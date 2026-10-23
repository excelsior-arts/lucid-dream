interface FrameDriver {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}

/** Render on demand, or continuously while the scene reports visible motion. */
export class FrameLoop {
  readonly firstFrame: Promise<void>;
  private resolveFirst!: () => void;
  private rejectFirst!: (error: unknown) => void;
  private pending: number | null = null;
  private running = false;
  private dirty = false;
  private started = false;
  private visible = true;
  private disposed = false;
  private previousTime: number | null = null;
  private frames = 0;
  private interval = 1000 / 60;
  private nextTime: number | null = null;

  private draw: (dt: number) => Promise<boolean>;
  private driver: FrameDriver;

  constructor(
    draw: (dt: number) => Promise<boolean>,
    driver: FrameDriver = {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
    },
  ) {
    this.draw = draw;
    this.driver = driver;
    this.firstFrame = new Promise((resolve, reject) => {
      this.resolveFirst = resolve;
      this.rejectFirst = reject;
    });
  }

  start() {
    this.started = true;
    this.invalidate();
    return this.firstFrame;
  }

  invalidate = () => {
    if (this.disposed) return;
    this.dirty = true;
    this.schedule();
  };

  setMaxFps(fps: number) {
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('Frame rate must be positive.');
    this.interval = 1000 / Math.min(60, fps);
    this.nextTime = null;
  }

  resetClock() {
    this.nextTime = null;
    this.previousTime = null;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.resetClock();
    if (visible) this.invalidate();
    else this.cancel();
  }

  private schedule() {
    if (!this.started || !this.visible || this.disposed || this.running || this.pending !== null)
      return;
    this.pending = this.driver.request((time) => void this.tick(time));
  }

  private async tick(time: number) {
    this.pending = null;
    if (!this.visible || this.disposed) return;
    // Cheap RAF callbacks pace 120/144 Hz displays and the 30 fps fallback without GPU work.
    if (this.nextTime !== null && time < this.nextTime - 1) {
      this.schedule();
      return;
    }
    const late = Math.max(0, time - (this.nextTime ?? time));
    this.nextTime = time + this.interval - (late % this.interval);
    this.running = true;
    this.dirty = false;
    const dt = this.previousTime === null ? 0 : Math.max(0, (time - this.previousTime) / 1000);
    this.previousTime = time;
    let moving = false;
    try {
      moving = await this.draw(dt);
      this.frames++;
      this.resolveFirst();
    } catch (error) {
      if (this.frames === 0) this.rejectFirst(error);
      else console.error('Scene rendering failed.', error);
      this.dispose();
    } finally {
      this.running = false;
    }
    // An input arriving during an awaited water pass must get its own frame.
    if (moving || this.dirty) this.schedule();
    else this.resetClock();
  }

  inspect() {
    return {
      frames: this.frames,
      idle: !this.running && this.pending === null,
      visible: this.visible,
    };
  }

  private cancel() {
    if (this.pending !== null) this.driver.cancel(this.pending);
    this.pending = null;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.resetClock();
  }
}
