/* The SSE frames of one chat call, as they actually arrive: in whatever lumps
   the network made of them. What is under test is the parser and the abort --
   the two things between a page and a model that can silently swallow a reply. */
import {afterEach, expect, test, vi} from 'vitest';
import {streamChat} from './chat';
import {Dropped, LATE_MS, NotAnswering, Stalled} from './stall';
import {Told} from './told';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const frame = (text: string) =>
  'data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\n\n';

/** A response body that hands over exactly these lumps, in this order. */
function body(lumps: string[], onCancel = () => {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: () => Promise.resolve(
        i < lumps.length ? {done: false, value: enc.encode(lumps[i++]!)} : {done: true}),
      cancel: () => { onCancel(); return Promise.resolve(); },
    }),
  };
}

const answers = (lumps: string[], onCancel?: () => void) =>
  vi.stubGlobal('fetch', () => Promise.resolve({ok: true, body: body(lumps, onCancel)}));

async function all(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
}

test('the deltas come out in the order the model wrote them', async () => {
  answers([frame('Yes.'), frame(' I thought so.'), 'data: [DONE]\n\n']);
  expect(await all(streamChat({messages: [{role: 'user', content: 'well?'}]})))
    .toEqual(['Yes.', ' I thought so.']);
});

test('a frame split across two reads is still one frame', async () => {
  // The network breaks a stream wherever it likes, and a `data:` line arriving
  // in halves used to be two lines that were neither of them JSON.
  const whole = frame('Stay... just like that.');
  answers([whole.slice(0, 20), whole.slice(20), 'data: [DONE]\n\n']);
  expect(await all(streamChat({messages: []}))).toEqual(['Stay... just like that.']);
});

test('and two frames arriving in one read are still two', async () => {
  answers([frame('One.') + frame('Two.') + 'data: [DONE]\n\n']);
  expect(await all(streamChat({messages: []}))).toEqual(['One.', 'Two.']);
});

test('[DONE] ends it, whatever the machine says after', async () => {
  answers([frame('One.'), 'data: [DONE]\n\n', frame('Two.')]);
  expect(await all(streamChat({messages: []}))).toEqual(['One.']);
});

test('a machine that says it went wrong is not a reply that came back empty', async () => {
  answers([frame('One.'), 'data: ' + JSON.stringify({error: 'the model has gone'}) + '\n\n']);
  await expect(all(streamChat({messages: []}))).rejects.toThrow('the model has gone');
});

test('a failure in the page\'s own words stays the page\'s, for the room to show', async () => {
  // Only a browser's stand-in sends `told`; the machine's errors are as they were.
  answers(['data: ' + JSON.stringify({error: 'this browser’s GPU let go of the pill', told: true}) + '\n\n']);
  await expect(all(streamChat({messages: []}))).rejects.toBeInstanceOf(Told);
  answers(['data: ' + JSON.stringify({error: 'the model has gone'}) + '\n\n']);
  await expect(all(streamChat({messages: []}))).rejects.not.toBeInstanceOf(Told);
});

test('a refusal is an error rather than a silence', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(
    {ok: false, status: 503, text: () => Promise.resolve('would not start')}));
  await expect(all(streamChat({messages: []}))).rejects.toThrow('503');
});

test('only what the persona actually set is sent', async () => {
  let sent: Record<string, unknown> = {};
  vi.stubGlobal('fetch', (_url: string, init: {body: string}) => {
    sent = JSON.parse(init.body) as Record<string, unknown>;
    return Promise.resolve({ok: true, body: body(['data: [DONE]\n\n'])});
  });
  await all(streamChat({messages: [], temperature: 0.9, top_p: null}));
  expect(sent.temperature).toBe(0.9);
  // A null top_p is a persona with no opinion about top_p, and sending it as
  // one is a different reply.
  expect('top_p' in sent).toBe(false);
  expect(sent.stream).toBe(true);
});

test('letting go of the stream tells the machine nobody is listening', async () => {
  let cancelled = false;
  answers([frame('One.'), frame('Two.'), 'data: [DONE]\n\n'], () => { cancelled = true; });
  for await (const d of streamChat({messages: []})) {
    expect(d).toBe('One.');
    break;                     // an interrupt, from the reply's point of view
  }
  expect(cancelled).toBe(true);
});

test('a last frame with no newline behind it is still a frame', async () => {
  /* A proxy flushing the tail of the body without its newline used to lose
     the last words and the [DONE] with them; the reply simply ended short. */
  answers(['data: {"choices":[{"delta":{"content":"One."}}]}\n\n',
           'data: {"choices":[{"delta":{"content":" Two."}}]}']);
  expect(await all(streamChat({messages: []}))).toEqual(['One.', ' Two.']);
});

// ---- A model that stops answering (stall.ts) ---------------------------------

/** A body that hands over these lumps and then nothing, ever: a stream that
    hangs without dropping. */
function hanging(lumps: string[], onCancel = () => {}) {
  const enc = new TextEncoder();
  let i = 0;
  vi.stubGlobal('fetch', () => Promise.resolve({ok: true, body: {
    getReader: () => ({
      read: () => (i < lumps.length ? Promise.resolve({done: false, value: enc.encode(lumps[i++]!)})
        : new Promise(() => {})),
      cancel: () => { onCancel(); return Promise.resolve(); },
    }),
  }}));
}

/** Read it to its end or its failure, noting what came and when it failed. */
function reading(o: Parameters<typeof streamChat>[0]) {
  const got: string[] = [];
  let failed: unknown = null;
  const done = (async () => {
    try {
      for await (const d of streamChat(o)) got.push(d);
    } catch (e) {
      failed = e;
    }
  })();
  return {got, done, failed: () => failed};
}

test('words that stop coming are a stall, a little after the machine would have said so', async () => {
  vi.useFakeTimers();
  let cancelled = false;
  hanging([frame('I was'), frame(' thinking')], () => { cancelled = true; });
  const r = reading({messages: [], firstMs: 90_000, nextMs: 15_000});
  await vi.advanceTimersByTimeAsync(15_000);
  // The machine's own fifteen seconds: its word would be on its way now.
  expect(r.failed()).toBe(null);
  await vi.advanceTimersByTimeAsync(LATE_MS);
  await r.done;
  expect(r.got).toEqual(['I was', ' thinking']);
  expect(r.failed()).toBeInstanceOf(Stalled);
  expect(r.failed()).toBeInstanceOf(NotAnswering);
  // And the stream is let go of, which is what frees the machine's queue.
  expect(cancelled).toBe(true);
});

test('before the first word, the prompt has its ninety seconds', async () => {
  vi.useFakeTimers();
  hanging([': keepalive\n\n']);
  const r = reading({messages: [], firstMs: 90_000, nextMs: 15_000});
  await vi.advanceTimersByTimeAsync(60_000);
  // A frame with no word in it is not an answer, and it is not a stall either.
  expect(r.failed()).toBe(null);
  await vi.advanceTimersByTimeAsync(30_000 + LATE_MS);
  await r.done;
  expect(r.failed()).toBeInstanceOf(Stalled);
  expect(r.got).toEqual([]);
});

test('a reader busy with a word is not the model being slow', async () => {
  /* Handing a sentence to the voice can take seconds; the stream is not
     read meanwhile, and that time is the reader's, not the model's. */
  vi.useFakeTimers();
  hanging([frame('One.'), frame(' Two.')]);
  const got: string[] = [];
  let failed: unknown = null;
  const done = (async () => {
    try {
      for await (const d of streamChat({messages: [], nextMs: 1000})) {
        got.push(d);
        await new Promise((go) => setTimeout(go, 30_000));
      }
    } catch (e) { failed = e; }
  })();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(got).toEqual(['One.', ' Two.']);
  expect(failed).toBe(null);
  await vi.advanceTimersByTimeAsync(1000 + LATE_MS);
  await done;
  expect(failed).toBeInstanceOf(Stalled);
});

test('the machine saying its model stopped answering is said quietly, not as a failure', async () => {
  answers([frame('One.'), 'data: ' + JSON.stringify(
    {error: 'the language model stopped answering', not_answering: true}) + '\n\n']);
  await expect(all(streamChat({messages: []}))).rejects.toBeInstanceOf(NotAnswering);
  // Anything else stays what it was.
  answers(['data: ' + JSON.stringify({error: 'the model has gone'}) + '\n\n']);
  await expect(all(streamChat({messages: []}))).rejects.not.toBeInstanceOf(NotAnswering);
});

test('a stream that drops under a reply is that, and an abort is still an abort', async () => {
  const enc = new TextEncoder();
  const failing = (why: Error) => {
    let i = 0;
    vi.stubGlobal('fetch', () => Promise.resolve({ok: true, body: {getReader: () => ({
      read: () => (i++ === 0 ? Promise.resolve({done: false, value: enc.encode(frame('One.'))})
        : Promise.reject(why)),
      cancel: () => Promise.resolve(),
    })}}));
  };
  failing(new TypeError('network error'));
  await expect(all(streamChat({messages: []}))).rejects.toBeInstanceOf(Dropped);
  const cut = new AbortController();
  cut.abort();
  failing(new DOMException('aborted', 'AbortError'));
  await expect(all(streamChat({messages: [], signal: cut.signal}))).rejects.not.toBeInstanceOf(NotAnswering);
});
