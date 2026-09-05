/* One reply, from tokens to sound.
 *
 * The chat stream and the voice are fakes the test drives by hand; the queue
 * is a stand-in that writes down what it was handed, because what is under
 * test is the order of things. Ported from what session.py's `_reply` and its
 * `flush` do, which had no test of their own in Python -- they were three
 * models and a microphone away from being one.
 */
import {afterEach, expect, test, vi} from 'vitest';
import type {Playback} from '@lucid/audio';
import type {Frame, Socketish, Voice} from './tts';
import {openVoice} from './tts';

const chat = vi.hoisted(() => ({
  /** The deltas the model will write. */
  script: [] as string[],
  /** Whether it waits to be told to write the next one, and who is waiting. */
  gated: false,
  waiting: [] as Array<() => void>,
  asked: [] as unknown[],
}));

vi.mock('./chat', () => ({
  streamChat: (o: {signal?: AbortSignal}) => {
    chat.asked.push(o);
    return (async function* () {
      for (const d of chat.script) {
        /* The real one is a fetch: an abort comes back out of it as a throw,
           in the middle of the reply, and that is the path an interrupt
           actually takes. */
        if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield d;
        if (chat.gated) await new Promise<void>((go) => { chat.waiting.push(go); });
      }
      if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    })();
  },
}));

const {runReply} = await import('./reply');

/** What was put into the queue, in the order it went in. */
function fakePlayback() {
  const put: Array<{pcm: string; rate: number} | {chars: number}> = [];
  const p = {
    enqueue: (pcm: string, rate: number) => { put.push({pcm, rate}); },
    // A speaker that plays what it is handed at once: the credit is banked.
    credit: (chars: number) => { put.push({chars}); p.spokenChars += chars; },
    stop: vi.fn(),
    hold: vi.fn(),
    queuedS: 0, playingS: 0, playedS: 0, spokenChars: 0, playingChars: 0, playing: false, held: false,
    sinceStartMs: 0,
    stalled: false,
    expecting: false,
    expect() {},
    position: () => 0,
    onChange() { return () => {}; },
    onUnheard() { return () => {}; },
    unlockOnce() { return () => {}; },
    dispose() {},
  };
  return {playback: p as unknown as Playback, put, raw: p};
}

/** A voice that answers every chunk with one frame, and remembers what it was
    asked to say. */
function fakeVoice() {
  const said: Array<{text: string; endsParagraph: boolean}> = [];
  const stop = vi.fn();
  const voice: Voice = {
    speak(text: string, endsParagraph = false): AsyncIterable<Frame> {
      said.push({text, endsParagraph});
      return (async function* () {
        yield {pcm: 'pcm:' + text, rate: 24000, chars: text.length + 1};
      })();
    },
    stop,
    close() {},
    stats: {},
  };
  return {voice, said, stop};
}

/** Let the model write one more delta, and wait for what that does. */
const step = async () => {
  chat.waiting.shift()?.();
  await new Promise((go) => setTimeout(go, 0));
};

/** And let it write the rest of them. */
const letGo = () => {
  chat.gated = false;
  while (chat.waiting.length) chat.waiting.shift()!();
};

afterEach(() => {
  chat.script = [];
  chat.gated = false;
  chat.waiting = [];
  chat.asked = [];
  vi.clearAllMocks();
});

const run = (o: Partial<Parameters<typeof runReply>[0]> = {}) => {
  const q = fakePlayback();
  const v = fakeVoice();
  const done: Array<[string, string[]]> = [];
  const reply = runReply({
    messages: [{role: 'user', content: 'well?'}],
    voice: v.voice,
    playback: q.playback,
    onDone: (text, spoken) => { done.push([text, spoken]); },
    ...o,
  });
  return {reply, q, v, done};
};

test('sentences are spoken in order, as soon as they exist', async () => {
  chat.script = ['Yes.', ' Come here.', ' Sit down. Stay a while.'];
  const {reply, v, done} = run();
  await reply.done;
  /* Whole sentences, handed over as soon as they exist rather than when the
     reply is finished -- which is the whole reason the buffer is split at all.
     A sentence at a time is what a model streaming at this speed produces;
     what happens when several arrive together is the splitter's, and
     speech.test.ts is where that is said. */
  expect(v.said.map((s) => s.text))
    .toEqual(['Yes.', 'Come here.', 'Sit down.', 'Stay a while.']);
  expect(done[0]?.[0]).toBe('Yes. Come here. Sit down. Stay a while.');
});

test('and a reply that arrives all at once is spoken a sentence at a time while nothing is queued', async () => {
  /* Nothing is playing yet, so nothing covers the wait a bigger call would
     add: every sentence goes the moment it is complete. What the splitter is
     looking at, each time it is asked, is the buffer that has not been spoken
     yet; how many sentences it carries in one call is the queue's to say --
     see the next test, and mergeFor in speech.ts. */
  chat.script = ['Yes. Come here. Sit down. Stay a while.'];
  const {reply, v} = run();
  await reply.done;
  expect(v.said.map((s) => s.text))
    .toEqual(['Yes.', 'Come here.', 'Sit down.', 'Stay a while.']);
});

test('with seconds of audio waiting, the sentences are carried together', async () => {
  /* A fast model has the reply written while the voice is on its second
     sentence. The seconds queued are time the voice can spend on one bigger
     call without a gap, and one call is one arc of intonation where several
     are seams. The opening is spared: it went before anything was queued. */
  chat.script = ['Yes. Come', ' here. Sit down. Stay a while. I mean it.'];
  chat.gated = true;
  const {reply, v, q} = run();
  const said = () => v.said.map((s) => s.text);
  await new Promise((go) => setTimeout(go, 0));
  expect(said()).toEqual(['Yes.']);      // spoken alone: the queue was empty
  q.raw.queuedS = 4;                     // ~22 words' worth, by mergeFor
  letGo();
  await reply.done;
  expect(said()[0]).toBe('Yes.');
  expect(said().slice(1)).toEqual(['Come here. Sit down. Stay a while. I mean it.']);
});

test('each chunk handed to the voice is reported in counts, and never in words', async () => {
  chat.script = ['Yes. Come', ' here. Sit down. Stay a while. I mean it.'];
  chat.gated = true;
  const chunks: Array<Parameters<NonNullable<Parameters<typeof runReply>[0]['onChunk']>>[0]> = [];
  const {reply, q} = run({onChunk: (c) => { chunks.push(c); }});
  await new Promise((go) => setTimeout(go, 0));
  expect(chunks).toEqual([{n: 1, words: 1, chars: 4, queuedS: 0, merge: 0, paragraph: false}]);
  q.raw.queuedS = 4;
  letGo();
  await reply.done;
  expect(chunks).toHaveLength(2);
  expect(chunks[1]).toMatchObject({n: 2, words: 10, queuedS: 4, merge: 23, paragraph: false});
  for (const c of chunks) expect(JSON.stringify(c)).not.toMatch(/Come|here|Sit/);
});

test('and muted, the size of a chunk is nobody\'s concern', async () => {
  chat.script = ['Yes. Come here. Sit down.'];
  const {reply, done, q} = run({voice: null});
  q.raw.queuedS = 9;                     // a queue that cannot be: nothing is played
  await reply.done;
  expect(done[0]?.[1]).toEqual(['Yes.', 'Come here.', 'Sit down.']);
});

test('the last chunk is held back until the reply is finished', async () => {
  /* While a reply is streaming the last sentence is still being written, and
     handing it over as though it were finished is the "one word at a time"
     bug. */
  chat.script = ['One.', ' Two.'];
  chat.gated = true;                            // a gate the test opens by hand
  const {reply, v} = run();
  await new Promise((go) => setTimeout(go, 0));
  expect(v.said.map((s) => s.text)).toEqual([]);  // one chunk so far: nothing to say
  await step();
  expect(v.said.map((s) => s.text)).toEqual(['One.']);
  letGo();
  await reply.done;
  expect(v.said.map((s) => s.text)).toEqual(['One.', 'Two.']);
});

test('the frames go into the queue, and the characters they cover with them', async () => {
  chat.script = ['Yes. And no.'];
  const {reply, q} = run();
  await reply.done;
  expect(q.put).toEqual([
    {pcm: 'pcm:Yes.', rate: 24000}, {chars: 5},
    {pcm: 'pcm:And no.', rate: 24000}, {chars: 8},
  ]);
});

test('the credit is the chunk as written, plus the space it was split on', async () => {
  chat.script = ['I know. [sigh]'];
  const {reply, q} = run();
  await reply.done;
  /* Not what the voice produced: the machine strips bracketed tags and every
     asterisk before synthesis, so counting the characters it streamed would
     count markup that is never said. */
  expect(q.put).toContainEqual({chars: 'I know. [sigh]'.length + 1});
});

test('a paragraph the model finished is spoken as one', async () => {
  chat.script = ['One.\n\nTwo.\n'];
  const {reply, v} = run();
  await reply.done;
  // The break the model wrote goes as a flag rather than as a newline: the
  // machine owns the beat that goes after it.
  expect(v.said).toEqual([
    {text: 'One.', endsParagraph: true},
    {text: 'Two.', endsParagraph: true},
  ]);
});

test('an interrupt keeps the prefix that was actually spoken', async () => {
  /* The third delta is a sentence still being written when the press comes:
     a finished one would have been handed to the voice by then -- nothing is
     queued, so nothing waits -- and this speaker plays what it is handed. */
  chat.script = ['She put the glass down.\n\n', '*a long pause*\n\n', 'You were saying', '. Go on.'];
  chat.gated = true;
  const {reply, done, q, v} = run();
  await new Promise((go) => setTimeout(go, 0));
  await step();                       // the first paragraph is spoken
  await step();                       // and the second
  reply.interrupt();
  letGo();
  await reply.done;
  const [text] = done[0] ?? [''];
  expect(text).toContain('She put the glass down.');
  expect(text, 'a line the voice never reached is in the transcript')
    .not.toContain('You were saying');
  // The blank line the model wrote is still there: what is stored is cut out
  // of its own text, not rebuilt from the pieces it was spoken in.
  expect(text).toContain('\n\n');
  // And the room went quiet on the press, not a beat later.
  expect(q.raw.stop).toHaveBeenCalledWith(false);
  expect(v.stop).toHaveBeenCalled();
});

test('a steer lets the line it is on land', async () => {
  /* Talking over the pill while it is carrying the evening is a steer, not an
     interruption: the sentence in hand finishes, what is queued behind it goes,
     and nothing more is written. Cutting a voice off mid-word to answer
     somebody reads as a machine glitching. */
  chat.script = ['She put the glass down.\n\n', 'You were saying.'];
  chat.gated = true;
  const {reply, done, q, v} = run();
  await new Promise((go) => setTimeout(go, 0));
  await step();
  reply.steer();
  letGo();
  await reply.done;
  expect(q.raw.stop).toHaveBeenCalledWith(true);
  expect(v.stop).toHaveBeenCalled();
  expect(done[0]?.[0]).toContain('She put the glass down.');
  expect(done[0]?.[0]).not.toContain('You were saying');
});

test('cut off before a token arrived, nothing is stored at all', async () => {
  chat.script = [];
  const {reply, done} = run();
  reply.interrupt();
  await reply.done;
  // An empty turn would go into the transcript and back to the model as context.
  expect(done).toEqual([]);
});

test('what the persona is set to goes to the model, and nothing else does', async () => {
  chat.script = ['Yes.'];
  const {reply} = run({temperature: 0.9, max_tokens: 900});
  await reply.done;
  const asked = chat.asked[0] as {temperature: number; max_tokens: number};
  expect(asked.temperature).toBe(0.9);
  expect(asked.max_tokens).toBe(900);
});

test('a reply is in flight from before its first sentence until after its last', async () => {
  /* A reply is a run of sentences with gaps between them, and a run waits on
     this before it writes the next turn. */
  chat.script = ['One.', ' Two.'];
  chat.gated = true;
  const {reply} = run();
  await new Promise((go) => setTimeout(go, 0));
  expect(reply.holding).toBe(true);
  letGo();
  await reply.done;
  expect(reply.holding).toBe(false);
});

test('the state says speaking once the first chunk is handed over', async () => {
  chat.script = ['One.', ' Two.'];
  const speaking = vi.fn();
  const {reply} = run({onSpeaking: speaking});
  await reply.done;
  expect(speaking).toHaveBeenCalledTimes(1);
});

test('pause is the sound in the room, and the reply hands it straight on', async () => {
  chat.script = ['One.'];
  const {reply, q} = run();
  await reply.done;
  reply.hold(true);
  expect(q.raw.hold).toHaveBeenCalledWith(true);
});

/* ---- and the same thing over a real socket -------------------------------- */

/** A stand-in machine: chunks in, and the test decides when each frame and
    each `done` comes back — including a `done` that arrives long after the
    page stopped listening, which is the whole of what is under test here. */
function fakeMachine() {
  let sock: Socketish | null = null;
  const chunks: Array<{id: string; text: string}> = [];
  const make = (): Socketish => {
    sock = {
      readyState: 1,
      send: (data: string) => {
        const m = JSON.parse(data) as {id?: string; text?: string};
        if (m.id) chunks.push({id: m.id, text: m.text ?? ''});
      },
      close: () => { sock?.onclose?.(); },
      onopen: null, onmessage: null, onclose: null,
    };
    queueMicrotask(() => sock?.onopen?.());
    return sock;
  };
  const say = (msg: unknown) => sock?.onmessage?.({data: JSON.stringify(msg)});
  return {
    make, chunks,
    frame: (n: number) => say({id: chunks[n]?.id, pcm: 'pcm:' + chunks[n]?.text,
                               rate: 24000, chars: 5}),
    done: (n: number) => say({id: chunks[n]?.id, done: true, stats: {}}),
  };
}

test('the first sentence of the reply after an interrupt is spoken', async () => {
  /* The blocker, end to end: a reply cut off mid-chunk leaves the machine
     finishing that chunk, and its `done` lands after the next reply's first
     sentence has gone up. Unnamed, that late `done` ended the new chunk and
     the reply carried on from sentence two -- in silence, with the words on
     the glass and no voice under them. */
  const wire = fakeMachine();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});

  chat.script = ['One.', ' Two.'];
  chat.gated = true;
  const first = run({voice});
  await new Promise((go) => setTimeout(go, 0));
  await step();                        // "One." goes up
  expect(wire.chunks.map((c) => c.text)).toEqual(['One.']);
  wire.frame(0);
  await new Promise((go) => setTimeout(go, 0));
  first.reply.interrupt();
  wire.frame(0);                       // one more, already in flight: it lets go here
  letGo();
  await first.reply.done;

  // The next turn. Its first sentence goes up while the machine is still
  // finishing the one nobody wanted.
  chat.script = ['Hello again.'];
  const next = run({voice});
  await new Promise((go) => setTimeout(go, 0));
  expect(wire.chunks[1]?.text).toBe('Hello again.');
  wire.done(0);                        // the abandoned chunk's, arriving late
  wire.frame(1);
  wire.done(1);
  await next.reply.done;

  expect(next.q.put).toEqual([{pcm: 'pcm:Hello again.', rate: 24000}, {chars: 5}]);
  voice.close();
});

test('what has been spoken can be asked for at any moment', async () => {
  /* For the page being closed mid-reply: there is no chance to interrupt, one
     synchronous moment, and the answer to his line is otherwise lost. */
  chat.script = ['One.', ' Two.', ' Three.'];
  chat.gated = true;
  const {reply, done} = run();
  await new Promise((go) => setTimeout(go, 0));
  expect(reply.snapshot()).toBe('');        // nothing spoken yet
  await step();
  expect(reply.snapshot()).toBe('One.');
  await step();
  expect(reply.snapshot()).toBe('One. Two.');
  letGo();
  await reply.done;
  // And it is the same text an interrupt would have kept.
  expect(reply.snapshot()).toBe(done[0]?.[0]);
});

/* ---- and a reply with no voice at all -------------------------------------
 *
 * The sound is fully muted, so the reply is given no voice: nothing is sent,
 * which means no socket is opened and the machine loads no voice for words
 * nobody is going to hear. The words still arrive, and the turn still ends.
 */

test('a muted reply opens no socket and still streams, and still finishes',
  async () => {
    let sockets = 0;
    const wire = fakeMachine();
    const counted = () => { sockets += 1; return wire.make(); };
    // The voice exists — the room made one on the way in — and is simply not
    // handed to this reply. Nothing must dial it.
    openVoice({voice: 'lover', url: 'ws://x', socket: counted});

    chat.script = ['Yes.', ' Come here.'];
    const {reply, q, done} = run({voice: null});
    await reply.done;
    expect(sockets).toBe(0);
    expect(wire.chunks).toEqual([]);
    // Nothing went into the queue either: there is no audio to put in it.
    expect(q.put).toEqual([]);
    expect(done[0]?.[0]).toBe('Yes. Come here.');
    // And what "was said" is what the page was handed, which is the cut an
    // interrupt would be made at.
    expect(done[0]?.[1]).toEqual(['Yes.', 'Come here.']);
  });

test('and a muted reply cut off keeps what had reached the page', async () => {
  chat.script = ['Yes.', ' Come here.', ' Sit down.'];
  chat.gated = true;
  const {reply, done} = run({voice: null});
  await new Promise((go) => setTimeout(go, 0));
  await step();
  reply.interrupt();
  letGo();
  await reply.done;
  expect(done[0]?.[0]).toBe('Yes.');
});

test('what an interrupt keeps is what the speaker got to, not what the voice was handed', async () => {
  /* The voice runs ahead of the speaker: three sentences are made and queued
     while the first is still playing. Cut then, the transcript used to keep
     all three as said, and a page closed mid-reply beaconed them to disk --
     sentences nobody heard, shown to the model as context the next evening.
     The speaker banks a chunk's characters when it has played, and says
     whose it is playing; that is how far the reply got. */
  chat.script = ['One.', ' Two.', ' Three.', ' Four.'];
  chat.gated = true;
  const {reply, q, v, done} = run();
  await new Promise((go) => setTimeout(go, 0));
  await step(); await step(); await step();
  expect(v.said.map((x) => x.text)).toEqual(['One.', 'Two.', 'Three.']);
  // 'One.' has played; 'Two.' is the chunk in hand; 'Three.' is queued.
  q.raw.spokenChars = 'One.'.length + 1;
  q.raw.playingChars = 'Two.'.length + 1;
  expect(reply.snapshot()).toBe('One. Two.');
  reply.interrupt();
  letGo();
  await reply.done;
  expect(done[0]?.[0]).toBe('One. Two.');
  expect(done[0]?.[1]).toEqual(['One.', 'Two.']);
});

test('and muted, what was handed to the page is what got out', async () => {
  chat.script = ['One.', ' Two.', ' Three.'];
  chat.gated = true;
  const {reply, done} = run({voice: null});
  await new Promise((go) => setTimeout(go, 0));
  await step(); await step();
  reply.interrupt();
  letGo();
  await reply.done;
  expect(done[0]?.[0]).toBe('One. Two.');
});

test('a cut from outside is an interrupt, not trouble', async () => {
  /* `signal` is the room being left or the page going away. It aborted the
     stream, and the abort was read as the model failing: trouble reported,
     no transcript kept, the bubble left streaming. */
  chat.script = ['One.', ' Two.', ' Three.'];
  chat.gated = true;
  const cut = new AbortController();
  const trouble: Error[] = [];
  const {reply, done} = run({signal: cut.signal, onTrouble: (e) => trouble.push(e)});
  await new Promise((go) => setTimeout(go, 0));
  await step(); await step();
  cut.abort();
  letGo();
  await reply.done;
  expect(trouble).toEqual([]);
  expect(done[0]?.[0]).toBe('One. Two.');
});
