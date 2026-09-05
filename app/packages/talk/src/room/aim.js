/* Which of the boxes under one ray a press was meant for.
 *
 * A target is a box round a thing, grown a little so that a finger has
 * something to land on, and the boxes overlap: a couch's box grown by a hand's
 * width encloses the lower half of every cushion lying on the couch, and from
 * most angles its face is the one in front. Nearest-first was the rule once,
 * and it handed the couch every press meant for a cushion.
 *
 * What a person is pointing at is the thing they can see, and among the boxes
 * a ray passes through that is the small one — the cushion inside the couch's
 * box, the glass inside the table's, the book against the shelf. So the
 * smallest wins, among those met within a short reach of the first, and the
 * nearest only breaks a tie: a stack of identical books answers with the one
 * on top, which is what a stack is.
 *
 * `REACH` is what stops the room across the way winning on the grounds that
 * something over there is small. Anything the ray meets more than this far
 * behind the first thing it met is behind the thing being pointed at, not
 * inside it.
 *
 * Pure arithmetic over what a raycaster hands back, so that it can be asked
 * questions without a renderer: see aim.test.ts.
 */

/** How far behind the nearest hit a box may still be the one meant, in
    meters. A third of a meter is a couch's depth: what is inside the box of
    the thing you are pointing at, and nothing standing behind it. */
export const REACH = .35;

/** How much room a target takes: a box's own measure, or the bounds of
    whatever shape it is. A target that is not a box used to come out NaN,
    lose every comparison, and be silently unpressable. */
export function volume(object) {
  const g = object.geometry;
  const p = g.parameters;
  if (p && p.width !== undefined && p.height !== undefined && p.depth !== undefined) {
    return p.width * p.height * p.depth;
  }
  if (!g.boundingBox) g.computeBoundingBox?.();
  if (!g.boundingBox) return Infinity;            // nothing to measure: it never wins
  const {min, max} = g.boundingBox;
  /* A plane is a box a hair thick, not a box of nothing: with a zero in it
     the product is zero and the plane wins every comparison it is in. */
  const side = (a, b) => Math.max(b - a, .01);
  return side(min.x, max.x) * side(min.y, max.y) * side(min.z, max.z);
}

const exact = (object) => !!(object.userData && object.userData.exact);
const loose = (object) => !!(object.userData && object.userData.loose);

/** The proxy a press means, out of a raycaster's hits in the order it gives
    them — nearest first. Null if there were none. */
export function smallest(hits, reach = REACH) {
  if (!hits.length) return null;
  /* The smallest-wins rule exists because boxes enclose each other. The
     nearest hit that is a thing's own shape encloses nothing: it is what the
     eye is on, and it wins outright. A loose thing met first is nearly that
     -- a blanket hanging in front of a lamp's disc is the blanket, however
     much smaller the disc behind it -- except against another loose thing,
     whose box its own box can enclose: a blanket's box holds the cushion
     lying on it, and the cushion is what is seen. So a loose thing met first
     puts the shapes and the furniture behind it out of the running, and the
     loose things within reach still go to the smallest. */
  const first = hits[0].object;
  if (exact(first)) return first;
  const only = loose(first) ? loose : () => true;
  const near = hits[0].distance;
  let best = null, least = Infinity;
  for (const h of hits) {
    if (h.distance > near + reach) break;
    if (!only(h.object)) continue;
    const vol = volume(h.object);
    /* Strictly smaller, by more than a rounding error — so that a tie is left
       with whichever came first, which is the nearest. */
    if (vol < least - 1e-6) { least = vol; best = h.object; }
  }
  return best;
}
