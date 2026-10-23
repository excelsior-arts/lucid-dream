/* A browser voice brought to the Mac's loudness: the meter reads as a meter
   should, the pauses do not count, a voice's level follows one figure rather
   than each sentence, and nothing passes the ceiling. */
import {expect, test} from 'vitest';
import {CEILING, TARGET, leveller, limited, loudness, steady} from './level';

const RATE = 24000;
const tone = (s: number, amp: number, hz = 1000) => {
  const a = new Float32Array(Math.round(s * RATE));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / RATE);
  return a;
};
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const db = (x: number) => 20 * Math.log10(x);

test('a full-scale 1 kHz tone reads -3 LUFS, as BS.1770 has it, at 24 kHz', () => {
  expect(loudness(tone(2, 1), RATE).lufs).toBeCloseTo(-3.01, 0);
  // 20 dB down is 20 LU down.
  expect(loudness(tone(2, 0.1), RATE).lufs).toBeCloseTo(-23.01, 0);
});

test('the pauses do not count: a line with silence round it reads as the line', () => {
  const said = tone(1.5, 0.1);
  const paused = join(new Float32Array(RATE), said, new Float32Array(2 * RATE), said);
  // Within a dB, where an ungated mean reads 4.5 dB down: the blocks that
  // straddle a pause's edge are half the line, and the relative gate keeps
  // those, as BS.1770 does.
  expect(Math.abs(loudness(paused, RATE).lufs - loudness(said, RATE).lufs)).toBeLessThan(1);
  expect(loudness(paused, RATE).speech_s).toBeLessThan(3.5);
  expect(loudness(new Float32Array(RATE), RATE).lufs).toBe(-Infinity);
});

test('a hot voice is brought down to the target, and its next line keeps its shape', () => {
  const level = leveller();
  const first = level(tone(2, 0.5), RATE, 'lover', 'Come here.');
  expect(loudness(first, RATE).lufs).toBeCloseTo(TARGET, 0);
  // A line the engine said 6 dB quieter stays nearly that much quieter: the
  // figure moves by the line's share, it is not set to it.
  const second = level(tone(2, 0.25), RATE, 'lover', 'Stay a while.');
  expect(loudness(second, RATE).lufs).toBeLessThan(TARGET - 4);
  // Another voice has a figure of its own.
  const other = level(tone(2, 0.05), RATE, 'thinker', 'That is sloppy.');
  expect(loudness(other, RATE).lufs).toBeCloseTo(TARGET, 0);
});

test('a whisper, a lone tag and a scrap do not move the figure, and are never raised before one', () => {
  expect(steady('[whispering] Come closer.')).toBe(false);
  expect(steady('[sigh]')).toBe(false);
  expect(steady('[sigh] I missed you.')).toBe(true);
  const level = leveller();
  // Nothing measured yet: a quiet sigh is left as quiet as it came.
  const sigh = tone(1, 0.01);
  expect(peak(level(sigh, RATE, 'lover', '[sigh]'))).toBeCloseTo(0.01, 4);
  const line = level(tone(2, 0.5), RATE, 'lover', 'Come here.');
  const whisper = level(tone(2, 0.1), RATE, 'lover', '[whispering] Closer.');
  // The whisper takes the voice's gain, so it sits as far under the line as
  // the engine put it, and the next line is levelled as the first was.
  expect(loudness(line, RATE).lufs - loudness(whisper, RATE).lufs).toBeCloseTo(db(5), 0);
  expect(loudness(level(tone(2, 0.5), RATE, 'lover', 'Again.'), RATE).lufs).toBeCloseTo(TARGET, 0);
});

test('nothing passes the ceiling, and what is under it is only scaled', () => {
  const a = join(tone(0.5, 0.05), tone(0.01, 0.9), tone(0.5, 0.05));
  const out = limited(a, 2, RATE);
  expect(peak(out)).toBeLessThanOrEqual(CEILING + 1e-6);
  // Well away from the burst the gain is the gain.
  expect(out[1000]! / a[1000]!).toBeCloseTo(2, 5);
  // A raise that leaves room is a plain multiplication.
  const quiet = tone(1, 0.1);
  expect(limited(quiet, 3, RATE)[123]).toBeCloseTo(quiet[123]! * 3, 6);
});
