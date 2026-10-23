/* The dune language: a crest drawn as points, with a height and two flanks,
 * and the arithmetic that makes a dune of it.
 *
 * This is the half of Burning Man's layout.ts that is not Burning Man's: the
 * type a ridge is written in, the bends and bows and swells along a crest, the
 * compiled form a ridge is sampled from, the heap that piles two dunes into
 * each other, and the relief of one ridge and of a whole list of them. Which
 * ridges there are is a landscape's (see landscape.ts). Nothing here is
 * cached at module level: a Geography compiles its own ridges once and hands
 * the map in.
 */
/** The author's sketch in metres: west = -X, north = -Z, Y is height. */
export type MapPoint = readonly [number, number];
export type DuneRidge = {
  name: string;
  points: readonly MapPoint[];
  height: number;
  windward: number;
  leeward: number;
  tip: number;
  curve?: boolean;
  /** Metres the crest bows across its own line, so it is not ruled in plan. */
  wander?: number;
  /** Metres the crest rises and falls along its length, so the top is not level. */
  swell?: number;
  /** Slides both along the crest, to put a low or a high where one is wanted. */
  phase?: number;
};

/** A ridge, compiled for sampling: its crest as segments with tangent and
    curvature at both ends, its total length, and its bounding box. */
export type Compiled = ReturnType<typeof compileRidge>;

/** Sample the editable crest through smooth bends; distance queries reuse it. */
export function crestPoints(ridge: DuneRidge): readonly MapPoint[] {
  if (!ridge.curve) return bowed(ridge, [...ridge.points]);
  const points: MapPoint[] = [];
  const at = (i: number) => ridge.points[Math.max(0, Math.min(ridge.points.length - 1, i))]!;
  for (let i = 0; i < ridge.points.length - 1; i++) {
    const a = at(i - 1),
      b = at(i),
      c = at(i + 1),
      d = at(i + 2);
    const count = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 3));
    for (let j = 0; j < count; j++) {
      const t = j / count;
      const axis = (k: 0 | 1) =>
        0.5 *
        (2 * b[k] +
          (-a[k] + c[k]) * t +
          (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t);
      points.push([axis(0), axis(1)]);
    }
  }
  points.push(at(ridge.points.length - 1));
  return bowed(ridge, points);
}
const TAU = Math.PI * 2;
/** Two slow sines of arc length, incommensurate so they never repeat a shape.
 * Returns -1 to 1, and it is smooth: a crest built on it has no corner in it. */
function swellAt(s: number, phase: number) {
  return (
    Math.sin((s / 5.3) * TAU + phase) * 0.5 +
    Math.sin((s / 8.9) * TAU + phase * 1.7 + 2.1) * 0.3 +
    Math.sin((s / 13.7) * TAU + phase * 0.6 + 4.3) * 0.2
  );
}
/** Bow the sampled crest across its own line, by arc length rather than by
 * control point, so the wander does not depend on where the author clicked. */
function bowed(ridge: DuneRidge, points: MapPoint[]): readonly MapPoint[] {
  if (!ridge.wander) return points;
  const out: MapPoint[] = [];
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const b = points[i]!;
    if (i > 0) along += Math.hypot(b[0] - points[i - 1]![0], b[1] - points[i - 1]![1]);
    const a = points[Math.max(0, i - 1)]!,
      c = points[Math.min(points.length - 1, i + 1)]!;
    const tx = c[0] - a[0],
      tz = c[1] - a[1];
    const m = Math.max(0.0001, Math.hypot(tx, tz));
    const bow =
      ridge.wander *
      (Math.sin((along / 121) * TAU + (ridge.phase ?? 0)) * 0.64 +
        Math.sin((along / 79) * TAU + (ridge.phase ?? 0) * 1.3 + 2.4) * 0.36);
    out.push([b[0] - (tz / m) * bow, b[1] + (tx / m) * bow]);
  }
  return out;
}
export function compileRidge(ridge: DuneRidge) {
  const points = crestPoints(ridge);
  const width = Math.max(ridge.windward, ridge.leeward);
  let total = 0;
  const segments = points.slice(1).map((point, i) => {
    const a = points[i]!;
    const dx = point[0] - a[0],
      dz = point[1] - a[1];
    const length2 = dx * dx + dz * dz,
      length = Math.sqrt(length2);
    const segment = {
      x: a[0],
      z: a[1],
      dx,
      dz,
      length2,
      length,
      along: total,
      // The crest's own tangent and curvature at this segment's two ends, so both
      // vary continuously along it. Read per segment they step at every join, and
      // a width built on a stepping tangent steps with it.
      ax: dx / length,
      az: dz / length,
      bx: dx / length,
      bz: dz / length,
      ka: 0,
      kb: 0,
    };
    total += length;
    return segment;
  });
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1]!,
      b = segments[i]!;
    const mx = a.dx / a.length + b.dx / b.length,
      mz = a.dz / a.length + b.dz / b.length;
    const m = Math.max(0.0001, Math.hypot(mx, mz));
    a.bx = b.ax = mx / m;
    a.bz = b.az = mz / m;
    const cross = (a.dx * b.dz - a.dz * b.dx) / Math.max(0.0001, a.length * b.length);
    const curvature =
      Math.asin(Math.max(-1, Math.min(1, cross))) / Math.max(0.0001, (a.length + b.length) * 0.5);
    a.kb = b.ka = curvature;
  }
  // The curvature drives the width inside a bend, so it must vary as slowly as
  // the bend itself. Read raw from three-metre samples of a hand-drawn line it
  // jittered join to join, and every jitter became a ridge running down the face.
  // Smooth it over about twenty metres of crest before it touches the width.
  const joins = segments.length + 1;
  const raw = new Float64Array(joins);
  for (let i = 0; i < segments.length; i++) raw[i] = segments[i]!.ka;
  raw[segments.length] = segments[segments.length - 1]!.kb;
  const smooth = new Float64Array(joins);
  const radius = 3;
  for (let i = 0; i < joins; i++) {
    let sum = 0,
      weight = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = Math.max(0, Math.min(joins - 1, i + d));
      const w = radius + 1 - Math.abs(d);
      sum += raw[j]! * w;
      weight += w;
    }
    smooth[i] = sum / weight;
  }
  for (let i = 0; i < segments.length; i++) {
    segments[i]!.ka = smooth[i]!;
    segments[i]!.kb = smooth[i + 1]!;
  }
  return {
    segments,
    total,
    bounds: [
      Math.min(...points.map((p) => p[0])) - width,
      Math.max(...points.map((p) => p[0])) + width,
      Math.min(...points.map((p) => p[1])) - width,
      Math.max(...points.map((p) => p[1])) + width,
    ],
  };
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** Sand piles into one another; it does not stack. A polynomial smooth maximum
 * joins overlapping cross-sections and neighbouring ridges without a crease. */
const BLEND = 1.4;
export function heap(a: number, b: number, k = BLEND) {
  // The extra sand two dunes leave against each other has to fade in with the
  // smaller of them. Switching it on the moment the second one appears steps the
  // ground by a quarter of the blend along every line where one reaches zero,
  // which is exactly the toe of every dune, and the step reads as a row of
  // notches there. Scaled this way the join is continuous and flat ground, where
  // the smaller contribution is nothing at all, is left alone.
  const low = Math.min(a, b);
  if (low <= 0) return Math.max(a, b);
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.max(a, b) + h * h * k * 0.25 * Math.min(1, low / k);
}
/** One dune, evaluated once. The nearest point on the whole crest gives a distance
 * and a place along it; the cross-section is a single raised cosine that reaches
 * the ground with zero slope, so the base is as continuous as the crest. Taking a
 * maximum over per-segment cross-sections cannot do this: wherever one segment
 * hands over to the next of a different width the surface steps, and the steps
 * read as a ledge along the toe. */
export function ridgeRelief(x: number, z: number, ridge: DuneRidge, shapes: Map<DuneRidge, Compiled>) {
  let shape = shapes.get(ridge);
  if (!shape) shapes.set(ridge, (shape = compileRidge(ridge)));
  const box = shape.bounds;
  if (x < box[0]! || x > box[1]! || z < box[2]! || z > box[3]!) return 0;
  let best = Infinity,
    along = 0,
    turn = 0,
    tx = 1,
    tz = 0,
    ox = 0,
    oz = 0;
  for (const segment of shape.segments) {
    const {dx, dz} = segment;
    const t = clamp(((x - segment.x) * dx + (z - segment.z) * dz) / segment.length2);
    const px = x - segment.x - t * dx,
      pz = z - segment.z - t * dz;
    const distance2 = px * px + pz * pz;
    if (distance2 >= best) continue;
    best = distance2;
    along = segment.along + t * segment.length;
    turn = segment.ka + (segment.kb - segment.ka) * t;
    tx = segment.ax + (segment.bx - segment.ax) * t;
    tz = segment.az + (segment.bz - segment.az) * t;
    ox = px;
    oz = pz;
  }
  const tangent = Math.max(0.0001, Math.hypot(tx, tz));
  tx /= tangent;
  tz /= tangent;
  const distance = Math.sqrt(best);
  // Which flank, blended across a half-metre so the crest line is not a crease:
  // the wind side is the long gentle one, the lee shorter and steeper.
  const lateral = ox * tz - oz * tx;
  const face = clamp(lateral / 1 + 0.5);
  let width = ridge.leeward + (ridge.windward - ridge.leeward) * (face * face * (3 - 2 * face));
  // Inside a bend the two flanks converge; give that side room so the profile
  // widens through the turn instead of pinching into a notch.
  width *= 1 + clamp(-Math.sign(lateral) * turn * 9) * 0.35;
  if (distance >= width) return 0;
  // A rounded nose at each end rather than a cut across the crest.
  const taper = clamp(Math.min(along, shape.total - along) / ridge.tip);
  const profile = 0.5 + 0.5 * Math.cos((Math.PI * distance) / width);
  // The crest rises and falls along its length, and only the crest does: carried
  // down the faces the same wave corrugates them into shelves running to the toe.
  // A third of the way down it is gone and the face is the plain cosine again.
  const top = clamp((profile - 0.62) / 0.38);
  const crest = ridge.swell
    ? ridge.swell * swellAt(along, ridge.phase ?? 0) * top * top * (3 - 2 * top)
    : 0;
  return (ridge.height * profile + crest) * taper * taper * (3 - 2 * taper);
}
export function duneRelief(
  x: number,
  z: number,
  ridges: readonly DuneRidge[],
  shapes: Map<DuneRidge, Compiled>,
) {
  let h = 0;
  for (const ridge of ridges) h = heap(h, ridgeRelief(x, z, ridge, shapes));
  return h;
}
