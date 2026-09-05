/* What makes a room a pure function of the clicks, with a physics engine in
 * the middle of it.
 *
 * No position is ever written down, for two reasons and they are both the
 * same reason. Rapier's answers are exact for the same operations in the same
 * order against the same build, and are not promised to be identical across
 * architectures or across versions; and a room that is redesigned moves the
 * shelf, at which point every position stored against the old one is a book
 * hanging in the air. So what is stored is what a hand did, and the falls are
 * done again.
 *
 * `rerun` is that: the shoves in the order they happened, each one applied
 * after exactly the number of fixed steps that ran before it, so the replay
 * *is* the live run — the same operations against the same world in the same
 * order, and therefore the same room, bit for bit.
 *
 * The number of steps is the point. A save that keeps only how many times
 * each thing was pushed has to invent an order to redo them in, and the order
 * a room's file registered its furniture in is not the order a hand touched
 * it: two things that met on the way come to rest somewhere else, and the
 * room somebody left is not the room they come back to. A step count is a
 * fact about the evening rather than a guess at it, and it is an integer off
 * the world's own counter — never wall time, which is a different number on
 * every machine.
 *
 * `steps` of null is what a save written before any of that can offer:
 * "however long it took everything to stop". `replay` below is exactly that
 * shape, kept for reading those, and what it hands back is the step counts it
 * actually took — so an old save can be written down as a new one and never
 * asked to guess again.
 */
import type {Bound} from './bodies';
import {settle} from './settle';
import type {World} from './world';

export interface Event {
  /** Whose count this is. The room's name for the thing. */
  name: string;
  /** How many times a hand was put to it. */
  count: number;
}

/** One shove, as it happened. */
export interface Shoved {
  /** The room's name for the thing that was pushed. */
  name: string;
  /** Fixed steps since the shove before it. Null — or missing — is "wait for
      everything to come to rest", which is all an old save knows. */
  steps?: number | null;
}

export interface Replaying {
  /** The cap on each settle. */
  maxSteps?: number;
  /** After every step, replayed or settled. What a room uses to notice that
      something has fallen out of it and stop simulating it, which is also
      what stops a settle running to its cap waiting for a body that is never
      going to land. */
  onStep?: (step: number) => void;
  /** What to wait for when `apply` says nothing. */
  all?: readonly Bound[];
  /** Whether to let everything come to rest at the end. */
  rest?: boolean;
}

/** Do it all again, in the order it happened, at no speed.
 *
 * `apply` is the room's own: given a name and which shove of that thing this
 * is, it pushes the right thing the right way and says which bodies are now
 * moving. What comes back is what a settle waits for; nothing at all means
 * wait for everything the caller passed as `all`.
 *
 * What is returned is how many steps ran before each shove, and then how many
 * the last one took to come to rest — one longer than the list handed in. For
 * a run made of numbers that is the numbers back; for one made of nulls it is
 * what those nulls turned out to be.
 */
export function rerun(
  world: World,
  shoves: readonly Shoved[],
  apply: (name: string, n: number) => readonly Bound[] | void,
  {maxSteps = 900, onStep, all = [], rest = true}: Replaying = {},
): number[] {
  const took: number[] = [];
  /* How many times each thing has been pushed so far, so that `apply` is
     handed the same n the room's own count would have given it. */
  const times = new Map<string, number>();
  let moving: readonly Bound[] = all;
  for (let i = 0; i < shoves.length; i++) {
    const {name, steps} = shoves[i]!;
    took.push(typeof steps === 'number'
      /* Exactly what ran last time. Not a settle: a settle asks a question
         about the state it is in, and the whole promise here is that no
         question is asked at all — the same steps, in the same order. */
      ? world.stepN(Math.max(0, Math.round(steps)), onStep)
      // Nothing before the first one; between the rest, however long it took.
      : (i === 0 ? 0 : settle(world, moving, {maxSteps, onStep})));
    const n = (times.get(name) ?? 0) + 1;
    times.set(name, n);
    moving = apply(name, n) ?? all;
  }
  took.push(rest ? settle(world, moving, {maxSteps, onStep}) : 0);
  return took;
}

/** The same, from a count per name and nothing else.
 *
 * The shape of every save written before the order was kept: each thing's
 * count, applied in whatever order the caller hands them over — which for a
 * room is the order its own file registered them in, a fact about the file
 * rather than about anybody's evening. Everything is let come to rest between
 * one and the next, because that is the only thing a count can mean.
 *
 * Returns the steps it took, all told.
 */
export function replay(
  world: World,
  events: readonly Event[],
  apply: (name: string, n: number) => readonly Bound[] | void,
  all: readonly Bound[] = [],
  {maxSteps = 900, onStep}: Replaying = {},
): number {
  return rerun(world, spread(events), apply, {maxSteps, onStep, all})
    .reduce((a, b) => a + b, 0);
}

/** A count per name, opened out into one entry per shove, in order. */
function spread(events: readonly Event[]): Shoved[] {
  const out: Shoved[] = [];
  for (const {name, count} of events) {
    for (let n = 1; n <= Math.max(0, Math.round(count)); n++) out.push({name});
  }
  return out;
}
