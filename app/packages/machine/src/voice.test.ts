/* The loop, from a voice stopping to a line somebody can answer.
 *
 * What Python's _handle_audio did between the microphone and the turn — the
 * recognizer, the junk filter, the seconds — happens here now, so this is the
 * test that used to be the first half of test_speech and the mic's own events
 * in session.py. What a game does with the line is the game's, and is tested
 * where that is decided: packages/talk/src/routes/room/audio.test.ts.
 *
 * Nothing below opens a device. The microphone and the speaker are stubbed at
 * the module boundary and the detector is driven by hand, because what is
 * being checked is the wiring between them and not any of the three.
 */
import {beforeEach, expect, test, vi} from 'vitest';
import type {Vad, VadEvent} from '@lucid/audio';

/* The four things the loop makes, replaced by the least that will stand in for
   them: a detector with a hand on it, a speaker that only remembers being
   stopped, and a microphone and a pacer that do nothing at all. */
const kit = vi.hoisted(() => {
  const ears = new Set<(e: VadEvent) => void>();
  return {
    ears,
    stopped: [] as boolean[],
    fed: [] as unknown[],
    say: (e: VadEvent) => { for (const fn of [...ears]) fn(e); },
  };
});

vi.mock('@lucid/audio', async (real) => ({
  ...(await real<typeof import('@lucid/audio')>()),
  createPlayback: () => ({stop: (soft: boolean) => kit.stopped.push(soft), dispose: () => {}, expect: () => {}}),
  createVad: () => ({
    on(fn: (e: VadEvent) => void) { kit.ears.add(fn); return () => kit.ears.delete(fn); },
    reset: () => {},
    feed: () => {},
    tune: (t: unknown) => kit.fed.push(t),
    barge: false,
  }) as unknown as Vad,
  createCapture: () => ({
    on: false,
    status: () => ({aec: true, lying: false, canBeHeard: true}),
    onChange: () => () => {},
    dispose: () => {},
  }),
  createPacer: () => ({reset: () => {}, dispose: () => {}}),
}));

const {createVoiceLoop} = await import('./voice');

let heard: Array<[string, number]> = [];
let listened: boolean[] = [];
let dropped: Array<[number, boolean]> = [];
let said: string[] = [];
let cut = 0;
let text = 'are you there';

/** A loop wired to nothing but the arrays above. */
const loop = (over: Partial<Parameters<typeof createVoiceLoop>[0]> = {}) =>
  createVoiceLoop({
    onHeard: (t, s) => heard.push([t, s]),
    onListening: (active) => listened.push(active),
    onDropped: (ms, barged) => dropped.push([ms, barged]),
    say: (line) => said.push(line),
    reply: () => ({interrupt: () => { cut += 1; }}),
    transcribe: () => Promise.resolve(text),
    tunables: () => Promise.resolve({}),
    ...over,
  });

beforeEach(() => {
  kit.ears.clear();
  kit.stopped = [];
  kit.fed = [];
  heard = [];
  listened = [];
  dropped = [];
  said = [];
  cut = 0;
  text = 'are you there';
});

test('a turn heard is a turn handed on, with how long the room listened', async () => {
  loop();
  kit.say({type: 'utterance', samples: new Float32Array(16000), seconds: 1.04});
  await vi.waitFor(() => expect(heard).toHaveLength(1));
  expect(heard[0]).toEqual(['are you there', 1]);
});

test('and what the recognizer says when it heard the room is not one', async () => {
  loop();
  text = 'Thank you.';
  kit.say({type: 'utterance', samples: new Float32Array(16000), seconds: 1.0});
  await vi.waitFor(() => expect(said.length).toBeGreaterThan(0));
  // Said rather than dropped in silence: a turn that was heard and then
  // quietly lost looks like a machine that has stopped listening.
  expect(said[0]).toMatch(/no usable speech/);
  expect(heard).toHaveLength(0);
});

test('a recognizer that would not answer says so instead of nothing', async () => {
  loop({transcribe: () => Promise.reject(new Error('answered 503'))});
  kit.say({type: 'utterance', samples: new Float32Array(16000), seconds: 1.0});
  await vi.waitFor(() => expect(said.length).toBeGreaterThan(0));
  expect(said[0]).toMatch(/503/);
});

test('the microphone opening and closing is the room listening', () => {
  loop();
  kit.say({type: 'listening', active: true});
  kit.say({type: 'listening', active: false});
  expect(listened).toEqual([true, false]);
});

test('talking over it stops this page first and cuts the reply after', () => {
  loop();
  kit.say({type: 'barge', spoken: true});
  // The queue that has to stop is the one on this page, and waiting for a
  // round trip is a sentence and a half of somebody talking over it.
  expect(kit.stopped).toEqual([false]);
  expect(cut).toBe(1);
});

test('but a key that took the floor is not an interruption', () => {
  loop();
  kit.say({type: 'barge', spoken: false});
  expect(kit.stopped).toEqual([false]);
  expect(cut).toBe(0);
});

test('and a barge with no reply in flight stops the queue and nothing else', () => {
  loop({reply: () => null});
  kit.say({type: 'barge', spoken: true});
  expect(kit.stopped).toEqual([false]);
});

test('a noise too short to be a turn is worth saying only for what it cost', () => {
  loop();
  kit.say({type: 'dropped', ms: 320, barged: true});
  expect(dropped).toEqual([[320, true]]);
});

test('and what the detector has to say goes to the console', () => {
  loop();
  kit.say({type: 'log', text: 'still learning'});
  expect(said).toEqual(['still learning']);
});

test('the numbers it hears by are the machine\'s, read once', async () => {
  const it = loop({tunables: () => Promise.resolve({vad: {floor_mult: 9}, mic_barge: 'on'})});
  await vi.waitFor(() => expect(kit.fed).toHaveLength(1));
  expect((kit.fed[0] as {floorMult: number}).floorMult).toBe(9);
  expect(it.micBarge).toBe('on');
});

test('and a machine that will not say leaves the defaults', async () => {
  const it = loop({tunables: () => Promise.reject(new Error('down'))});
  await Promise.resolve();
  expect(kit.fed).toHaveLength(0);
  expect(it.micBarge).toBe('auto');
});

test('a turn transcribed after the loop is gone is nobody\'s', async () => {
  /* The request cannot be taken back, and a recognizer still loading answers
     it fifteen seconds later -- into a room that has been left, where it
     opened the conversation again from the shelf and answered it there. */
  let answer: (t: string) => void = () => {};
  const it = loop({transcribe: () => new Promise<string>((go) => { answer = go; })});
  kit.say({type: 'utterance', samples: new Float32Array(16000), seconds: 1.0});
  await new Promise((go) => setTimeout(go, 0));
  it.dispose();
  answer('are you there');
  await new Promise((go) => setTimeout(go, 0));
  expect(heard).toEqual([]);
});
