/* Text, at the speed of the voice.
 *
 * The model writes faster than anyone speaks. Measured on this machine, one
 * reply: 119 words streamed over 13.4s while the audio of it ran 30.0s -- so
 * the last word was readable sixteen seconds before it was audible, and the
 * whole reply sat finished on screen while a third of it had been said. A
 * thing whose first sentence is "You are heard aloud, not read" was spoiling
 * every line with its own subtitles.
 *
 * No constant to tune: what is held is released at whatever rate empties it
 * as the queued audio empties. A faster model fills the buffer sooner and the
 * text still lands with the voice; a slower one never fills it at all and
 * nothing is held back.
 *
 * Two ways this must not strand the words. Sound that never plays -- blocked by
 * the browser, a voice that failed -- must not hold text hostage, so pacing
 * engages only once something has actually been heard. And a reply whose sound
 * has stopped -- or never started -- releases the remainder outright the moment
 * it ends.
 *
 * ---- and the room with the sound off ---------------------------------------
 *
 * Muted is the one case where there is no voice coming and everybody knows it
 * in advance: no socket is opened and no voice is loaded, so there is nothing
 * to pace against and nothing ever will be. Releasing the whole reply as the
 * model writes it is the subtitles complaint from the other side -- a hundred
 * words landing in a lump, faster than anybody reads. So the caller says so
 * (`reading`), and the words come out at a reading pace instead: the same
 * withholding, measured against a clock rather than against a speaker.
 */
import type {Playback} from './playback';

export interface Pacer {
  /** An `assistant_delta`: the next words of the reply being written. */
  feed(delta: string): void;
  /** An `assistant_done`: the reply, whole, once it has stopped growing. */
  done(text: string): void;
  /** The reply broke off -- a failure, not a Stop: it is over on the glass
      now, every word that came shown at once, whatever its voice has still
      to say of the sentences it was handed. Walking the tail out against
      that voice would keep the caret under a reply that has ended. */
  cut(text: string): void;
  /** A new turn, or a line of your own. */
  reset(): void;
  /** There will be no voice for this reply, so pace against the clock.
   *
   * Said by whoever knows -- the room, off the mute switch -- and taken up at
   * the start of the next reply rather than in the middle of the one being
   * written: unmuting mid-reply cannot make a voice appear for a reply that
   * was never given one, and flipping the mode under it would dump its
   * remaining half on the screen at once. */
  reading(on: boolean): void;
  /** What the transcript should show right now. */
  readonly visible: string;
  /** The reply is over on the screen's terms: nothing is still being let out. */
  readonly settled: boolean;
  onChange(fn: () => void): () => void;
  dispose(): void;
}

/* How far in front of the voice the words may run. Matching the rate alone
   preserves whatever lead exists when pacing starts -- and text flows freely
   until the first sound, so that lead was a sentence or two and stayed there
   all reply. Pacing to the audio's position makes the lead a number rather
   than an accident: about a sentence of speech, which reads as being slightly
   ahead rather than as subtitles. */
export const LEAD_S = 1.5;   // seconds of speech, not sentences -- these are short

/* Often enough that a word does not arrive in a lump, seldom enough that it
   is not a frame budget. */
export const STEP_MS = 70;

/* And the pace to read a muted reply out at, in characters a second. About
   three hundred words a minute: quicker than anybody is spoken to -- there is
   no voice to keep time with, and holding text back to the speed of speech
   nobody can hear would be pure delay -- and slower than the model writes,
   which is the whole point of holding any of it back. */
export const READ_CPS = 25;

/* The voice's pace before it has been measured, in characters a second: what
   Chatterbox does with this kind of writing, give or take. Measured, the rate
   replaces it within a couple of seconds of sound; until then the first reply
   of an evening is paced by this rather than not at all. It used to be not at
   all, which a slow model hid -- its words arrived no faster than the voice
   could say them -- and a fast one showed up at once: the whole reply on the
   glass before the first sound, and the voice reading subtitles. */
export const DEFAULT_CHPS = 20;

/* How long words wait for a voice that is expected and has not started. The
   first chunk takes a second or two to make; a fast model has finished the
   reply by then, and releasing what it wrote was the whole reply ahead of the
   sound. So the words wait -- but a voice that never comes (blocked, failed)
   must not hold them hostage, and this is the most they wait. */
export const HOLD_MS = 6000;

/* What may show before the first sound: the opening, up to the first
   sentence's end, so the glass is not blank while the voice is made and the
   reader is not ahead of it either. */
export const OPENING_CHARS = 160;

export interface Clock {
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export function createPacer(playback: Playback, o: Clock = {}): Pacer {
  const every = o.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopEvery = o.clearInterval ?? ((id) => clearInterval(id as number));
  const now = o.now ?? (() => Date.now());

  let shown = '';                  // what the transcript is showing
  let withheld = '';               // and what it is not, yet
  let settled = true;
  let heardAny = false;
  let timer: unknown = null;
  /* The reply's final text, parked while the voice finishes saying it. null is
     "no reply is waiting"; the empty string still means a reply ended. */
  let doneText: string | null = null;
  /* This reply's share of what the voice has said. The counters on the
     playback belong to the whole evening, so a reply keeps the readings it
     started from and works in the difference. */
  let baseChars = playback.spokenChars, basePlayed = playback.playedS;

  /* How fast the voice says these characters, measured from audio that has
   * played against the characters the server says it covered.
   *
   * Estimating this from the streamed text instead cannot be made to work, and
   * the failure is one-directional: the text carries markup that is stripped
   * before synthesis, so every estimate reads high, and a pacer running on a
   * high rate opens a gap that widens for as long as the reply lasts. Only the
   * server knows what it handed the voice. It survives the reply that measured
   * it, so a session pays the cost once. */
  let voiceChps = 0;               // characters a second, measured

  /* Whether there is a voice coming at all. `wantReading` is what the room has
     said about the mute switch; `reading` is what this reply is being paced
     by, taken from it when the reply starts, and `readAt` is when that was.
     The two are apart so that unmuting mid-reply lands on the next one. */
  let wantReading = false;
  let reading = false;
  let readAt = 0;
  /* When this reply's first words arrived: the hold for a voice that has not
     started is measured from here. */
  let firstAt = 0;

  const ears = new Set<() => void>();
  const changed = () => { for (const fn of [...ears]) fn(); };

  const spoken = () => playback.spokenChars - baseChars;
  const played = () => playback.playedS - basePlayed;
  // Something is actually coming out of the speaker right now, or is about to:
  // a reply is a run of chunks with silence between them.
  const sounding = () => !playback.stalled
    && (playback.playing || playback.queuedS > 0 || playback.expecting);
  /* A voice is on its way: the reply is still being made, or its sound is
     queued. Words wait for it, for a while. */
  const voiceComing = () => !!playback.expecting || playback.queuedS > 0;
  const waited = () => now() - firstAt;

  /** The opening of what is held: through the first sentence's end, capped. */
  function opening(): number {
    const head = withheld.slice(0, OPENING_CHARS);
    const m = /[.!?…]["')\]]?\s/.exec(head);
    return m ? m.index + m[0].length : Math.min(withheld.length, OPENING_CHARS);
  }

  /* Watched rather than asked: the moment a chunk starts, there is a voice for
     the text to keep pace with. Until then there is not, and pacing against
     nothing is how words stop arriving at all. */
  const watching = playback.onChange(() => {
    if (playback.playing) heardAny = true;
    if (played() > 1.5 && spoken() > 40) voiceChps = spoken() / played();
  });

  function reveal(n: number): void {
    if (settled || n <= 0) return;
    shown += withheld.slice(0, n);
    withheld = withheld.slice(n);
    changed();
  }

  function paceAll(): void {
    reveal(withheld.length);
    /* Words that had nowhere to go must not sit here and open the next
       reply -- a barge-in can have taken the bubble already. */
    withheld = '';
    if (timer !== null) { stopEvery(timer); timer = null; }
    heardAny = false;
  }

  /* The reply is over on the screen's terms: everything held is released, the
     final text (which can differ in length from what streamed) goes in, and
     the bubble stops being the streaming one. */
  function settle(text: string): void {
    doneText = null;
    paceAll();
    if (text) shown = text;
    settled = true;
    changed();
  }

  function start(): void {
    if (timer !== null) return;
    timer = every(() => {
      /* No voice for this one: the words come out against the clock, and the
         reply ends when the last of them has. Nothing here waits on sound --
         there is none, and there never was going to be. */
      if (reading) {
        if (!settled && withheld) {
          reveal(Math.round(READ_CPS * (now() - readAt) / 1000) - shown.length);
        }
        if (doneText !== null && !withheld) settle(doneText);
        return;
      }
      /* Nothing heard yet. A voice on its way is waited for, up to the hold;
         past it, or with no voice coming at all, the words go out. */
      if (!heardAny) {
        if (voiceComing() && waited() < HOLD_MS) {
          if (!shown && withheld) reveal(opening());
          return;
        }
        if (doneText !== null) { settle(doneText); return; }
        reveal(withheld.length);
        return;
      }
      // A reply that has ended settles when its words run out or its sound
      // does -- and sound stopping is also every barge-in and Stop, so this is
      // what keeps a cut-off reply from waiting on audio that was thrown away.
      if (doneText !== null && (!withheld || !sounding())) { settle(doneText); return; }
      if (settled || !withheld) return;
      // Where the voice has got to, plus the lead. Absolute rather than
      // incremental, so a gap opened earlier in the reply closes itself
      // instead of being carried to the end of it. Characters said, plus
      // where the chunk in progress has got to, at the measured rate or the
      // one assumed until there is one.
      const rate = voiceChps || DEFAULT_CHPS;
      const at = spoken() + rate * playback.position();
      const want = Math.round(at + rate * LEAD_S) - shown.length;
      if (want > 0) reveal(want);
    }, STEP_MS);
  }

  return {
    feed(delta: string) {
      if (settled) {                                  // a new one
        shown = '';
        withheld = '';
        settled = false;
        baseChars = playback.spokenChars;
        basePlayed = playback.playedS;
        // Which way this reply is paced is decided here, once, and holds for
        // the whole of it. See `reading`.
        reading = wantReading;
        readAt = now();
        firstAt = now();
      }
      withheld += delta;
      if (reading) { start(); changed(); return; }
      /* Nothing heard yet, and no voice coming: the words go out now. A voice
         on its way holds them, up to the hold -- the timer lets them go when
         the sound starts, or when the wait has been long enough to mean it
         will not. */
      if (!heardAny && !voiceComing()) { reveal(withheld.length); return; }
      if (!heardAny && !shown) reveal(opening());
      start();
      changed();
    },

    /* The model finishes writing long before the voice finishes speaking --
       measured above, sixteen seconds before. Settling here handed the whole
       back half of every reply to the screen in one piece, which is the gap
       that widened down the message however well the pacer held mid-stream:
       the pacer was already dead. So while sound is still coming out, the
       settle waits and the pacer walks the tail; the moment nothing is
       sounding -- finished, stopped, or never started -- waiting would hold
       the words hostage, and the remainder goes out at once. */
    done(text: string) {
      // The clock is still letting this one out; it ends when it has.
      if (reading && !settled && withheld) {
        doneText = text || '';
        start();
        return;
      }
      /* Still to be said -- heard and sounding, or a voice on its way that
         has not started: the words wait with it. */
      if (!settled && withheld && ((heardAny && sounding())
                                   || (!heardAny && voiceComing() && waited() < HOLD_MS))) {
        doneText = text || '';
        start();               // the last delta can land before the first sound
        return;
      }
      settle(text);
    },

    cut(text: string) {
      if (!settled) settle(text);
    },

    reading(on: boolean) { wantReading = !!on; },

    reset() {
      doneText = null;
      if (timer !== null) { stopEvery(timer); timer = null; }
      shown = '';
      withheld = '';
      heardAny = false;
      settled = true;
      // Not `wantReading`: the mute switch is where it stands, and a reset is
      // a new turn rather than somebody reaching for it.
      reading = false;
      baseChars = playback.spokenChars;
      basePlayed = playback.playedS;
      changed();
    },

    get visible() { return shown; },
    get settled() { return settled; },

    onChange(fn: () => void) { ears.add(fn); return () => { ears.delete(fn); }; },

    dispose() {
      watching();
      if (timer !== null) { stopEvery(timer); timer = null; }
      ears.clear();
    },
  };
}
