/* The sounds matter more than they look like they do. This app is worth
   nothing on mute — it is a voice — and the surest way to tell somebody their
   speakers are live, without a dialog, is for the lid to make a sound when it
   opens. It also sets the level: if the latch is comfortable, it will be too.

   The interface's own sounds are made here, out of an oscillator and a little
   noise: nothing to download, nothing to license, and a sound can be retuned
   in one line instead of re-recorded. The rest -- a footstep, an ember taken,
   wind -- are recordings, and they come off a shelf by name: fetched once,
   decoded once, and played through the same two gains as everything else, so
   the volume knob and the hush cover them too. The shell does not know where
   the shelf is -- that is the machine's, and the machine package is built on
   this one -- so the composition hands it a `Shelf` (see app/src/main.tsx).
   A name with no clip on the shelf, or no shelf at all, is silence, and a
   game that plays it is the same game with the sound off. */

declare global {
  interface Navigator {
    audioSession?: {type: string};
  }
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const KEY = 'lucid:volume', CALM_KEY = 'lucid:calm';
/** Where the knob sits until somebody moves it. A page that brings its own mix
    (a trip's desert and song) was mixed to be heard at this, and plays at its
    own level here and in proportion either side of it. */
export const RESTING_LEVEL = 0.7;
const read = () => {
  try { const v = localStorage.getItem(KEY); return v === null ? RESTING_LEVEL : +v; } catch { return RESTING_LEVEL; }
};
const write = (v: number) => { try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ } };
const readCalm = () => { try { return localStorage.getItem(CALM_KEY) === '1'; } catch { return false; } };
const writeCalm = (v: boolean) => {
  try { localStorage.setItem(CALM_KEY, v ? '1' : '0'); } catch { /* private mode */ }
};
/* Hush is not a volume. It is the answer to "not now" — somebody else in the
   room, a phone call, a sleeping child — and it has to cover the one sound
   this program makes that a volume slider does not: whatever a game is
   speaking, which it plays through an audio element of its own and which has
   never been the shell's to turn down. So the shell keeps the switch and the
   game reads it. */
const HUSH_KEY = 'lucid:hush';
const readHush = () => { try { return localStorage.getItem(HUSH_KEY) === '1'; } catch { return false; } };
const writeHush = (v: boolean) => {
  try { localStorage.setItem(HUSH_KEY, v ? '1' : '0'); } catch { /* private mode */ }
};

// How far the interface steps back when asked to be calm.
//
// These are fixed numbers, set by ear, and that is deliberate: I tried
// levelling the interface automatically against the measured loudness of the
// voice, and it asked for fifteen times the gain. A 50ms click and half a
// second of speech cannot be compared by average level — the click's energy is
// concentrated where your ear is most alert to it, and its average is almost
// nothing. Now that the voice is normalized to a known loudness before it
// plays, one constant per sound is both simpler and truer.
const CALM = 0.35;

export interface Struck {
  freq?: number;
  noise?: number;
  decay?: number;
  gain?: number;
  type?: OscillatorType;
}

/** A loop that is playing: its level, and the way to stop it. */
export interface Loop {
  /** Ease the loop to this level, 0 to 1, over `seconds`. */
  level(v: number, seconds?: number): void;
  stop(seconds?: number): void;
}

/** Air: wind made from noise, not a recording. Brown noise through a low
    pass, its level swelling and falling under a slow oscillator so it
    gusts, and under that, if asked for, a few very faint low tones. */
export interface Air {
  /** The low pass, in hertz: lower is a heavier, further wind. */
  cutoff?: number;
  /** How often it gusts, in hertz: .065 is a gust every fifteen seconds. */
  gust?: number;
  /** How much of the level the gust swings, 0 to 1. */
  depth?: number;
  /** Faint tones under the wind, in hertz, each at a fiftieth of the
      wind's level. Left out, none. */
  drone?: readonly number[];
}

/** A burst of filtered noise: a footstep, a landing, a whoosh. */
export interface Puff {
  /** Which filter, and where it sits. */
  kind?: BiquadFilterType;
  freq?: number;
  /** Where the filter ends up, for a sweep: a whoosh rises. Left out, it
      stays where it began. */
  to?: number;
  /** Seconds it takes to die away. */
  decay?: number;
  gain?: number;
  /** How resonant the filter is. */
  q?: number;
}

/** A few notes, one after another, each rung and left to ring. */
export interface Chime {
  /** Seconds between one note and the next. */
  spacing?: number;
  /** Seconds each rings for. */
  decay?: number;
  gain?: number;
  type?: OscillatorType;
}

/** A low hit: a tone falling as it dies, with a thump of noise in it. */
export interface Thud {
  freq?: number;
  decay?: number;
  gain?: number;
  /** How much noise rides on the tone, 0 to 1. */
  noise?: number;
}

export interface Played {
  /** Level, 0 to 1. The clip's own level is baked in by tools/soundprep.py;
      this is the moment's: a far thing is quieter. */
  gain?: number;
  /** Playback rate; a little above or below one keeps a repeated sound from
      being the same sound every time. */
  rate?: number;
  /** Left to right, -1 to 1. */
  pan?: number;
}

/** Where recordings come from, by name. */
export interface Shelf {
  /** Every name on it. */
  names(): Promise<string[]>;
  /** The encoded bytes of one, or null for a name the shelf has not got. */
  clip(name: string): Promise<ArrayBuffer | null>;
}

export class Instrument {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ui: GainNode | null = null;
  private shelf: Shelf | null = null;
  /** What the shelf has, asked once; a name not on it is never fetched. */
  private stocked: Promise<Set<string>> | null = null;
  /** The shelf's clips, decoded; a name that is being fetched, or that the
      shelf has not got, is a promise here too, so nobody asks twice. */
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  /** Names asked for before the first press woke the context, fetched at
      the first one that does. */
  private wanted = new Set<string>();
  /** Loops asked for before the first press woke the context: started at
      the first one that does. */
  private waitingLoops: Array<{name: string; gain: number; start: (ctx: AudioContext) => void}> = [];
  private volume = read();
  private quiet = readCalm();
  private off = readHush();

  // Silence first: a short gap is not worth announcing. Then the first beat
  // after it, and then sooner and sooner.
  readonly HOLD = 1100;
  readonly FROM = 620;
  readonly TO = 210;
  private pulse: ReturnType<typeof setTimeout> | null = null;
  private gap = 0;
  private beats = 0;
  private gaveUp = false;

  get level(): number { return this.volume; }
  get calm(): boolean { return this.quiet; }
  get hush(): boolean { return this.off; }
  /** Nothing can be heard: hushed, or the knob at zero. The voice plays at
      the same level as everything else (see @lucid/audio's playback), so
      there is no level of its own to be at zero. Silent is what a game
      speaking reads, where it read the hush: the words at a reading pace,
      nothing handed to a voice, and the voice not wanted. Said as
      `lucid:silent` (detail: silent) whenever it changes, from either side. */
  get silent(): boolean { return this.off || this.volume === 0; }
  private said = this.off || this.volume === 0;
  private sayIfSilenceMoved(): void {
    const now = this.silent;
    if (this.said === now) return;
    this.said = now;
    document.dispatchEvent(new CustomEvent('lucid:silent', {detail: now}));
  }

  /* Browsers refuse to make a sound before you have touched the page, and are
     right to. Safari is the strict one: the context has to be *built* inside a
     real gesture, not merely resumed in one. Built on a hover instead, it comes
     up suspended, its clock never starts, and every sound scheduled against
     that clock is silently thrown away — which is exactly what a page that
     works in Chrome and is mute in Safari looks like.

     So: nothing before the first press, and no sound at all until the context
     actually reports itself running. */
  wake(gesture = false): AudioContext | null {
    if (!this.ctx) {
      if (!gesture) return null;                 // not yet; a hover is not a press
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      /* iOS routes WebAudio to the "ambient" channel, which the ring/silent
         switch on the side of the phone kills — while its voice, played from
         an <audio> element, goes out on the media channel and ignores that
         switch. So on a silenced phone it talks and the interface is mute,
         which reads as broken. Asking for the playback session puts both on
         the same channel. Ignored by browsers that have never heard of it.

         Never downgraded, though. `playback` is a category a microphone cannot
         be opened in: Safari refuses with InvalidStateError and the words
         "AudioSession category is not compatible with audio capture", which is
         the only clue anywhere. An app that is listening has already asked for
         `play-and-record`, which covers this just as well — it is the same
         media channel with a microphone attached — and taking that away to
         gain nothing costs the microphone. */
      try {
        const s = navigator.audioSession;
        if (s && s.type !== 'play-and-record') s.type = 'playback';
      } catch { /* not available; the switch wins, and that is survivable */ }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      /* Hushed before the context existed -- muted on the last visit, and
         the first press of this one built the context -- is hushed now:
         the wind under a walk began at full while the corner said mute. */
      this.master.gain.value = this.off ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      // Everything the interface makes goes through here first, so it can be
      // pulled back without touching the level the voice plays at.
      this.ui = this.ctx.createGain();
      this.ui.gain.value = this.quiet ? CALM : 1;
      this.ui.connect(this.master);
      // WebKit wants something actually played inside the gesture before it
      // considers the context unlocked. One silent frame does it.
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      s.connect(this.master);
      s.start(0);
    }
    if (this.ctx.state === 'running' && this.waitingLoops.length) {
      for (const w of this.waitingLoops.splice(0)) w.start(this.ctx);
    }
    if (this.wanted.size) {
      for (const n of this.wanted) void this.clip(n);
      this.wanted.clear();
    }
    if (this.ctx.state !== 'running') {
      if (gesture) void this.ctx.resume();
      // Asked again rather than assumed: a browser that flips the state inside
      // resume() is awake now, and one that waits for the promise is not — and
      // a sound scheduled against a clock that is not running is thrown away.
      const state: string = this.ctx.state;
      return state === 'running' ? this.ctx : null;
    }
    return this.ctx;
  }

  setCalm(on: boolean): void {
    this.quiet = !!on;
    writeCalm(this.quiet);
    if (this.ui) this.ui.gain.value = this.quiet ? CALM : 1;
  }

  setHush(on: boolean): void {
    this.off = !!on;
    writeHush(this.off);
    if (this.master) this.master.gain.value = this.off ? 0 : this.volume;
    // Said out loud, because the thing most affected by it is not here: the
    // voice belongs to whichever app is open, and it listens for this.
    document.dispatchEvent(new CustomEvent('lucid:hush', {detail: this.off}));
    this.sayIfSilenceMoved();
  }

  setLevel(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    write(this.volume);
    if (this.master) this.master.gain.value = this.off ? 0 : this.volume;
    // Anything else that makes noise — a game speaking, on its own page —
    // reads this rather than keeping its own idea of loud.
    document.dispatchEvent(new CustomEvent('lucid:volume', {detail: this.volume}));
    /* A knob dragged through zero says silent and then not, a moment apart.
       Nothing is debounced here: what listens lets go of a voice only after a
       grace (90 s, on the machine and in a page alike), and is asked back
       before it runs out, so a drag through zero costs two small requests and
       no model. */
    this.sayIfSilenceMoved();
  }

  // A struck sound: a body, a click of noise on the front of it, and a decay.
  strike({freq = 420, noise = 0.35, decay = 0.09, gain = 0.5, type = 'triangle'}: Struck = {}): void {
    const ctx = this.wake();
    if (!ctx || !this.volume || this.off || !this.ui) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.ui);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.55), t + decay);
    osc.connect(g); osc.start(t); osc.stop(t + decay + 0.02);

    if (noise > 0) {
      const n = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.03), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      n.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(noise * gain, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1200;
      n.connect(hp); hp.connect(ng); ng.connect(this.ui);
      n.start(t);
    }
  }

  // Moving air, for anything that opens or carries you somewhere. Brown noise
  // rather than white — white hisses, brown breathes — swept through a bandpass
  // that rises and falls. A struck sound was wrong here: a lid going back is a
  // movement, and a low sine reads as a drum.
  whoosh({dur = 0.95, peak = 0.5}: {dur?: number; peak?: number} = {}): void {
    const ctx = this.wake();
    if (!ctx || !this.volume || this.off || !this.ui) return;
    const t = ctx.currentTime;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, loudest = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.021 * white) / 1.021;      // integrate: brown noise
      d[i] = last;
      if (Math.abs(last) > loudest) loudest = Math.abs(last);
    }
    // Normalized, because integrated noise comes out at whatever level it
    // happens to reach and the bandpass then takes most of that away.
    const lift = loudest ? 1 / loudest : 1;
    for (let i = 0; i < len; i++) d[i]! *= lift;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(260, t);
    band.frequency.exponentialRampToValueAtTime(1400, t + dur * 0.42);
    band.frequency.exponentialRampToValueAtTime(380, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.36);   // swells
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);        // and goes

    src.connect(band); band.connect(g); g.connect(this.ui);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // All of these sit deliberately low. A click is a sharp transient and a voice
  // is sustained, so matching them by number leaves the interface shouting over
  // the thing you are here to listen to — which is what happened: at equal gain
  // the ticks read as much louder than it does.
  tick(): void { this.strike({freq: 520, noise: 0.5, decay: 0.05, gain: 0.16}); }

  /* ---- something is coming ------------------------------------------------
   *
   * A soft pulse, quickening. It covers the gap between a reply appearing as
   * text and the same reply arriving as a voice — which on the first turn of an
   * evening is the length of time it takes to load a speech model, and is spent
   * watching words scroll past in silence with no way to tell whether the sound
   * is broken or merely late.
   *
   * Two things make it not an alarm. It starts a beat late, so an ordinary turn
   * — where the voice is a moment behind the text — never plays it at all and
   * this is only ever heard when there is genuinely something to wait for. And
   * it accelerates, which is the part that says *arriving* rather than
   * *waiting*: a metronome is a wait, a quickening is an approach. Low, short,
   * and under the words either way.
   */
  waiting(on: boolean): void {
    if (!on) {
      if (this.pulse) clearTimeout(this.pulse);
      this.pulse = null;
      this.gaveUp = false;                     // whatever it was waiting for, that is over
      return;
    }
    /* Already saying so — or already given up. The deck asks for this five
       times a second while a reply is pending, so having stopped is a state it
       has to keep: without it, the beat that gave up simply started again on
       the next ask, and the twenty-beat limit turned into twenty beats, a
       pause, and twenty more, all evening. */
    if (this.pulse || this.gaveUp) return;
    this.gap = this.FROM;
    this.beats = 0;
    const beat = (first: boolean) => {
      if (!first) {
        // And it gives up. Past this the voice is not late, it is not coming —
        // a machine with no speech model loaded, a synthesiser that died — and
        // a sound that means "any moment now" is a lie after twenty of them.
        // The console is where that gets explained.
        if (++this.beats > 20) { this.pulse = null; this.gaveUp = true; return; }
        // Quietly at first and a little brighter as it closes, the way
        // something approaching sounds.
        const near = (this.FROM - this.gap) / (this.FROM - this.TO);
        this.strike({freq: 150 + near * 60, noise: 0.12, decay: 0.16,
                     gain: 0.05 + near * 0.03, type: 'sine'});
        this.gap = Math.max(this.TO, this.gap * 0.86);
      }
      this.pulse = setTimeout(() => beat(false), first ? this.HOLD : this.gap);
    };
    beat(true);
  }

  latch(): void {
    this.strike({freq: 300, noise: 0.7, decay: 0.12, gain: 0.3});
    setTimeout(() => this.strike({freq: 880, noise: 0.2, decay: 0.07, gain: 0.13}), 55);
  }

  hover(): void {
    this.strike({freq: 1250, noise: 0.15, decay: 0.03, gain: 0.045, type: 'sine'});
  }

  /* ---- the shelf ---------------------------------------------------------- */

  /** Where the recordings are. Once, by the composition; nothing plays off
      a shelf until then. */
  stock(shelf: Shelf | null): void {
    this.shelf = shelf;
    this.stocked = null;
    this.clips.clear();
  }

  /** The names on the shelf, asked once for the page. Empty when there is
      no shelf, or it could not be reached. */
  private names(): Promise<Set<string>> {
    if (!this.stocked) {
      const shelf = this.shelf;
      this.stocked = shelf
        ? shelf.names().then((n) => new Set(n), () => {
            /* The machine was not there: not an empty shelf, a question to
               ask again at the next press. */
            this.stocked = null;
            return new Set<string>();
          })
        : Promise.resolve(new Set<string>());
    }
    return this.stocked;
  }

  /** A clip, decoded, or null for a name the shelf has not got. Fetched and
      decoded once per page; a clip is a few tens of kilobytes. */
  private clip(name: string): Promise<AudioBuffer | null> {
    let had = this.clips.get(name);
    if (had) return had;
    had = (async () => {
      const ctx = this.ctx;
      const shelf = this.shelf;
      if (!ctx || !shelf) return null;
      try {
        if (!(await this.names()).has(name)) return null;
        const raw = await shelf.clip(name);
        return raw ? await ctx.decodeAudioData(raw) : null;
      } catch {
        return null;
      }
    })();
    this.clips.set(name, had);
    /* A miss before the context was up is asked again next time; a miss on
       the shelf is a miss for the page. */
    void had.then((b) => { if (!b && !this.ctx) this.clips.delete(name); });
    return had;
  }

  /** Warm the clips a page is going to want, so the first footstep is not
      late. Fetched at the first press, if the context is not up yet. */
  preload(names: readonly string[]): void {
    if (!this.ctx) { for (const n of names) this.wanted.add(n); return; }
    for (const n of names) void this.clip(n);
  }

  /** Play a clip from the shelf, once. Silent before the first press, on
      hush, and for a name the shelf has not got. */
  play(name: string, {gain = 1, rate = 1, pan = 0}: Played = {}): void {
    const ctx = this.wake();
    if (!ctx || !this.volume || this.off || !this.ui) return;
    const to = this.ui;
    void this.clip(name).then((buffer) => {
      if (!buffer || !this.ctx || this.ctx !== ctx) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = Math.max(0, Math.min(1, gain));
      let tail: AudioNode = g;
      if (pan && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        tail = p;
      }
      src.connect(g);
      tail.connect(to);
      src.start();
    });
  }

  /** A clip looped, quietly, until stopped: wind, a room. Begun at the first
      press if the context is not up yet, so a page may ask on the way in. */
  loop(name: string, gain = .5): Loop {
    let g: GainNode | null = null;
    let src: AudioBufferSourceNode | null = null;
    let want = Math.max(0, Math.min(1, gain));
    let stopped = false;
    const start = (ctx: AudioContext) => {
      void this.clip(name).then((buffer) => {
        if (!buffer || stopped || !this.ui || this.ctx !== ctx) return;
        g = ctx.createGain();
        g.gain.value = 0;
        g.gain.linearRampToValueAtTime(want, ctx.currentTime + 2.5);
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(g);
        g.connect(this.ui);
        src.start();
      });
    };
    const ctx = this.wake();
    if (ctx) start(ctx);
    else this.waitingLoops.push({name, gain, start});
    return {
      level: (v, seconds = 1.5) => {
        want = Math.max(0, Math.min(1, v));
        if (g && this.ctx) {
          g.gain.cancelScheduledValues(this.ctx.currentTime);
          g.gain.setValueAtTime(g.gain.value, this.ctx.currentTime);
          g.gain.linearRampToValueAtTime(want, this.ctx.currentTime + seconds);
        }
      },
      stop: (seconds = 1.5) => {
        stopped = true;
        this.waitingLoops = this.waitingLoops.filter((w) => w.start !== start);
        if (!g || !src || !this.ctx) return;
        const at = this.ctx.currentTime;
        g.gain.cancelScheduledValues(at);
        g.gain.setValueAtTime(g.gain.value, at);
        g.gain.linearRampToValueAtTime(0, at + seconds);
        src.stop(at + seconds + .05);
      },
    };
  }

  /* ---- made, not recorded -------------------------------------------------
   *
   * Four things an interface can make out of nothing: air, a puff of noise,
   * a chime and a thud. Enough for a desert -- wind, footsteps, a thing
   * taken, a thing broken -- and none of it a file to fetch, cut, licence or
   * keep on a shelf. A recording of wind is somebody else's wind, twenty-four
   * seconds of it going round; noise through a low pass under a slow swell is
   * wind for as long as anybody stands in it and never the same twice.
   */

  /** Brown noise, four seconds of it, made once a context: the raw stuff
      of the wind and of every puff. */
  private brown: AudioBuffer | null = null;
  private noise(ctx: AudioContext): AudioBuffer {
    if (this.brown && this.brownFor === ctx) return this.brown;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const out = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      last = (last + .02 * (Math.random() * 2 - 1)) / 1.02;
      out[i] = last * 3;
    }
    this.brown = buffer;
    this.brownFor = ctx;
    return buffer;
  }
  private brownFor: AudioContext | null = null;

  /** Wind, until stopped. Begun at the first press if the context is not up
      yet, like a loop off the shelf. */
  air({cutoff = 550, gust = .065, depth = .3, drone = []}: Air = {}, gain = .5): Loop {
    let g: GainNode | null = null;
    const stops: Array<() => void> = [];
    let want = Math.max(0, Math.min(1, gain));
    let stopped = false;
    const start = (ctx: AudioContext) => {
      if (stopped || !this.ui) return;
      g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(want, ctx.currentTime + 2.5);
      g.connect(this.ui);
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      src.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = cutoff;
      /* The gust: the wind's own level, swung by a slow sine. */
      const swell = ctx.createGain();
      swell.gain.value = .17;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = gust;
      const swing = ctx.createGain();
      swing.gain.value = .17 * depth;
      lfo.connect(swing);
      swing.connect(swell.gain);
      src.connect(low);
      low.connect(swell);
      swell.connect(g);
      src.start();
      lfo.start();
      stops.push(() => src.stop(), () => lfo.stop());
      for (const f of drone) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        const v = ctx.createGain();
        v.gain.value = .17 / 50;
        osc.connect(v);
        v.connect(g);
        osc.start();
        stops.push(() => osc.stop());
      }
    };
    const ctx = this.wake();
    if (ctx) start(ctx);
    else this.waitingLoops.push({name: 'air', gain, start});
    return {
      level: (v, seconds = 1.5) => {
        want = Math.max(0, Math.min(1, v));
        if (g && this.ctx) {
          g.gain.cancelScheduledValues(this.ctx.currentTime);
          g.gain.setValueAtTime(g.gain.value, this.ctx.currentTime);
          g.gain.linearRampToValueAtTime(want, this.ctx.currentTime + seconds);
        }
      },
      stop: (seconds = 1.5) => {
        stopped = true;
        this.waitingLoops = this.waitingLoops.filter((w) => w.start !== start);
        if (!g || !this.ctx) return;
        const at = this.ctx.currentTime;
        g.gain.cancelScheduledValues(at);
        g.gain.setValueAtTime(g.gain.value, at);
        g.gain.linearRampToValueAtTime(0, at + seconds);
        const later = stops.splice(0);
        setTimeout(() => { for (const stop of later) try { stop(); } catch { /* already gone */ } }, (seconds + .1) * 1000);
      },
    };
  }

  /** A puff of noise through a filter, dying away: a footstep at 800 Hz
      high-passed, a landing low-passed, a whoosh swept upward. */
  puff({kind = 'highpass', freq = 800, to, decay = .14, gain = .2, q = 1}: Puff = {}): void {
    const ctx = this.wake();
    if (!ctx || !this.volume || this.off || !this.ui) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = kind;
    filter.Q.value = q;
    const at = ctx.currentTime;
    filter.frequency.setValueAtTime(freq, at);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, at + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), at);
    g.gain.exponentialRampToValueAtTime(.0001, at + decay);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.ui);
    /* From somewhere in the four seconds, so two steps are not one step. */
    src.start(at, Math.random() * 3, decay + .05);
  }

  /** Notes, rung one after another: a soft attack and a long ring. Three
      rising ones are a question; one alone is a thing picked up. */
  chime(freqs: readonly number[], {spacing = .13, decay = 2.7, gain = .045, type = 'sine'}: Chime = {}): void {
    const ctx = this.wake();
    if (!ctx || !this.volume || this.off || !this.ui) return;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = ctx.currentTime + i * spacing;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + .018);
      g.gain.exponentialRampToValueAtTime(.0001, t + decay);
      osc.connect(g);
      g.connect(this.ui!);
      osc.start(t);
      osc.stop(t + decay + .1);
    });
  }

  /** A low hit: the tone drops to a third of itself as it dies, and a
      low-passed thump of noise lands with it. */
  thud({freq = 90, decay = .35, gain = .5, noise = .5}: Thud = {}): void {
    const ctx = this.wake();
    if (!ctx || !this.volume || this.off || !this.ui) return;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq / 3), at + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), at);
    g.gain.exponentialRampToValueAtTime(.0001, at + decay);
    osc.connect(g);
    g.connect(this.ui);
    osc.start(at);
    osc.stop(at + decay + .05);
    if (noise > 0) this.puff({kind: 'lowpass', freq: 220, decay: decay * .8, gain: gain * noise});
  }
}

/* One of them, for the whole interface. The class is exported as well
   because the first press is a state a thing only has once, and a test
   asking what happens on it needs one that has never been woken. */
export const sound = new Instrument();

/* ---- and every press makes a sound ----------------------------------------
 *
 * Here rather than at each control, and this is the whole point of it. It used
 * to be a tick written into one handler at a time, which meant the four knobs
 * in the corner had a voice and everything invented after them did not: the
 * deck, the sheets, the rows on the box's dashboard, the way back down a
 * conversation. Nobody forgot — there was simply nothing to remember, and the
 * interface got quieter as it grew.
 *
 * So the shell listens for presses on anything that behaves like a control, and
 * an app gets the sound by using a button. Which is also the rule this
 * enforces: if it is pressable it is a button, an anchor or an input, and if it
 * is one of those it sounds like one.
 *
 * Captured, because half the controls in here stop the click going any further
 * — a press inside a popover is not a press away from it — and a listener on
 * the way down hears them all regardless.
 */
const CONTROLS = 'button, [role="button"], a[href], summary, select, ' +
                 'input[type="checkbox"], input[type="radio"]';
// A switch, either way round: something that will be in the other state when
// you let go. The heavier sound says so.
const SWITCHES = '[aria-pressed], input[type="checkbox"], input[type="radio"]';

function pressed(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target.closest<HTMLElement>(CONTROLS) : null;
  // Nothing for a key that is not offering anything — a press that does not
  // work should not sound like one that did. And `data-quiet` is for the few
  // that make their own sound, at their own moment: the console's clatter, the
  // tick that plays *after* Calm has changed so that what you hear is the level
  // you just asked for.
  if (!el || (el as HTMLButtonElement).disabled || el.closest('[data-quiet]')) return null;
  return el;
}

function press(el: HTMLElement): void {
  if (el.matches(SWITCHES)) sound.latch(); else sound.tick();
}

/** Installed once, for the whole page. Returns the way to take it off again. */
export function listenForPresses(root: Document): () => void {
  const target = root.defaultView ?? window;

  // Every press tries to wake the audio, not just the first: Safari suspends
  // the context again when the page has been in the background, and one missed
  // gesture would otherwise leave the whole interface mute for the session.
  // touchend and click are the gestures iOS counts as activation; pointerdown
  // is the one that arrives first on a Mac.
  const GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  const rouse = () => sound.wake(true);
  for (const ev of GESTURES) target.addEventListener(ev, rouse, {passive: true});

  const down = (e: Event) => {
    const el = pressed(e.target);
    if (el) press(el);
  };
  // The keyboard presses things too, and a button reached by tab and space is
  // still a button. Space and Enter are what a control answers to; pointerdown
  // never fires for either, so there is no double.
  const typed = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (e.repeat) return;                        // held down is one press
    const el = pressed(root.activeElement);
    if (el) press(el);
  };

  target.addEventListener('pointerdown', down, {capture: true, passive: true});
  target.addEventListener('keydown', typed, {capture: true, passive: true});

  return () => {
    for (const ev of GESTURES) target.removeEventListener(ev, rouse);
    target.removeEventListener('pointerdown', down, {capture: true});
    target.removeEventListener('keydown', typed, {capture: true});
  };
}
