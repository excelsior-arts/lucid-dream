/* The ground, and which way round it is.
 *
 * Everything else in this file is arithmetic that could be read off the code.
 * The orientation cannot: Rapier is handed a flat buffer and a pair of counts,
 * and whether the first count is the number of samples along x or along z — and
 * whether it is samples or cells — is a thing the documentation says in a
 * sentence that can be read both ways. A game that gets it wrong gets a
 * landscape transposed about its own diagonal, which looks like a landscape,
 * so nobody finds it until a region's edge does not meet its neighbour's.
 *
 * So it is proved here, in both directions, on a field that is not square.
 */
import {beforeAll, describe, expect, it} from 'vitest';

import {groundAt, staticHeightfield} from './heightfield';
import {createWorld, ready} from './world';
import type {World} from './world';

beforeAll(async () => { await ready(); });

/** A field of `rows` × `cols` samples over `size` metres, filled by a function
    of the sample's own world (x, z) — which is what the game's own terrain is,
    and reading it back is then a question about the field and not about the
    arithmetic that filled it. */
function field(
  w: World,
  {rows, cols, size, of}:
  {rows: number; cols: number; size: {x: number; z: number};
   of: (x: number, z: number) => number},
) {
  const heights = new Float32Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = -size.x / 2 + (size.x * col) / (cols - 1);
      const z = -size.z / 2 + (size.z * row) / (rows - 1);
      heights[row * cols + col] = of(x, z);
    }
  }
  const bound = staticHeightfield(w, {rows, cols, heights, size});
  /* And a step, because a collider built this instant is not in the broad
     phase until one has been taken -- see `groundAt`. */
  w.stepN(1);
  return bound;
}

describe('a heightfield', () => {
  it('reads higher at +x when the game filled it sloping along x', () => {
    const w = createWorld({seed: 'slope-x'});
    // Ten metres of rise over the forty the field is wide.
    field(w, {rows: 21, cols: 21, size: {x: 40, z: 40}, of: (x) => x / 4});

    expect(groundAt(w, 16, 0)).toBeGreaterThan(groundAt(w, -16, 0)!);
    /* And is flat along the other axis, which is the half of it a transposed
       field would still pass. To four decimals rather than exactly: sixteen is
       a seam, so one of these two was cast a few floats to one side of where
       it was asked for -- see SEAM. */
    expect(groundAt(w, 0, 16)).toBeCloseTo(groundAt(w, 0, -16)!, 4);
    // The height itself, not only its order: x / 4 at x = 16 is four.
    expect(groundAt(w, 16, 0)).toBeCloseTo(4, 2);
    w.dispose();
  });

  it('and higher at +z when it slopes along z', () => {
    const w = createWorld({seed: 'slope-z'});
    field(w, {rows: 21, cols: 21, size: {x: 40, z: 40}, of: (_x, z) => z / 4});

    expect(groundAt(w, 0, 16)).toBeGreaterThan(groundAt(w, 0, -16)!);
    expect(groundAt(w, 16, 0)).toBeCloseTo(groundAt(w, -16, 0)!, 4);
    expect(groundAt(w, 0, 16)).toBeCloseTo(4, 2);
    w.dispose();
  });

  /* The two above pass on a field whose rows and columns are the same length
     even if the buffer is walked the wrong way, because a square transposed is
     still square and the two slopes are two separate worlds. This one does
     not: 13 × 33 read as 33 × 13 is a matrix of the wrong shape, and Rapier
     answers a wrong-shaped matrix by trapping in the wasm. */
  it('keeps its stride when it is not square', () => {
    const w = createWorld({seed: 'oblong'});
    field(w, {
      rows: 13, cols: 33, size: {x: 64, z: 24},
      of: (x, z) => x / 8 + z / 4,
    });
    expect(groundAt(w, 24, 0)).toBeCloseTo(3, 1);
    expect(groundAt(w, 0, 8)).toBeCloseTo(2, 1);
    expect(groundAt(w, -24, -8)).toBeCloseTo(-5, 1);
    w.dispose();
  });

  it('is lowest in the middle when it is a bowl', () => {
    const w = createWorld({seed: 'bowl'});
    field(w, {
      rows: 25, cols: 25, size: {x: 48, z: 48},
      of: (x, z) => (x * x + z * z) / 100,
    });
    const middle = groundAt(w, 0, 0)!;
    const rim: Array<[number, number]> =
      [[20, 0], [-20, 0], [0, 20], [0, -20], [14, 14], [-14, 14]];
    for (const [x, z] of rim) {
      expect(groundAt(w, x, z)).toBeGreaterThan(middle);
    }
    expect(middle).toBeCloseTo(0, 2);
    w.dispose();
  });

  it('is where `at` puts it, and nowhere else', () => {
    const w = createWorld({seed: 'placed'});
    const flat = new Float32Array(9);
    staticHeightfield(w, {
      rows: 3, cols: 3, heights: flat, size: {x: 20, z: 20},
      at: {x: 100, y: 7, z: 0},
    });
    /* The rule, on its own, because it is the one that will catch somebody:
       a ray cast at a field that has just been built finds nothing at all. */
    expect(groundAt(w, 100, 0)).toBe(null);
    w.stepN(1);
    expect(groundAt(w, 100, 0)).toBeCloseTo(7, 5);
    // Off the end of what has been built, which is what a walk finds out with.
    expect(groundAt(w, 0, 0)).toBe(null);
    expect(groundAt(w, 120, 0)).toBe(null);
    w.dispose();
  });

  /* The seam. A field of samples every two metres has an edge between cells on
     every even metre, and a ray cast exactly along one of those falls through
     it — which is not an exotic input, it is what asking for the ground under
     a round number is. Whether a particular seam swallows a ray is down to
     float rounding, so this walks a line of them rather than picking one. */
  it('finds ground on the seams between its own cells', () => {
    const w = createWorld({seed: 'seams'});
    field(w, {rows: 21, cols: 21, size: {x: 40, z: 40}, of: (x) => x / 4});
    for (let x = -18; x <= 18; x += 2) {
      for (let z = -18; z <= 18; z += 2) {
        expect(groundAt(w, x, z), `at (${x}, ${z})`).not.toBe(null);
        expect(groundAt(w, x, z)).toBeCloseTo(x / 4, 3);
      }
    }
    w.dispose();
  });

  it('refuses a buffer that is not the size it was told', () => {
    const w = createWorld({seed: 'wrong'});
    expect(() => staticHeightfield(
      w, {rows: 5, cols: 5, heights: new Float32Array(24), size: {x: 10, z: 10}}))
      .toThrow(/24/);
    w.dispose();
  });
});
