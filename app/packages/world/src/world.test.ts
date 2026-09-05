/* The world, and the one property everything above it stands on.
 *
 * A room is a pure function of the clicks. With hand-written arithmetic that
 * was true by inspection; with a physics engine in the middle of it, it is
 * true because these tests say it is, and it is the kind of thing that stops
 * being true silently — a variable step, a stream of random numbers, an event
 * applied in a different order, and the room somebody left is not the room
 * they come back to.
 */
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';

import {dynamicFromMesh, pose, staticFromMesh, sync} from './bodies';
import {shove} from './impulse';
import {replay, rerun} from './replay';
import {hush, isAsleep, rouse, settle} from './settle';
import {createWorld, ready} from './world';
import type {World} from './world';

beforeAll(async () => { await ready(); });

/** A floor at y = 0, five meters of it, and nothing else. */
function ground(w: World) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(10, .4, 10));
  slab.position.y = -.2;
  return staticFromMesh(w, slab, {friction: .9});
}

/** A book-sized box, half a kilo of it, awake unless asked otherwise. A mass
    is worth writing down: an impulse is newton-seconds, so a shove that reads
    as a finger against a book is a shove that would throw a gram across the
    room. */
function crate(w: World, at: [number, number, number] = [0, .1, 0], sleeping = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(.4, .06, .3));
  m.position.set(...at);
  return dynamicFromMesh(w, m, {mass: .5, sleeping});
}

/* A keyed rng, the same one the rooms use: `fate(name, n)` is a hash, never
   the next number out of a stream. Written out here rather than imported
   because it belongs to the game above and this package must not know it —
   what matters is that it is a function of the key. */
const fate = (...key: unknown[]) => {
  let h = 2166136261 >>> 0;
  for (const part of key) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h = Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0;
  }
  let x = (h + 0x6d2b79f5) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

describe('the step', () => {
  it('is fixed, so a slow frame is more steps and never a longer one', () => {
    const w = createWorld({seed: 'a'});
    expect(w.advance(1 / 120)).toBe(0);      // banked, not taken
    expect(w.advance(1 / 120)).toBe(1);      // and now there is a step in it
    expect(w.advance(4 / 60)).toBe(4);
    w.dispose();
  });

  it('drops the time a tab spent in the background rather than simulating it', () => {
    const w = createWorld({seed: 'a'});
    /* Two minutes away. A world that honoured that would have finished every
       fall in the room before the first frame was drawn — and six steps is
       also the most a stutter is allowed to be caught up with in one frame,
       which is the difference between a room that hesitates and a book that
       crosses a hand's width between two pictures. */
    expect(w.advance(120)).toBe(6);
    w.dispose();
  });

  it('and stepN is the same world as advance over the same time', () => {
    const walk = (w: World) => {
      ground(w);
      const box = crate(w, [0, .8, 0]);
      shove(box, {dir: {x: 1, y: .2, z: .3}, strength: .3, twist: {x: .002, y: 0, z: .004}});
      return box;
    };
    const slow = createWorld({seed: 'a'});
    const fast = createWorld({seed: 'a'});
    const a = walk(slow), b = walk(fast);
    for (let i = 0; i < 240; i++) slow.advance(1 / 60);
    fast.stepN(240);
    expect(slow.steps).toBe(240);
    expect(pose(a)).toEqual(pose(b));
    slow.dispose();
    fast.dispose();
  });
});

describe('a body', () => {
  it('is made asleep, so an untouched room is a picture and not a simulation', () => {
    const w = createWorld({seed: 'a'});
    ground(w);
    const box = crate(w, [0, 1.4, 0], true);  // and nowhere near the floor
    expect(isAsleep(box)).toBe(true);
    w.stepN(120);
    /* Two seconds of gravity, and it has not moved. Six places rather than
       nine because Rapier keeps its positions in single precision, which is
       also why a room at rest is never synced *from* the bodies: the meshes
       were composed by hand in double and are left exactly where they were
       put until a hand actually moves one. */
    expect(box.body.translation().y).toBeCloseTo(1.4, 6);
    w.dispose();
  });

  /* And the awkward truth underneath that, which everything above this line
     is built on knowing. */
  it('is woken anyway by the first step of a fresh world, until it is hushed', () => {
    const loud = createWorld({seed: 'a'});
    ground(loud);
    const one = crate(loud, [0, .03, 0], true);
    const two = crate(loud, [3, .03, 0], true);
    /* Inserting a body counts as changing it, and a changed body goes back
       into the active set whatever it was created as. So the first step of a
       world full of sleeping furniture wakes all of it — and, worse, wakes it
       before the contacts under it exist, so every piece falls freely for the
       few steps it takes them to appear. Five centimeters of the whole room
       dropping and climbing back on the first press of an evening. */
    shove(one, {dir: {x: 1, y: 0, z: 0}, strength: .5});
    loud.stepN(6);
    expect(two.body.isSleeping()).toBe(false);
    expect(two.body.translation().y).toBeLessThan(0);      // through the floor
    loud.dispose();

    /* Hushed: made awake, stepped once so the contacts are made, and put to
       sleep on the spot. Now a shove wakes what it touches and nothing else,
       and the rest of the room does not move at all. */
    const quiet = createWorld({seed: 'a'});
    ground(quiet);
    const three = crate(quiet, [0, .03, 0]);
    const four = crate(quiet, [3, .03, 0]);
    hush(quiet, [three, four]);
    expect(four.body.isSleeping()).toBe(true);
    const was = four.body.translation().y;
    shove(three, {dir: {x: 1, y: 0, z: 0}, strength: .5});
    quiet.stepN(120);
    expect(four.body.isSleeping()).toBe(true);
    expect(four.body.translation().y).toBe(was);
    // And the one step it cost is not a settle: a tenth of a millimeter.
    expect(Math.abs(was - .03)).toBeLessThan(.001);
    quiet.dispose();
  });

  it('has a collider its own size, measured in its own frame', () => {
    const w = createWorld({seed: 'a'});
    // Lying at an angle: a world-axis box round this would be half again as
    // wide as the thing, and books on a shelf would not fit past each other.
    const m = new THREE.Mesh(new THREE.BoxGeometry(.4, .06, .3));
    m.rotation.y = Math.PI / 4;
    const it = dynamicFromMesh(w, m);
    const half = it.collider.halfExtents()!;
    expect(half.x).toBeCloseTo(.2, 6);
    expect(half.z).toBeCloseTo(.15, 6);
    w.dispose();
  });

  it('and falls onto a floor and goes to sleep on it', () => {
    const w = createWorld({seed: 'a'});
    ground(w);
    const box = crate(w, [0, .9, 0]);
    const steps = settle(w, [box], {maxSteps: 600});
    expect(steps).toBeLessThan(600);
    expect(box.body.translation().y).toBeCloseTo(.03, 2);
    sync(box);
    expect(box.mesh.position.y).toBeCloseTo(.03, 2);
    w.dispose();
  });
});

describe('a shove', () => {
  it('moves it, and it comes to rest', () => {
    const w = createWorld({seed: 'a'});
    ground(w);
    const box = crate(w);
    settle(w, [box]);
    const was = pose(box).position;
    shove(box, {dir: {x: 1, y: .15, z: 0}, strength: .35});
    const steps = settle(w, [box], {maxSteps: 900});
    const now = pose(box).position;
    expect(steps).toBeLessThan(900);
    expect(now.x - was.x).toBeGreaterThan(.02);
    expect(isAsleep(box)).toBe(true);
    w.dispose();
  });
});

describe('the same clicks', () => {
  /* The whole contract, measured: two worlds that know nothing of each other,
     given the same events in the same order, hold the same poses. This is why
     a save can be a count per name and never a position. */
  const room = (seed: string) => {
    const w = createWorld({seed});
    ground(w);
    const books = ['book-1', 'book-2'].map((name, i) => ({
      name, bound: crate(w, [i * .9 - .45, .05, 0]),
    }));
    settle(w, books.map((b) => b.bound));
    const apply = (name: string, n: number) => {
      const it = books.find((b) => b.name === name)!;
      const a = fate(name, n) * Math.PI * 2;
      const far = .2 + fate(name, n, 'far') * .3;
      shove(it.bound, {
        dir: {x: Math.cos(a), y: .2, z: Math.sin(a)},
        strength: far,
        twist: {x: (fate(name, n, 'tilt') - .5) * .004, y: 0,
                z: (fate(name, n, 'roll') - .5) * .004},
      });
      return [it.bound];
    };
    return {w, books, apply};
  };

  it('give the same room, to a billionth of a meter', () => {
    const events = [{name: 'book-1', count: 3}, {name: 'book-2', count: 2}];
    const one = room('lover/2026-09-02');
    const two = room('lover/2026-09-02');
    replay(one.w, events, one.apply);
    replay(two.w, events, two.apply);
    for (let i = 0; i < one.books.length; i++) {
      const a = pose(one.books[i]!.bound), b = pose(two.books[i]!.bound);
      expect(a.position.x).toBeCloseTo(b.position.x, 9);
      expect(a.position.y).toBeCloseTo(b.position.y, 9);
      expect(a.position.z).toBeCloseTo(b.position.z, 9);
      expect(a.quaternion.w).toBeCloseTo(b.quaternion.w, 9);
    }
    one.w.dispose();
    two.w.dispose();
  });

  it('and a third shove is somewhere the second one was not', () => {
    const two = room('a');
    const three = room('a');
    replay(two.w, [{name: 'book-1', count: 2}], two.apply);
    replay(three.w, [{name: 'book-1', count: 3}], three.apply);
    const a = pose(two.books[0]!.bound).position;
    const b = pose(three.books[0]!.bound).position;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(.02);
    two.w.dispose();
    three.w.dispose();
  });
});

/* ---- waking a pile ---------------------------------------------------------
   The fault `rouse` exists for, and the one that cost a room a book every time
   somebody pushed the top of a stack. It is a property of the engine rather
   than of any room, so it is measured here, on three crates and a slab. */
describe('waking one thing in a stack', () => {
  /** Three of them, one on another, asleep on a slab of real thickness. */
  const pile = (seed: string) => {
    const w = createWorld({seed});
    const slab = new THREE.Mesh(new THREE.BoxGeometry(4, .25, 4));
    slab.position.y = -.125;                 // its top face at y = 0
    staticFromMesh(w, slab, {friction: .9});
    const books = [0, 1, 2].map((i) => crate(w, [0, .03 + i * .06, 0]));
    hush(w, books);
    return {w, books};
  };

  it('drops the rest of it through the floor, because their contacts are gone', () => {
    /* Rapier wakes the island and rebuilds the manifolds only of what was
       woken by name. The two underneath spend ten steps in free fall with
       nothing under them, and the bottom one is through a quarter meter of
       stone before the narrow phase catches up. This is the bug, written
       down: if it ever stops being true, `rouse` can go. */
    const {w, books} = pile('stack/alone');
    books[2]!.body.wakeUp();
    w.stepN(90);
    /* Inside the stone, by twice its own thickness — it did not sag, it went
       in through the top face while nothing was looking. In a room whose
       floor is a quarter meter of slab it goes out through the bottom. */
    expect(pose(books[0]!).position.y).toBeLessThan(-.12);
    w.dispose();
  });

  it('and stays a stack when what it is leaning on is woken with it', () => {
    const {w, books} = pile('stack/roused');
    const was = books.map((b) => pose(b).position.y);
    const woken = rouse(w, books[2]!, books);
    // The whole pile, worked out from the contacts rather than asked for.
    expect(woken.length).toBe(3);
    w.stepN(60);
    for (let i = 0; i < books.length; i++) {
      /* Where it stood, near enough. A pile woken with its contacts intact
         sags by the slack a solver leaves in a contact and by nothing else —
         a millimeter and a bit through three of them, against the two
         millimeters the room above this calls the least it will admit to as
         movement. That margin is the whole reason a press does not make the
         room shiver. */
      expect(Math.abs(pose(books[i]!).position.y - was[i]!)).toBeLessThan(2e-3);
    }
    w.dispose();
  });
});

/* ---- and the run, done again ----------------------------------------------- */
describe('the shoves, in the order they were made', () => {
  const room = (seed: string) => {
    const w = createWorld({seed});
    ground(w);
    const books = ['book-1', 'book-2'].map((name, i) => ({
      name, bound: crate(w, [i * .9 - .45, .05, 0], true),
    }));
    hush(w, books.map((b) => b.bound));
    const apply = (name: string, n: number) => {
      const it = books.find((b) => b.name === name)!;
      const a = fate(name, n) * Math.PI * 2;
      shove(it.bound, {
        dir: {x: Math.cos(a), y: .2, z: Math.sin(a)},
        // Hard enough to still be travelling a few frames later, which is
        // what the timing test below is about.
        strength: 1.2 + fate(name, n, 'far') * .8,
        twist: {x: (fate(name, n, 'tilt') - .5) * .004, y: 0,
                z: (fate(name, n, 'roll') - .5) * .004},
      });
      return [it.bound];
    };
    return {w, books, apply};
  };

  const log = [{name: 'book-1', steps: 0}, {name: 'book-2', steps: 17},
               {name: 'book-1', steps: 140}, {name: 'book-2', steps: 5}];

  it('are the same room every time, to a billionth of a meter', () => {
    const one = room('lover/order'), two = room('lover/order');
    rerun(one.w, log, one.apply);
    rerun(two.w, log, two.apply);
    for (let i = 0; i < one.books.length; i++) {
      const a = pose(one.books[i]!.bound), b = pose(two.books[i]!.bound);
      expect(a.position.x).toBeCloseTo(b.position.x, 9);
      expect(a.position.y).toBeCloseTo(b.position.y, 9);
      expect(a.position.z).toBeCloseTo(b.position.z, 9);
      expect(a.quaternion.w).toBeCloseTo(b.quaternion.w, 9);
    }
    one.w.dispose();
    two.w.dispose();
  });

  it('and the steps between them are part of what a room is', () => {
    /* The same two shoves, the second of them a sixth of a second later, is a
       different room — which is the whole reason a count per name could not
       say what happened in one. A thing that has stopped moving is shoved
       from somewhere else than one still sliding, and the second push lands
       on a body with nothing left of the first in it rather than on one
       already travelling. */
    const soon = room('lover/when'), late = room('lover/when');
    rerun(soon.w, [{name: 'book-1', steps: 0}, {name: 'book-1', steps: 6}], soon.apply);
    rerun(late.w, [{name: 'book-1', steps: 0}, {name: 'book-1', steps: 200}], late.apply);
    const a = pose(soon.books[0]!.bound).position;
    const b = pose(late.books[0]!.bound).position;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(.02);
    soon.w.dispose();
    late.w.dispose();
  });

  it('and a save that never kept them is opened by letting things rest', () => {
    /* `steps` of null: what a count per name means, and all it can mean. What
       those nulls turned out to be comes back, so an old save can be written
       down as a new one and never guessed at twice. */
    const old = room('lover/older'), told = room('lover/older');
    const took = rerun(old.w, [{name: 'book-1', steps: null},
                               {name: 'book-1', steps: null}], old.apply);
    expect(took.length).toBe(3);            // before each, and the rest at the end
    expect(took[0]).toBe(0);                // nothing runs before the first
    expect(took[1]).toBeGreaterThan(0);
    // And read back as numbers, the same room comes out.
    rerun(told.w, [{name: 'book-1', steps: took[0]},
                   {name: 'book-1', steps: took[1]}], told.apply);
    const a = pose(old.books[0]!.bound), b = pose(told.books[0]!.bound);
    expect(a.position.x).toBeCloseTo(b.position.x, 9);
    expect(a.position.z).toBeCloseTo(b.position.z, 9);
    old.w.dispose();
    told.w.dispose();
  });
});
