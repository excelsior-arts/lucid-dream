// @vitest-environment node
import {expect, it} from 'vitest';
import {duneHeight} from '../landscape';
import {landHeight, MAP} from '../landscape';
import {HEIGHT_MIN, HEIGHT_RANGE} from '@lucid/world/desert';
import {horizonDuneHeight, basinHalfWidth} from '../landscape';
import {Walker} from '../experience/walker';
import {sampleScore, validateScore} from '../experience/score';
import {calibratedPace} from '../experience/walker';
import {REFERENCE} from './reference-score';

/** The landscape was drawn for a walk that reaches the sea. At the shipped pace it
 * no longer does, by design pending the author's choice (see the shortfall test in
 * the score suite), so the ground itself is measured at the pace that completes the
 * authored route: full gait, no intro wait, and the speed calibration would pick. */
const plain = validateScore({...REFERENCE, paceScale: 1, stage_01_flame: 0});
const ROUTE = validateScore({...plain, walkSpeed: calibratedPace(plain)});

it('keeps the coastal faces gentle and adds about ten seconds to the beach approach', () => {
  for (let x = -109; x < -39; x += 0.125)
    expect(Math.abs((duneHeight(x + 0.1, 0) - duneHeight(x - 0.1, 0)) / 0.2)).toBeLessThan(
      Math.tan((17 * Math.PI) / 180),
    );
  const walker = new Walker();
  walker.reset(0, 0);
  let crest: number | null = null,
    clear: number | null = null;
  for (let t = 0; t < ROUTE.stage_08_kneel; t += 1 / 120) {
    walker.step(-1, 0, 1 / 120, sampleScore(t, ROUTE).mobility, ROUTE);
    if (crest === null && walker.state.position.x <= MAP.gates.sea[0]) crest = t;
    if (clear === null && walker.state.position.x <= MAP.gates.sea[0] - 31) clear = t;
  }
  expect(crest).not.toBeNull();
  expect(ROUTE.stage_05_fall).toBeLessThan(crest!);
  expect(clear).not.toBeNull();
  // Preserve the roughly ten-second approach delay added by the wider central playa.
  expect(clear!).toBeGreaterThan(122);
  expect(clear!).toBeLessThan(127);
  expect(clear!).toBeLessThan(ROUTE.stage_08_kneel);
});

it('surrounds the north and south with irregular dunes while the eastern basin stays open', () => {
  for (let x = -110; x <= 130; x += 10)
    for (let z = -130; z <= 130; z += 10)
      if (Math.hypot(x, z) < 130) expect(horizonDuneHeight(x, z)).toBe(0);
  for (let x = 120; x <= 610; x += 10)
    for (let z = -120; z <= 120; z += 20) expect(horizonDuneHeight(x, z)).toBe(0);
  for (const sign of [-1, 1]) {
    let dunes = 0;
    const heights = [];
    for (let x = 0; x < 700; x += 20)
      for (let z = 250; z < 900; z += 25) {
        const height = horizonDuneHeight(x, z * sign);
        heights.push(height);
        if (height > 5) dunes++;
      }
    // Separate chains leave irregular interdune openings as well as tall crests.
    expect(dunes).toBeGreaterThan(300);
    expect(heights.filter((h) => h < 1).length).toBeGreaterThan(80);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(15);
  }
  expect(basinHalfWidth(500)).toBeGreaterThan(basinHalfWidth(0) * 2);
  expect(horizonDuneHeight(150, 360)).not.toBe(horizonDuneHeight(150, -360));
});

it('blends the walking and horizon surveys continuously without clipping dune heights', () => {
  for (let z = -192; z <= 192; z += 4)
    for (let x = -192; x <= 192; x += 4)
      expect(landHeight(x, z)).toBeLessThan(HEIGHT_MIN + HEIGHT_RANGE);
  for (const sign of [-1, 1])
    for (let x = -100; x <= 190; x += 5) {
      const inner = duneHeight(x, sign * 191.999),
        outer = duneHeight(x, sign * 192.001);
      expect(Math.abs(inner - outer)).toBeLessThan(0.01);
    }
});

// Static 2 m tiles meet the 8 m background mesh along this square. A mismatch
// here opens cracks as soon as dunes extend beyond the walking survey.
it('joins the distant mesh to the detailed terrain without open boundary edges', () => {
  for (const edge of [-256, 256])
    for (let along = -256; along < 256; along += 2) {
      const start = Math.floor(along / 8) * 8;
      const t = (along - start) / 8;
      for (const side of [false, true]) {
        const height = (value: number) =>
          side ? duneHeight(edge, value) : duneHeight(value, edge);
        expect(height(along)).toBeCloseTo(height(start) * (1 - t) + height(start + 8) * t, 6);
      }
    }
});
