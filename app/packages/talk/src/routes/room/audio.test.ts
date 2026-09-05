/* What a heard turn becomes.
 *
 * The loop between the microphone and a line of text is @lucid/machine's and is
 * tested there — see voice.test.ts. What is left here is the one thing that is
 * Lucid Talk's about it: what the page does with a line once it has one, which
 * is answer it in this page, in this conversation, with nothing said to
 * anybody.
 */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {TurnRequest} from '../../conversation/turn';
import {EMPTY, link, onLog} from '../../link/store';

/* The machine, at the three doors this file knocks on: the loop it is handed,
   and the two calls that say what this page is using. What is under test is
   the press — what it asks for, in what order, and what the key wears while
   it waits — and never the model behind it. */
const stack = vi.hoisted(() => ({
  wanted: [] as Array<[string, boolean]>,
  /** The device, as far as a press can tell. */
  on: false,
  refuse: false,
  started: 0,
  stopped: 0,
  /** What `want` says back, and what the poll for readiness settles on. */
  status: 'loading' as string,
  ready: true,
}));
vi.mock('@lucid/machine', () => ({
  createVoiceLoop: () => ({
    capture: {
      get on() { return stack.on; },
      start: () => {
        stack.started += 1;
        if (stack.refuse) return Promise.reject(new Error('no microphone here'));
        stack.on = true;
        return Promise.resolve();
      },
      stop: () => { stack.stopped += 1; stack.on = false; },
      onChange: () => () => {},
    },
    playback: {}, pacer: {}, vad: {},
    micBarge: 'auto',
  }),
  models: {
    want: (model: string, wanted: boolean) => {
      stack.wanted.push([model, wanted]);
      return Promise.resolve({status: wanted ? stack.status : 'ready', grace: null});
    },
  },
  awaitReady: () => Promise.resolve(stack.ready),
}));

/* The conversation this page runs, stubbed at its two doors: a turn to answer,
   and a reply to cut off. Everything under them is turn.ts's own business and
   has its own tests. */
const conversation = vi.hoisted(
  () => ({turns: [] as TurnRequest[], cut: 0, back: 0, held: [] as boolean[]}));
vi.mock('../../conversation/turn', () => ({
  runTurn: (o: TurnRequest) => { conversation.turns.push(o); return Promise.resolve(); },
  current: () => ({interrupt: () => { conversation.cut += 1; }}),
}));
/* And the loop, at the two doors this file knocks on: the run behind a paused
   voice, and the line a room noise owes somebody. */
vi.mock('../../conversation/loop', () => ({
  cutIn: () => { conversation.cut += 1; return true; },
  holdContinuous: (on: boolean) => { conversation.held.push(on); return true; },
  putItBack: () => { conversation.back += 1; },
}));

const {answering, inputMode, micOff, micOn, recognizer, say} = await import('./audio');
const {turns} = conversation;

beforeEach(() => {
  stack.wanted.length = 0;
  stack.on = stack.refuse = false;
  stack.started = stack.stopped = 0;
  stack.status = 'loading';
  stack.ready = true;
  conversation.turns.length = 0;
  conversation.cut = 0;
  conversation.back = 0;
  conversation.held.length = 0;
  link.setState({...EMPTY});
});

afterEach(() => {
  link.setState({...EMPTY});
});

test('a heard turn is answered here, in this page\'s own conversation', () => {
  link.setState({slug: 'lover', sid: 'a-session'});
  answering().onHeard('are you there', 1.2);
  expect(turns).toEqual([{slug: 'lover', sessionId: 'a-session',
                          text: 'are you there', heard: true, seconds: 1.2}]);
});

test('the microphone is the page\'s own state', () => {
  answering().onListening(true);
  expect(link.getState().state).toBe('listening');
  answering().onListening(false);
  expect(link.getState().state).toBe('idle');
  // And a mic event does not stomp on an in-flight reply.
  link.setState({state: 'speaking'});
  answering().onListening(false);
  expect(link.getState().state).toBe('speaking');
});

test('a room noise that cost a reply owes the line back', () => {
  answering().onDropped(320, true);
  expect(conversation.back).toBe(1);
  answering().onDropped(320, false);
  expect(conversation.back).toBe(1);   // it stopped nothing; nothing is owed
});

test('talking over it cuts the reply this page is speaking', () => {
  answering().reply()?.interrupt();
  expect(conversation.cut).toBe(1);
});

test('a pause holds the run behind the voice', () => {
  answering().onHold(true);
  expect(conversation.held).toEqual([true]);
});

test('which way somebody is talking to the pill', () => {
  inputMode('mic');
  expect(link.getState().input_mode).toBe('mic');
});

test('what the loop says is said twice, and the second is for the dots', () => {
  /* "no usable speech" takes the marks down under a bubble as surely as the
     words arriving do — and the only thing that knows it happened is the line
     that was said about it. See dots.ts. */
  const heard: string[] = [];
  const off = onLog((m) => heard.push(m.text));
  say('that was 320ms — too short to hear');
  off();
  expect(heard).toEqual(['that was 320ms — too short to hear']);
});

/* ---- the microphone, and the model behind it -------------------------------
 *
 * Nothing is loaded to listen with until somebody asks to be heard. What that
 * costs is a key that has to say it is working for as long as the recognizer
 * takes, and a way back out of it if the recognizer never comes.
 */

test('pressing Talk asks for the recognizer and opens the device', async () => {
  stack.status = 'ready';                     // already up: nothing to wait for
  await micOn();
  expect(stack.wanted).toEqual([['stt', true]]);
  expect(stack.started).toBe(1);
  expect(link.getState().input_mode).toBe('mic');
  expect(recognizer.warming).toBe(false);
});

test('and says it is working for as long as the recognizer takes', async () => {
  const seen: boolean[] = [];
  const off = recognizer.onChange(() => seen.push(recognizer.warming));
  await micOn();
  off();
  // Working, then armed — and the console says which of the two it is doing.
  expect(seen).toEqual([true, false]);
  expect(link.getState().input_mode).toBe('mic');
});

test('a recognizer that never comes puts the key back rather than leaving it lit',
  async () => {
    stack.ready = false;
    await micOn();
    expect(stack.stopped).toBe(1);
    expect(recognizer.warming).toBe(false);
    expect(link.getState().input_mode).toBe('type');
    expect(stack.wanted).toEqual([['stt', true], ['stt', false]]);
  });

test('a microphone that will not open leaves nothing loading behind it', async () => {
  stack.refuse = true;
  await micOn();
  // It said why. The key stays off, and the recognizer is let go of again.
  expect(stack.wanted).toEqual([['stt', true], ['stt', false]]);
  expect(link.getState().input_mode).not.toBe('mic');
});

test('turning the mic off lets the machine have the recognizer back', async () => {
  stack.status = 'ready';
  await micOn();
  stack.wanted.length = 0;
  micOff();
  expect(stack.stopped).toBe(1);
  expect(stack.wanted).toEqual([['stt', false]]);
  expect(link.getState().input_mode).toBe('type');
});

test('a line said over a reply takes the floor from it', () => {
  /* Python's say cut in before it replied; a page that queued the line behind
     the floor answered it only when the long reply had ended, and then worked
     through everything said since, one reply after another. */
  const before = conversation.cut;
  answering().onHeard('wait, stop for a moment', 1.4);
  expect(conversation.cut).toBe(before + 1);
  expect(turns.at(-1)?.text).toBe('wait, stop for a moment');
});
