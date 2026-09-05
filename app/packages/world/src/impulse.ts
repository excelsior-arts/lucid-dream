/* A shove.
 *
 * Every number in here comes from the caller. Nothing reaches for
 * Math.random, and that is the rule the whole of this package exists to keep:
 * a shove is `(name, n)` hashed into a direction and a strength, so the third
 * shove of a book is the same third shove of that book on every machine that
 * ever opens that conversation. A stream of random numbers would desync the
 * moment two shoves replayed in a different order; a key cannot.
 *
 * See replay.ts, which is the other half of the same idea, and the room's own
 * `fate(name, n)` in the game above this, which is where the keys are cut.
 */
import type {Bound} from './bodies';
import type {Vec3} from './world';

export interface Shove {
  /** Which way, in world terms. Normalised here, so a room may hand in
      whatever vector its own arithmetic produced. */
  dir: Vec3;
  /** How hard, as an impulse in newton-seconds: mass times the change in
      speed it is meant to cause. */
  strength: number;
  /** Where on the thing the hand landed, in world terms. Off the middle is
      what makes a thing turn as it goes, which is most of what tells the eye
      it was pushed rather than placed. Left out, it is pushed through its
      own middle and goes straight. */
  at?: Vec3;
  /** And a twist about its own axes, for something that should go end over
      end rather than skid. Newton-metre-seconds. */
  twist?: Vec3;
}

const LEN = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

/** Push it. The body is woken — a thing that has been shoved is a thing that
    is moving, whatever it was doing a moment ago. */
export function shove({body}: Bound, {dir, strength, at, twist}: Shove): void {
  const len = LEN(dir);
  if (len > 0 && strength !== 0) {
    const j = {
      x: (dir.x / len) * strength,
      y: (dir.y / len) * strength,
      z: (dir.z / len) * strength,
    };
    if (at) body.applyImpulseAtPoint(j, at, true);
    else body.applyImpulse(j, true);
  }
  if (twist && LEN(twist) > 0) body.applyTorqueImpulse(twist, true);
  body.wakeUp();
}
