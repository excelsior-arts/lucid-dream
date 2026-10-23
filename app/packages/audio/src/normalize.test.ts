import {expect, test} from 'vitest';
import {VOICE, normalize, soften} from './normalize';
import type {Lift} from './normalize';

/* The DSP is the one part of this where "looks right" is worth nothing: a
   misplaced parenthesis in the percentile changes how loud a sentence plays by
   a decibel and nothing fails, in any test that reasons about the arithmetic
   rather than running it. So the last three below are recorded answers — what
   this code does today, to the bit — and a change to any of them is a change
   somebody has to have meant. */

/** Signed 16-bit, the way the socket sends it. */
function pcm(fill: (i: number) => number, n: number): Uint8Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.round(fill(i) * 32768);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return new Uint8Array(out.buffer);
}

/** Repeatable noise: a test that fails once a week is a test nobody trusts. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x40000000) - 1;
  };
}

const RATE = 24000;
const quietSine = () => pcm((i) => 0.03 * Math.sin((2 * Math.PI * 220 * i) / RATE), RATE);
/* A sentence and the gap after it, which is the shape every chunk has. */
const loudSquare = () =>
  pcm((i) => (i > RATE * 0.4 ? 0 : Math.sin((2 * Math.PI * 180 * i) / RATE) > 0 ? 0.8 : -0.8), RATE);
const hiss = () => {
  const rnd = noise(7);
  return pcm(() => rnd() * 0.2, RATE);
};

test('soften leaves everything under the knee alone', () => {
  for (const v of [0, 0.1, 0.5, VOICE.KNEE, -VOICE.KNEE, -0.3]) expect(soften(v)).toBe(v);
});

test('and holds everything over it under full scale', () => {
  // Full scale is the limit and tanh only reaches it in the limit: 40 times
  // over is rounded to 1.0 and nothing is asked to go past it.
  for (const v of [0.81, 0.94, 1, 2, 40, -1, -7]) expect(Math.abs(soften(v))).toBeLessThanOrEqual(1);
  expect(Math.abs(soften(1.2))).toBeLessThan(1);
  expect(soften(-1)).toBe(-soften(1));
  expect(soften(2)).toBeGreaterThan(soften(1));       // still monotone
});

test('a quiet sine is lifted to about where speech should sit', () => {
  const lift: Lift = {voiceLift: 0};
  const bytes = normalize(quietSine(), lift);
  const out = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  let sum = 0, peak = 0;
  for (const s of out) {
    const v = s / 32768;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  /* The aim is taken over what was said rather than over the chunk, so even a
     sine -- whose quietest samples are still under VOICE.QUIET and left out of
     the measurement -- lands a shade under the figure. Close, not equal. */
  expect(Math.sqrt(sum / out.length)).toBeCloseTo(VOICE.RMS, 1);
  expect(peak).toBeLessThanOrEqual(VOICE.CEILING);
});

test('a loud one is left where it is', () => {
  const lift: Lift = {voiceLift: 0};
  const before = loudSquare();
  const after = normalize(loudSquare(), lift);
  expect([...after]).toEqual([...before]);            // clamped by the ceiling
  expect(lift.voiceLift).toBe(1);                     // and it wants no lift
});

test('the figure moves fifteen percent of the way per sentence', () => {
  const lift: Lift = {voiceLift: 0};
  normalize(quietSine(), lift);
  const first = lift.voiceLift;
  expect(first).toBeGreaterThan(1);
  normalize(loudSquare(), lift);                      // wants 1
  expect(lift.voiceLift).toBeCloseTo(first * 0.85 + 1 * 0.15, 10);
});

test('silence is handed back untouched, and does not move the figure', () => {
  const lift: Lift = {voiceLift: 3};
  const bytes = normalize(new Uint8Array(4800), lift);
  expect([...bytes]).toEqual([...new Uint8Array(4800)]);
  expect(lift.voiceLift).toBe(3);
});

/* A breath: a tenth of a second at most over VOICE.QUIET, the rest under it
   -- what Turbo made of a "[sigh]" handed to it alone. */
const breath = () => pcm(
  (i) => (i < 1000 ? 0.03 * Math.sin((2 * Math.PI * 220 * i) / RATE) : 0.004 * Math.sin(i)),
  RATE,
);

test('too little speech to measure does not move the figure', () => {
  const lift: Lift = {voiceLift: 2.5};
  normalize(breath(), lift);
  expect(lift.voiceLift).toBe(2.5);
});

test('and is lifted no further than the voice is', () => {
  const lift: Lift = {voiceLift: 2.5};
  const raw = breath();
  const before = new Int16Array(raw.slice().buffer);
  const after = new Int16Array(normalize(raw, lift).buffer);
  expect(after[200]! / before[200]!).toBeCloseTo(2.5, 2);
});

test('before there is a figure, it is played as it came', () => {
  const lift: Lift = {voiceLift: 0};
  const raw = breath();
  const before = [...raw];
  expect([...normalize(raw, lift)]).toEqual(before);
  expect(lift.voiceLift).toBe(0);
  // and the first line of speech after it still takes its own figure whole
  normalize(quietSine(), lift);
  const fresh: Lift = {voiceLift: 0};
  normalize(quietSine(), fresh);
  expect(lift.voiceLift).toBe(fresh.voiceLift);
});

/** Everything in the buffer, as one number. Recorded rather than written out:
    a reply is a second of audio, and what is worth holding is that not a byte
    of it moved. */
function digest(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = ((h ^ b) * 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

test('the constants are the ones set by ear, to the digit', () => {
  /* Every one of these was arrived at by listening, and each is load-bearing:
     the aim, the ceiling the softening starts under, where a sample stops
     counting as speech, and how much speech is enough to take an average
     over. A tuning is a decision; a drift is a bug. */
  expect(VOICE).toEqual({RMS: 0.14, CEILING: 0.94, KNEE: 0.8, TAIL: 0.005,
                         QUIET: 0.01, ENOUGH: 2400});
});

test('byte for byte what it does today, across a whole reply', () => {
  const lift: Lift = {voiceLift: 0};
  // Three chunks in a row, so the slow figure has to agree as well as the
  // arithmetic inside one sentence.
  const want: [string, number][] = [
    ['f2fb6b60', 5.8945043679297555],
    ['fa2e0f84', 5.160328712740292],
    ['cd22088c', 4.563016232544734],
  ];
  [quietSine, loudSquare, hiss].forEach((make, i) => {
    expect([digest(normalize(make(), lift)), lift.voiceLift]).toEqual(want[i]);
  });
});

test('and soften bends where it always bent', () => {
  for (const [v, want] of [[-1.2, -0.9928055160151634], [-0.9, -0.892423431452002],
                           [-0.8, -0.8], [0.8, 0.8], [0.85, 0.8489837324807418],
                           [0.9, 0.892423431452002], [1, 0.952318831191153],
                           [1.5, 0.9996355795222398], [3, 0.9999999998884213]]) {
    expect(soften(v!)).toBe(want);
  }
});
