/* The voice socket: chunks up, frames down, one chunk at a time.
 *
 * The socket is the one thing stubbed. What is under test is what the machine
 * on the other end has to be able to rely on -- that a chunk is not sent until
 * the one in front of it is done, that `chars` arrives on the first frame of a
 * chunk and nowhere else, that a chunk let go of takes its name with it, and
 * that a socket going away is said out loud rather than leaving a reply
 * waiting on frames that are not coming.
 */
import {expect, test} from 'vitest';
import type {Frame, Socketish} from './tts';
import {openVoice, VoiceFailed, VoiceRefused} from './tts';

function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  let sock: Socketish | null = null;
  const make = (): Socketish => {
    sock = {
      readyState: 1,
      send: (data: string) => { sent.push(JSON.parse(data) as Record<string, unknown>); },
      close: () => { sock?.onclose?.(); },
      onopen: null,
      onmessage: null,
      onclose: null,
    };
    // The machine accepts on the next tick, the way a real one does.
    queueMicrotask(() => sock?.onopen?.());
    return sock;
  };
  return {
    make,
    sent,
    says(msg: unknown) { sock?.onmessage?.({data: JSON.stringify(msg)}); },
    /** The same, in the name the machine was given for that chunk: every
        frame it sends carries the id back. */
    about(n: number, msg: Record<string, unknown>) {
      sock?.onmessage?.({data: JSON.stringify({...msg, id: sent[n]?.id})});
    },
    hangUp() { sock?.onclose?.(); },
  };
}

/** Read the frames of one chunk, saying `after` once it has gone up: the
    socket accepts, the chunk is sent, and only then does the machine answer. */
const took = async (it: AsyncIterable<Frame>, after: () => void): Promise<Frame[]> => {
  const out: Frame[] = [];
  setTimeout(after, 0);
  for await (const f of it) out.push(f);
  return out;
};

const settle = () => new Promise((go) => setTimeout(go, 0));

test('a chunk goes up with the voice it is to be said in', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x/machine/tts', socket: wire.make});
  const frames = await took(voice.speak('Yes.', false), () => {
    wire.says({pcm: 'AAA', rate: 24000, chars: 5});
    wire.says({done: true, stats: {rtf: 0.4}});
  });
  // The id is this end's own name for the chunk, and comes back on every
  // frame the machine sends about it. See the note at the top of tts.ts.
  expect(wire.sent).toEqual([
    {text: 'Yes.', voice: 'lover', ends_paragraph: false, id: 'c1'},
  ]);
  expect(frames).toEqual([{pcm: 'AAA', rate: 24000, chars: 5}]);
  expect(voice.stats).toEqual({rtf: 0.4});
  voice.close();
});

test('one chunk produces as many frames as the voice made of it', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  const frames = await took(voice.speak('One. Two.'), () => {
    // chars on the first frame only, so a page pacing its words against the
    // voice does not count the same characters three times.
    wire.says({pcm: 'a', rate: 24000, chars: 10});
    wire.says({pcm: 'b', rate: 24000, chars: 0});
    wire.says({done: true, stats: {}});
  });
  expect(frames.map((f) => f.chars)).toEqual([10, 0]);
  voice.close();
});

test('the next chunk waits for the one in front of it', async () => {
  /* The machine answers `done` per chunk, so two in flight would be two runs
     of frames with nothing in them saying which is which. */
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  const first = voice.speak('One.');
  const second = voice.speak('Two.');
  const both: string[] = [];
  const reading = (async () => {
    for await (const f of first) both.push('1:' + f.pcm);
    for await (const f of second) both.push('2:' + f.pcm);
  })();
  await settle();
  expect(wire.sent.map((m) => m.text)).toEqual(['One.']);
  wire.says({pcm: 'a', rate: 24000, chars: 5});
  wire.says({done: true, stats: {}});
  await settle();
  expect(wire.sent.map((m) => m.text)).toEqual(['One.', 'Two.']);
  wire.says({pcm: 'b', rate: 24000, chars: 5});
  wire.says({done: true, stats: {}});
  await reading;
  expect(both).toEqual(['1:a', '2:b']);
  voice.close();
});

test('a paragraph ending says so, and the machine puts the beat in', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  await took(voice.speak('One.', true), () => wire.says({done: true, stats: {}}));
  expect(wire.sent[0]?.ends_paragraph).toBe(true);
  voice.close();
});

test('stop abandons the chunk being made and keeps the socket', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  await took(voice.speak('One.'), () => {
    voice.stop();
    wire.says({done: true, stats: {}});
  });
  expect(wire.sent).toEqual([
    {text: 'One.', voice: 'lover', ends_paragraph: false, id: 'c1'},
    {stop: true},
  ]);
  voice.close();
});

test('a socket that went away is said rather than waited on', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  await expect(took(voice.speak('One.'), () => wire.hangUp()))
    .rejects.toThrow('the voice socket closed');
  voice.close();
});

test('the machine saying it would not speak is not a silence', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  await expect(took(voice.speak('One.'), () => wire.says({error: 'the voice would not load'})))
    .rejects.toThrow('the voice would not load');
  voice.close();
});

test('a chunk let go of does not end the one that replaced it', async () => {
  /* The blocker, in the order it happens: a reply is cut off mid-chunk, the
     machine finishes that chunk anyway and answers it a second later, and by
     then the next reply's first sentence is the one being spoken. Unnamed,
     that late `done` ended it -- its frames arrived to nothing and the reply
     carried on from sentence two, every time. */
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});

  // A, one frame taken and then let go of, which is what an interrupt does.
  const a = voice.speak('One.')[Symbol.asyncIterator]();
  const first = a.next();
  await settle();
  wire.about(0, {pcm: 'a', rate: 24000, chars: 5});
  expect((await first).value).toEqual({pcm: 'a', rate: 24000, chars: 5});
  await a.return?.();
  voice.stop();

  // B, the next reply's first sentence, sent while A is still being made.
  const heard: Frame[] = [];
  const reading = (async () => { for await (const f of voice.speak('Two.')) heard.push(f); })();
  await settle();
  const b = wire.sent.findIndex((m) => m.text === 'Two.');
  expect(b).toBeGreaterThan(0);
  expect(wire.sent[b]?.id).not.toBe(wire.sent[0]?.id);

  wire.about(0, {done: true, stats: {rtf: 9}});     // A's, arriving late
  wire.about(b, {pcm: 'b', rate: 24000, chars: 4});
  wire.about(b, {done: true, stats: {rtf: 0.4}});
  await reading;
  // The sentence was heard, and its credit went with it.
  expect(heard).toEqual([{pcm: 'b', rate: 24000, chars: 4}]);
  expect(voice.stats).toEqual({rtf: 0.4});
  voice.close();
});

test('letting go of a chunk says so, so the machine can drop the rest of it', async () => {
  /* A replay pressed twice abandons its iterator and sends no stop of its
     own. Without this the machine went on making sentences nobody would hear,
     with the next reply queued behind them on the one thread. */
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  const it = voice.speak('One.')[Symbol.asyncIterator]();
  const first = it.next();
  await settle();
  wire.about(0, {pcm: 'a', rate: 24000, chars: 5});
  await first;
  expect(wire.sent).toHaveLength(1);
  await it.return?.();
  expect(wire.sent[1]).toEqual({stop: true});
  voice.close();
});

test('a chunk read to the end says nothing more about it', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  await took(voice.speak('One.'), () => wire.about(0, {done: true, stats: {}}));
  expect(wire.sent).toEqual([{text: 'One.', voice: 'lover', ends_paragraph: false, id: 'c1'}]);
  voice.close();
});

test('a voice the shelf has not got is a refusal, not a machine that is down', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'nobody', url: 'ws://x', socket: wire.make});
  await expect(took(voice.speak('One.'),
                    () => wire.about(0, {error: "no voice named 'nobody'", refused: 'voice'})))
    .rejects.toThrow(VoiceRefused);
  voice.close();
});

test('a chunk the voice could not make is the voice failing, not the machine', async () => {
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  await expect(took(voice.speak('One.'), () => wire.about(0, {error: 'RuntimeError: Aborted()'})))
    .rejects.toThrow(VoiceFailed);
  voice.close();
});

test('a chunk asked for and never read does not hold the ones behind it', async () => {
  /* The place in the queue used to be taken on the call and released inside
     the generator -- so a chunk nobody iterated kept its place for ever, and
     every sentence after it on the socket waited behind nothing. */
  const wire = fakeSocket();
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: wire.make});
  void voice.speak('One.');                            // asked for, never read
  const heard: Frame[] = [];
  const reading = (async () => { for await (const f of voice.speak('Two.')) heard.push(f); })();
  await settle();
  const b = wire.sent.findIndex((m) => m.text === 'Two.');
  expect(b).toBeGreaterThanOrEqual(0);
  wire.about(b, {pcm: 'b', rate: 24000, chars: 5});
  wire.about(b, {done: true, stats: {rtf: 0.4}});
  await reading;
  expect(heard).toEqual([{pcm: 'b', rate: 24000, chars: 5}]);
  voice.close();
});

test('a socket still closing does not take the next one with it', async () => {
  /* The old socket's close handler used to wipe whichever socket the voice
     held and fail whichever chunks were live -- the new socket's. The machine
     went on speaking into a socket nobody held, stop() had nothing to send
     to, and the chunk after that opened a third. */
  const wire = fakeSocket();
  const made: Socketish[] = [];
  const voice = openVoice({voice: 'lover', url: 'ws://x', socket: () => { const s = wire.make(); made.push(s); return s; }});
  const first = (async () => { for await (const f of voice.speak('One.')) void f; })();
  await settle();
  wire.about(0, {done: true, stats: {}});
  await first;
  made[0]!.readyState = 2;                                 // closing, not closed
  const heard: Frame[] = [];
  const second = (async () => { for await (const f of voice.speak('Two.')) heard.push(f); })();
  await settle();
  expect(made).toHaveLength(2);
  made[0]!.onclose?.();                                    // the old one goes, late
  const b = wire.sent.findIndex((m) => m.text === 'Two.');
  wire.about(b, {pcm: 'b', rate: 24000, chars: 5});
  wire.about(b, {done: true, stats: {rtf: 0.4}});
  await second;
  expect(heard).toEqual([{pcm: 'b', rate: 24000, chars: 5}]);
  voice.stop();
  expect(wire.sent[wire.sent.length - 1]).toEqual({stop: true});   // sent down the socket it holds
  voice.close();
});
