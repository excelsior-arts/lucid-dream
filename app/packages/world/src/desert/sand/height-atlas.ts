/* The ground survey: two height atlases sampled off a landscape.
 *
 * The walking atlas is a quarter-metre grid over the central square, the
 * horizon atlas an eight-metre grid out to two kilometres; the GPU terrain
 * reads both as textures and everything on the CPU reads them through
 * `height`. One Survey per Geography, built on workers while the rest of the
 * piece comes up, or on this thread the first time anything asks if the
 * workers never arrive.
 */
import type {Geography, Landscape} from '../landscape';
import type {SurveyJob} from './height-atlas.worker';
import {
  ATLAS_MIN,
  ATLAS_SIZE,
  ATLAS_STEP,
  buildAtlas,
  FAR_ATLAS_MIN,
  FAR_ATLAS_SIZE,
  FAR_ATLAS_STEP,
  FAR_HEIGHT_RANGE,
  HEIGHT_MIN,
  HEIGHT_RANGE,
} from './atlas-build';
export {
  ATLAS_MIN,
  ATLAS_SIZE,
  ATLAS_STEP,
  FAR_ATLAS_MIN,
  FAR_ATLAS_SIZE,
  FAR_ATLAS_STEP,
  FAR_HEIGHT_RANGE,
  HEIGHT_MIN,
  HEIGHT_RANGE,
} from './atlas-build';

function sample(data: Uint8Array, gx: number, gz: number, size: number, range: number) {
  const ix = Math.floor(gx),
    iz = Math.floor(gz),
    u = gx - ix,
    v = gz - iz;
  const read = (x: number, z: number) => {
    const i = (z * size + x) * 4;
    return HEIGHT_MIN + ((data[i]! * 256 + data[i + 1]!) / 65535) * range;
  };
  return (
    (read(ix, iz) * (1 - u) + read(ix + 1, iz) * u) * (1 - v) +
    (read(ix, iz + 1) * (1 - u) + read(ix + 1, iz + 1) * u) * v
  );
}

export class Survey {
  private atlas: Uint8Array | undefined;
  private distant: Uint8Array | undefined;
  private running: Promise<void> | undefined;
  private readonly geo: Geography;

  constructor(geo: Geography) {
    this.geo = geo;
  }

  /**
   * Start both surveys on workers and resolve when they arrive. The two and a
   * third million ridge evaluations used to hold the main thread for well over a
   * second before anything could be drawn; off the thread they run while the body
   * downloads. Every sampler below stays synchronous, and if the workers are
   * unavailable the first sample simply builds the survey here, as it always did.
   */
  ready(): Promise<void> {
    return (this.running ??= this.run());
  }

  /** Split both surveys into row bands and hand them to as many workers as the
   * machine offers. Each band is the same arithmetic on the same points, so the
   * stitched result is the survey a single pass would have produced. The
   * landscape goes with every job: a worker builds its own geography from the
   * numbers, since a function cannot be posted. */
  private async run() {
    if (this.atlas && this.distant) return;
    const cores = Math.max(1, Math.min(6, (navigator?.hardwareConcurrency ?? 4) - 1));
    let workers: Worker[];
    try {
      workers = Array.from(
        {length: cores},
        () => new Worker(new URL('./height-atlas.worker.ts', import.meta.url), {type: 'module'}),
      );
    } catch {
      // No workers here: the first sample builds the survey on this thread.
      return;
    }
    const landscape: Landscape = this.geo.landscape;
    const near = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
    const far = new Uint8Array(FAR_ATLAS_SIZE * FAR_ATLAS_SIZE * 4);
    const jobs: SurveyJob[] = [];
    const band = (size: number) => Math.max(1, Math.ceil(size / cores));
    for (let from = 0; from < ATLAS_SIZE; from += band(ATLAS_SIZE))
      jobs.push({
        landscape,
        id: 0,
        min: ATLAS_MIN,
        step: ATLAS_STEP,
        size: ATLAS_SIZE,
        range: HEIGHT_RANGE,
        from,
        to: Math.min(ATLAS_SIZE, from + band(ATLAS_SIZE)),
      });
    for (let from = 0; from < FAR_ATLAS_SIZE; from += band(FAR_ATLAS_SIZE))
      jobs.push({
        landscape,
        id: 1,
        min: FAR_ATLAS_MIN,
        step: FAR_ATLAS_STEP,
        size: FAR_ATLAS_SIZE,
        range: FAR_HEIGHT_RANGE,
        from,
        to: Math.min(FAR_ATLAS_SIZE, from + band(FAR_ATLAS_SIZE)),
      });
    try {
      let next = 0;
      await Promise.all(
        workers.map(
          (worker) =>
            new Promise<void>((resolve, reject) => {
              const take = () => {
                const job = jobs[next++];
                if (!job) return resolve();
                worker.postMessage(job);
              };
              worker.onmessage = (
                event: MessageEvent<{id: number; from: number; rows: ArrayBuffer}>,
              ) => {
                const {id, from, rows} = event.data;
                const size = id === 0 ? ATLAS_SIZE : FAR_ATLAS_SIZE;
                (id === 0 ? near : far).set(new Uint8Array(rows), from * size * 4);
                take();
              };
              worker.onerror = () => reject(new Error('The ground survey worker failed.'));
              take();
            }),
        ),
      );
      this.atlas ??= near;
      this.distant ??= far;
    } catch {
      // Fall through: the first sample builds the survey on this thread.
    } finally {
      for (const worker of workers) worker.terminate();
    }
  }

  heightAtlas(): Uint8Array {
    return (this.atlas ??= buildAtlas(this.geo.landHeight, ATLAS_MIN, ATLAS_STEP, ATLAS_SIZE, HEIGHT_RANGE));
  }
  horizonAtlas(): Uint8Array {
    return (this.distant ??= buildAtlas(
      this.geo.landHeight,
      FAR_ATLAS_MIN,
      FAR_ATLAS_STEP,
      FAR_ATLAS_SIZE,
      FAR_HEIGHT_RANGE,
    ));
  }

  /** The surveyed ground at a point: the walking atlas inside its square,
      blended over eight metres into the horizon atlas, and the formula itself
      beyond both. */
  height(x: number, z: number): number {
    const gx = (x - ATLAS_MIN) / ATLAS_STEP,
      gz = (z - ATLAS_MIN) / ATLAS_STEP;
    const edge = -ATLAS_MIN - Math.max(Math.abs(x), Math.abs(z));
    const near = edge > 0 ? sample(this.heightAtlas(), gx, gz, ATLAS_SIZE, HEIGHT_RANGE) : 0;
    if (edge >= 8) return near;
    const fx = (x - FAR_ATLAS_MIN) / FAR_ATLAS_STEP,
      fz = (z - FAR_ATLAS_MIN) / FAR_ATLAS_STEP;
    if (fx < 0 || fz < 0 || fx >= FAR_ATLAS_SIZE - 1 || fz >= FAR_ATLAS_SIZE - 1)
      return this.geo.landHeight(x, z);
    const far = sample(this.horizonAtlas(), fx, fz, FAR_ATLAS_SIZE, FAR_HEIGHT_RANGE);
    const t = Math.max(0, Math.min(1, edge / 8));
    const blend = t * t * (3 - 2 * t);
    return far * (1 - blend) + near * blend;
  }
}
