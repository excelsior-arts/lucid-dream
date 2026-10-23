// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {Walker} from '../experience/walker';
import {ScriptedWalk} from '../experience/rehearsal';
import {pace} from '../experience/score';
import {REFERENCE} from './reference-score';

const dt = 1 / 120;
describe('camera-directed walking', () => {
  it('starts facing the ocean, including restarts and timeline zero', () => {
    const w = new Walker(() => 0);
    w.reset(20, 0);
    expect(w.state.facing).toBe(-Math.PI / 2);
    w.step(0, 1, 1, 1, REFERENCE);
    w.reset(20, 0);
    expect(w.state.facing).toBe(-Math.PI / 2);
    expect(new ScriptedWalk(REFERENCE).sample(0).facing).toBe(-Math.PI / 2);
  });
  it('pivots through ninety degrees promptly without an instantaneous turn or position jump', () => {
    const w = new Walker(() => 0);
    w.reset(0, 0);
    const before = structuredClone(w.state);
    w.step(0, 1, dt, 1, REFERENCE);
    expect(Math.abs(w.state.facing - before.facing)).toBeLessThanOrEqual(6 * dt + 1e-10);
    expect(w.state.position.z).toBeLessThan(0.002);
    for (let i = 1; i < 60; i++) w.step(0, 1, dt, 1, REFERENCE);
    expect(Math.abs(w.state.facing)).toBeLessThan(0.025);
    expect(w.state.distance).toBeLessThan(pace(REFERENCE) * 0.5);
  });
  it('bounds even a full reversal and preserves timed falls', () => {
    const w = new Walker(() => 0);
    w.reset(0, 0);
    for (let i = 0; i < 120; i++) w.step(-1, 0, dt, 1, REFERENCE);
    for (let i = 0; i < 120; i++) {
      const heading = w.state.facing;
      w.step(1, 0, dt, 1, REFERENCE);
      expect(Math.abs(w.state.facing - heading)).toBeLessThanOrEqual(6 * dt + 1e-10);
    }
    expect(Math.sin(w.state.facing)).toBeGreaterThan(0.999);
    const before = structuredClone(w.state);
    w.step(0, 1, dt, 0, REFERENCE);
    expect(w.state.position).toEqual(before.position);
    expect(w.state.facing).toBe(before.facing);
    expect(w.state.speed).toBe(0);
  });
});
