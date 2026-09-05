import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {Playback} from './playback';
import {DEFAULT_CHPS, HOLD_MS, LEAD_S, READ_CPS, STEP_MS, createPacer} from './pacing';

/* The voice, as a set of numbers the test moves by hand. Nothing here decodes
   anything: what the pacer is owed is a position, a count of characters said,
   and the fact that sound is still coming. */
function fakeVoice() {
  const ears = new Set<() => void>();
  let at = 0;
  const p = {
    queuedS: 0,
    playingS: 0,
    playedS: 0,
    spokenChars: 0,
    playing: false,
    held: false,
    stalled: false,
    expecting: false,
    position: () => at,
    onChange(fn: () => void) { ears.add(fn); return () => { ears.delete(fn); }; },
    onUnheard() { return () => {}; },
    enqueue() {},
    credit() {},
    stop() {},
    hold() {},
    unlockOnce() { return () => {}; },
    dispose() {},
  };
  return {
    playback: p as unknown as Playback,
    /** Say what changed, the way the real one does. */
    moved(into = at) { at = into; for (const fn of [...ears]) fn(); },
    /** A reply's worth of voice, so a rate can be measured off it. */
    spoke(secs: number, chars: number) {
      p.playedS += secs;
      p.spokenChars += chars;
      at = 0;
      for (const fn of [...ears]) fn();
    },
    set(fields: Partial<typeof p>) { Object.assign(p, fields); for (const fn of [...ears]) fn(); },
  };
}

const LINE = 'x'.repeat(400);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('nothing is held back before anything has been heard', () => {
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  pacer.feed('You are heard aloud, not read.');
  expect(pacer.visible).toBe('You are heard aloud, not read.');
  pacer.dispose();
});

test('the first reply is paced by an assumed rate until the voice is measured', () => {
  /* It used to flow free, which a slow model hid and a fast one showed: the
     whole first reply on the glass while the voice was on its first line. */
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  voice.set({playing: true});                    // sound, but nothing measured
  pacer.feed(LINE);
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.visible.length).toBe(Math.round(DEFAULT_CHPS * LEAD_S));
  voice.moved(2);
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.visible.length).toBe(Math.round(DEFAULT_CHPS * (2 + LEAD_S)));
  pacer.dispose();
});

test('words written before the first sound wait for it, showing only their opening', () => {
  /* A fast model finishes the reply while the first chunk of voice is still
     being made. Released then, all of it was on the glass before a word was
     heard, and the voice read subtitles for the rest of the reply. */
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  voice.set({expecting: true});                  // the reply is being made
  pacer.feed('One sentence first. ' + LINE);
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.visible).toBe('One sentence first. ');
  pacer.done('One sentence first. ' + LINE);     // the model is done; no sound yet
  vi.advanceTimersByTime(STEP_MS * 5);
  expect(pacer.visible).toBe('One sentence first. ');
  expect(pacer.settled).toBe(false);
  // The sound starts: from here the words follow it.
  voice.set({playing: true});
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.visible.length).toBeGreaterThan('One sentence first. '.length);
  expect(pacer.visible.length).toBeLessThan(LINE.length);
  pacer.dispose();
});

test('but a voice that never comes does not hold them hostage', () => {
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  voice.set({expecting: true});
  pacer.feed(LINE);
  pacer.done(LINE);
  vi.advanceTimersByTime(HOLD_MS + STEP_MS);
  expect(pacer.visible).toBe(LINE);
  expect(pacer.settled).toBe(true);
  pacer.dispose();
});

/** A first reply, spoken, so the rate exists for the ones after it. */
function measured() {
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  pacer.feed('the first reply');
  voice.set({playing: true});
  voice.spoke(3, 120);                           // 40 characters a second
  pacer.done('the first reply');
  pacer.reset();
  return {voice, pacer};
}

test('after that the words are let out at the speed of the voice, plus a lead', () => {
  const {voice, pacer} = measured();
  voice.set({playing: true, queuedS: 2});
  pacer.feed(LINE);
  expect(pacer.visible).toBe('');                // held, now there is a voice

  vi.advanceTimersByTime(STEP_MS);
  // Nothing said yet: what is out is the lead alone.
  expect(pacer.visible.length).toBe(Math.round(40 * LEAD_S));

  voice.moved(0.5);                              // half a second into the chunk
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.visible.length).toBe(Math.round(40 * 0.5 + 40 * LEAD_S));

  voice.spoke(2, 80);                            // and a chunk finished
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.visible.length).toBe(Math.round(80 + 40 * LEAD_S));
  pacer.dispose();
});

test('a reply that has ended waits for its voice, then lands whole', () => {
  const {voice, pacer} = measured();
  voice.set({playing: true, queuedS: 2});
  pacer.feed(LINE);
  vi.advanceTimersByTime(STEP_MS);
  pacer.done(LINE);
  expect(pacer.settled).toBe(false);
  vi.advanceTimersByTime(STEP_MS * 5);
  expect(pacer.settled).toBe(false);             // still coming out
  expect(pacer.visible.length).toBeLessThan(LINE.length);

  voice.set({playing: false, queuedS: 0});       // finished, stopped, or cut off
  vi.advanceTimersByTime(STEP_MS);
  expect(pacer.settled).toBe(true);
  expect(pacer.visible).toBe(LINE);
  pacer.dispose();
});

test('a reply whose sound never started is not held hostage by it', () => {
  const {voice, pacer} = measured();
  voice.set({playing: false, queuedS: 0});
  pacer.feed(LINE);
  pacer.done(LINE);
  expect(pacer.settled).toBe(true);
  expect(pacer.visible).toBe(LINE);
  pacer.dispose();
});

test('the final text replaces what streamed, which can be a different length', () => {
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  pacer.feed('half a th');
  pacer.done('half a thought, tidied');
  expect(pacer.visible).toBe('half a thought, tidied');
  pacer.dispose();
});

test('a new turn starts empty, and words with nowhere to go do not open it', () => {
  const {voice, pacer} = measured();
  voice.set({playing: true, queuedS: 2});
  pacer.feed(LINE);
  pacer.reset();
  expect(pacer.visible).toBe('');
  expect(pacer.settled).toBe(true);
  vi.advanceTimersByTime(STEP_MS * 10);
  expect(pacer.visible).toBe('');
  pacer.dispose();
});

test('the clock can belong to somebody else', () => {
  const voice = fakeVoice();
  const ticks: (() => void)[] = [];
  const pacer = createPacer(voice.playback, {
    setInterval: (fn) => { ticks.push(fn); return ticks.length; },
    clearInterval: () => {},
  });
  voice.set({playing: true});
  voice.spoke(3, 120);
  pacer.feed(LINE);
  expect(ticks.length).toBe(1);
  expect(pacer.visible).toBe('');
  ticks[0]!();
  expect(pacer.visible.length).toBe(Math.round(40 * LEAD_S));
  pacer.dispose();
});

/* ---- and the room with the sound off ---------------------------------------
 *
 * No socket is opened and no voice is loaded, so nothing will ever play and
 * the words have only the clock to keep time with. */

test('with no voice coming, the words come out at a reading pace', () => {
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  pacer.reading(true);
  pacer.feed(LINE);
  // Not in a lump, however fast the model wrote it.
  expect(pacer.visible).toBe('');
  /* A second's worth a second, to within the step it is let out in: the
     revealing happens on the tick and the last tick of a second is a little
     short of it. */
  vi.advanceTimersByTime(1000);
  expect(pacer.visible.length).toBeGreaterThan(READ_CPS - 3);
  expect(pacer.visible.length).toBeLessThanOrEqual(READ_CPS);
  vi.advanceTimersByTime(1000);
  expect(pacer.visible.length).toBeGreaterThan(READ_CPS * 2 - 3);
  expect(pacer.visible.length).toBeLessThanOrEqual(READ_CPS * 2);
  pacer.dispose();
});

test('and the reply ends when the last of them is out, not when the model stops', () => {
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  pacer.reading(true);
  pacer.feed('x'.repeat(READ_CPS * 2));
  pacer.done('x'.repeat(READ_CPS * 2));
  vi.advanceTimersByTime(1000);
  expect(pacer.settled).toBe(false);
  expect(pacer.visible.length).toBeLessThan(READ_CPS * 2);
  vi.advanceTimersByTime(1200);
  expect(pacer.settled).toBe(true);
  expect(pacer.visible.length).toBe(READ_CPS * 2);
  pacer.dispose();
});

test('turning the sound back on lands on the next reply, not this one', () => {
  /* The reply being written was given no voice when it started -- that is
     decided once, where the socket would have been opened -- so letting it
     out against a voice that is never coming would dump the rest of it on the
     screen at once. */
  const voice = fakeVoice();
  const pacer = createPacer(voice.playback);
  pacer.reading(true);
  pacer.feed(LINE);
  pacer.reading(false);
  vi.advanceTimersByTime(1000);
  expect(pacer.visible.length).toBeLessThanOrEqual(READ_CPS);

  pacer.done(LINE);
  vi.advanceTimersByTime(LINE.length / READ_CPS * 1000);
  pacer.reset();
  pacer.feed('and this one is spoken');
  expect(pacer.visible).toBe('and this one is spoken');
  pacer.dispose();
});
