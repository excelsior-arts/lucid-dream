import * as THREE from 'three/webgpu';
import {float, mix, texture, vec2} from 'three/tsl';

const SIZE = 512;
const METRES = 4;
let shared: {map: THREE.DataTexture; users: number} | undefined;
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const wrap = (x: number, period: number) => ((x % period) + period) % period;
function noise(u: number, v: number, nx: number, ny = nx) {
  const x = u * nx,
    y = v * ny,
    ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = smooth(0, 1, x - ix),
    fy = smooth(0, 1, y - iy);
  const at = (dx: number, dy: number) => hash(wrap(ix + dx, nx), wrap(iy + dy, ny));
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(at(0, 0), at(1, 0), fx),
    THREE.MathUtils.lerp(at(0, 1), at(1, 1), fx),
    fy,
  );
}

/** Bake once: fine powder, scattered crust edges and stretched dust deposits.
 * Periodic fields and wrapped derivatives make every channel tile seamlessly.
 * RG stores the height gradient, B the grain/crust tone, A the dust coverage. */
function bakeDust() {
  const bytes = new Uint8Array(SIZE * SIZE * 4);
  const heights = new Float32Array(SIZE * SIZE);
  const cells = 32;
  const seeds = Array.from({length: cells * cells}, (_, i) => {
    const x = i % cells,
      y = Math.floor(i / cells);
    return [0.15 + hash(x + 97, y + 17) * 0.7, 0.15 + hash(x + 43, y + 91) * 0.7];
  });
  const byte = (v: number) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE,
        v = y / SIZE;
      // Bend the sampling field before baking. Straight value-noise cells and
      // a stretched 2-by-12 lattice made broad deposits read as parallel rows.
      const turn = Math.PI * 2;
      const wu =
        u + 0.075 * Math.sin(turn * (u + 2 * v)) + 0.035 * Math.sin(turn * (5 * v - 2 * u));
      const wv =
        v + 0.075 * Math.sin(turn * (2 * u - v)) + 0.025 * Math.sin(turn * (3 * u + 4 * v));
      const patch = noise(wu, wv, 5) * 0.65 + noise(wu + 0.37, wv - 0.21, 9) * 0.35,
        powder = noise(u, v, 64);
      const grain = hash(x, y) - 0.5;
      const qx = u * cells,
        qy = v * cells;
      const ix = Math.floor(qx),
        iy = Math.floor(qy);
      let first = Infinity,
        second = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const seed = seeds[wrap(iy + dy, cells) * cells + wrap(ix + dx, cells)]!;
          const distance = (ix + dx + seed[0]! - qx) ** 2 + (iy + dy + seed[1]! - qy) ** 2;
          if (distance < first) {
            second = first;
            first = distance;
          } else second = Math.min(second, distance);
        }
      }
      const edge = Math.sqrt(second) - Math.sqrt(first);
      const crust = (1 - smooth(0.005, 0.055, edge)) * smooth(0.45, 0.72, patch);
      const i = y * SIZE + x;
      heights[i] = (powder - 0.5) * 0.0012 + grain * 0.00065 - crust * 0.0011;
      bytes[i * 4 + 2] = byte(
        0.5 + (patch - 0.5) * 0.24 + (powder - 0.5) * 0.2 + grain * 0.15 - crust * 0.25,
      );
      bytes[i * 4 + 3] = byte(
        noise(wu, wv, 3) * 0.55 + noise(wu + 0.21, wv + 0.73, 7) * 0.3 + patch * 0.15,
      );
    }
  }
  const at = (x: number, y: number) => heights[wrap(y, SIZE) * SIZE + wrap(x, SIZE)]!;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      bytes[i] = byte(0.5 + ((at(x + 1, y) - at(x - 1, y)) * SIZE) / METRES);
      bytes[i + 1] = byte(0.5 + ((at(x, y + 1) - at(x, y - 1)) * SIZE) / METRES);
    }
  }
  const map = new THREE.DataTexture(bytes, SIZE, SIZE, THREE.RGBAFormat);
  map.name = 'Playa powder and weathered crust';
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

/** The walking surface and distant flats share one ~1.33 MiB mipmapped tile.
 * Broad, rotated deposits also warp the fine tile coordinates, hiding its repeat
 * without another texture fetch. Filtering keeps distant grain from shimmering. */
export function playaSurface(point: THREE.Node<'vec3'>, coverage: THREE.Node<'float'>) {
  const resource = shared ?? (shared = {map: bakeDust(), users: 0});
  resource.users++;
  const drift = texture(
    resource.map,
    vec2(point.x.mul(0.93).add(point.z.mul(0.37)), point.z.mul(0.93).sub(point.x.mul(0.37))).mul(
      0.055,
    ),
  );
  const sample = texture(
    resource.map,
    point.xz.div(METRES).add(vec2(0.6, -0.43).mul(drift.a.sub(0.5))),
  );
  const tone = float(1)
    .add(sample.b.sub(0.5).mul(0.9))
    .add(sample.a.sub(0.5).mul(0.16))
    .add(drift.a.sub(0.5).mul(0.24));
  let disposed = false;
  return {
    tint: mix(1, tone, coverage),
    gradient: sample.rg.sub(0.5).mul(1.05).mul(coverage),
    roughness: float(0.96).add(sample.b.sub(0.5).mul(0.06).mul(coverage)),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--resource.users === 0) {
        resource.map.dispose();
        shared = undefined;
      }
    },
  };
}
