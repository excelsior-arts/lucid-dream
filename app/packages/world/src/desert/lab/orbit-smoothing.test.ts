// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {OrbitSpring} from '../camera/smooth-orbit';

describe('camera drag and zoom easing', () => {
  it('starts gently, gains speed, and coasts to the requested angle without overshooting', () => {
    const spring = new OrbitSpring();
    spring.add(1);
    const first = spring.advance(1 / 60);
    const second = spring.advance(1 / 60);
    expect(first).toBeLessThan(0.04);
    expect(second).toBeGreaterThan(first);
    let travelled = first + second;
    for (let i = 0; i < 120; i++) {
      const delta = spring.advance(1 / 60);
      expect(delta).toBeGreaterThanOrEqual(0);
      travelled += delta;
      expect(travelled).toBeLessThanOrEqual(1 + 1e-10);
    }
    expect(travelled).toBeCloseTo(1, 9);
    expect(spring.velocity).toBeCloseTo(0, 8);
  });
  it('has the same response at 30, 60 and 144 Hz, including wheel zoom', () => {
    const states = [30, 60, 144].map((fps) => {
      const spring = new OrbitSpring();
      spring.add(Math.log(0.6));
      let travelled = 0;
      for (let i = 0; i < fps / 2; i++) travelled += spring.advance(1 / fps);
      return {radius: 8 * Math.exp(travelled), velocity: spring.velocity};
    });
    for (const state of states) {
      expect(state.radius).toBeCloseTo(states[0]!.radius, 10);
      expect(state.velocity).toBeCloseTo(states[0]!.velocity, 10);
    }
  });
  it('reverses gently and clears all momentum for an exact timeline view', () => {
    const spring = new OrbitSpring();
    spring.add(1);
    spring.advance(0.06);
    const before = spring.velocity;
    spring.add(-2);
    spring.advance(0.001);
    expect(Math.abs(spring.velocity - before)).toBeLessThan(0.5);
    spring.advance(0.3);
    expect(spring.velocity).toBeLessThan(0);
    spring.reset();
    expect(spring.advance(1)).toBe(0);
    expect(spring.velocity).toBe(0);
  });
});
