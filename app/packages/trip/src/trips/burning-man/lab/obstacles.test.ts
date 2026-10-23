// @vitest-environment node
import {expect, it} from 'vitest';
import {moveAroundObstacles, obstacleDistance, WALKER_CLEARANCE, type WalkObstacle} from '@lucid/world/desert';
import {Walker} from '../experience/walker';
import {ScriptedWalk} from '../experience/rehearsal';
import {FALLEN_OBSTACLES} from '../world/fallen-site';
import {REFERENCE} from './reference-score';

const obstacle: WalkObstacle = {ax: 0, az: -1, bx: 0, bz: 1, radius: .45};
const clear = (p: {x: number; z: number}, o = obstacle) =>
  expect(obstacleDistance(p.x, p.z, o)).toBeGreaterThanOrEqual(WALKER_CLEARANCE - 1e-8);

it('sweeps through sides and rounded ends without tunneling, including the rotated altar', () => {
  for (const o of [obstacle, ...FALLEN_OBSTACLES]) {
    const x = (o.ax + o.bx) / 2, z = (o.az + o.bz) / 2;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const result = moveAroundObstacles(x + 5 * dx, z + 5 * dz, x - 5 * dx, z - 5 * dz, [o]);
      clear(result, o);
      // An oblique sweep can slide beyond the centre, but cannot reach the
      // requested opposite point by passing straight through the capsule.
      expect(Math.hypot(result.x - (x - 5 * dx), result.z - (z - 5 * dz))).toBeGreaterThan(.5);
    }
  }
});

it('slides around a rounded end at different frame rates without sticking or penetrating', () => {
  const ends = [30, 60, 120].map(hz => {
    let p = {x: -2, z: -.5};
    for (let i = 0; i < 6 * hz; i++) {
      p = moveAroundObstacles(p.x, p.z, p.x + 1 / hz, p.z + .65 / hz, [obstacle]);
      clear(p);
    }
    expect(p.x).toBeGreaterThan(1);
    expect(p.z).toBeGreaterThan(2);
    return p;
  });
  expect(Math.hypot(ends[0]!.x - ends[2]!.x, ends[0]!.z - ends[2]!.z)).toBeLessThan(.08);
});

it('settles actual speed and walked distance when a held key presses against the body', () => {
  const w = new Walker(() => 0, [obstacle]);
  w.reset(-3, 0);
  w.state.facing = Math.PI / 2;
  for (let i = 0; i < 600; i++) { w.step(1, 0, 1 / 60, 1, REFERENCE, true); clear(w.state.position); }
  const distance = w.state.distance;
  for (let i = 0; i < 120; i++) w.step(1, 0, 1 / 60, 1, REFERENCE, true);
  expect(w.state.speed).toBeLessThan(.001);
  expect(w.state.distance - distance).toBeLessThan(.001);
  const stoppedX = w.state.position.x;
  for (let i = 0; i < 180; i++) w.step(-1, 0, 1 / 60, 1, REFERENCE, true);
  expect(w.state.position.x).toBeLessThan(stoppedX - .3);
  expect(w.state.speed).toBeGreaterThan(.1);
});

it('projects overlapping spawns outside and preserves a paused pose', () => {
  const w = new Walker(() => 0, [obstacle]);
  w.reset(0, 0);
  clear(w.state.position);
  const before = structuredClone(w.state);
  w.step(1, 0, 0, 1, REFERENCE, true);
  expect(w.state).toEqual(before);
});

it('leaves the authored ocean route unchanged', () => {
  const original = new ScriptedWalk(REFERENCE);
  const colliding = new ScriptedWalk(REFERENCE, 'sea', false, FALLEN_OBSTACLES);
  for (const time of [0, 20, 75, 149, 30]) expect(colliding.sample(time)).toEqual(original.sample(time));
});
