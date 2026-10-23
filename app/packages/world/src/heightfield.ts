/* Ground, as a grid of heights.
 *
 * A room is furniture and its floor is a slab; a landscape is neither. What a
 * game that walks wants underfoot is a field of samples — a height every two
 * metres, a square region of them, the next region's edge agreeing with this
 * one's — and a collider that is that field rather than a mesh cut from it. A
 * trimesh of the same ground would work and would cost a hundred times the
 * memory and give a worse answer at the seams, because a heightfield knows it
 * is a heightfield: it can say which cell a point is over by arithmetic
 * instead of by search, and it can be told to fix the normals along the edges
 * between its own triangles.
 *
 * ---- the orientation, which is the whole difficulty ------------------------
 *
 * The game holds its samples the way it reads them: row-major, a row running
 * along x, rows stepping along z, so `heights[row * cols + col]` is the height
 * at (col-th x, row-th z). Rapier wants the same matrix stored the other way
 * about — column-major, which is nalgebra's — and it is documented in a
 * sentence that does not say which of x and z a row is. So it was measured,
 * not assumed, and what came back is written down here and proved again in
 * heightfield.test.ts every time the suite runs:
 *
 *   Matrix element (i, j) sits at buffer index `i + j * (number of rows)`.
 *   The row index i runs along **z**, increasing; the column index j runs
 *   along **x**, increasing. So the game's layout and Rapier's are the same
 *   matrix and the conversion is a transpose of the *storage* only.
 *
 *   And `nrows`/`ncols` are the number of **cells**, one less than the number
 *   of samples along that edge: a 49 × 49 field of samples is 48 × 48 to
 *   Rapier. Handing it 49 does not fail politely — the wasm traps with
 *   `unreachable`, because it builds a matrix that wants 2500 numbers out of
 *   a buffer holding 2401.
 */
import * as THREE from 'three';

import type {Bound} from './bodies';
import type {Vec3, World} from './world';

export interface HeightfieldOpts {
  /** Heights row-major from the game: `heights[row * cols + col]`; a row runs
      along x (col is x), rows step along z. Rapier wants column-major and
      this converts. `rows` and `cols` count samples, not cells. */
  rows: number;
  cols: number;
  heights: Float32Array;
  /** The field's footprint in metres, centred on `at`. The first sample of a
      row sits at `at.x - size.x / 2` and the last at `at.x + size.x / 2`. */
  size: {x: number; z: number};
  at?: Vec3;
  friction?: number;
}

/** A fixed body with a heightfield collider, FIX_INTERNAL_EDGES set.
 *
 * `Bound.mesh` is an empty `THREE.Object3D` at `at`: the game draws its own
 * ground, with its own colours and its own flat shading, and what is wanted
 * back from here is only the shape the walking is done against. It is a Bound
 * all the same so that `remove` takes it away like anything else — a region
 * behind you is released the same way a book that fell out of a room is. */
export function staticHeightfield(
  w: World, {rows, cols, heights, size, at = {x: 0, y: 0, z: 0}, friction}: HeightfieldOpts,
): Bound {
  const R = w.RAPIER;
  if (rows < 2 || cols < 2) throw new Error('a heightfield is at least 2 x 2 samples');
  if (heights.length !== rows * cols) {
    throw new Error(`heights is ${heights.length}, not rows * cols (${rows * cols})`);
  }
  /* The transpose of the storage and nothing else: element (row, col) keeps
     its meaning and moves from index `row * cols + col` to `row + col * rows`. */
  const column = new Float32Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      column[row + col * rows] = heights[row * cols + col]!;
    }
  }
  const body = w.world.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z));
  /* The heights are already metres, so the y of the scale is 1; the x and z
     are the footprint, which Rapier centres on the body. */
  const desc = R.ColliderDesc.heightfield(
    rows - 1, cols - 1, column, {x: size.x, y: 1, z: size.z},
    R.HeightFieldFlags.FIX_INTERNAL_EDGES);
  if (friction !== undefined) desc.setFriction(friction);
  const mesh = new THREE.Object3D();
  mesh.position.set(at.x, at.y, at.z);
  return {body, collider: w.world.createCollider(desc, body), mesh};
}

/* How far a ray that fell down a seam is moved before it is cast again.
 *
 * Relative to where it is being cast, because Rapier's numbers are 32-bit
 * floats: a hair at the origin is nothing at all two kilometres out, and two
 * kilometres out is where a ten-minute walk ends up. Four parts in a million
 * is about thirty of the smallest steps a float can take wherever it is, which
 * is enough to be inside a cell rather than on its edge and small enough that
 * the height it reads back is the same one to five decimal places. */
const SEAM = 4e-6;

/** Rapier's own answer for the ground height at (x, z), by a downward ray from
    `from` metres up, or null off the field.
 *
 * Rapier's rather than the game's arithmetic on purpose. The game knows the
 * height it asked for; what a figure stands on is the height Rapier built,
 * and between the two are the triangulation of every cell and whatever else
 * has been dropped on the ground since. Asking the world is how a walk finds
 * out it has walked off the end of what has been built — that is what the
 * null is for, and it is a fact the caller wants before the figure is falling.
 *
 * Sensors are skipped: a trigger volume is not something to stand on. Solids
 * are not, so a boulder resting on the ground reads as the top of the boulder,
 * which is the honest answer to "what is under this point".
 *
 * ---- two things that will otherwise cost somebody an afternoon -------------
 *
 * A collider built this instant is not visible to a ray until the world has
 * taken a step: scene queries are answered out of the broad phase, and the
 * broad phase learns about a new collider when it is next run. So a region
 * built and immediately probed reads null. Build, step, then ask.
 *
 * And a ray cast exactly along the seam between two cells of a heightfield
 * misses it — falls between the two triangles and out the bottom of the world.
 * Which is not a corner case here: a field of samples every two metres has a
 * seam on every even metre, and a game asks for the ground under round numbers
 * all day. Whether a given seam swallows a ray is down to which way a float
 * rounded, so it is not even consistent between one edge of a field and the
 * other. So a miss is tried again a few floats to one side, and then a few to
 * the other — off the end of the field all three miss, which is what keeps the
 * null meaning what it says. */
export function groundAt(
  w: World, x: number, z: number, from = 200,
): number | null {
  const R = w.RAPIER;
  const cast = (atX: number, atZ: number) => {
    const ray = new R.Ray({x: atX, y: from, z: atZ}, {x: 0, y: -1, z: 0});
    /* As far down again as it started up: ground below -`from` is ground the
       caller has already lost the figure into. */
    const hit = w.world.castRay(
      ray, from * 2, true, R.QueryFilterFlags.EXCLUDE_SENSORS);
    return hit ? from - hit.timeOfImpact : null;
  };
  const straight = cast(x, z);
  if (straight !== null) return straight;
  const off = Math.max(Math.abs(x), Math.abs(z), 1) * SEAM;
  /* Both ways, because the seam a ray fell down may be the outer edge of the
     field, and stepping outward from that is off it. */
  return cast(x + off, z + off) ?? cast(x - off, z - off);
}
