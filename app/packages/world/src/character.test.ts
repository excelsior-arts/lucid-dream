/* The character controller, which no room in this checkout uses.
 *
 * It is tested because it is the piece the next games are built on and the
 * one that is hard to add afterwards — and because a capsule that cannot get
 * up a step is a bug nobody finds until there are stairs.
 *
 * Every test drives it the way a game does: `stepN` with a callback, and the
 * move inside the callback. `move` writes down where the body is to be next
 * and takes no step of its own, so a test that called it in a bare loop would
 * be a test of a figure that never actually goes anywhere.
 */
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';

import {staticFromMesh} from './bodies';
import {createCharacter} from './character';
import type {Character} from './character';
import {staticHeightfield} from './heightfield';
import {createWorld, ready} from './world';
import type {World} from './world';

beforeAll(async () => { await ready(); });

/** Twenty metres of nothing, as the ground a game would actually build. */
function flat(w: World) {
  return staticHeightfield(w, {
    rows: 11, cols: 11, heights: new Float32Array(121), size: {x: 40, z: 40},
    friction: .9,
  });
}

/** A slab floor, for the tests that want a ledge or a wall beside it. */
function slab(w: World, size: [number, number, number], at: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size));
  m.position.set(...at);
  return staticFromMesh(w, m);
}

/** `n` fixed steps with one move inside each, the way a walk's loop runs. */
function walk(w: World, who: Character, n: number, dir: {x: number; z: number},
              each?: (step: number) => void) {
  w.stepN(n, (step) => {
    who.move(dir, w.step);
    each?.(step);
  });
}

describe('a character', () => {
  it('walks across a heightfield and gets about as far as it asked to', () => {
    const w = createWorld({seed: 'walk'});
    flat(w);
    const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});

    // Two seconds east at a metre and a half a second: three metres of it.
    walk(w, who, 120, {x: 1.5, z: 0});

    expect(who.at().x).toBeGreaterThan(2.8);
    expect(who.at().x).toBeLessThan(3.05);
    /* And did not wander sideways -- to three decimals, because a capsule
       sliding across the triangles of a heightfield picks up a fraction of a
       millimetre of drift a metre, and Rapier's numbers are 32-bit. */
    expect(who.at().z).toBeCloseTo(0, 3);
    expect(who.grounded).toBe(true);
    expect(who.fall).toBe(0);
    who.dispose();
    w.dispose();
  });

  it('falls off a ledge, and lands lower than it started', () => {
    const w = createWorld({seed: 'ledge'});
    // The ground, and a two-metre plinth on the western half of it.
    slab(w, [40, .4, 40], [0, -.2, 0]);
    slab(w, [12, 2, 10], [-5, 1, 0]);

    const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: -8, y: 2.92, z: 0}});
    const from = who.at().y;

    let fell = 0;
    let leftTheGround = false;
    walk(w, who, 600, {x: 2, z: 0}, () => {
      if (!who.grounded) leftTheGround = true;
      fell = Math.min(fell, who.fall);
    });

    expect(leftTheGround).toBe(true);
    // It was falling, and by more than the hair a walk down a slope would be.
    expect(fell).toBeLessThan(-2);
    // And has landed: on the ground, with the fall spent.
    expect(who.grounded).toBe(true);
    expect(who.fall).toBe(0);
    expect(who.at().y).toBeLessThan(from - 1.5);
    expect(who.at().x).toBeGreaterThan(1);
    who.dispose();
    w.dispose();
  });

  it('steps a kerb rather than stopping against it', () => {
    const w = createWorld({seed: 'kerb'});
    slab(w, [20, .4, 20], [0, -.2, 0]);
    slab(w, [4, .2, 8], [4.5, .1, 0]);

    const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});
    walk(w, who, 240, {x: 1.5, z: 0});

    expect(who.at().x).toBeGreaterThan(4.5);
    expect(who.grounded).toBe(true);
    // On top of the kerb rather than stopped against it.
    expect(who.at().y).toBeGreaterThan(.95);
    who.dispose();
    w.dispose();
  });

  it('is stopped by a wall rather than going through it', () => {
    const w = createWorld({seed: 'wall'});
    slab(w, [20, .4, 20], [0, -.2, 0]);
    slab(w, [.4, 3, 8], [2, 1.5, 0]);

    const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});
    walk(w, who, 180, {x: 2, z: 0});
    expect(who.at().x).toBeLessThan(1.6);
    who.dispose();
    w.dispose();
  });

  /* The property the whole package is shaped by, at the one place a game with
     a figure in it would lose it: the same clicks are the same walk. */
  it('is the same walk twice, to the bit', () => {
    const inputs = Array.from({length: 400}, (_, i) => ({
      x: Math.cos(i / 37) * 3,
      z: Math.sin(i / 23) * 3,
    }));
    const once = () => {
      const w = createWorld({seed: 'twice'});
      flat(w);
      slab(w, [1, 2, 6], [3, 1, 1]);
      const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});
      let i = 0;
      w.stepN(inputs.length, () => { who.move(inputs[i++]!, w.step); });
      const end = who.at();
      who.dispose();
      w.dispose();
      return end;
    };
    const a = once();
    const b = once();
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(b.z).toBe(a.z);
    // And it actually went somewhere, so the equality is not two zeroes.
    expect(Math.abs(a.x) + Math.abs(a.z)).toBeGreaterThan(1);
  });

  it('walks through a sensor and into a solid, and says which it hit', () => {
    const w = createWorld({seed: 'hits'});
    const ground = flat(w);
    const trigger = slab(w, [1, 3, 6], [2, 1.5, 0]);
    trigger.collider.setSensor(true);
    const box = slab(w, [1, 3, 6], [6, 1.5, 0]);

    const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});
    let sawTheSensor = false;
    walk(w, who, 300, {x: 2, z: 0}, () => {
      if (who.hits().includes(trigger.collider.handle)) sawTheSensor = true;
    });

    // Straight through the trigger: never a wall, never in hits().
    expect(who.at().x).toBeGreaterThan(2);
    expect(sawTheSensor).toBe(false);
    // And stopped against the box, which is.
    expect(who.at().x).toBeLessThan(5.7);
    expect(who.hits()).toContain(box.collider.handle);
    /* The ground is in there too. `hits()` is what was run into, and the
       caller is the only one who knows which of them is the floor. */
    expect(who.hits()).toContain(ground.collider.handle);
    who.dispose();
    w.dispose();
  });

  it('is put down where warp says, with the fall forgotten', () => {
    const w = createWorld({seed: 'warp'});
    flat(w);
    const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: 40, z: 0}});
    // Long enough to be falling fast.
    walk(w, who, 60, {x: 0, z: 0});
    expect(who.fall).toBeLessThan(-8);

    who.warp({x: 5, y: .9, z: -5});
    // To six decimals rather than exactly: a translation makes the round trip
    // through a 32-bit float on the wasm side.
    expect(who.at().x).toBeCloseTo(5, 6);
    expect(who.at().y).toBeCloseTo(.9, 6);
    expect(who.at().z).toBeCloseTo(-5, 6);
    expect(who.fall).toBe(0);
    expect(who.hits()).toEqual([]);

    // And the step that follows does not undo it.
    walk(w, who, 30, {x: 0, z: 0});
    expect(who.at().x).toBeCloseTo(5, 3);
    expect(who.at().z).toBeCloseTo(-5, 3);
    expect(who.grounded).toBe(true);
    who.dispose();
    w.dispose();
  });
});
