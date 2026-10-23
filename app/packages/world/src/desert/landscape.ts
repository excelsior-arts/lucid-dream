/* A landscape, as numbers, and the geography those numbers make.
 *
 * The desert is a grammar: a level playa floor, a shoreline running north to
 * south with a beach falling to the sea, dunes drawn as crests with a height
 * and two flanks, a field of distant dune chains round a basin, and a
 * mountain range on the far side. Which numbers fill that grammar is a
 * trip's: Burning Man's are in its own landscape.ts, and another trip's will
 * be another file of the same shape. Everything below is the arithmetic that
 * turns the numbers into ground, and it is the same arithmetic the standalone
 * Burning Man ran with its numbers written in -- bit for bit, which its
 * ground-identity test holds it to.
 *
 * A Landscape is plain data on purpose: the ground survey runs on workers,
 * which can be handed a message but not a function, and the GPU terrain reads
 * the same numbers into its own copy of the shoreline. A Geography is the
 * landscape with its working parts built -- the compiled crests, the horizon
 * field's cells, the crest cache, the survey -- and every function of the
 * ground is a method of it, bound so it can be handed about as a function.
 */
import {compileRidge, duneRelief as reliefOfRidges, heap, ridgeRelief as reliefOfRidge} from './layout';
import type {Compiled, DuneRidge} from './layout';
import {HorizonDunes} from './horizon-dunes';
import type {HorizonField} from './horizon-dunes';
import {Survey} from './sand/height-atlas';

export type {DuneRidge, MapPoint} from './layout';
export type {HorizonField} from './horizon-dunes';

/** A cone of rock: an elliptical footprint and a height. */
export interface Peak {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  height: number;
}

export interface Landscape {
  /** The level the playa floor sits at, metres. The dunes rise from it. */
  floor: number;
  /** The shoreline runs north to south at this x, wandering by these sines
      of z: each is an amplitude and a frequency, summed in order. */
  coast: {x: number; meander: readonly (readonly [amplitude: number, frequency: number])[]};
  /** The beach: metres of flat dry sand before the dunes begin, where the dune
      relief has fully taken over, and the slope of the sand above and below
      the water line. */
  beach: {width: number; transition: number; slope: number; seabedSlope: number};
  /** The authored dunes, as crests. */
  ridges: readonly DuneRidge[];
  /** The far dune chains, round the basin. */
  horizon: HorizonField;
  /** The range on the far side: where its foot is, its peaks, and the long
      background ridge behind them. */
  mountains: {
    foot: number;
    peaks: readonly Peak[];
    ridge: {
      /** Where the ridge line runs, and how it sways with z (amplitude, frequency). */
      x: number;
      sway: readonly (readonly [amplitude: number, frequency: number])[];
      /** Half the width of its profile, metres. */
      width: number;
      /** Its height, and how that rises and falls with z (amplitude, frequency, phase). */
      height: number;
      swell: readonly (readonly [amplitude: number, frequency: number, phase: number])[];
    };
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Geography {
  readonly landscape: Landscape;
  readonly horizon: HorizonDunes;
  /** The ground survey: the walking atlas and the horizon atlas, built on
      workers or on this thread. Absent inside a worker, which builds the
      survey rather than owning one. */
  readonly survey: Survey | null;
  private readonly shapes: Map<DuneRidge, Compiled>;
  private readonly crests = new Map<number, number>();

  constructor(landscape: Landscape, options: {survey?: boolean} = {}) {
    this.landscape = landscape;
    this.shapes = new Map(landscape.ridges.map((ridge) => [ridge, compileRidge(ridge)]));
    this.horizon = new HorizonDunes(landscape.horizon);
    this.survey = options.survey === false ? null : new Survey(this);
  }

  /** Where the water begins at this z. */
  coastX = (z: number): number => {
    let x = this.landscape.coast.x;
    for (const [amplitude, frequency] of this.landscape.coast.meander)
      x += amplitude * Math.sin(z * frequency);
    return x;
  };

  /** How much of the ground at this distance from the shore is the dunes',
      0 on the beach and 1 where the relief has fully taken over. */
  coastalDuneWeight = (shore: number): number =>
    smooth(this.landscape.beach.width, this.landscape.beach.transition, shore);

  /** The authored dunes alone, heaped into one another. */
  duneRelief = (x: number, z: number): number => reliefOfRidges(x, z, this.landscape.ridges, this.shapes);

  /** One dune. */
  ridgeRelief = (x: number, z: number, ridge: DuneRidge): number =>
    reliefOfRidge(x, z, ridge, this.shapes);

  /** Ground under the authored dunes; the playa beyond them stays level. */
  landHeight = (x: number, z: number): number => {
    const {beach, floor} = this.landscape;
    const shore = x - this.coastX(z);
    const sand = Math.max(-20, shore * (shore < 0 ? beach.seabedSlope : beach.slope));
    const weight = this.coastalDuneWeight(shore);
    return (
      sand * (1 - weight) +
      // The authored dunes and the horizon field are one sand sheet: pile them into
      // each other rather than taking whichever is taller and leaving a ledge.
      (floor + heap(this.duneRelief(x, z), this.horizon.height(x, z))) * weight
    );
  };

  /** Distance from the shoreline to the top of the last dune before it, read
      off the ground itself so a change to the coastal profile carries whatever
      stands on it along. */
  coastalCrest = (z: number): number => {
    const key = Math.round(z / 2) * 2;
    let crest = this.crests.get(key);
    if (crest === undefined) {
      let highest = -Infinity;
      crest = this.landscape.beach.width;
      for (let shore = this.landscape.beach.width; shore <= 90; shore += 0.5) {
        const ground = this.landHeight(this.coastX(key) + shore, key);
        if (ground > highest) {
          highest = ground;
          crest = shore;
        }
      }
      this.crests.set(key, crest);
    }
    return crest;
  };

  /** Broad eroded shoulders and the peaks, past the range's foot. */
  mountainHeight = (x: number, z: number): number => {
    const {foot, peaks: PEAKS, ridge} = this.landscape.mountains;
    if (x <= foot) return 0;
    const cone = (cx: number, cz: number, rx: number, rz: number, height: number) => {
      const dx = (x - cx) / rx,
        dz = (z - cz) / rz;
      const r = Math.hypot(dx, dz);
      const flank = Math.max(0, 1 - r);
      const angle = Math.atan2(dz, dx);
      const gullies =
        1 + Math.sin(angle * 19 + r * 4) * 0.2 * r + Math.sin(angle * 37 - r * 9) * 0.065 * r;
      const crags =
        Math.sin(x * 0.21 + Math.sin(z * 0.12)) * 1.4 +
        Math.sin(z * 0.29 - x * 0.13) * 1.0 +
        Math.sin(x * 0.63 + z * 0.41) * 0.55;
      return Math.max(0, height * Math.pow(flank, 1.1) * gullies + crags * smooth(0, 0.24, flank));
    };
    let summits = 0;
    for (const peak of PEAKS)
      summits = Math.max(summits, cone(peak.x, peak.z, peak.radiusX, peak.radiusZ, peak.height));
    let longRidge = ridge.x;
    for (const [amplitude, frequency] of ridge.sway) longRidge += Math.sin(z * frequency) * amplitude;
    const profile = Math.max(0, 1 - Math.abs(x - longRidge) / ridge.width);
    let height = ridge.height;
    for (const [amplitude, frequency, phase] of ridge.swell)
      height += amplitude * Math.sin(z * frequency + phase);
    const background = profile * profile * height;
    return Math.max(summits, background) * smooth(foot, foot + 25, x);
  };

  /** The surveyed ground: the walking atlas inside its square, the horizon
      atlas beyond it, the formula past both. What is drawn and walked on. */
  surveyedHeight = (x: number, z: number): number => this.surveyOwned().height(x, z);

  heightAtlas = (): Uint8Array => this.surveyOwned().heightAtlas();
  horizonAtlas = (): Uint8Array => this.surveyOwned().horizonAtlas();
  /** Start the survey on workers; resolves when both atlases are in. */
  surveyReady = (): Promise<void> => this.surveyOwned().ready();

  private surveyOwned(): Survey {
    if (!this.survey) throw new Error('this geography has no survey: it was built to be sampled by one');
    return this.survey;
  }
}
