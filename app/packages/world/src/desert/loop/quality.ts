export type QualityTier = 'high' | 'balanced' | 'low';
export type QualityMode = 'auto' | QualityTier;

/**
 * The middle budget is a cadence step, not a picture step. Measured on this
 * Mac, a third fewer pixels and a third of the body's triangles bought about a
 * twelfth of the frame's cost, while halving the frame rate halved it: the
 * per-frame passes, uploads and submissions dominate, not the pixels. So
 * Balanced keeps every one of High's pixels, its full body and its water, and
 * draws them thirty times a second. Low remains the genuinely overloaded case,
 * where the picture itself has to give.
 */
export const QUALITY = {
  high: {
    pixelRatio: 1.5,
    pixels: 3_200_000,
    bloom: 0.5,
    water: 'medium',
    body: 'high',
    sunShadow: 4096,
    moonShadow: 4096,
    fps: 60,
  },
  balanced: {
    pixelRatio: 1.5,
    pixels: 3_200_000,
    bloom: 0.5,
    water: 'medium',
    body: 'high',
    sunShadow: 4096,
    moonShadow: 4096,
    fps: 30,
  },
  low: {
    water: 'low',
    pixelRatio: 1,
    pixels: 950_000,
    bloom: 0.25,
    body: 'low',
    sunShadow: 2048,
    moonShadow: 1024,
    fps: 30,
  },
} as const;

export function qualityMode(value: unknown): QualityMode {
  return value === 'high' || value === 'balanced' || value === 'low' ? value : 'auto';
}

/** Bound total pixels as well as density: a large Retina display must not dominate cost. */
export function renderPixelRatio(
  width: number,
  height: number,
  deviceRatio: number,
  tier: QualityTier,
  scale = 1,
) {
  const profile = QUALITY[tier];
  return Math.max(
    0.1,
    Math.min(
      deviceRatio,
      profile.pixelRatio,
      Math.sqrt(profile.pixels / Math.max(1, width * height)),
    ) * scale,
  );
}

/** Frame cadence, not a hardware name or a CPU-core guess, controls fallback. */
export class AdaptiveQuality {
  mode: QualityMode;
  tier: QualityTier;
  scale = 1;
  reason: string;
  private samples: number[] = [];
  private elapsed = 0;
  private warmup = 2;
  private slowWindows = 0;
  private measuredFps = 0;
  private slowFraction = 0;
  private changes = 0;
  private longFrames = 0;
  /** The cadence actually in force. The finished piece runs slower on purpose,
   * and a frame that is late only against a rate nobody is asking for is not a
   * sign of an overloaded machine. */
  private capFps = 0;

  private webgpu: boolean;

  constructor(mode: unknown = 'auto', webgpu = true) {
    this.webgpu = webgpu;
    this.mode = qualityMode(mode);
    this.tier = this.mode === 'auto' ? (webgpu ? 'balanced' : 'low') : this.mode;
    this.reason =
      this.mode === 'auto'
        ? webgpu
          ? 'Balanced starting budget'
          : 'WebGL compatibility budget'
        : 'Manual quality';
  }

  select(mode: unknown) {
    this.mode = qualityMode(mode);
    this.tier = this.mode === 'auto' ? (this.webgpu ? 'balanced' : 'low') : this.mode;
    this.scale = 1;
    this.reason = this.mode === 'auto' ? 'Automatic budget restarted' : 'Manual quality';
    this.resetSampling();
  }

  /** Judge frames against the rate being asked for, not the budget's own. */
  setCap(fps: number) {
    if (fps === this.capFps) return;
    this.capFps = fps;
    this.resetSampling();
  }

  /** Exclude loading, a seek, tab restoration and resize from sustained-load decisions. */
  resetSampling() {
    this.longFrames = 0;
    this.samples = [];
    this.elapsed = 0;
    this.warmup = 2;
    this.slowWindows = 0;
    this.measuredFps = 0;
    this.slowFraction = 0;
  }

  observe(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    if (dt > 0.5 && this.longFrames === 0) {
      this.resetSampling();
      this.longFrames = 1;
      return false;
    }
    // One long task is a hitch; consecutive long frames are an overloaded device.
    this.longFrames = dt > 0.5 ? this.longFrames + 1 : 0;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return false;
    }
    this.samples.push(dt);
    this.elapsed += dt;
    if (this.elapsed < 3) return false;
    const budget = 1 / Math.min(QUALITY[this.tier].fps, this.capFps || Infinity);
    this.measuredFps = this.samples.length / this.elapsed;
    this.slowFraction =
      this.samples.filter((time) => time > budget * 1.4).length / this.samples.length;
    this.samples = [];
    this.elapsed = 0;
    this.slowWindows = this.slowFraction > 0.2 ? this.slowWindows + 1 : 0;
    if (this.mode !== 'auto' || this.slowWindows < 2) return false;
    // Only step down during a take. Automatic upgrades can repeatedly overload a marginal GPU.
    if (this.tier === 'balanced') this.tier = 'low';
    else if (this.scale > 0.75) this.scale = 0.75;
    else return false;
    this.reason =
      this.scale < 1 ? 'Persistent load: reduced Low resolution' : 'Persistent load: 30 fps budget';
    this.changes++;
    this.resetSampling();
    return true;
  }

  inspect() {
    return {
      mode: this.mode,
      tier: this.tier,
      scale: this.scale,
      targetFps: QUALITY[this.tier].fps,
      fps: this.measuredFps,
      slowFraction: this.slowFraction,
      changes: this.changes,
      reason: this.reason,
    };
  }
}
