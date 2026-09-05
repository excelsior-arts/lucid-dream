/* The SSE frames of one chat call, as they actually arrive: in whatever lumps
   the network made of them. What is under test is the parser and the abort --
   the two things between a page and a model that can silently swallow a reply. */
import {afterEach, expect, test, vi} from 'vitest';
import {streamChat} from './chat';

afterEach(() => { vi.unstubAllGlobals(); });

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
