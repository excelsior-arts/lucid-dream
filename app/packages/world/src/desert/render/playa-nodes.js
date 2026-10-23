// The dry lake bed: a cracked crust rather than a smooth field.
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  length,
  max,
  mul,
  normalize,
  select,
  sin,
  smoothstep,
  vec2,
  vec4,
} from 'three/tsl';

/** Average plate width, in metres. */
export const PLATE = 0.62;
/** Crack half width in plate units, about two centimetres on the ground. */
export const CRACK = 0.028;

export function createPlayaNodes() {
const cellHash = /*@__PURE__*/ Fn(([p]) =>
  fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453)),
);

/** One plate unit's width on screen. Taken by the caller, in uniform control
 * flow, so the network itself can sit inside a branch. */
const plateFootprint = /*@__PURE__*/ Fn(([p]) =>
  max(length(fwidth(p.div(PLATE))).mul(0.9), 0.004),
);

/**
 * A jittered cellular field gives the plates. The distance to the bisector of
 * the two nearest seeds gives a crack of roughly even width, and the direction
 * between those seeds gives the slope of the raised plate lip, so a low light
 * catches one side of every plate the way it does on a real playa.
 *
 * The plate coordinate is a couple of cycles per metre, far from the magnitudes
 * where this hash degenerates into a visible lattice. Crack contrast is faded by
 * its own screen-space width, so the network thins into the distance instead of
 * aliasing, and a second warp keeps the plates off a tidy grid.
 */
const playaCracks = /*@__PURE__*/ Fn(([p, soft]) => {
  // Plate size drifts slowly across the bed, so the network never reads as one
  // even flagstone floor.
  const q = p
    .div(PLATE)
    .mul(float(1).add(sin(p.x.mul(0.085).add(sin(p.y.mul(0.061)).mul(1.7))).mul(0.2)))
    .toVar();
  q.addAssign(
    vec2(
      sin(q.y.mul(0.61).add(q.x.mul(0.23))).mul(0.3),
      sin(q.x.mul(0.55).sub(q.y.mul(0.19)).add(2.1)).mul(0.3),
    ),
  );
  q.addAssign(vec2(sin(q.y.mul(1.9).add(4.3)).mul(0.12), sin(q.x.mul(2.3).sub(1.7)).mul(0.12)));
  const base = floor(q).toVar();
  const near = vec2(0.0).toVar();
  const second = vec2(0.0).toVar();
  const first = float(1e9).toVar();
  const other = float(1e9).toVar();
  const seedCell = vec2(0.0).toVar();
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cell = base.add(vec2(dx, dy)).toVar();
      const site = cell.add(cellHash(cell)).toVar();
      const d = length(site.sub(q)).toVar();
      const nearest = d.lessThan(first).toVar();
      const runnerUp = d.lessThan(other).toVar();
      second.assign(select(nearest, near, select(runnerUp, site, second)));
      other.assign(select(nearest, first, select(runnerUp, d, other)));
      seedCell.assign(select(nearest, cell, seedCell));
      near.assign(select(nearest, site, near));
      first.assign(select(nearest, d, first));
    }
  const direction = normalize(second.sub(near).add(vec2(1e-5, 0))).toVar();
  const edge = abs(dot(q.sub(near.add(second).mul(0.5)), direction)).toVar();
  const detail = clamp(mul(CRACK, 1.7).div(soft), 0, 1).toVar();
  const crack = smoothstep(float(CRACK).add(soft), float(CRACK).sub(soft), edge)
    .mul(detail)
    .toVar();
  // The plate curls up toward its edge, so the lip is a slope and not a step.
  const lip = smoothstep(mul(CRACK, 6.0), mul(CRACK, 1.1), edge)
    .mul(float(1).sub(crack))
    .mul(detail)
    .toVar();
  // x: one inside a crack, zero on the plate. y: per-plate tone.
  // zw: horizontal slope of the raised lip, pointing out of the plate.
  // Wind-blown silt settles in the deepest part of a crack and lifts it a little.
  const silt = smoothstep(mul(CRACK, 0.5), 0.0, edge).mul(detail);
  return vec4(crack.sub(silt.mul(0.45)), cellHash(seedCell).x, direction.mul(lip));
});
  return {playaCracks, plateFootprint};
}
