/* The contract the rooms are built on, held to in the small.
 *
 * The rooms themselves are checked in a browser — a room needs a renderer, a
 * camera and a canvas before it needs a solver, and none of those exist here.
 * What *can* be checked here is the promise underneath them, which is the one
 * that would rot silently: the save is a count per name, and where a thing has
 * got to is redone from that count. If two replays of the same counts ever
 * stop agreeing, every conversation ever had in one of these rooms opens in a
 * room that is nearly right.
 *
 * So this is the ribbon and one book, stripped to the parts that matter: a
 * sloped surface with a hole at the middle of it, a body on it, and a shove
 * keyed the way `fate(name, n)` keys — which is where the rooms get theirs.
 */
import * as THREE from 'three';
import {beforeAll, expect, test} from 'vitest';
import {
  dynamicFromMesh, hush, isAsleep, pose, replay, rerun, ready, rouse, shove,
  staticFromMesh, createWorld,
} from '@lucid/world';
import type {Bound, World} from '@lucid/world';

beforeAll(async () => { await ready(); });

/* The same hash `fate` is: keyed, never a stream. A stream would desync the
   moment two shoves replayed in a different order, and this file is about
   exactly that not happening. */
function fate(...key: unknown[]): number {
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
}

const SINK = -8;                     // below this, the room has let go of it

/** A ring of stone with a hole down the middle of it, and books on it.
 *
 * Slabs with real depth, because that is what the rooms' own floors are now:
 * the spiral in thinker.js is cut into one box per facet of the drawn ribbon
 * rather than handed over as its own triangles. A surface with no thickness
 * lets a body composed a centimeter inside it out through the bottom, and
 * every flat thing laid by eye on a floor that falls away is composed a
 * centimeter inside it somewhere. `sunk` is exactly that book.
 */
function room(seed: string, {sunk = 0} = {}) {
  const w = createWorld({seed});
  for (const [x, z, sx, sz] of [[0, 2.5, 6, 2], [0, -2.5, 6, 2],
                                [2.5, 0, 2, 6], [-2.5, 0, 2, 6]]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(sx!, .3, sz!));
    slab.position.set(x!, -.15, z!);
    staticFromMesh(w, slab, {friction: .9});
  }
  const make = (x: number, z: number, into = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, .06, .3));
    mesh.position.set(x, .03 - into, z);
    return {mesh, bound: dynamicFromMesh(w, mesh, {mass: .5, friction: .82})};
  };
  const one = make(-1.9, 1.9, sunk);
  // Another, right across the room, that no hand is ever going to touch.
  const other = make(1.9, -1.9);
  /* And the room made quiet: one step so the contacts exist, then everything
     asleep where it stands. Without it the first step of the world wakes the
     lot — see the world package. */
  hush(w, [one.bound, other.bound]);
  return {w, book: one.mesh, bound: one.bound, other: other.bound};
}

/* Which way the nth shove goes: in towards the hole, off a keyed random —
   the same shape thinker.js uses, and the reason a book ends up in the drop
   rather than wandering. */
function push(w: World, b: Bound, name: string, n: number) {
  const at = b.body.translation();
  const pull = Math.atan2(-at.z, -at.x);
  const a = pull + (fate(name, n) - .5) * 2.4;
  const far = .34 + fate(name, n, 'far') * .5 + n * .03;
  const v = Math.sqrt(2 * .82 * 9.81 * far);
  shove(b, {dir: {x: Math.cos(a), y: .1, z: Math.sin(a)},
            strength: .5 * v * Math.hypot(1, .1),
            twist: {x: -Math.sin(a) * .55, y: 0, z: Math.cos(a) * .55}});
  void w;
}

/** Stop simulating whatever has left the room, the way the room does. */
const gone = (b: Bound) => b.body.translation().y < SINK;
const park = (b: Bound) => { if (gone(b)) b.body.setEnabled(false); };

test('a shove moves it, and it comes to rest', () => {
  const {w, bound} = room('lover/one');
  const was = pose(bound).position;
  replay(w, [{name: 'book-2-1', count: 1}],
         (name, n) => { push(w, bound, name, n); return [bound]; }, [],
         {maxSteps: 600, onStep: () => park(bound)});
  const now = pose(bound).position;
  expect(Math.hypot(now.x - was.x, now.z - was.z)).toBeGreaterThan(.1);
  w.dispose();
});

test('replaying the same count twice gives the same pose, to a billionth', () => {
  const one = room('lover/two');
  const two = room('lover/two');
  for (const it of [one, two]) {
    replay(it.w, [{name: 'book-2-1', count: 3}],
           (name, n) => { push(it.w, it.bound, name, n); return [it.bound]; }, [],
           {maxSteps: 600, onStep: () => park(it.bound)});
  }
  const a = pose(one.bound), b = pose(two.bound);
  expect(a.position.x).toBeCloseTo(b.position.x, 9);
  expect(a.position.y).toBeCloseTo(b.position.y, 9);
  expect(a.position.z).toBeCloseTo(b.position.z, 9);
  expect(a.quaternion.w).toBeCloseTo(b.quaternion.w, 9);
  one.w.dispose();
  two.w.dispose();
});

test('and a book worked far enough in goes over the edge and is gone', () => {
  const {w, bound} = room('lover/three');
  let over = false;
  for (let n = 1; n <= 12 && !over; n++) {
    replay(w, [{name: 'book-2-1', count: 1}],
           () => { push(w, bound, 'book-2-1', n); return [bound]; }, [],
           {maxSteps: 600, onStep: () => { park(bound); if (gone(bound)) over = true; }});
  }
  expect(over).toBe(true);
  expect(pose(bound).position.y).toBeLessThan(SINK);
  w.dispose();
});

test('a book composed inside the stone is pushed up out of it, never through', () => {
  // A centimeter in, which is what a flat book on a ribbon that is falling
  // away is composed as, and which no eye has ever caught.
  const {w, bound} = room('thinker/sunk', {sunk: .01});
  const was = pose(bound).position;
  /* Still where it was put, to a couple of millimeters: the one step it took
     to make the contacts is a step, and a body already inside something
     spends it falling. That is why the room writes down where a body ended
     that step and asks "has this moved" against *that*, rather than against
     the numbers it was drawn with — otherwise the whole room reads as having
     moved the moment anybody touches any of it. */
  expect(Math.abs(was.y - .02)).toBeLessThan(.002);
  replay(w, [{name: 'book-2-1', count: 1}],
         (name, n) => { push(w, bound, name, n); return [bound]; }, [],
         {maxSteps: 600, onStep: () => park(bound)});
  const now = pose(bound).position;
  expect(now.y).toBeGreaterThan(was.y);        // it came up
  expect(now.y).toBeCloseTo(.03, 2);           // and is standing on the stone
  w.dispose();
});

test('and what nobody touched has not moved at all', () => {
  const {w, bound, other} = room('thinker/still');
  const was = pose(other);
  replay(w, [{name: 'book-2-1', count: 2}],
         (name, n) => { push(w, bound, name, n); return [bound, other]; }, [],
         {maxSteps: 600, onStep: () => park(bound)});
  /* Not "close to": the same. A body that was never woken is where it was
     put, to the bit — which is what lets the room leave its meshes at the
     doubles they were composed with and rebuild itself under them without
     anything on screen so much as shivering. */
  expect(pose(other)).toEqual(was);
  w.dispose();
});

/* ---- a pile, and the press that used to cost the room the bottom of it ------
 *
 * The complaint was "once I click the same pile of books, a few gone, the rest
 * are not clickable", and this is what was under it: shoving the top of a
 * stack put the whole stack into Rapier's active set without giving any of it
 * its contacts back, so everything under the pushed book fell freely for ten
 * steps and the bottom one was through a quarter meter of stone before the
 * narrow phase caught up. It left the room, its target went with it, and what
 * was left of the pile had a hole in it.
 *
 * Written down here in the room's own terms — a stack on a slab, one shove —
 * because that is where it was seen.
 */
function pile(seed: string, n = 5) {
  const w = createWorld({seed});
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4, .25, 4));
  slab.position.y = -.125;                      // its top face at y = 0
  staticFromMesh(w, slab, {friction: .95, restitution: .02});
  const books: Bound[] = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const tall = .055 + ((i * 7 + n) % 4) * .012;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.38, tall, .28));
    mesh.position.set(0, y + tall / 2, 0);
    books.push(dynamicFromMesh(w, mesh, {mass: .5, friction: .82, sleeping: false}));
    y += tall;
  }
  hush(w, books);
  return {w, books};
}

test('shoving the top of a pile leaves the rest of it standing on the stone', () => {
  const {w, books} = pile('thinker/pile');
  const was = books.map((b) => pose(b).position);
  const top = books[books.length - 1]!;
  rouse(w, top, books);
  push(w, top, 'book-3-4', 1);
  w.stepN(600);
  for (let i = 0; i < books.length - 1; i++) {
    const now = pose(books[i]!).position;
    /* Standing on the stone, not in it, and within a millimeter of where it
       stood at the bottom of the pile — the ones nearer the top settle by the
       thickness of the book that has just left. Without the wake the bottom
       one spends ten steps in free fall with nothing under it, and where it
       ends up is inside a quarter meter of slab or straight through it. The
       property itself is pinned in the world package, at `rouse`; this is the
       same thing said in the shape a room actually meets it. */
    expect(now.y).toBeGreaterThan(-.005);
    if (i === 0) expect(Math.abs(now.y - was[i]!.y)).toBeLessThan(.001);
  }
  // And the one that was pushed has actually gone somewhere.
  expect(Math.hypot(pose(top).position.x, pose(top).position.z)).toBeGreaterThan(.1);
  w.dispose();
});

test('and the same shoves at the same steps are the same pile, to a billionth', () => {
  /* What the save is now: the shoves in order, with the steps between them.
     Two rooms handed the same log hold the same poses — which is what lets a
     conversation be reopened as the room somebody left rather than as a
     plausible rearrangement of it. */
  const log = [{name: 'top', steps: 0}, {name: 'top', steps: 31},
               {name: 'top', steps: 260}];
  const runs = ['thinker/log', 'thinker/log'].map((seed) => {
    const it = pile(seed);
    const top = it.books[it.books.length - 1]!;
    rerun(it.w, log, (name, n) => {
      rouse(it.w, top, it.books);
      push(it.w, top, name, n);
      return it.books;
    }, {maxSteps: 600, onStep: () => it.books.forEach(park)});
    return it;
  });
  for (let i = 0; i < runs[0]!.books.length; i++) {
    const a = pose(runs[0]!.books[i]!), b = pose(runs[1]!.books[i]!);
    expect(a.position.x).toBeCloseTo(b.position.x, 9);
    expect(a.position.y).toBeCloseTo(b.position.y, 9);
    expect(a.position.z).toBeCloseTo(b.position.z, 9);
    expect(a.quaternion.w).toBeCloseTo(b.quaternion.w, 9);
  }
  for (const it of runs) it.w.dispose();
});

/* A cushion is shoved by a hand, not along the floor: part of the shove is
   upward and part of it is a turn, which is what lets one press take it off a
   couch and the next only shift it. lover.js keys both off fate; this pins
   that a shove with those parts does what the room relies on. */
test('a shove with lift and a twist sends a soft thing up and turning', () => {
  const w = createWorld({seed: 'lift'});
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2, .3, 1));
  seat.position.set(0, .15, 0);
  staticFromMesh(w, seat, {friction: .9});
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, .4, 8));
  floor.position.set(0, -.2, 0);
  staticFromMesh(w, floor, {friction: .78});
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(.5, .18, .5));
  cushion.position.set(.6, .3 + .09, 0);
  const b = dynamicFromMesh(w, cushion, {mass: .5, friction: .85, restitution: .05});
  hush(w, [b]);
  const up = .8, a = 0, v = Math.sqrt(2 * .85 * 9.81 * .6);
  shove(b, {dir: {x: Math.cos(a), y: up, z: Math.sin(a)},
            strength: .5 * v * Math.hypot(1, up),
            twist: {x: 0, y: 0, z: 4 * ((b.body.principalInertia().x + b.body.principalInertia().z) / 2)}});
  expect(b.body.linvel().y).toBeGreaterThan(0);
  expect(Math.hypot(b.body.angvel().x, b.body.angvel().y, b.body.angvel().z)).toBeGreaterThan(1);
  const startY = b.body.translation().y;
  w.stepN(600);
  // Off the seat and down onto the floor, resting, not stuck in either.
  expect(b.body.translation().y).toBeLessThan(startY - .2);
  expect(b.body.translation().y).toBeGreaterThan(.05);
  expect(b.body.translation().x).toBeGreaterThan(1.0);
});

/* A cylinder on a flat floor has no rolling resistance the solver knows of; a
   bolster that landed on its side rolled across the room for as long as
   anybody watched. Damping is what says feathers do not roll like that. */
test('a rolling bolster stops within a few seconds when it is damped', () => {
  const w = createWorld({seed: 'roll'});
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, .4, 20));
  floor.position.set(0, -.2, 0);
  staticFromMesh(w, floor, {friction: .78});
  const bolster = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .55, 16));
  bolster.rotation.z = Math.PI / 2;                // lying on its side
  bolster.position.set(0, .18, 0);
  const b = dynamicFromMesh(w, bolster, {shape: 'cylinder', mass: .5, friction: .85,
                                          damping: {linear: 1.2, angular: 3.5}});
  hush(w, [b]);
  shove(b, {dir: {x: 0, y: .1, z: 1}, strength: .5 * 2.5});
  let steps = 0;
  while (!isAsleep(b) && steps < 60 * 20) { w.stepN(1); steps += 1; }
  expect(steps).toBeLessThan(60 * 6);
  expect(Math.abs(b.body.translation().z)).toBeLessThan(3);
});
