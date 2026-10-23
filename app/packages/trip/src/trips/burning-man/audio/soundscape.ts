/* What Burning Man sounds like: the desert, and him in it.
 *
 * The desert -- wind, surf, footsteps, the song -- is the platform's
 * DesertSound. What he brings is two layers on it: the heartbeat, which the
 * VitalPlayer plays off the score, and the fire, a band of the same noise
 * that rises with the burn and crackles now and then. The levels the desert
 * mixes at are read off the score each frame, so the piece goes on handing
 * this the score and nothing in experience/piece.ts had to learn the split.
 */
import {DesertSound} from '@lucid/world/desert';
import type {Mix, SoundLayer, SurfListener, Transport} from '@lucid/world/desert';
import {DEFAULT_SCORE, pace, type Score} from '../experience/score';
import {VitalPlayer} from './vital-player';
import {WALK_FOOTFALLS} from '../character/walk-gait';
import {geo} from '../landscape';

export type {Transport as VitalTransport};

/** The desert's levels, as the score has them. */
const mixOf = (s: Score): Mix => ({
  ambience: s.ambienceGain,
  surf: s.surfGain,
  surfRange: s.surfRange,
  steps: s.stepsGain,
  music: s.musicGain,
  pace: pace(s),
});

/** His heart, on the score's clock. */
class Heartbeat implements SoundLayer {
  private player?: VitalPlayer;
  private previewRequest = 0;
  private score: Score;
  private transport: Transport;
  constructor(score: Score, transport: Transport) {
    this.score = score;
    this.transport = transport;
  }
  attach(context: AudioContext, master: GainNode) {
    this.player = new VitalPlayer(context, master, this.score);
    this.player.follow(this.transport, this.score);
  }
  follow(transport: Transport, score: Score) {
    this.transport = transport;
    this.score = score;
    if (!transport.visible) this.stopPreview();
    this.player?.follow(transport, score);
  }
  preview(pitch: number, gain: number) {
    this.player?.preview(pitch, gain);
  }
  nextPreview() {
    return ++this.previewRequest;
  }
  isPreview(request: number) {
    return request === this.previewRequest;
  }
  stopPreview() {
    this.previewRequest++;
    this.player?.stopPreview();
  }
  get state() {
    return this.player?.state;
  }
  dispose() {
    this.stopPreview();
    this.player?.dispose();
  }
}

/** The fire: a bright band of the desert's noise, and the odd crackle. */
class Fire implements SoundLayer {
  private gain?: GainNode;
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private crackle = 0;
  attach(context: AudioContext, master: GainNode, noise: AudioBuffer) {
    this.context = context;
    const fire = context.createBufferSource();
    fire.buffer = noise;
    fire.loop = true;
    const high = context.createBiquadFilter();
    high.type = 'bandpass';
    high.frequency.value = 1300;
    high.Q.value = 0.45;
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    fire.connect(high).connect(this.gain).connect(master);
    fire.start();
    this.source = fire;
  }
  /** Each frame: the band follows the burn, and a crackle lands now and then. */
  update(dt: number, burn: number, playing: boolean, s: Score, burst: DesertSound['burst']) {
    if (!this.context || !this.gain) return;
    this.gain.gain.setTargetAtTime(playing ? burn * s.fireGain * 0.22 : 0, this.context.currentTime, 0.1);
    this.crackle += playing ? dt * burn : 0;
    if (this.crackle > 0.13) {
      this.crackle = 0;
      if (Math.random() < 0.5)
        burst(s.fireGain * 0.13, 0.025, 2000, (Math.random() - 0.5) * 0.5);
    }
  }
  pause() {
    if (this.context) this.gain?.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
  }
  dispose() {
    this.source?.stop();
  }
}

/** Filtered-noise wind and footsteps, the surf and the song, and his heart and his fire. */
export class Soundscape {
  private readonly desert = new DesertSound(geo, WALK_FOOTFALLS);
  private score = DEFAULT_SCORE;
  private transport: Transport = {time: 0, started: false, playing: false, rate: 1, visible: true};
  private readonly heart = new Heartbeat(this.score, this.transport);
  private readonly fire = new Fire();

  constructor() {
    this.desert.add(this.heart);
    this.desert.add(this.fire);
  }

  set onStateChange(fn: (() => void) | undefined) {
    this.desert.onStateChange = fn;
  }
  get onStateChange() {
    return this.desert.onStateChange;
  }
  set onSourceFailed(fn: (() => void) | undefined) {
    this.desert.onSourceFailed = fn;
  }
  get onSourceFailed() {
    return this.desert.onSourceFailed;
  }
  get muted() {
    return this.desert.muted;
  }
  get status() {
    return this.desert.status;
  }

  /** Try autoplay immediately; a blocked browser can resume this same context on any gesture. */
  arm(score: Score) {
    this.score = score;
    this.desert.arm(mixOf(score));
  }
  follow(transport: Transport, score: Score) {
    this.transport = {...transport};
    this.score = score;
    this.heart.follow(this.transport, score);
    this.desert.follow(transport, mixOf(score));
  }
  unlock() {
    return this.desert.unlock();
  }
  setTrack(url: string) {
    this.desert.setTrack(url);
  }
  setFile(file: File) {
    this.desert.setFile(file);
  }
  async previewHeartbeat(pitch: number) {
    const request = this.heart.nextPreview();
    await this.unlock();
    if (this.heart.isPreview(request) && this.transport.visible)
      this.heart.preview(Math.max(28, Math.min(65, pitch)), this.score.heartbeatGain);
  }
  stopHeartbeatPreview() {
    this.heart.stopPreview();
  }
  toggleMute() {
    this.desert.toggleMute();
  }
  /** The listener's volume and hush, from the page. */
  hear(gain: number, hushed: boolean) {
    this.desert.hear(gain, hushed);
  }
  sync(time: number, playing: boolean, rate: number, seek = false) {
    return this.desert.sync(time, playing, rate, seek);
  }
  update(
    dt: number,
    time: number,
    distance: number,
    walking: boolean,
    burn: number,
    playing: boolean,
    s: Score,
    listener?: SurfListener,
    landings?: readonly number[],
  ) {
    this.desert.update(dt, time, distance, walking, playing, mixOf(s), listener, landings);
    this.fire.update(dt, burn, playing, s, (v, d, f, p) => this.desert.burst(v, d, f, p));
  }
  pause() {
    this.desert.pause();
  }
  get state() {
    return {...this.desert.state, vitals: this.heart.state};
  }
  dispose() {
    this.desert.dispose();
  }
}
