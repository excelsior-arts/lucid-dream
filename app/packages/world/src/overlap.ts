/* What is touching what, asked of the world rather than worked out again.
 *
 * A game with things to pick up has one question it asks every step: is the
 * figure inside that. It could answer it in arithmetic — a distance, a radius,
 * a comparison — and for a sphere that is what it should do. The moment the
 * thing is a shape, the arithmetic is a second description of it, and the
 * second description is the one that goes wrong when the first is edited.
 *
 * Rapier already knows. The narrow phase has been keeping the pairs since the
 * step began: sensors it is intersecting, solids it is in contact with. This
 * is those two lists, read out and put together.
 *
 * ---- what Rapier will and will not keep a pair for -------------------------
 *
 * It does not watch everything. By default a pair is only tracked when one of
 * the two is attached to a *dynamic* body: two fixed things overlapping are
 * not a fact anybody was going to need, and a figure walking through a fixed
 * trigger is — but the figure is kinematic, and kinematic against fixed is not
 * watched either. So a fixed sensor asked about a kinematic character answers
 * nothing at all, for ever, and it looks exactly like a sensor placed wrong.
 *
 * The cure is one line where the collider is built, and it has to be there and
 * not afterwards — a collider already in the world does not take the change:
 *
 *     ColliderDesc.cuboid(...).setSensor(true)
 *       .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
 *
 * Which is a decision about that trigger and not about this function, so it is
 * written down here rather than done here. Proved in overlap.test.ts.
 */
import type * as RAPIER from '@dimforge/rapier3d-compat';

import type {World} from './world';

/** Every collider whose shape intersects `c` right now. Sensors included; the
    caller decides what a touch means. Deterministic per step.
 *
 * Read after a step and before the next one: these are the pairs the last step
 * left behind, so a collider moved by hand since then is reported where it
 * was. Which is the right answer for a game whose every decision is taken at a
 * step anyway, and the reason this is safe to replay.
 *
 * The pairs are filtered down to the ones that are actually touching. The
 * broad phase hands the narrow phase rather more than that — two boxes whose
 * bounding volumes overlap are a pair from the moment they are near each
 * other — and a `take` that fired on nearness would collect an ember from a
 * metre away. */
export function overlapping(w: World, c: RAPIER.Collider): RAPIER.Collider[] {
  const seen = new Set<number>();
  const out: RAPIER.Collider[] = [];
  const keep = (other: RAPIER.Collider) => {
    if (seen.has(other.handle)) return;
    seen.add(other.handle);
    out.push(other);
  };
  /* Sensors first, and they are the cheap half: an intersection pair only
     exists while the two are intersecting, so there is nothing to filter. */
  w.world.intersectionPairsWith(c, (other) => {
    if (w.world.intersectionPair(c, other)) keep(other);
  });
  w.world.contactPairsWith(c, (other) => {
    let touching = false;
    w.world.contactPair(c, other, (manifold) => {
      if (manifold.numContacts() > 0) touching = true;
    });
    if (touching) keep(other);
  });
  return out;
}
