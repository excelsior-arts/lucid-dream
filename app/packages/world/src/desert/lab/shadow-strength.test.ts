// @vitest-environment node
import {expect, it} from 'vitest';
import {shadowStrength} from '../scene/shadow-strength';

it('keeps full shadows for the dominant light and omits negligible secondary shadows', () => {
  expect(shadowStrength(3, 0.07)).toBe(1);
  expect(shadowStrength(0.07, 3)).toBe(0);
  expect(shadowStrength(0, 0.6)).toBe(0);
  expect(shadowStrength(0.6, 0)).toBe(1);
  expect(shadowStrength(0, 0)).toBe(0);
  expect(shadowStrength(0.001, 0)).toBe(0);
  expect(shadowStrength(0.4, 0.4)).toBe(1);
});

it('fades continuously through dusk and gives the same result after a backward seek', () => {
  let previous = 0;
  const forward = [];
  for (let i = 0; i <= 1000; i++) {
    const sun = i / 1000;
    const strength = shadowStrength(sun, 0.6);
    expect(strength).toBeGreaterThanOrEqual(previous);
    expect(strength - previous).toBeLessThan(0.025);
    forward.push(strength);
    previous = strength;
  }
  for (let i = 1000; i >= 0; i--) expect(shadowStrength(i / 1000, 0.6)).toBe(forward[i]);
});
