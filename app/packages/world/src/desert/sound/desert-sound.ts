/* What the desert sounds like: wind, surf, footsteps, and a song.
 *
 * This is the half of Burning Man's Soundscape that is the desert's. The wind
 * is filtered noise in gusts read off the piece's own clock; the surf is the
 * SurfPlayer next door, placed by where the listener stands against the
 * shore; a footstep is a burst of the same noise, panned to the foot; the
 * song is a media element playing straight to the output. What is not here
 * is anything a figure brings with it -- Burning Man's heartbeat and fire --
 * and those arrive as layers: handed the context and the master when the
 * sound is unlocked, paused and disposed with it, and free to ask for a burst.
 *
 * The levels come in as a Mix each frame rather than as a score, so a trip
 * without a score has somewhere to put its numbers.
 */
import {SurfPlayer, type SurfListener} from './surf';
import type {Footfalls} from '../sand/contacts';
import type {Geography} from '../landscape';

/** The clock the sound follows. */
export interface Transport {
  time: number;
  started: boolean;
  playing: boolean;
  rate: number;
  visible: boolean;
}

/** How loud each part is, 0 to 1, and how far the surf carries. */
export interface Mix {
  ambience: number;
  surf: number;
  surfRange: number;
  steps: number;
  music: number;
  /** What a full stride is walked at, metres a second: a step slower than
      that is a quieter step. */
  pace: number;
}

/** Something a trip adds to the desert's sound. */
export interface SoundLayer {
  /** The graph exists: build into it. Called once, on unlock, or at once if
      the sound is already unlocked when the layer is added. */
  attach(context: AudioContext, master: GainNode, noise: AudioBuffer): void;
  pause?(): void;
  dispose?(): void;
}

export const QUIET: Mix = {ambience: 0, surf: 0, surfRange: 0, steps: 0, music: 0, pace: 1};

export class DesertSound {
  private context?: AudioContext;
  private surf?: SurfPlayer;
  private mix: Mix = QUIET;
  private transport: Transport = {
    time: 0,
    started: false,
    playing: false,
    rate: 1,
    visible: true,
  };
  onStateChange?: () => void;
  private master?: GainNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  /** iOS keeps the media volume in the user's hands: the property reads 1
   * whatever is written to it. Found once, the first time a level is set. */
  private volumeSettable?: boolean;
  private noise?: AudioBuffer;
  private nodes: AudioScheduledSourceNode[] = [];
  private media = new Audio();
  private objectUrl?: string;
  private musicNeedsSeek = true;
  private distance = 0;
  private footfalls = 0;
  private readonly gait: Footfalls;
  private readonly geo: Geography;
  private readonly layers: SoundLayer[] = [];
  muted = false;
  /** The listener's volume, 1 being the mix as authored, and their hush. Set
   * by whatever the trip is shown in; distinct from `muted`, which is the
   * piece's own switch. */
  private gain = 1;
  private hushed = false;
  /** Asked for a fresh address when the one in hand will not play. */
  onSourceFailed?: () => void;
  private sourceFailures = 0;
  status = 'Desert sound ready · no music selected';

  constructor(geo: Geography, gait: Footfalls) {
    this.geo = geo;
    this.gait = gait;
    this.media.preload = 'auto';
    // The song plays straight from the element to the output, never through the
    // graph. On iOS a media element feeding a MediaElementAudioSourceNode is a
    // tap off AVFoundation into a one-second ring buffer that the graph's render
    // thread must keep draining: whatever the graph misses under load, the song
    // falls behind by, and once a second is owed it is snapped forward to the
    // present, which is heard as the song rushing. The element on its own has no
    // such consumer to fall behind.
    this.media.crossOrigin = 'anonymous';
    this.media.addEventListener('error', () => {
      this.status = 'Music could not load. Desert sound remains available.';
      // The address the song is fetched from is signed and does not live for
      // ever. Left paused past its life and then resumed, the element is handed
      // a refusal rather than the song, so a fresh address is asked for instead
      // of the piece simply going quiet. Bounded, since a signer that is down
      // would otherwise be asked for ever; a track that plays clears the count.
      if (this.media.hasAttribute('src') && this.sourceFailures < 3) {
        this.sourceFailures++;
        this.onSourceFailed?.();
      }
    });
    this.media.addEventListener('canplay', () => {
      this.sourceFailures = 0;
    });
  }

  /** Add a layer. Attached now if the graph is up, or when it comes up. */
  add(layer: SoundLayer) {
    this.layers.push(layer);
    if (this.context && this.master && this.noise) layer.attach(this.context, this.master, this.noise);
  }

  /** Try autoplay immediately; a blocked browser can resume this same context on any gesture. */
  arm(mix: Mix) {
    this.mix = mix;
    this.transport.visible = !document.hidden;
    void this.unlock().catch(() => this.onStateChange?.());
  }
  follow(transport: Transport, mix: Mix) {
    this.transport = {...transport};
    this.mix = mix;
    this.waiting();
  }
  /** The desert is there before he is. Nothing draws while the piece waits to be
   * started, so the frame loop sleeps and the running mix is never asked for;
   * the wind is therefore set once and left to the graph, where the filter's own
   * slow sweep keeps it moving for nothing. The piece takes the level back the
   * moment it begins. */
  private waiting() {
    if (!this.context || !this.windGain || this.transport.started) return;
    this.windGain.gain.setTargetAtTime(this.lobbyWind(), this.context.currentTime, 0.9);
  }
  /** What the desert sounds like with nobody in it. */
  private lobbyWind() {
    return this.transport.visible && !this.silent() && !this.transport.started
      ? this.mix.ambience * 0.26
      : 0;
  }
  async unlock() {
    if (!this.context) {
      const ctx = (this.context = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = this.out();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 8;
      this.master.connect(limiter).connect(ctx.destination);
      this.surf = new SurfPlayer(ctx, this.master, this.geo);
      ctx.onstatechange = () => this.onStateChange?.();
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + 0.025 * (Math.random() * 2 - 1)) / 1.025;
        data[i] = last * 3;
      }
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = (this.windFilter = ctx.createBiquadFilter());
      filter.type = 'lowpass';
      filter.frequency.value = 620;
      const wind = (this.windGain = ctx.createGain());
      wind.gain.value = 0;
      source.connect(filter).connect(wind).connect(this.master);
      source.start();
      this.nodes.push(source);
      const lfo = ctx.createOscillator(),
        depth = ctx.createGain();
      lfo.frequency.value = 0.055;
      depth.gain.value = 90;
      lfo.connect(depth).connect(filter.frequency);
      lfo.start();
      this.nodes.push(lfo);
      for (const layer of this.layers) layer.attach(ctx, this.master, this.noise);
    }
    this.onStateChange?.();
    await this.context.resume();
    this.waiting();
    this.onStateChange?.();
  }
  setTrack(url: string) {
    this.musicNeedsSeek = true;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = undefined;
    }
    this.media.pause();
    if (url) {
      this.media.crossOrigin = 'anonymous';
      // Previews and tests pass blob and data URLs; a score passes a bare path.
      this.media.src = /^[a-z][\w+.-]*:/i.test(url) ? url : new URL(url, document.baseURI).href;
      this.status = 'Music selected';
    } else {
      this.media.removeAttribute('src');
      this.media.load();
      this.status = 'Desert sound only';
    }
  }
  setFile(file: File) {
    this.setTrack('');
    this.objectUrl = URL.createObjectURL(file);
    this.media.src = this.objectUrl;
    this.status = `Preview: ${file.name}`;
  }
  toggleMute() {
    this.muted = !this.muted;
    this.settle();
    this.onStateChange?.();
  }
  /** The listener's volume and hush. The song follows where the element takes
   * a volume; where it does not (iOS), the hush still silences it. */
  hear(gain: number, hushed: boolean) {
    this.gain = Math.max(0, Math.min(1.6, gain));
    this.hushed = hushed;
    this.settle();
    this.setMusicLevel(this.mix.music * 0.65 * this.gain);
  }
  private silent() {
    return this.muted || this.hushed;
  }
  /** The master's level: the bed, scaled by the listener, or nothing. */
  private out() {
    return this.silent() ? 0 : this.bed() * this.gain;
  }
  private settle() {
    this.media.muted = this.silent();
    this.waiting();
    if (this.context) this.master?.gain.setTargetAtTime(this.out(), this.context.currentTime, 0.025);
  }
  /** The song's level, and whether the element will take one at all. */
  private setMusicLevel(level: number) {
    const wanted = Math.max(0, Math.min(1, level));
    if (this.volumeSettable === undefined) {
      this.media.volume = 0.5;
      this.volumeSettable = this.media.volume === 0.5;
    }
    if (this.volumeSettable && this.media.volume !== wanted) this.media.volume = wanted;
  }
  /** Master level for everything but the song. The song used to pass through
   * this same 0.65; where the element takes a volume it still does, and where it
   * will not, the bed comes up to meet the song's own level instead, so the
   * balance the piece was mixed at survives on both. */
  private bed() {
    return this.volumeSettable === false ? 1 : 0.65;
  }
  /** Reposition only for transport edits. Safari's media clock can trail the
   * score by its output latency; repeatedly "fixing" that delay interrupts audio.
   */
  async sync(time: number, playing: boolean, rate: number, seek = false) {
    if (seek) this.musicNeedsSeek = true;
    if (!this.context) return;
    const playbackRate = Math.max(0.25, Math.min(3, rate));
    if (this.media.playbackRate !== playbackRate) this.media.playbackRate = playbackRate;
    if (!playing) this.media.pause();
    // A song that stopped on its own, on a stalled frame or when the phone took
    // the audio session away, keeps its place: the picture comes back to it,
    // because a seek is the one thing here that is actually audible. Only a
    // transport edit or a new source repositions it, and both say so.
    if (this.musicNeedsSeek) {
      // And never from the wrong place. After a spell in the background iOS can
      // hand the element back with nothing buffered, and playing before the
      // seek lands starts the song from the top. Wait; this runs every frame.
      if (this.media.readyState === 0) return;
      const target = Math.max(
        0,
        Math.min(time, Number.isFinite(this.media.duration) ? this.media.duration : time),
      );
      if (Math.abs(this.media.currentTime - target) > 0.01) this.media.currentTime = target;
      this.musicNeedsSeek = false;
    }
    if (playing && this.media.hasAttribute('src') && this.media.paused && !this.media.ended) {
      try {
        await this.media.play();
      } catch (error) {
        // Pause, seek and source replacement may intentionally cancel a pending play.
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          this.status = 'Press Resume to enable music playback.';
      }
    }
  }

  /** Nought to one, and never the same twice inside three minutes. */
  private gust(time: number) {
    const swell =
      Math.sin(time * 0.081) * 0.5 +
      Math.sin(time * 0.143 + 1.7) * 0.3 +
      Math.sin(time * 0.29 + 4.1) * 0.14 +
      Math.sin(time * 0.53 + 2.3) * 0.06;
    return Math.max(0, Math.min(1, 0.5 + swell * 0.5));
  }

  /** The desert's own part of a frame. A trip's layers take their turn after. */
  update(
    dt: number,
    time: number,
    distance: number,
    walking: boolean,
    playing: boolean,
    mix: Mix,
    listener?: SurfListener,
    landings?: readonly number[],
  ) {
    const fromDistance = this.distance;
    this.distance = distance;
    this.mix = mix;
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.surf!.update(listener, mix.surfRange, mix.surf, playing);
    this.setMusicLevel(mix.music * 0.65 * this.gain);
    this.master.gain.setTargetAtTime(this.out(), t, 0.045);
    // Wind is gusts rather than a level, and a gust is heard as much in the
    // brightness as in the loudness, because moving air hisses. One envelope
    // drives both. Its waves have unrelated periods, so it does not repeat
    // inside the piece, and it is read off the score's own clock, so a scrub
    // lands on the same gust it left.
    const gust = this.gust(time);
    // A frame drawn before he is started must not silence the desert: the piece
    // hands the wind back to the lobby rather than to nothing.
    this.windGain!.gain.setTargetAtTime(
      playing ? mix.ambience * 0.32 * (0.45 + gust * 1.05) : this.lobbyWind(),
      t,
      playing ? 0.35 : 0.9,
    );
    this.windFilter?.frequency.setTargetAtTime(430 + gust * 520, t, 0.5);
    if (playing && landings) {
      for (const foot of landings) this.footstep(foot === 0 ? -0.24 : 0.24, 0.65, mix);
    } else if (playing && walking && distance >= fromDistance) {
      // A tentative step is a quiet step. Footfalls are the only pulse in the
      // mix, so a cadence gathering after a fall was heard as the music itself
      // changing tempo. Weighting each step by how much of his stride he is
      // actually using leaves the gathering to the body rather than the beat.
      const stride = dt > 0 ? (distance - fromDistance) / dt / Math.max(0.1, mix.pace) : 1;
      const weight = Math.min(1, Math.max(0, stride)) ** 1.3;
      const {stepCount, contacts} = this.gait;
      for (let step = stepCount(fromDistance); step < stepCount(distance); step++) {
        const pan = contacts[step % 2]!.foot === 'left' ? -0.24 : 0.24;
        this.footstep(pan, weight, mix);
      }
    }
  }
  private footstep(pan: number, weight: number, mix: Mix) {
    this.footfalls++;
    this.burst(mix.steps * 0.55 * weight, 0.16, 650, pan);
    this.burst(mix.steps * 0.12 * weight, 0.055, 160, pan);
  }
  /** A short filtered puff of the desert's noise: a footstep, a crackle. */
  burst(volume: number, duration: number, frequency: number, pan: number) {
    if (!this.context || !this.noise || !this.master) return;
    const c = this.context,
      source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain(),
      panner = c.createStereoPanner();
    source.buffer = this.noise;
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.6;
    panner.pan.value = pan;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(c.currentTime, Math.random() * 5, duration + 0.02);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
  }
  pause() {
    this.musicNeedsSeek = true;
    this.media.pause();
    this.surf?.pause();
    if (this.context) this.windGain?.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
    for (const layer of this.layers) layer.pause?.();
  }
  /** The clock as last followed, for a layer that keeps its own time. */
  get clock(): Readonly<Transport> {
    return this.transport;
  }
  get state() {
    return {
      unlocked: this.context?.state === 'running',
      surf: this.surf?.state,
      footfalls: this.footfalls,
      windGain: this.windGain?.gain.value ?? 0,
      context: this.context?.state,
      muted: this.muted,
      hushed: this.hushed,
      gain: this.gain,
      musicVolume: this.media.volume,
      musicMuted: this.media.muted,
      musicTime: this.media.currentTime,
      musicPlaying: !this.media.paused,
      status: this.status,
    };
  }
  dispose() {
    this.media.pause();
    for (const layer of this.layers) layer.dispose?.();
    this.surf?.dispose();
    for (const n of this.nodes) n.stop();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    void this.context?.close();
  }
}
