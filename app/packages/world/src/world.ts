/* The world: a physics simulation with a clock of its own that nobody winds.
 *
 * Rapier does the arithmetic. What is added here is the two things that make
 * it usable by a game whose rooms have to be the same room twice:
 *
 *   A fixed step. `advance(dt)` never hands Rapier a variable interval — it
 *   banks the time and takes whole steps of `step` seconds out of the bank.
 *   A simulation stepped by however long the last frame happened to take is a
 *   simulation that gives a different answer on a fast machine, and then a
 *   room restored from a save is subtly wrong on somebody else's laptop.
 *
 *   A seed. Nothing in here reaches for Math.random; what wants a number
 *   keyed to a name and a count asks the caller for one (see impulse.ts). The
 *   seed is carried so that everything built on this world can key off the
 *   same thing.
 *
 * ---- on determinism --------------------------------------------------------
 *
 * Rapier promises more than it is usually given credit for: its JavaScript
 * and wasm build is cross-platform deterministic, so the same version, the
 * same initialisation and the same operations in the same order give the same
 * result on somebody else's machine as on this one. What it warns about is
 * the arithmetic on *this* side of the boundary — JavaScript's own sin, cos,
 * pow and the rest are the engine's, not the standard's, and a number that
 * built an input to the simulation carries whatever that engine made of it
 * into everything downstream. Our ground is a heightfield of trigonometry and
 * our motion is worked out the same way, so the guarantee is Rapier's and the
 * risk is ours.
 *
 * So nothing is ever *stored* as a position. A save is a count per name, and
 * opening it replays the same shoves in the same order against the build that
 * is running (see replay.ts). That is what makes a room a pure function of
 * the clicks even though a physics engine is in the middle of it: the clicks
 * are what is written down, and the physics is redone — which is also the one
 * repair that works when a browser's maths does differ, since a position that
 * was never written down cannot be wrong.
 */
import * as RAPIER from '@dimforge/rapier3d-compat';

export type Vec3 = {x: number; y: number; z: number};

export interface WorldOpts {
  /** Which way is down, and how hard. Earth unless a room says otherwise. */
  gravity?: Vec3;
  /** What everything keyed rather than random in here is keyed from. */
  seed: string;
  /** Seconds per fixed step. 1/60 is what everything here is tuned at. */
  step?: number;
}

export interface World {
  /** Rapier itself, for the few things that want a descriptor by hand. */
  readonly RAPIER: typeof RAPIER;
  readonly world: RAPIER.World;
  readonly seed: string;
  /** Seconds in one fixed step. */
  readonly step: number;
  /** How many steps this world has taken since it was made. Two worlds that
      have taken the same steps in the same order hold the same positions. */
  readonly steps: number;
  /** Bank `dt` seconds and take whole steps out of the bank. Returns how many
      were taken, which is 0 on a frame shorter than one step.

      `onStep` runs after each one. A frame may be worth six steps, and a
      caller that only looks once a frame is a caller whose answer to "has
      this fallen out of the room" arrives up to six steps late — which is
      six steps of difference between the run somebody watched and the run
      that is replayed from it. */
  advance(dt: number, onStep?: (step: number) => void): number;
  /** Fast-forward: n steps, now, with nothing drawn between them. What a save
      is opened with, and it takes the same per-step callback for the same
      reason. */
  stepN(n: number, onStep?: (step: number) => void): number;
  /** Give the wasm side its memory back. */
  dispose(): void;
}

/* The longest a single frame is allowed to be worth. A tab that was in the
   background for a minute comes back with a minute of dt in its hand, and a
   world that honoured it would simulate a minute in one frame — every book in
   the room would have finished falling before anything was drawn, which is
   the animation owning the state by the back door.

   A tenth of a second, which is six steps: a stutter is caught up with and a
   gap is not. It used to be a quarter, and a quarter is long enough to see —
   a frame that took 250 ms simulated 250 ms of falling and drew none of it,
   so a book crossed a hand's width of stone between two pictures. The cost of
   the smaller number is that a machine drawing slower than ten frames a
   second runs the room in slow motion, which is the right way to be wrong:
   the eye reads slow as a slow machine and reads a jump as a broken room. */
const MOST = .1;

/* The bank is compared with a hair off the step rather than with the step
   itself. 120 frames of exactly 1/60 add up to 2 seconds in binary floating
   point only if you are lucky; without this, `advance` called 120 times takes
   119 steps and `stepN(120)` disagrees with it by one. */
const HAIR = 1e-9;

let started: Promise<void> | null = null;

/** Rapier's wasm, loaded once for the life of the page. Everything else in
    this package needs it to have finished; ask for it before building. */
export function ready(): Promise<void> {
  started ??= RAPIER.init();
  return started;
}

/** A world, built. `ready()` has to have finished first — the wasm is not
    there before it, and Rapier's own constructors are what would fail. */
export function createWorld({gravity, seed, step = 1 / 60}: WorldOpts): World {
  const world = new RAPIER.World(gravity ?? {x: 0, y: -9.81, z: 0});
  world.timestep = step;
  let bank = 0;
  let steps = 0;
  return {
    RAPIER,
    world,
    seed,
    step,
    get steps() { return steps; },
    advance(dt, onStep) {
      if (!(dt > 0)) return 0;
      bank = Math.min(bank + dt, MOST);
      let took = 0;
      while (bank >= step - HAIR) {
        world.step();
        bank -= step;
        steps++;
        took++;
        onStep?.(took);
      }
      return took;
    },
    stepN(n, onStep) {
      const want = Math.max(0, Math.round(n));
      for (let i = 1; i <= want; i++) {
        world.step();
        steps++;
        onStep?.(i);
      }
      return want;
    },
    dispose() {
      world.free();
    },
  };
}
