// @vitest-environment node
/// <reference types="node" />
/* The ground, bit for bit.
 *
 * Burning Man's landscape used to be constants inside the sand engine; it is
 * now numbers the engine is handed. The numbers and the arithmetic are the
 * same, so every height, every shoreline and every rehearsed step must come
 * out the same double it was. This hashes dense samples of each and compares
 * them with what the standalone piece produced before the move. A hash that
 * moves is a change to his ground, whatever else it is.
 *
 * Record afresh (only when the ground is meant to change):
 *   GROUND_RECORD=<file to append the hashes to> npx vitest run ground-identity
 */
import {appendFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  coastX, coastalCrest, landHeight, mountainHeight, duneRelief, horizonDuneHeight, basinHalfWidth,
  surveyedHeight, duneHeight, geo,
} from '../landscape';
import {SandField} from '@lucid/world/desert';
import {surfExposure, shoreRise} from '@lucid/world/desert';
import {rehearse} from '../experience/walker';
import {REFERENCE} from './reference-score';

/** FNV-1a over the bytes of the doubles, as a hex string. */
function hashSeries(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(Float64Array.from(values).buffer);
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

const grid = (f: (x: number, z: number) => number, x0: number, x1: number, dx: number,
              z0: number, z1: number, dz: number) => {
  const out: number[] = [];
  for (let z = z0; z <= z1; z += dz) for (let x = x0; x <= x1; x += dx) out.push(f(x, z));
  return out;
};
const line = (f: (z: number) => number, z0: number, z1: number, dz: number) => {
  const out: number[] = [];
  for (let z = z0; z <= z1; z += dz) out.push(f(z));
  return out;
};
/** A fixed sequence of points, so the field is asked the same questions. */
function* points(count: number, span: number) {
  let s = 12345;
  const next = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < count; i++) yield [next() * span, next() * span] as const;
}

const SERIES: Record<string, () => ArrayLike<number>> = {
  'land height, near': () => grid(landHeight, -192, 192, 1.5, -192, 192, 1.5),
  'land height, far': () => grid(landHeight, -2048, 2048, 32, -2048, 2048, 32),
  'the coast': () => line(coastX, -300, 300, 0.5),
  'the last crest before the water': () => line(coastalCrest, -200, 200, 20),
  'the mountains': () => grid(mountainHeight, 560, 1100, 8, -400, 400, 8),
  'the horizon dunes': () => grid(horizonDuneHeight, -300, 1100, 7, -1100, 1100, 11),
  'the basin': () => line(basinHalfWidth, -100, 1100, 10),
  'the authored dunes': () => grid(duneRelief, -200, 200, 1, -200, 200, 1),
  'the survey': () => grid(surveyedHeight, -200, 200, 0.7, -200, 200, 0.7),
  'the field': () => {
    const field = new SandField(geo);
    const out: number[] = [];
    for (const [x, z] of points(400, 150)) {
      out.push(field.height(x, z), field.crustWeight(x, z), field.wetWeight(x, z));
      const s = field.support(x, z);
      out.push(s.softness, s.grip, s.sinkDepth);
    }
    // Then walk on it: prints, a slide, a kneel, and time for the sand to move.
    let i = 0;
    for (const [x, z] of points(60, 40)) {
      field.time = i * 0.1;
      field.contact({x, z, facing: i, force: 0.8 + (i % 3) * 0.1, radius: 1,
                     kind: i % 7 === 0 ? 'kneel' : i % 5 === 0 ? 'slide' : 'step', load: i % 2 === 0});
      field.update(0.05);
      i++;
    }
    for (const [x, z] of points(200, 40)) out.push(field.height(x, z), field.gradient(x, z).x);
    out.push(field.footfalls, field.collapses, field.movedVolume, duneHeight(3, 7));
    return out;
  },
  'the surf': () => {
    const out: number[] = [];
    for (const [x, z] of points(300, 200)) {
      const e = surfExposure(geo, x, z, REFERENCE.surfRange);
      out.push(e.distance, e.approach, e.openness, e.proximity, shoreRise(geo, x, z));
    }
    return out;
  },
  'the rehearsed walk': () => {
    const r = rehearse(REFERENCE);
    return [r.x, r.z, r.waterDistance, r.arrival ?? -1, r.distance];
  },
};

/** What the standalone piece's ground hashed to, before the move into the platform. */
const RECORDED: Record<string, string> = {
  'land height, near': '79e8a521effdd0b6',
  'land height, far': '77b30e84431ad29d',
  'the coast': '178607d2f522459b',
  'the last crest before the water': 'd99d9b75fcc44aa8',
  'the mountains': '316b7a52198f2c11',
  'the horizon dunes': 'c41d4fb398aaf5d4',
  'the basin': 'a7949aa070a839c0',
  'the authored dunes': 'f7cb9b1cef83c2e9',
  'the survey': '881a4c9808a3e60e',
  'the field': 'aa71827d3eb02d52',
  'the surf': '5e17204234f5c9f9',
  'the rehearsed walk': '7fae328381113b56',
};

describe('the ground is the same ground', () => {
  const record = process.env.GROUND_RECORD;
  const got: Record<string, string> = {};
  for (const [name, series] of Object.entries(SERIES)) {
    it(name, () => {
      got[name] = hashSeries(series());
      if (record) appendFileSync(record, `  '${name}': '${got[name]}',\n`);
      else expect(got[name]).toBe(RECORDED[name]);
    });
  }
});
