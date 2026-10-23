// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {AdaptiveQuality, QUALITY, qualityMode, renderPixelRatio} from '../loop/quality';

function frames(q: AdaptiveQuality, seconds: number, fps: number) {
  let changes = 0;
  for (let i = 0; i < seconds * fps; i++) changes += Number(q.observe(1 / fps));
  return changes;
}
describe('graphics budgets', () => {
  it('caps total Retina pixels and stays below the device density', () => {
    for (const tier of ['high', 'balanced', 'low'] as const)
      for (const [w, h, dpr] of [
        [390, 844, 3],
        [1440, 900, 2],
        [3840, 2160, 2],
        [800, 600, 1],
      ]) {
        const ratio = renderPixelRatio(w!, h!, dpr!, tier);
        expect(ratio).toBeLessThanOrEqual(dpr!);
        expect(w! * h! * ratio * ratio).toBeLessThanOrEqual(QUALITY[tier].pixels + 1);
      }
    expect(renderPixelRatio(1440, 900, 2, 'low', 0.75)).toBeLessThan(
      renderPixelRatio(1440, 900, 2, 'low'),
    );
  });
  it('steps the middle budget in cadence, not in picture, and keeps the ladder monotone', () => {
    for (const key of ['pixelRatio', 'pixels', 'bloom', 'water', 'body', 'sunShadow'] as const)
      expect(QUALITY.balanced[key]).toBe(QUALITY.high[key]);
    expect(QUALITY.high.fps).toBe(60);
    expect(QUALITY.balanced.fps).toBe(30);
    expect(QUALITY.low.fps).toBe(30);
    // Low is the only step that gives up picture, and it gives up all of it.
    expect(QUALITY.low.pixels).toBeLessThan(QUALITY.balanced.pixels);
    expect(QUALITY.low.body).toBe('low');
    expect(QUALITY.low.water).toBe('low');
    expect(QUALITY.low.sunShadow).toBeLessThan(QUALITY.balanced.sunShadow);
  });
  it('uses a conservative WebGL budget and validates URL or Studio input', () => {
    expect(new AdaptiveQuality('auto', false).tier).toBe('low');
    expect(qualityMode('ultra')).toBe('auto');
    expect(new AdaptiveQuality('high', false).tier).toBe('high');
  });
  it('ignores startup and isolated hitches, then reduces sustained slow rendering', () => {
    const q = new AdaptiveQuality();
    frames(q, 2, 15); // Shader warmup.
    frames(q, 12, 60);
    q.observe(0.15);
    frames(q, 4, 60);
    expect(q.tier).toBe('balanced');
    // Balanced now budgets 30 fps, so overload means well under that.
    expect(frames(q, 8, 18)).toBe(1);
    expect(q.tier).toBe('low');
    expect(q.inspect().targetFps).toBe(30);
  });
  it('does not count a capped 30 fps as overload or oscillate back up', () => {
    const q = new AdaptiveQuality();
    expect(q.tier).toBe('balanced');
    expect(frames(q, 90, 30)).toBe(0);
    expect(q.tier).toBe('balanced');
    expect(q.scale).toBe(1);
    q.select('auto');
    expect(q.tier).toBe('balanced');
  });
  it('has a bounded final resolution fallback without repeated reallocations', () => {
    const q = new AdaptiveQuality('auto', false);
    expect(frames(q, 10, 15)).toBe(1);
    expect(q.scale).toBe(0.75);
    expect(frames(q, 90, 15)).toBe(0);
  });
  it('excludes tab gaps, resets and manual quality from auto degradation', () => {
    const q = new AdaptiveQuality();
    frames(q, 5, 30);
    q.observe(10);
    frames(q, 6, 30);
    expect(q.tier).toBe('balanced');
    q.resetSampling();
    frames(q, 6, 30);
    expect(q.tier).toBe('balanced');
    q.select('high');
    expect(frames(q, 30, 15)).toBe(0);
    expect(q.tier).toBe('high');
  });
  it('also degrades persistently very slow devices instead of treating every frame as a loading hitch', () => {
    const q = new AdaptiveQuality();
    expect(frames(q, 12, 1)).toBe(1);
    expect(q.tier).toBe('low');
  });
});
