// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {Walker} from '../experience/walker';
import {angleDelta} from '../character/manual-gait';
import {REFERENCE} from './reference-score';

const dt = 1 / 120;
const fixture = () => {
  const walker = new Walker(() => 0);
  walker.reset(20, 0);
  const step = (x: number, z: number, seconds: number, mobility = 1) => {
    for (let t = 0; t < seconds - 1e-8; t += dt)
      walker.step(x, z, Math.min(dt, seconds - t), mobility, REFERENCE, true);
  };
  return {walker, step};
};

describe('captured manual locomotion', () => {
  it('steps through a quarter turn before travelling, then starts walking', () => {
    const {walker: w, step} = fixture();
    step(0, 1, 0.5);
    expect(w.state.gesture?.clip).toBe('turnleft90');
    expect(w.state.position).toEqual({x: 20, y: 0, z: 0});
    expect(w.state.facing).toBeGreaterThan(-Math.PI / 2);
    expect(w.state.facing).toBeLessThan(0);
    step(0, 1, 0.9);
    expect(w.state.gesture?.clip).toBe('startwalk');
    expect(w.state.facing).toBeCloseTo(0, 5);
    step(0, 1, 4);
    expect(w.state.gesture).toBeUndefined();
    expect(w.state.position.z).toBeGreaterThan(1);
    expect(Math.abs(w.state.position.x - 20)).toBeLessThan(0.001);
  });
  it('handles left/right and full reversals with bounded heading changes', () => {
    for (const [x, z, clip] of [[0, 1, 'turnleft90'], [0, -1, 'turnright90'], [1, 0, 'turnleft180']] as const) {
      const {walker: w} = fixture();
      w.step(x, z, dt, 1, REFERENCE, true);
      expect(w.state.gesture?.clip).toBe(clip);
      for (let i = 0; i < 4 / dt; i++) {
        const before = w.state.facing;
        w.step(x, z, dt, 1, REFERENCE, true);
        expect(Math.abs(angleDelta(w.state.facing, before))).toBeLessThan(0.08);
      }
      expect(Math.abs(angleDelta(w.state.facing, Math.atan2(x, z)))).toBeLessThan(0.001);
    }
  });
  it('finishes the planted turn after a tap without taking an unwanted walk', () => {
    const {walker: w, step} = fixture();
    step(0, 1, dt);
    step(0, 0, 3);
    expect(w.state.position).toEqual({x: 20, y: 0, z: 0});
    expect(w.state.gesture?.clip).toBe('stand');
  });
  it('takes a captured settling step on release, then holds position with a living idle', () => {
    const {walker: w, step} = fixture();
    step(-1, 0, 4);
    const start = w.state.distance;
    step(0, 0, dt);
    expect(w.state.gesture?.clip).toBe('stopwalk');
    step(0, 0, 4);
    expect(w.state.distance - start).toBeCloseTo(0.193257, 4);
    expect(w.state.gesture?.clip).toBe('stand');
    const at = {...w.state.position};
    step(0, 0, 2);
    expect(w.state.position).toEqual(at);
  });
  it('holds pause, and lets authored immobility cancel a turn immediately', () => {
    const {walker: w, step} = fixture();
    step(0, 1, 0.4);
    const before = structuredClone(w.state);
    w.step(0, -1, 0, 1, REFERENCE, true);
    expect(w.state).toEqual(before);
    step(1, 0, dt, 0);
    expect(w.state.position).toEqual(before.position);
    expect(w.state.facing).toBe(before.facing);
    expect(w.state.gesture).toBeUndefined();
    expect(w.state.speed).toBe(0);
  });
  it('samples the same travel at 30, 60, and 120 updates per second', () => {
    const runs = [30, 60, 120].map(hz => {
      const w = new Walker(() => 0); w.reset(20, 0);
      for (let i = 0; i < 5 * hz; i++) w.step(0, 1, 1 / hz, 1, REFERENCE, true);
      return w.state;
    });
    for (const state of runs) {
      expect(Math.abs(state.distance - runs[2]!.distance)).toBeLessThan(0.045);
      expect(state.facing).toBeCloseTo(runs[2]!.facing, 5);
    }
  });
  it('carries a partial final start sample into walking without a second stop', () => {
    for (const hz of [30, 60, 120]) {
      const w = new Walker(() => 0); w.reset(20, 0);
      let previous = '', handoff = false;
      for (let i = 0; i < 3 * hz; i++) {
        w.step(-1, 0, 1 / hz, 1, REFERENCE, true);
        if (previous === 'startwalk' && !w.state.gesture) {
          expect(w.state.speed).toBeGreaterThan(0.6);
          handoff = true;
        }
        previous = w.state.gesture?.clip ?? '';
      }
      expect(handoff).toBe(true);
    }
  });
});
