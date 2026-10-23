/** Finite, overlapping dune chains around the playa's basin. The basin guides
 * where dunes accumulate; it never cuts their toes to a perfect curved edge.
 *
 * The chains are grown from a grid of jittered accumulation patches, every
 * number of which is drawn from a hash of the patch's place, so the field is
 * the same field every time it is built from the same numbers. Which numbers
 * -- the basin, the grid, where the field is kept clear -- are the landscape's
 * (HorizonField below); the shapes of the dunes themselves are this file's. */
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, z: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + 83.19) * 43758.5453;
  return n - Math.floor(n);
};
function noise(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const u = smooth(0, 1, x - ix),
    v = smooth(0, 1, z - iz);
  return (
    (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) +
    (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
  );
}

export interface HorizonField {
  /** Half the basin's width at x = 0, and how it widens with x squared. */
  basin: {halfWidth: number; growth: number};
  /** The grid the chains are seeded on: rows either side of z = 0, the span
      of columns, the pitch of the grid (x, z), the jitter of each seed (x, z),
      the x bounds a seed may fall in, and the share of seeds dropped. */
  seeds: {
    rows: number;
    columns: readonly [from: number, to: number];
    pitch: readonly [x: number, z: number];
    jitter: readonly [x: number, z: number];
    west: number;
    east: number;
    drop: number;
  };
  /** Where the field is kept clear: inside this radius of the origin (and
      the band over which it fades in), west of this x (and its fade), and a
      corridor east of a line (its fade in x) within a half width of z = 0
      (its fade). */
  clear: {
    radius: readonly [from: number, to: number];
    west: readonly [from: number, to: number];
    corridor: {from: readonly [number, number]; halfWidth: readonly [number, number]};
  };
}

interface Dune {
  x: number;
  z: number;
  half: number;
  bow: number;
  bend: number;
  phase: number;
  slant: number;
  height: number;
  windward: number;
  leeward: number;
}
const CELL = 128;
const key = (x: number, z: number) => `${x},${z}`;

function relief(dune: Dune, x: number, z: number) {
  const t = (z - dune.z) / dune.half;
  if (Math.abs(t) >= 1) return 0;
  const crest =
    dune.x +
    dune.bow * t * t +
    dune.slant * t +
    dune.bend * Math.sin(t * 4.1 + dune.phase) * (1 - t * t);
  const width =
    (x < crest ? dune.windward : dune.leeward) * (0.88 + 0.2 * Math.sin(t * 3 + dune.phase));
  const d = Math.abs(x - crest) / width;
  if (d >= 1) return 0;
  const lip = Math.sqrt(d * d + 0.14 * 0.14) - 0.14;
  const face = (1 - lip / (Math.sqrt(1.0196) - 0.14)) ** 2;
  const horn = Math.pow(Math.max(0, 1 - t * t), 0.8);
  return dune.height * face * horn * (0.86 + 0.14 * Math.sin(t * 5 + dune.phase));
}

export class HorizonDunes {
  private readonly cells = new Map<string, Dune[]>();
  readonly field: HorizonField;

  constructor(field: HorizonField) {
    this.field = field;
    const {seeds} = field;
    // Jittered accumulation patches seed independent chains, not rows of one phase.
    // Offshoots share part of a parent's crest before bending into another chain.
    for (let row = -seeds.rows; row <= seeds.rows; row++)
      for (let col = seeds.columns[0]; col <= seeds.columns[1]; col++) {
        const r = (salt: number) => hash(col * 19 + salt * 7.3, row * 31 - salt * 2.1);
        const x = col * seeds.pitch[0] + (r(1) - 0.5) * seeds.jitter[0];
        const z = row * seeds.pitch[1] + (r(2) - 0.5) * seeds.jitter[1];
        const bank =
          this.basinHalfWidth(x) +
          (noise(x / 210, z / 300) - 0.5) * 145 +
          (noise(x / 75 + 19, z / 130) - 0.5) * 58;
        if (Math.abs(z) < bank || x < seeds.west || x > seeds.east || r(3) < seeds.drop) continue;
        const dune: Dune = {
          x,
          z,
          half: 78 + r(4) * 147,
          bow: 12 + r(5) * 47,
          bend: 6 + r(6) * 17,
          phase: r(7) * Math.PI * 2,
          slant: (r(8) - 0.5) * 94,
          height: 8 + r(9) * 19,
          windward: 38 + r(10) * 31,
          leeward: 21 + r(11) * 23,
        };
        this.add(dune);
        if (r(12) < 0.58)
          this.add({
            ...dune,
            x: x + 22 + r(13) * 27,
            z: z + (r(14) - 0.5) * dune.half,
            half: dune.half * 0.64,
            slant: dune.slant - 38,
            bow: dune.bow * -0.65,
            height: dune.height * (0.48 + r(15) * 0.28),
            windward: dune.windward * 0.7,
            leeward: dune.leeward * 0.7,
          });
      }
  }

  basinHalfWidth = (x: number): number =>
    this.field.basin.halfWidth + Math.pow(Math.max(0, x), 2) * this.field.basin.growth;

  private add(dune: Dune) {
    const reach =
      Math.abs(dune.bow) +
      Math.abs(dune.slant) +
      dune.bend +
      Math.max(dune.windward, dune.leeward) * 1.3;
    for (
      let z = Math.floor((dune.z - dune.half) / CELL);
      z <= Math.floor((dune.z + dune.half) / CELL);
      z++
    )
      for (
        let x = Math.floor((dune.x - reach) / CELL);
        x <= Math.floor((dune.x + reach) / CELL);
        x++
      ) {
        const id = key(x, z);
        let bucket = this.cells.get(id);
        if (!bucket) this.cells.set(id, (bucket = []));
        bucket.push(dune);
      }
  }

  height = (x: number, z: number): number => {
    const {clear} = this.field;
    const radius = Math.hypot(x, z);
    if (
      radius <= clear.radius[0] ||
      x <= clear.west[0] ||
      (x >= clear.corridor.from[1] && Math.abs(z) <= clear.corridor.halfWidth[0])
    )
      return 0;
    const bucket = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!bucket) return 0;
    let height = 0;
    for (const dune of bucket) {
      const h = relief(dune, x, z);
      // Sand shoulders join at crossings instead of leaving a stack of shells.
      const overlap = Math.max(0, 1 - Math.abs(height - h) / 1.8);
      height = Math.max(height, h) + overlap * overlap * 0.45 * smooth(0, 0.8, Math.min(height, h));
    }
    const corridor =
      1 -
      smooth(clear.corridor.from[0], clear.corridor.from[1], x) *
        (1 - smooth(clear.corridor.halfWidth[0], clear.corridor.halfWidth[1], Math.abs(z)));
    return (
      height *
      smooth(clear.radius[0], clear.radius[1], radius) *
      corridor *
      smooth(clear.west[0], clear.west[1], x)
    );
  };

  /** Every tile intersecting an accumulation patch needs the same shared fine grid. */
  inTile(x: number, z: number, size: number): boolean {
    for (let iz = Math.floor(z / CELL); iz <= Math.floor((z + size) / CELL); iz++)
      for (let ix = Math.floor(x / CELL); ix <= Math.floor((x + size) / CELL); ix++)
        if (this.cells.has(key(ix, iz))) return true;
    return false;
  }
}
