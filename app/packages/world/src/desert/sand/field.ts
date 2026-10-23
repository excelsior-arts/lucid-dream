import type {Geography} from '../landscape';
/** Metres, Y-up. Sparse deformation tiles; no renderer or Three.js dependency. */
export const SAND_CELL = 0.125;
const SIDE = 64;
const TILE = SIDE * SAND_CELL;
const ACTIVE_LIMIT = 6000;
const TILE_LIMIT = 256;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Print depth in loose dry sand: the dunes and the upper beach. */
const LOOSE_PRINT = 0.075;
/** The playa crust barely yields. A step there scuffs it rather than sinking in. */
const CRUST_PRINT = 0.004;
/** Saturated swash sand holds its shape, so it takes a shallower, crisper print. */
const WET_PRINT = 0.042;

type Tile = {
  delta: Float32Array;
  base: Float32Array;
  compact: Float32Array;
  touched: Float32Array;
  loose: Float32Array;
  flow: Float32Array;
};
export type SandBurst = {
  x: number;
  y: number;
  z: number;
  amount: number;
  kind: 'step' | 'slide' | 'crest';
  /** Direction of a foot push; natural slumps have no facing. */
  facing?: number;
};
export type SandContact = {
  x: number;
  z: number;
  facing: number;
  force?: number;
  radius?: number;
  kind?: 'step' | 'slide' | 'kneel';
  /** A planted foot can keep loading a crest while pushing or slipping. */
  load?: boolean;
};

export class SandField {
  /** The ground this sand lies on. The displayed surface and foot contact
      sample the same survey. */
  readonly geo: Geography;
  readonly cell = SAND_CELL;
  wind = {x: 2.5, z: 0.7};
  time = 0;
  revision = 0;
  /** Field time of the last change, so consumers can tell settled sand from fading sand. */
  disturbedAt = -Infinity;
  footfalls = 0;
  collapses = 0;
  movedVolume = 0;
  lastEvent = 'Undisturbed sand';
  private tiles = new Map<string, Tile>();
  private active = new Map<string, {x: number; z: number}>();
  private bursts: SandBurst[] = [];
  private accumulator = 0;
  private windPhase = 0;

  constructor(geo: Geography) {
    this.geo = geo;
  }

  private locate(gx: number, gz: number, create = false) {
    const tx = Math.floor(gx / SIDE),
      tz = Math.floor(gz / SIDE);
    const key = `${tx},${tz}`;
    let tile = this.tiles.get(key);
    if (!tile && create) {
      // A session keeps up to 16,384m² of modified sand. Evict the oldest tile.
      if (this.tiles.size >= TILE_LIMIT) this.tiles.delete(this.tiles.keys().next().value!);
      tile = {
        delta: new Float32Array(SIDE * SIDE),
        base: new Float32Array(SIDE * SIDE),
        compact: new Float32Array(SIDE * SIDE),
        touched: new Float32Array(SIDE * SIDE),
        loose: new Float32Array(SIDE * SIDE),
        flow: new Float32Array(SIDE * SIDE),
      };
      for (let z = 0; z < SIDE; z++)
        for (let x = 0; x < SIDE; x++)
          tile.base[z * SIDE + x] = this.geo.surveyedHeight(
            tx * TILE + x * SAND_CELL,
            tz * TILE + z * SAND_CELL,
          );
      this.tiles.set(key, tile);
    }
    return {tile, i: (gz - tz * SIDE) * SIDE + gx - tx * SIDE};
  }

  private gridHeight(gx: number, gz: number) {
    const {tile, i} = this.locate(gx, gz);
    return tile ? tile.base[i]! + tile.delta[i]! : this.geo.surveyedHeight(gx * SAND_CELL, gz * SAND_CELL);
  }

  height = (x: number, z: number): number => {
    const gx = Math.floor(x / SAND_CELL),
      gz = Math.floor(z / SAND_CELL);
    const u = x / SAND_CELL - gx,
      v = z / SAND_CELL - gz;
    const a = this.gridHeight(gx, gz),
      b = this.gridHeight(gx + 1, gz);
    const c = this.gridHeight(gx, gz + 1),
      d = this.gridHeight(gx + 1, gz + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };

  gradient = (x: number, z: number) => ({
    x: (this.height(x + 0.2, z) - this.height(x - 0.2, z)) / 0.4,
    z: (this.height(x, z + 0.2) - this.height(x, z - 0.2)) / 0.4,
  });

  surface(x: number, z: number) {
    const {tile, i} = this.locate(Math.round(x / SAND_CELL), Math.round(z / SAND_CELL));
    if (!tile) return {delta: 0, compact: 0, loose: 0, flow: 0};
    const age = Math.max(0, this.time - tile.touched[i]!);
    const healing = Math.exp(-age * Math.hypot(this.wind.x, this.wind.z) * 0.002);
    return {
      delta: tile.delta[i]!,
      compact: tile.compact[i]! * healing,
      loose: tile.loose[i]!,
      flow: tile.flow[i]! * Math.exp(-age * 1.8),
    };
  }

  /** Foot-scale slope sampling ignores single grain/footprint edges for balance. */
  walkGradient = (x: number, z: number) => ({
    x: (this.height(x + 0.55, z) - this.height(x - 0.55, z)) / 1.1,
    z: (this.height(x, z + 0.55) - this.height(x, z - 0.55)) / 1.1,
  });

  /**
   * How firmly the ground holds a print: one on the open playa crust, zero on
   * loose dune sand and on the dry beach. This is the same weight the terrain
   * material shades the crust with, so a print's depth and its appearance cross
   * the dune-to-playa-to-beach boundary together.
   */
  crustWeight = (x: number, z: number) => {
    const dune = smoothstep(0.08, 0.7, this.geo.surveyedHeight(x, z) - this.geo.landscape.floor);
    const slope = this.gradient(x, z);
    const flat = smoothstep(0.975, 0.997, 1 / Math.sqrt(1 + slope.x ** 2 + slope.z ** 2));
    return (1 - dune) * flat * this.geo.coastalDuneWeight(x - this.geo.coastX(z));
  };

  /** The saturated band the swash still reaches, just above the water line. */
  wetWeight = (x: number, z: number) =>
    (1 - this.geo.coastalDuneWeight(x - this.geo.coastX(z))) * (1 - smoothstep(0, 0.125, this.geo.surveyedHeight(x, z)));

  /** Firm interdune floors, yielding dune backs, and mobile disturbed sand. */
  support = (x: number, z: number) => {
    const relief = Math.max(0, this.height(x, z) - this.geo.landscape.floor);
    const softness = 0.025 + clamp(relief / 3.4) * 0.9;
    const patch = 0.88 + 0.12 * Math.sin(x * 0.23 + Math.sin(z * 0.19));
    const marks = this.surface(x, z);
    const loose = clamp(softness * patch * (1 - marks.compact * 0.35) + marks.loose * 0.28);
    return {
      softness: loose,
      grip: clamp(1 - loose * 0.55 - marks.flow * 0.12, 0.25, 1),
      sinkDepth: loose * loose * 0.075,
    };
  };

  private disturb() {
    this.revision++;
    this.disturbedAt = this.time;
  }

  private activate(x: number, z: number) {
    if (this.active.size < ACTIVE_LIMIT) this.active.set(`${x},${z}`, {x, z});
  }

  /** A heel/toe depression and a displaced rim. Deposit equals excavation. */
  contact({x, z, facing, force = 1, radius = 1, kind = 'step', load = false}: SandContact) {
    const sin = Math.sin(facing),
      cos = Math.cos(facing);
    const firm = this.crustWeight(x, z),
      wet = this.wetWeight(x, z);
    const depth = LOOSE_PRINT + (CRUST_PRINT - LOOSE_PRINT) * firm + (WET_PRINT - LOOSE_PRINT) * wet;
    // Wet sand keeps a sharp rim where dry sand slumps into a soft ring.
    const rimEdge = 3.2 * (1 + wet * 0.8);
    const reach = 0.5 * radius;
    const cells: {gx: number; gz: number; pit: number; rim: number; shape: number}[] = [];
    let excavation = 0,
      rimWeight = 0;
    for (
      let gz = Math.floor((z - reach) / SAND_CELL);
      gz <= Math.ceil((z + reach) / SAND_CELL);
      gz++
    ) {
      for (
        let gx = Math.floor((x - reach) / SAND_CELL);
        gx <= Math.ceil((x + reach) / SAND_CELL);
        gx++
      ) {
        const dx = gx * SAND_CELL - x,
          dz = gz * SAND_CELL - z;
        const across = (dx * cos - dz * sin) / (0.115 * radius);
        const along = (dx * sin + dz * cos) / (0.24 * radius);
        const r = Math.hypot(across, along);
        if (r > 1.95) continue;
        // The print's shape is the same on every ground; only its depth is not,
        // so the crust still carries a full-strength mark at a few millimetres.
        const shape = Math.exp(-r * r * 3);
        const pit = shape * depth * force;
        const rim = Math.exp(-Math.pow((r - 1.38) * rimEdge, 2));
        cells.push({gx, gz, pit, rim, shape});
        excavation += pit;
        rimWeight += rim;
      }
    }
    for (const {gx, gz, pit, rim, shape} of cells) {
      const {tile, i} = this.locate(gx, gz, true);
      tile!.delta[i] = tile!.delta[i]! - pit + (rim * excavation) / Math.max(0.001, rimWeight);
      tile!.compact[i] = Math.max(tile!.compact[i]!, clamp(shape * 1.5));
      tile!.loose[i] = 1;
      tile!.touched[i] = this.time;
      this.activate(gx, gz);
    }
    if (kind === 'step') this.footfalls++;
    this.lastEvent =
      kind === 'slide'
        ? 'Sliding tracks'
        : kind === 'kneel'
          ? 'Pressed into the sand'
          : force > 1.4
            ? 'Sand kicked loose'
            : 'Footprint pressed';
    this.bursts.push({
      x,
      y: this.height(x, z),
      z,
      amount: 20 * force,
      kind: kind === 'kneel' ? 'slide' : kind,
      facing,
    });
    // A loaded knife edge slumps over a wider area than a footprint.
    const crest = this.height(x, z) - (this.height(x - 0.65, z) + this.height(x + 0.65, z)) * 0.5;
    if (crest > 0.065 && (kind === 'step' || load)) this.collapse(x, z, force);
    this.disturb();
  }

  private collapse(x: number, z: number, force: number) {
    const cut: {gx: number; gz: number; amount: number}[] = [];
    let total = 0;
    const radius = 0.65 + Math.min(force, 2) * 0.15;
    for (
      let gz = Math.floor((z - radius) / SAND_CELL);
      gz <= Math.ceil((z + radius) / SAND_CELL);
      gz++
    )
      for (
        let gx = Math.floor((x - radius) / SAND_CELL);
        gx <= Math.ceil((x + radius) / SAND_CELL);
        gx++
      ) {
        const r = Math.hypot(gx * SAND_CELL - x, gz * SAND_CELL - z) / radius;
        if (r >= 1) continue;
        const amount = 0.11 * force * Math.pow(1 - r * r, 2);
        cut.push({gx, gz, amount});
        total += amount;
      }
    // Prevailing dune slip face is downwind (+X); displaced crest feeds that face.
    for (const {gx, gz, amount} of cut) {
      const a = this.locate(gx, gz, true),
        b = this.locate(gx + 8, gz, true);
      a.tile!.delta[a.i] = a.tile!.delta[a.i]! - amount;
      b.tile!.delta[b.i] = b.tile!.delta[b.i]! + amount;
      for (const cell of [a, b]) {
        cell.tile!.loose[cell.i] = 1;
        cell.tile!.compact[cell.i] = 0.65;
        cell.tile!.flow[cell.i] = 1;
        cell.tile!.touched[cell.i] = this.time;
      }
      this.activate(gx, gz);
      this.activate(gx + 8, gz);
    }
    this.collapses++;
    this.movedVolume += total * SAND_CELL * SAND_CELL;
    this.lastEvent = 'Crest giving way';
    this.bursts.push({x, y: this.height(x, z), z, amount: 90, kind: 'crest'});
  }

  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.time += Math.min(dt, 0.1);
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= 1 / 30) {
      this.relax(1 / 30);
      this.accumulator -= 1 / 30;
    }
  }

  private relax(dt: number) {
    const current = [...this.active.values()];
    this.active.clear();
    const transfers: {x: number; z: number; nx: number; nz: number; amount: number}[] = [];
    const windSpeed = Math.hypot(this.wind.x, this.wind.z);
    this.windPhase += dt;
    for (const {x, z} of current) {
      const a = this.locate(x, z);
      if (!a.tile) continue;
      const loose = a.tile.loose[a.i]!;
      if (loose < 0.008) continue;
      const h = this.gridHeight(x, z);
      let drop = 0,
        nx = x,
        nz = z;
      for (const [ox, oz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const diff = h - this.gridHeight(x + ox!, z + oz!);
        if (diff > drop) {
          drop = diff;
          nx = x + ox!;
          nz = z + oz!;
        }
      }
      // Mobile grains start moving at ~29°, then settle toward the repose slope.
      const excess = drop - (0.64 - loose * 0.1) * SAND_CELL;
      if (excess > 0.001) {
        const amount = Math.min(0.028, excess * 0.23) * loose;
        transfers.push({x, z, nx, nz, amount});
      }
      // Slow saltation transports exposed, loosened material downwind.
      if (windSpeed > 0.05 && this.windPhase > 0.2 && loose > 0.2) {
        const wx = Math.abs(this.wind.x) > Math.abs(this.wind.z) ? Math.sign(this.wind.x) : 0;
        const wz = wx ? 0 : Math.sign(this.wind.z);
        transfers.push({
          x,
          z,
          nx: x + wx,
          nz: z + wz,
          amount: Math.min(0.00015, windSpeed * 0.00002) * loose,
        });
      }
      a.tile.loose[a.i] = loose * Math.exp(-dt * 0.45);
      if (a.tile.loose[a.i]! > 0.008) this.activate(x, z);
    }
    if (this.windPhase > 0.2) this.windPhase = 0;
    for (const {x, z, nx, nz, amount} of transfers) {
      const a = this.locate(x, z, true),
        b = this.locate(nx, nz, true);
      a.tile!.delta[a.i] = a.tile!.delta[a.i]! - amount;
      b.tile!.delta[b.i] = b.tile!.delta[b.i]! + amount;
      b.tile!.loose[b.i] = Math.max(b.tile!.loose[b.i]!, a.tile!.loose[a.i]! * 0.92);
      for (const c of [a, b]) {
        c.tile!.flow[c.i] = Math.min(1, amount * 100);
        c.tile!.touched[c.i] = this.time;
      }
      this.activate(nx, nz);
      this.movedVolume += amount * SAND_CELL * SAND_CELL;
      if (amount > 0.008 && this.bursts.length < 24 && (x + z) % 17 === 0)
        this.bursts.push({
          x: nx * SAND_CELL,
          y: this.gridHeight(nx, nz),
          z: nz * SAND_CELL,
          amount: 3,
          kind: 'slide',
        });
    }
    if (transfers.length) this.disturb();
  }

  drainBursts() {
    const result = this.bursts;
    this.bursts = [];
    return result;
  }
  crestNear(x: number, z: number) {
    let best = x,
      height = -Infinity;
    for (let at = x - 19; at < x + 19; at += 0.125) {
      const h = this.height(at, z);
      if (h > height) {
        height = h;
        best = at;
      }
    }
    return {x: best, z, y: height};
  }
  reset() {
    this.tiles.clear();
    this.active.clear();
    this.bursts = [];
    this.footfalls = 0;
    this.collapses = 0;
    this.movedVolume = 0;
    this.lastEvent = 'Fresh wind-combed sand';
    this.disturb();
  }
  inspect() {
    let net = 0;
    for (const tile of this.tiles.values()) for (const d of tile.delta) net += d;
    return {
      footfalls: this.footfalls,
      collapses: this.collapses,
      movedVolume: this.movedVolume,
      netVolume: net * SAND_CELL * SAND_CELL,
      activeCells: this.active.size,
      tiles: this.tiles.size,
      revision: this.revision,
      disturbedAt: this.disturbedAt,
      time: this.time,
      lastEvent: this.lastEvent,
    };
  }
}
