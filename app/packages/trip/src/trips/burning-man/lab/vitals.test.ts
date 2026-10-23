// @vitest-environment node
import {describe, it, expect} from 'vitest';
import {validateScore} from '../experience/score';
import {vitalCue, vitalEvents, heartbeatSamples} from '../audio/vitals';
import {DEFAULT_SCORE} from '../experience/score';
import {REFERENCE, without} from './reference-score';

const score = validateScore(REFERENCE);
const rms = (data: Float32Array, start: number, end: number, rate: number) => {
  const part = data.slice(Math.floor(start * rate), Math.floor(end * rate));
  return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length);
};
describe('the heartbeat score', () => {
  it('keeps the opening even, slows at the authored cue and becomes uneven before the final fall', () => {
    for (const time of [0, 20, 60, score.heartbeatSlowAt - 0.1, score.heartbeatSlowAt])
      expect(vitalCue(time, score).bpm).toBe(score.heartbeatBpm);
    expect(vitalCue(score.heartbeatSlowAt + 10, score).bpm).toBeLessThan(score.heartbeatBpm);
    expect(vitalCue(score.stage_08_kneel - 5, score).bpm).toBeLessThan(
      vitalCue(score.heartbeatSlowAt + 10, score).bpm,
    );
    expect(vitalCue(score.stage_08_kneel - 5, score).irregularity).toBeGreaterThan(0.6);
    const hearts = vitalEvents(score).filter((e) => e.kind === 'heart');
    const intervals = hearts
      .slice(1)
      .map((e, i) => ({time: e.time, gap: e.time - hearts[i]!.time}));
    for (const e of intervals.filter((e) => e.time < score.heartbeatSlowAt))
      expect(e.gap).toBeCloseTo(60 / score.heartbeatBpm, 9);
    const late = intervals
      .filter((e) => e.time > score.duration - 26 && e.time < score.duration - 12)
      .map((e) => e.gap);
    expect(Math.max(...late) - Math.min(...late)).toBeGreaterThan(0.6);
    expect(Math.max(...late)).toBeGreaterThan(2);
  });
  it('ends the pulse ten seconds before the ending and reproduces the exact same cues on every rehearsal', () => {
    const events = vitalEvents(score);
    expect(events).toEqual(vitalEvents(structuredClone(score)));
    expect(events.every((e) => e.time + e.duration <= score.duration - 10)).toBe(true);
    expect(vitalCue(score.duration - 10.1, score).stopped).toBe(false);
    for (const time of [score.duration - 10, score.duration - 5, score.duration])
      expect(vitalCue(time, score)).toMatchObject({bpm: 0, stopped: true});
    const last = events.filter((e) => e.kind === 'heart').at(-1)!;
    expect(last.time).toBeCloseTo(score.duration - 10.62);
    expect(last.time + last.duration).toBeCloseTo(score.duration - 10.1);
  });
  it('migrates old drafts and validates independently adjustable audio cues', () => {
    const {heartbeatGain, surfGain, surfRange, heartbeatSlowAt, heartbeatStopBeforeEnd, ...old} =
      score;
    // A draft without them takes the authored score's values for those five and
    // keeps every other field of its own exactly as written.
    const authored = validateScore(DEFAULT_SCORE);
    const restored = validateScore(old);
    const carried = {
      heartbeatGain,
      surfGain,
      surfRange,
      heartbeatSlowAt,
      heartbeatStopBeforeEnd,
    } as const;
    for (const key of Object.keys(carried) as (keyof typeof carried)[])
      expect(restored[key]).toBe(authored[key]);
    expect({...restored, ...carried}).toEqual(score);
    for (const patch of [
      {heartbeatSlowAt: 195},
      {heartbeatStopBeforeEnd: 31},
      {heartbeatSlowAt: NaN},
    ])
      expect(() => validateScore({...score, ...patch})).toThrow();
    const changed = validateScore({...score, heartbeatSlowAt: 80, heartbeatStopBeforeEnd: 5});
    expect(vitalCue(81, changed).bpm).toBeLessThan(score.heartbeatBpm);
    const withoutTempo = without(score, 'heartbeatBpm');
    expect(validateScore(withoutTempo).heartbeatBpm).toBe(72);
    expect(vitalCue(changed.duration - 6, changed).stopped).toBe(false);
    expect(vitalCue(changed.duration - 5, changed).stopped).toBe(true);
  });
  it('lowers the thud frequency without stretching the double beat or retiming the score', () => {
    const old = without(score, 'heartbeatPitch');
    expect(validateScore(old).heartbeatPitch).toBe(57);
    expect(validateScore({...score, heartbeatPitch: 10}).heartbeatPitch).toBe(28);
    expect(validateScore({...score, heartbeatPitch: 90}).heartbeatPitch).toBe(65);
    expect(() => validateScore({...score, heartbeatPitch: NaN})).toThrow();
    for (const rate of [44100, 48000]) {
      let previousFrequency = Infinity;
      for (const pitch of [57, 48, 40, 32]) {
        const heart = heartbeatSamples(rate, pitch);
        expect(heart.length).toBe(heartbeatSamples(rate).length);
        expect(heart.every((v) => Number.isFinite(v) && Math.abs(v) < 1)).toBe(true);
        expect(heart[0]).toBeCloseTo(0);
        expect(heart.at(-1)).toBeCloseTo(0);
        const crossings: number[] = [];
        for (let i = Math.floor(rate * 0.02); i < rate * 0.18; i++)
          if (heart[i - 1]! <= 0 && heart[i]! > 0) crossings.push(i);
        const frequency = ((crossings.length - 1) * rate) / (crossings.at(-1)! - crossings[0]!);
        expect(frequency).toBeLessThan(previousFrequency * 0.9);
        expect(frequency).toBeGreaterThan(pitch * 0.95);
        expect(frequency).toBeLessThan(pitch * 1.25);
        previousFrequency = frequency;
        expect(rms(heart, 0.22, 0.29, rate)).toBeGreaterThan(rms(heart, 0.14, 0.2, rate) * 3);
        expect(vitalEvents({...score, heartbeatPitch: pitch})).toEqual(vitalEvents(score));
      }
    }
  });
  it('synthesizes two clear rounded thuds without clipped samples or any breath cues', () => {
    expect(vitalEvents(score).every((e) => e.kind === 'heart')).toBe(true);
    for (const rate of [44100, 48000]) {
      const heart = heartbeatSamples(rate);
      expect(heart.every(Number.isFinite)).toBe(true);
      expect(heart.every((v) => Math.abs(v) < 1)).toBe(true);
      expect(heart[0]).toBeCloseTo(0);
      expect(heart.at(-1)).toBeCloseTo(0);
      expect(rms(heart, 0.01, 0.1, rate)).toBeGreaterThan(rms(heart, 0.14, 0.2, rate) * 4);
      expect(rms(heart, 0.22, 0.29, rate)).toBeGreaterThan(rms(heart, 0.14, 0.2, rate) * 3);
    }
  });
});
