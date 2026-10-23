// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {
  shoreRise,
  surfApproach,
  surfExposure,
  surfOpenness,
  surfSamples,
  surfFullAt,
  SURF_LOOP_SECONDS,
} from '@lucid/world/desert';
import {SURF_REACH_DEFAULT, validateScore} from '../experience/score';
import {coastX, geo} from '../landscape';
import {REFERENCE} from './reference-score';

const REACH = REFERENCE.surfRange;
/** The walk crosses the coastal dune here; the water is due west of it. */
const CREST_X = -76;
const at = (x: number) => surfExposure(geo, x, 0, REACH);
const distanceAt = (x: number) => x - coastX(0);

describe('shore surf', () => {
  it('is silent inland, silent behind the coastal dune, and swells over its crest', () => {
    expect(at(0).proximity).toBe(0);
    expect(at(-30).proximity).toBe(0);
    // Behind the dune the ground stands well above his ear line.
    expect(shoreRise(geo, -30, 0)).toBeGreaterThan(3);
    expect(surfOpenness(geo, -30, 0)).toBe(0);
    expect(at(-55).proximity).toBe(0);
    // Climbing the windward face opens the water before the crest, as a swell.
    expect(surfOpenness(geo, -62, 0)).toBeGreaterThan(0.5);
    expect(surfOpenness(geo, CREST_X, 0)).toBe(1);
    expect(shoreRise(geo, CREST_X, 0)).toBeLessThan(0);
    expect(at(CREST_X).proximity).toBeGreaterThan(0.05);
  });
  it('rises monotonically from the crest to the water and is full on the beach', () => {
    let previous = at(CREST_X).proximity;
    for (let x = CREST_X - 1; x >= -110; x--) {
      const step = at(x).proximity;
      expect(step).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
    expect(previous).toBe(1);
    expect(at(coastX(0) + surfFullAt(geo)).proximity).toBe(1);
    expect(at(coastX(0)).proximity).toBe(1);
    // The approach is slow at the reach and steep near the water.
    const rise = (d: number) => surfApproach(d - 1, REACH, surfFullAt(geo)) - surfApproach(d, REACH, surfFullAt(geo));
    expect(rise(20)).toBeGreaterThan(rise(REACH - 5) * 4);
  });
  it('reports the distance to the shoreline and never samples the ground far inland', () => {
    let samples = 0;
    const ground = (x: number, z: number) => {
      samples++;
      return x * 0 + z * 0;
    };
    expect(surfExposure(geo, 0, 0, REACH, ground).distance).toBeCloseTo(distanceAt(0), 6);
    expect(samples).toBe(0);
    expect(surfExposure(geo, -100, 0, REACH, ground).proximity).toBeGreaterThan(0);
    expect(samples).toBeGreaterThan(0);
    expect(surfExposure(geo, Infinity, 0, REACH).proximity).toBe(0);
  });
  it('migrates a legacy audibility radius and keeps the reach bounded', () => {
    const score = validateScore({...REFERENCE, breathingGain: 1});
    expect(score).not.toHaveProperty('breathingGain');
    expect(score.surfGain).toBe(REFERENCE.surfGain);
    expect(score.surfRange).toBe(SURF_REACH_DEFAULT);
    // A reach shorter than the coastal dune is deep is the old radius: take the default.
    expect(validateScore({...score, surfRange: 20}).surfRange).toBe(SURF_REACH_DEFAULT);
    expect(validateScore({...score, surfRange: 0}).surfRange).toBe(SURF_REACH_DEFAULT);
    expect(validateScore({...score, surfRange: 120}).surfRange).toBe(120);
    expect(() => validateScore({...score, surfRange: 201})).toThrow();
  });
  it('makes stereo rolling surf with a continuous loop join and no clipped samples', () => {
    const rate = 8000;
    const channels = surfSamples(rate);
    expect(channels[0]).not.toEqual(channels[1]);
    for (const samples of channels) {
      expect(samples.every((v) => Number.isFinite(v) && Math.abs(v) < 1)).toBe(true);
      expect(samples.length).toBe((SURF_LOOP_SECONDS + 1) * rate);
      expect(samples.at(-1)).toBe(samples[rate - 1]);
      const energy = (start: number) => {
        const part = samples.slice(start * rate, (start + 1) * rate);
        return part.reduce((sum, v) => sum + v * v, 0) / part.length;
      };
      const levels = [1, 2, 3, 4, 5, 6].map(energy);
      expect(Math.max(...levels)).toBeGreaterThan(Math.min(...levels) * 2);
      expect(Math.max(...levels)).toBeGreaterThan(0.001);
    }
  });
});
