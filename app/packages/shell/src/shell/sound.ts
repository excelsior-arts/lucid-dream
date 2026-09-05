/* The sounds matter more than they look like they do. This app is worth
   nothing on mute — it is a voice — and the surest way to tell somebody their
   speakers are live, without a dialog, is for the lid to make a sound when it
   opens. It also sets the level: if the latch is comfortable, it will be too.

   Every sound in the interface is made here, out of an oscillator and a little
   noise. No files: nothing to download, nothing to license, and a sound can be
   retuned in one line instead of re-recorded. */

declare global {
  interface Navigator {
    audioSession?: {type: string};
  }
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const KEY = 'lucid:volume', CALM_KEY = 'lucid:calm';
const read = () => {
  try { const v = localStorage.getItem(KEY); return v === null ? 0.7 : +v; } catch { return 0.7; }
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

export class Instrument {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ui: GainNode | null = null;
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
      this.master.gain.value = this.volume;
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
  }

  setLevel(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    write(this.volume);
    if (this.master) this.master.gain.value = this.off ? 0 : this.volume;
    // Anything else that makes noise — a game speaking, on its own page —
    // reads this rather than keeping its own idea of loud.
    document.dispatchEvent(new CustomEvent('lucid:volume', {detail: this.volume}));
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
