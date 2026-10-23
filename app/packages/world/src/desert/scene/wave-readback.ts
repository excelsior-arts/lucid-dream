import type {WaterSystem} from 'threejs-water-pro';

type Sampler = ReturnType<WaterSystem['buoyancy']['getSampler']>;
type Positions = Parameters<Sampler['setPositions']>[0];

/** The water owns the sampler. This adapter keeps its GPU readback off the frame path. */
export class WaveReadback implements Sampler {
  private positions: Positions = [];
  private pending: Promise<void> | null = null;
  private failure: unknown;
  private disposed = false;

  private source: Sampler;

  constructor(source: Sampler) {
    this.source = source;
  }

  setPositions(positions: Positions) {
    // The source copies these into its input buffer when a query starts. Never
    // overwrite that buffer while its previous query is still in flight.
    this.positions = positions;
  }

  async updateLowLatency() {
    if (this.disposed) return;
    if (this.failure) throw this.failure;
    if (!this.pending) this.launch(this.positions);
    // Buoyancy reads the last completed sample. A late GPU result must not
    // freeze unrelated character animation, particles or camera movement.
  }

  /** Explicit height queries still wait for a fresh result at their requested position. */
  async update() {
    const positions = this.positions.map((point) => point.clone()) as Positions;
    while (this.pending) await this.pending;
    if (this.disposed) return;
    if (this.failure) throw this.failure;
    this.launch(positions);
    await this.drain();
  }

  private launch(positions: Positions) {
    this.source.setPositions(positions);
    this.pending = this.source
      .update()
      .catch((error: unknown) => {
        if (!this.disposed) this.failure = error;
      })
      .finally(() => {
        this.pending = null;
      });
  }

  /** Resource rebuilds must finish the readback before replacing GPU buffers. */
  async drain() {
    await this.pending;
    if (this.failure) throw this.failure;
  }

  getSample(index: number) {
    return this.source.getSample(index);
  }

  getSamples() {
    return this.source.getSamples();
  }

  getSampleCount() {
    return this.source.getSampleCount();
  }

  updateCascadeUniforms() {
    this.source.updateCascadeUniforms();
  }

  dispose() {
    // WaterSystem owns/disposes the source, including during quality changes.
    this.disposed = true;
  }
}
