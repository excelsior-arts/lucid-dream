/* The promise the whole room rests on, asked twice.
 *
 * A room is a pure function of the clicks: nothing is stored but what a hand
 * did and when it did it, and where everything ended up is simulated again
 * every time the evening is opened. Which holds exactly as long as the live
 * run and the replay do the same things in the same order, and there were two
 * places they did not.
 *
 * The room itself needs a canvas, a camera and a renderer before it needs any
 * of this, and none of those exist here. What is left when they are taken
 * away is what is below: a world, a floor, two things on it, and the same
 * ledger and the same `lull` that room3d.js runs.
 */
import * as THREE from 'three';
import {beforeAll, expect, test} from 'vitest';
import {
  createWorld, dynamicFromMesh, hush, isAsleep, pose, ready, shove,
  staticFromMesh,
} from '@lucid/world';
import type {Bound} from '@lucid/world';
import {ledger, lull} from './log.js';
import type {Ledger} from './log.js';

beforeAll(async () => { await ready(); });

interface Thing {
  name: string;
  bound: Bound;
  quiet?: number;
  awake?: number;
}

/* A floor and two things on it. The bolster is the one that matters: barely
   damped, it is a cylinder on flat boards with no rolling resistance the
   solver knows of, so it goes on rolling until the room puts it down — which
   is `lull`, and is exactly the rule that used to be counted in frames. */
function room(seed: string) {
  const w = createWorld({seed});
  const floor = new THREE.Mesh(new THREE.BoxGeometry(60, .4, 60));
  floor.position.y = -.2;
  staticFromMesh(w, floor, {friction: .5});
  const bolster = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .55, 16));
  bolster.rotation.z = Math.PI / 2;
  bolster.position.set(0, .18, 0);
  const book = new THREE.Mesh(new THREE.BoxGeometry(.38, .06, .28));
  book.position.set(1.4, .03, .9);
  const things: Thing[] = [
    {name: 'bolster', bound: dynamicFromMesh(w, bolster, {
      shape: 'cylinder', mass: .5, friction: .6, sleeping: false,
      damping: {linear: .02, angular: .02}})},
    {name: 'book', bound: dynamicFromMesh(w, book, {
      mass: .5, friction: .82, sleeping: false})},
  ];
  hush(w, things.map((t) => t.bound));
  return {w, things};
}

const find = (it: ReturnType<typeof room>, name: string) =>
  it.things.find((t) => t.name === name)!;

/* Which way the nth shove of a thing goes. Keyed to the name and the count,
   never a stream, for the same reason `fate` is: the replay has to be able to
   ask for the fourth shove of a cushion without having done the first three. */
function push(t: Thing, n: number) {
  const a = (t.name.length * .7 + n * 1.9) % (Math.PI * 2);
  const far = .5 + (n % 3) * .35;
  const v = Math.sqrt(2 * .6 * 9.81 * far);
  shove(t.bound, {dir: {x: Math.cos(a), y: .08, z: Math.sin(a)},
                  strength: .5 * v * Math.hypot(1, .08)});
}

/** The room's own loop: shove, then draw frames of `dt` until nothing in the
    room is moving, with `lull` after every fixed step and never per frame. */
function press(it: ReturnType<typeof room>, log: Ledger, name: string, dt: number) {
  const n = log.shoves.filter((q) => q.name === name).length + 1;
  log.mark(it.w, name);
  push(find(it, name), n);
  const step = () => { for (const q of it.things) lull(q); };
  for (let frame = 0; frame < 4000; frame++) {
    it.w.advance(dt, step);
    if (it.things.every((q) => isAsleep(q.bound))) return;
  }
  throw new Error('the room never stopped moving');
}

/** And opening the save: the same shoves after the same steps, at no speed. */
function reopen(seed: string, log: Ledger) {
  const it = room(seed);
  const again = ledger();
  again.adopt(log.shoves.map((q) => ({...q})));
  again.again(it.w, (name, n) => {
    push(find(it, name), n);
    return it.things.map((t) => t.bound);
  }, {onStep: () => { for (const q of it.things) lull(q); }});
  return {it, log: again};
}

/** To a millionth of a meter, which is a thousandth of a millimeter. */
function same(a: ReturnType<typeof room>, b: ReturnType<typeof room>) {
  for (let i = 0; i < a.things.length; i++) {
    const p = pose(a.things[i]!.bound), q = pose(b.things[i]!.bound);
    expect(p.position.x).toBeCloseTo(q.position.x, 6);
    expect(p.position.y).toBeCloseTo(q.position.y, 6);
    expect(p.position.z).toBeCloseTo(q.position.z, 6);
    expect(p.quaternion.w).toBeCloseTo(q.quaternion.w, 6);
  }
}

test('a press after a save is opened survives the save being opened again', () => {
  /* The one that took two reloads to see. The trailing settle — the steps
     after the last shove, while everything came to rest — was charged to the
     next press, so the press was written down as having happened a settle
     later than it did. Opened a second time, it landed while the shove before
     it was still in the air, and the room came back rearranged. */
  const first = room('log/again');
  const written = ledger();
  written.start(first.w);
  for (const name of ['bolster', 'book', 'bolster']) press(first, written, name, 1 / 60);

  const opened = reopen('log/again', written);
  same(first, opened.it);

  // A hand in the reopened room, which is the ordinary case: you come back to
  // an evening and push something.
  press(opened.it, opened.log, 'bolster', 1 / 60);
  const twice = reopen('log/again', opened.log);
  same(opened.it, twice.it);

  for (const w of [first.w, opened.it.w, twice.it.w]) w.dispose();
});

test('and the same presses are the same room at any frame rate, or at none', () => {
  /* `lull` is a count of fixed steps and not of frames, because a frame is
     worth one step or six depending on how fast the machine is drawing. The
     same shove used to be put down at step 57 on one machine and step 86 on
     another, and the replay — which draws nothing — put it down never. */
  const order = ['bolster', 'book', 'bolster'];
  const quick = room('log/rate');
  const quickLog = ledger();
  quickLog.start(quick.w);
  for (const name of order) press(quick, quickLog, name, 1 / 60);

  const slow = room('log/rate');
  const slowLog = ledger();
  slowLog.start(slow.w);
  for (const name of order) press(slow, slowLog, name, 1 / 30);
  same(quick, slow);

  const opened = reopen('log/rate', quickLog);
  same(quick, opened.it);

  for (const w of [quick.w, slow.w, opened.it.w]) w.dispose();
});
