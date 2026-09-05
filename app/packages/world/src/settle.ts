/* Stepping until nothing is moving any more — and, before any of that, the
 * one step it takes to make a fresh world hold still at all.
 *
 * A room is not a simulation that runs; it is a picture that changes when a
 * hand touches it and then stops. So every shove is followed by this: step
 * until every dynamic body has gone back to sleep, or until the cap says it
 * is not going to. The cap matters more than it looks — a thing that has
 * fallen off the edge of the world falls forever, and forever is a page that
 * never draws another frame.
 */
import {type Bound} from './bodies';
import type {World} from './world';

export interface Settling {
  /** How many steps before everything was still. The cap, if it never was. */
  maxSteps?: number;
  /** Called after each step, for a caller that is drawing while it settles. */
  onStep?: (step: number) => void;
}

/* A fresh world, made quiet.
 *
 * Everything in a room is born asleep at the pose it was composed at, and a
 * room nobody has touched is a picture. That is the whole idea, and Rapier
 * will not do it on its own: a body that is created asleep has no contacts
 * yet, because a sleeping body is not in the active set and nothing has
 * looked at what it is resting on. The first time the world is stepped —
 * which is the first time a hand touches anything — inserting a body counts
 * as changing it, every one of them is put back into the active set, and each
 * falls freely for the six steps it takes the contacts to appear. Five
 * centimeters of the whole room dropping and climbing back, on the first
 * press of the evening.
 *
 * So they are made awake, the world is stepped exactly once, and then every
 * one of them is put to sleep on the spot. The step is what makes the
 * contacts; the sleep is what stops anything ever asking again.
 *
 * It is not a settle. One step is one sixtieth of a second: nothing falls in
 * it and nothing slides. What it costs is about a tenth of a millimeter — a
 * solver lets a contact overlap that much rather than chasing it to zero —
 * and a couple of millimeters for anything composed *inside* something else,
 * which spends that step going the wrong way and is straightened out the
 * first time it is woken. Which is why the caller should write down where
 * each body ended this and ask "has it moved" against that, rather than
 * against the numbers the thing was drawn with.
 *
 * After this, a shove wakes what it hits and nothing else.
 */
export function hush(world: World, bounds: readonly Bound[]): void {
  world.stepN(1);
  for (const {body} of bounds) if (body.isDynamic()) body.sleep();
}

/* And waking them, which is the same fault as `hush` wearing a different hat.
 *
 * Waking one body wakes its island: push the top book of a pile and Rapier
 * puts the whole pile back into the active set, which is right. What it does
 * not do is give those neighbours their contacts back in the same step. Only
 * the body woken *by name* is marked as changed, so only its manifolds are
 * rebuilt; the rest sit in the active set with nothing under them and fall
 * freely for the eight or ten steps it takes the narrow phase to find them
 * again.
 *
 * Which is invisible for a book with a meter of air under it and fatal for
 * one at the bottom of a stack: it accelerates for ten steps, and by the time
 * the contacts arrive it is a hand's width inside the stone and travelling —
 * so it goes out through the bottom of the floor, and the room has lost a
 * book nobody touched. Pushing the top of a pile cost the bottom of it, every
 * time.
 *
 * So the shove wakes, by name, everything the shove was going to wake anyway:
 * whatever the pushed thing is touching, whatever that is touching, and so on
 * out. Exactly the island, worked out from the contacts rather than asked
 * for, and no wider — a room where everything is woken is a room that finds
 * its feet the first time you touch anything in it, and what a hand pushed is
 * then the least of what moved.
 *
 * Nothing in the set moves: a body woken with its contacts intact is a body
 * standing where it stood.
 */
export function rouse(
  w: World, from: Bound, bounds: readonly Bound[],
): readonly Bound[] {
  const byCollider = new Map<number, Bound>();
  for (const b of bounds) {
    if (b.body.isDynamic() && b.body.isEnabled()) byCollider.set(b.collider.handle, b);
  }
  const woken = new Set<Bound>([from]);
  const todo = [from];
  while (todo.length) {
    const it = todo.pop()!;
    it.body.wakeUp();
    /* Reported for a sleeping body as readily as for a moving one — the pairs
       are the broad phase's and outlive the island going quiet, which is what
       makes this answerable at all before the step that needs it. */
    w.world.contactPairsWith(it.collider, (other) => {
      const next = byCollider.get(other.handle);
      if (next && !woken.has(next)) {
        woken.add(next);
        todo.push(next);
      }
    });
  }
  return [...woken];
}

/** Rapier puts a body to sleep once it has been slow for long enough — and a
    body that has been parked or was never dynamic is as still as one. */
export function isAsleep({body}: Bound): boolean {
  return body.isSleeping() || !body.isDynamic() || !body.isEnabled();
}

/** Step until they are all asleep. Returns how many steps that took, which is
    the cap if it ran out. */
export function settle(
  world: World, bounds: readonly Bound[], {maxSteps = 900, onStep}: Settling = {},
): number {
  for (let i = 1; i <= maxSteps; i++) {
    world.stepN(1);
    onStep?.(i);
    if (bounds.every(isAsleep)) return i;
  }
  return maxSteps;
}
