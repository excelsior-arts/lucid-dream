import type {Geography} from '../landscape';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / Math.max(0.0001, b - a));
  return t * t * (3 - 2 * t);
};
/** The shoreline the surf is heard from: where the water is at a z, the
    ground between here and it, and how wide the beach is. A Geography is one. */
export type Shore = Pick<Geography, 'coastX' | 'landHeight'> & {landscape: {beach: {width: number}}};

export const SURF_LOOP_SECONDS = 32;
const JOIN_SECONDS = 1;

/** Ear above the ground he stands on. */
export const EAR_HEIGHT = 1.6;
/** Metres of intervening ground, measured against the ear line, over which the
 * shore opens up. Cresting a dune is then a swell of a few seconds, not a switch. */
export const CREST_FADE = 2.5;
/** Inside the beach's width from the shoreline the surf is at its full level. */
export const surfFullAt = (shore: Shore) => shore.landscape.beach.width;
const PATH_STEP = 2;
const PATH_SAMPLES = 48;

/** Ground height in metres at a point on the map. */
export type Ground = (x: number, z: number) => number;
export type SurfListener = {x: number; z: number; ground?: Ground};
export type SurfExposure = {
  distance: number;
  approach: number;
  openness: number;
  proximity: number;
};

/**
 * Highest the ground between the listener and the water stands above his ear
 * line, in metres. Positive means a dune is in the way; negative means open
 * water. The path is the shortest one to the shore, straight down the beach
 * bearing, since the coast runs north to south.
 */
export function shoreRise(shore: Shore, x: number, z: number, ground: Ground = shore.landHeight) {
  const span = x - shore.coastX(z);
  if (!(span > 0)) return -EAR_HEIGHT;
  const ear = ground(x, z) + EAR_HEIGHT;
  const steps = Math.min(PATH_SAMPLES, Math.max(1, Math.ceil(span / PATH_STEP)));
  let rise = -Infinity;
  for (let i = 1; i <= steps; i++) rise = Math.max(rise, ground(x - (span * i) / steps, z) - ear);
  return rise;
}

/** 1 with the water in the open, 0 with a dune between him and it. */
export function surfOpenness(shore: Shore, x: number, z: number, ground: Ground = shore.landHeight) {
  return 1 - smooth(0, CREST_FADE, shoreRise(shore, x, z, ground));
}

/** Nothing at the reach, slow at first, steep near the water, full on the beach. */
export function surfApproach(distance: number, reach: number, fullAt: number) {
  if (!Number.isFinite(distance)) return 0;
  const span = Math.max(1, reach - fullAt);
  const near = Math.max(0, Math.min(1, (reach - Math.max(0, distance)) / span));
  return near * near;
}

/**
 * What the shore sounds like from where he stands: an approach curve gated by
 * the dune in front of it. Far inland the terrain is never sampled.
 */
export function surfExposure(
  shore: Shore,
  x: number,
  z: number,
  reach: number,
  ground: Ground = shore.landHeight,
): SurfExposure {
  const distance = Math.max(0, x - shore.coastX(z));
  const approach = surfApproach(distance, reach, surfFullAt(shore));
  if (approach <= 0) return {distance, approach: 0, openness: 0, proximity: 0};
  const openness = surfOpenness(shore, x, z, ground);
  return {distance, approach, openness, proximity: approach * openness};
}

const swell = (time: number, period: number, offset: number) => {
  const phase = ((time + offset) % period) / period;
  return smooth(0, 0.24, phase) * (1 - smooth(0.3, 1, phase));
};

/** Broad stereo breakers: rolling low water, a brighter break, then a long foam wash. */
export function surfSamples(sampleRate: number): [Float32Array, Float32Array] {
  const count = Math.ceil((SURF_LOOP_SECONDS + JOIN_SECONDS) * sampleRate);
  const channels: [Float32Array, Float32Array] = [new Float32Array(count), new Float32Array(count)];
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 90) / sampleRate);
  const bodyAlpha = 1 - Math.exp((-2 * Math.PI * 700) / sampleRate);
  const airAlpha = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = channels[channel]!;
    let seed = 731 + channel * 104729,
      low = 0,
      body = 0,
      air = 0,
      wash = 0,
      roll = 0;
    for (let i = 0; i < count; i++) {
      if (i % 128 === 0) {
        const time = i / sampleRate + channel * 0.22;
        const breaker = swell(time, 6.8, 1.6);
        const distant = swell(time, 9.7, 4.2);
        wash = 0.08 + 0.48 * breaker + 0.2 * distant;
        roll = 0.3 + 0.3 * swell(time, 6.8, 2.3);
      }
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      low += lowAlpha * (noise - low);
      body += bodyAlpha * (noise - body);
      air += airAlpha * (noise - air);
      samples[i] = low * roll + body * 0.25 + (air - body) * wash * 0.65;
    }
    // The tail becomes the first second, then loops into its next sample: no seam click.
    const join = Math.round(JOIN_SECONDS * sampleRate);
    const tail = Math.round(SURF_LOOP_SECONDS * sampleRate);
    for (let i = 0; i < join; i++) {
      const mix = smooth(0, join - 1, i);
      samples[tail + i] = samples[tail + i]! * (1 - mix) + samples[i]! * mix;
    }
  }
  return channels;
}

/** A dune keeps the break dull until he is over it; open water is unfiltered. */
const MUFFLED_HZ = 240;
const OPEN_HZ = 16000;

export class SurfPlayer {
  private source?: AudioBufferSourceNode;
  private tone: BiquadFilterNode;
  /** The swell of the approach, slow, and the author's level, immediate. */
  private swell: GainNode;
  private level: GainNode;
  private exposure: SurfExposure = {distance: Infinity, approach: 0, openness: 0, proximity: 0};
  private target = 0;

  private context: AudioContext;
  private readonly shore: Shore;

  constructor(context: AudioContext, destination: AudioNode, shore: Shore) {
    this.context = context;
    this.shore = shore;
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = MUFFLED_HZ;
    this.swell = context.createGain();
    this.swell.gain.value = 0;
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.tone.connect(this.swell).connect(this.level).connect(destination);
  }

  /** Thirty-three seconds of stereo breakers is three million samples. The shore
   * is only audible over the last stretch of the walk, so the loop is synthesised
   * the first time it can actually be heard, not while the page is still opening. */
  private ensureLoop() {
    if (this.source) return;
    const samples = surfSamples(this.context.sampleRate);
    const buffer = this.context.createBuffer(2, samples[0].length, this.context.sampleRate);
    samples.forEach((data, channel) => buffer.getChannelData(channel).set(data));
    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.loopStart = JOIN_SECONDS;
    this.source.loopEnd = SURF_LOOP_SECONDS + JOIN_SECONDS;
    this.source.connect(this.tone);
    this.source.start(0, JOIN_SECONDS);
  }

  update(listener: SurfListener | undefined, reach: number, gain: number, active: boolean) {
    this.exposure = listener
      ? surfExposure(this.shore, listener.x, listener.z, reach, listener.ground)
      : {distance: Infinity, approach: 0, openness: 0, proximity: 0};
    const proximity = active ? this.exposure.proximity : 0;
    this.target = proximity * gain;
    if (this.target > 0) this.ensureLoop();
    const t = this.context.currentTime;
    this.swell.gain.setTargetAtTime(proximity, t, 0.28);
    // The level is the author's hand on the fader: it must be heard at once.
    this.level.gain.setTargetAtTime(gain, t, 0.04);
    this.tone.frequency.setTargetAtTime(
      MUFFLED_HZ * Math.pow(OPEN_HZ / MUFFLED_HZ, this.exposure.openness),
      t,
      0.3,
    );
  }

  pause() {
    this.target = 0;
    this.swell.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
  }

  get state() {
    return {
      proximity: this.exposure.proximity,
      openness: this.exposure.openness,
      approach: this.exposure.approach,
      distance: this.exposure.distance,
      target: this.target,
      gain: this.swell.gain.value * this.level.gain.value,
    };
  }

  dispose() {
    this.source?.stop();
    this.source?.disconnect();
    this.tone.disconnect();
    this.swell.disconnect();
    this.level.disconnect();
  }
}
