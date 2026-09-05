/* The typed face of log.js, which is hand-set JavaScript for the same reason
   room3d.js is: it moves with the room. */
import type {Bound, Replaying, Shoved, World} from '@lucid/world';

/** One shove applied, the nth of that name; what it woke, for the settle. */
export type Apply = (name: string, n: number) => readonly Bound[] | void;

/** The shoves in order, with the steps between them — what a save is. */
export interface Ledger {
  readonly shoves: Shoved[];
  /** Start counting from a freshly built and hushed world. */
  start(world: World): void;
  /** Write one shove down, before it is done. */
  mark(world: World, name: string): void;
  /** Forget the counting along with the world. */
  reset(): void;
  /** Take a log a save handed over. */
  adopt(log: readonly Shoved[]): void;
  /** Replay the whole log, fill in what an old save could not say, and leave
      the counting ready for the next press. One longer than the log. */
  again(world: World, apply: Apply, opts?: Replaying): number[];
}

export function ledger(): Ledger;

/** A thing the room is watching: its body and its two sleep counters. */
export interface Restless {
  bound: Bound;
  quiet?: number;
  awake?: number;
}

/** One fixed step of "has it stopped yet", run by the loop and the replay. */
export function lull(it: Restless): void;
