import {holdAt} from '@lucid/world/desert';
import type {Score} from '../experience/score';
import {heartbeatSamples, vitalCue, vitalEvents, type VitalEvent} from './vitals';

export interface VitalTransport {
  time: number;
  started: boolean;
  playing: boolean;
  rate: number;
  visible: boolean;
}

/** The audio clock schedules ahead, so a slow graphics frame cannot chop up a thud. */
export class VitalPlayer {
  private heart: AudioBuffer;
  private pitch: number;
  private previewOutput: GainNode;
  private previewVoices = new Map<AudioBufferSourceNode, GainNode>();
  private previewUntil = 0;
  private previewPitch: number | null = null;
  private output: GainNode;
  private voices = new Map<AudioBufferSourceNode, GainNode>();
  private timer: ReturnType<typeof setInterval>;
  private transport: VitalTransport = {
    time: 0,
    started: false,
    playing: false,
    rate: 1,
    visible: true,
  };
  private anchor = 0;
  private lobbyAt = 0;
  private cursor = 0;
  private nextHeart = 0;
  private events: VitalEvent[] = [];
  private score: Score;
  private signature = '';
  private heartbeats = 0;
  private active = false;

  private context: AudioContext;

  constructor(context: AudioContext, destination: AudioNode, score: Score) {
    this.context = context;
    this.score = score;
    this.output = context.createGain();
    this.output.connect(destination);
    this.pitch = score.heartbeatPitch;
    this.heart = this.buffer(heartbeatSamples(context.sampleRate, this.pitch));
    this.previewOutput = context.createGain();
    this.previewOutput.connect(destination);
    this.lobbyAt = context.currentTime;
    this.timer = setInterval(() => this.tick(), 25);
    this.follow(this.transport, score);
  }

  private buffer(samples: Float32Array) {
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  follow(transport: VitalTransport, score: Score) {
    const now = this.context.currentTime;
    if (!transport.visible) this.stopPreview();
    if (score.heartbeatPitch !== this.pitch) {
      this.pitch = score.heartbeatPitch;
      this.heart = this.buffer(heartbeatSamples(this.context.sampleRate, this.pitch));
    }
    const signature = [
      score.duration,
      score.heartbeatSlowAt,
      score.heartbeatStopBeforeEnd,
      score.stage_08_kneel,
      score.heartbeatGain,
      score.heartbeatBpm,
    ].join(':');
    const active = transport.visible && (!transport.started || transport.playing);
    const expected =
      this.transport.time +
      (this.transport.playing ? (now - this.anchor) * this.transport.rate : 0);
    const reset =
      signature !== this.signature ||
      active !== this.active ||
      transport.started !== this.transport.started ||
      transport.rate !== this.transport.rate ||
      Math.abs(transport.time - expected) > 0.18;
    if (signature !== this.signature) {
      this.events = vitalEvents(score);
      this.signature = signature;
    }
    this.score = score;
    this.transport = {...transport};
    this.anchor = now;
    this.active = active;
    if (reset) {
      this.cancel();
      this.cursor = this.events.findIndex((e) => e.time + e.duration > transport.time);
      if (this.cursor < 0) this.cursor = this.events.length;
      this.lobbyAt = now;
      this.nextHeart = 0;
    }
    this.output.gain.setTargetAtTime(active && !this.previewUntil ? 1 : 0, now, 0.012);
    this.tick();
  }

  private tick() {
    if (this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.previewUntil && now >= this.previewUntil) this.stopPreview();
    if (!this.active) return;
    if (!this.transport.started) {
      const time = now - this.lobbyAt;
      if (this.nextHeart < time - 0.3) this.nextHeart = time;
      while (this.nextHeart < time + 0.16) {
        this.play(
          {kind: 'heart', time: this.nextHeart, duration: 0.52, strength: 1},
          this.lobbyAt,
          1,
        );
        this.nextHeart += 60 / this.score.heartbeatBpm;
      }
      return;
    }
    const rate = this.transport.rate;
    const origin = this.anchor - this.transport.time / rate;
    const time = (now - origin) * rate;
    while (
      this.cursor < this.events.length &&
      this.events[this.cursor]!.time < time + 0.16 * rate
    ) {
      const event = this.events[this.cursor++]!;
      if (event.time + event.duration > time) this.play(event, origin, rate);
    }
  }

  private play(event: VitalEvent, origin: number, rate: number) {
    const now = this.context.currentTime;
    const at = origin + event.time / rate;
    const offset = Math.max(0, now - at);
    const untilStop = this.transport.started
      ? (vitalCue(0, this.score).stopAt - event.time) / rate
      : Infinity;
    const duration = Math.min(this.heart.duration, untilStop);
    if (offset >= duration) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.heart;
    // Pace follows the transport; heart timbre retains its pitch even in a fast rehearsal.
    source.playbackRate.value = 1;
    const available = Math.min(
      duration - offset,
      (source.buffer.duration - offset * source.playbackRate.value) / source.playbackRate.value,
    );
    if (available <= 0) return;
    const start = Math.max(now, at);
    const level = event.strength * this.score.heartbeatGain;
    gain.gain.setValueAtTime(offset > 0.005 ? 0 : level, start);
    if (offset > 0.005)
      gain.gain.linearRampToValueAtTime(level, start + Math.min(0.012, available / 3));
    gain.gain.setValueAtTime(level, start + Math.max(0, available - 0.025));
    gain.gain.linearRampToValueAtTime(0, start + available);
    source.connect(gain).connect(this.output);
    source.start(start, offset * source.playbackRate.value);
    source.stop(start + available);
    this.voices.set(source, gain);
    this.heartbeats++;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(source);
    };
  }

  /** Four evenly spaced beats, independent of the film and its exhaustion cues. */
  preview(pitch: number, gain: number) {
    this.stopPreview();
    const now = this.context.currentTime;
    const buffer = this.buffer(heartbeatSamples(this.context.sampleRate, pitch));
    this.previewPitch = pitch;
    const beat = 60 / this.score.heartbeatBpm;
    this.previewUntil = now + 0.025 + 3 * beat + buffer.duration;
    this.output.gain.setTargetAtTime(0, now, 0.012);
    for (let i = 0; i < 4; i++) {
      const source = this.context.createBufferSource();
      const level = this.context.createGain();
      const at = now + 0.025 + i * beat;
      source.buffer = buffer;
      level.gain.setValueAtTime(gain, at);
      source.connect(level).connect(this.previewOutput);
      source.start(at);
      this.previewVoices.set(source, level);
      source.onended = () => {
        source.disconnect();
        level.disconnect();
        this.previewVoices.delete(source);
      };
    }
  }

  stopPreview() {
    if (!this.previewUntil) return;
    const now = this.context.currentTime;
    for (const [source, gain] of this.previewVoices) {
      holdAt(gain.gain, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.015);
      source.stop(now + 0.015);
    }
    this.previewVoices.clear();
    this.previewUntil = 0;
    this.previewPitch = null;
    this.output.gain.setTargetAtTime(this.active ? 1 : 0, now, 0.012);
  }

  private cancel() {
    const now = this.context.currentTime;
    for (const [source, gain] of this.voices) {
      holdAt(gain.gain, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.015);
      source.stop(now + 0.015);
    }
    this.voices.clear();
  }

  get state() {
    const cue = vitalCue(this.transport.started ? this.transport.time : 0, this.score);
    return {
      ...cue,
      active: this.active,
      mode: this.transport.started ? 'score' : 'opening',
      heartbeats: this.heartbeats,
      voices: this.voices.size,
      pitch: this.pitch,
      previewPitch: this.previewPitch,
      previewVoices: this.previewVoices.size,
    };
  }

  dispose() {
    clearInterval(this.timer);
    this.stopPreview();
    this.cancel();
    this.output.disconnect();
    this.previewOutput.disconnect();
  }
}
