/* ---- vad: where a voice starts and stops --------------------------------
 *
 * Pure arithmetic on 32 ms blocks: how loud the room is, when somebody began
 * talking, when they stopped, and whether they talked over the pill. The
 * microphone is the page's and so is the speaker, which is the whole reason
 * this belongs here — the three facts this needs about playback (whether it
 * is sounding, how long it has been, and how much of it has actually been
 * heard) are reads on the object doing the playing rather than a number
 * estimated at the far end of a socket and sent back.
 *
 * Nothing in here touches a device, the DOM or the clock: blocks in, events
 * out, which is what makes every rule below three lines of test.
 */

/** Whether the mic runs itself or waits for a key held down. */
export type MicMode = 'hands_free' | 'push_to_talk';

/** A standing order about talking over the voice, from whoever is holding the
    page. `auto` leaves it to what this browser's microphone granted -- see
    bargeAllowed. */
export type MicBarge = 'auto' | 'on' | 'off';

/** What the recognizer wants, and what capture hands us. */
export const RATE = 16000;
export const BLOCK_MS = 32;
export const BLOCK = (RATE * BLOCK_MS) / 1000;

// VAD tuning. Levels are RMS of float32 samples in [-1, 1].
/** ~96 ms above threshold before we call it speech. */
export const ONSET_BLOCKS = 3;
/** Keep ~256 ms before onset so we don't clip the first word. */
export const PREROLL_BLOCKS = 8;
// How many blocks of the reply the mic must have heard before the bar is
// cut from that rather than from the quiet room's floor: a third of a second.
const RESIDUAL_BLOCKS = 10;
// Blocks of a chunk said to be playing during which nothing reached the room
// before the room stops believing it: three seconds.
const STUCK_BLOCKS = Math.round(3000 / BLOCK_MS);
/* How much voice-like sound has to have been refused, in runs no further
   apart than a second, before the room says so -- and how long before it
   says so again. A cough is not worth a line; a sentence is. */
const REFUSED_BLOCKS = Math.round(1500 / BLOCK_MS);
const REFUSED_GAP_BLOCKS = Math.round(1000 / BLOCK_MS);
const REFUSED_AGAIN_BLOCKS = Math.round(20000 / BLOCK_MS);
/** Absolute floor so a silent room can't arm the VAD. */
export const FLOOR_MIN = 0.004;

/** The ten numbers the machine's config has an opinion about. */
export interface Tuning {
  /** Speech must beat the running noise floor by this much. */
  floorMult: number;
  /* And then it may go quiet again without having stopped.
   *
   * One threshold cannot do both jobs. Starting to speak is a loud event --
   * floor x 3 keeps a fan, a fridge and a room from arming the mic.
   * Continuing to speak is not: an unstressed syllable, the tail of a
   * question, the breath in the middle of a sentence all fall under that bar
   * while somebody is plainly still talking. With one gate for both, "so who
   * you are?" armed the mic, fell below the bar on the second syllable, and
   * was measured at 384ms of a second-long sentence -- then dropped as too
   * short to be one.
   *
   * So: arm high, sustain low, which is what every voice detector does. As a
   * multiple of the same floor, and comfortably above it, because this one has
   * only to tell a voice from the room rather than from a doorway. */
  sustainMult: number;
  /** Trailing silence that ends a turn. */
  hangoverMs: number;
  /** Shorter than this is a cough, not a sentence. */
  minTurnMs: number;
  maxTurnMs: number;
  /** Louder still to interrupt playback, against the quiet room's floor --
      used only until the room under the reply has been heard for a moment;
      see `bargeOver`. */
  bargeMult: number;
  /** How far over what the microphone hears of the reply itself a voice has
      to be to count as talking over it. The floor is frozen while the pill
      speaks, so a bar cut from it was a bar for a quiet room: six times a
      silent room, on headphones where the mic hears no pill at all, was above
      an ordinary speaking voice, and a long sentence said normally was dropped
      without a word. Measured against the residual -- what is left of the
      pill's voice after the browser's canceller, tracked while it talks --
      the bar is low where the canceller is good and high where it is not. */
  bargeOver: number;
  /** Ignore the mic right after playback starts. */
  bargeGraceMs: number;
  /* Loudness alone cannot tell a voice from a door: both clear the gate, and
   * one of them stops it mid-sentence. Speech is periodic -- it has a pitch --
   * and a bang, a cough, a keyboard or a chair does not. 0 disables the test. */
  bargeVoiced: number;
  /* How much of the pill's own voice the browser's echo canceller must have
   * heard before talking over it is believed.
   *
   * Canceling an echo means subtracting a signal the canceller has to learn
   * first, and it can only learn while there is something to cancel -- so it is
   * at its worst on the first reply after the mic opens and good from the second
   * on. Which is exactly backwards for us: barge-in is armed from the first
   * word, so the pill hears itself, decides it was interrupted, and stops in the
   * middle of its opening line. Every browser does this; they differ only in how
   * long they take to converge.
   *
   * Measured in playback actually heard rather than wall-clock, because a
   * canceller learns nothing from silence. The cost is the first second and a
   * half of the first reply, which cannot be interrupted by voice -- Skip and
   * typing both still stop it. 0 trusts the canceller from the first block. */
  bargeLearnMs: number;
}

export const TUNING: Tuning = {
  floorMult: 3.0,
  sustainMult: 1.4,
  hangoverMs: 700,
  minTurnMs: 500,
  maxTurnMs: 30000,
  bargeMult: 6.0,
  bargeOver: 2.5,
  bargeGraceMs: 600,
  bargeVoiced: 0.3,
  bargeLearnMs: 1500,
};

/** The same nine, as the machine writes them down. See machine/config.py. */
export interface VadConfig {
  floor_mult?: number;
  sustain_mult?: number;
  hangover_ms?: number;
  min_turn_ms?: number;
  max_turn_ms?: number;
  barge_mult?: number;
  barge_over?: number;
  barge_grace_ms?: number;
  barge_voiced?: number;
  barge_learn_ms?: number;
}

export function tuning(cfg: VadConfig | undefined | null): Tuning {
  const c = cfg ?? {};
  const num = (v: unknown, was: number) => (typeof v === 'number' && isFinite(v) ? v : was);
  return {
    floorMult: num(c.floor_mult, TUNING.floorMult),
    sustainMult: num(c.sustain_mult, TUNING.sustainMult),
    hangoverMs: num(c.hangover_ms, TUNING.hangoverMs),
    minTurnMs: num(c.min_turn_ms, TUNING.minTurnMs),
    maxTurnMs: num(c.max_turn_ms, TUNING.maxTurnMs),
    bargeMult: num(c.barge_mult, TUNING.bargeMult),
    bargeOver: num(c.barge_over, TUNING.bargeOver),
    bargeGraceMs: num(c.barge_grace_ms, TUNING.bargeGraceMs),
    bargeVoiced: num(c.barge_voiced, TUNING.bargeVoiced),
    bargeLearnMs: num(c.barge_learn_ms, TUNING.bargeLearnMs),
  };
}

/** How the machine is set, and what this page's microphone actually granted.
 *
 * Two things want a say. The page reports what its microphone gave it and
 * turns barge-in off where there is no echo cancellation, because without it
 * the pill is the loudest thing in the room and hears itself. Somebody can
 * also say so at the console, which is the only remedy for a browser that
 * reports cancellation and does not do any -- and a choice outranks a report,
 * because the mic is re-read every time it is opened and a report that could
 * overrule would undo the order twenty seconds after it was given.
 */
export function bargeAllowed(order: MicBarge, mic: {aec: boolean | null; lying: boolean}): boolean {
  if (order === 'on' || order === 'off') return order === 'on';
  /* `false` only, never a browser that did not say: one that does not report
     is not one that failed, and turning this off on a maybe would take
     barge-in away from people who have it. */
  return mic.aec !== false && !mic.lying;
}

/* ---- what this needs of the thing making the sound ---------------------- */

/** The speaker, as the detector reads it. See audio/playback. */
export interface Speaker {
  readonly playing: boolean;
  readonly queuedS: number;
  readonly held: boolean;
  /** The browser paused the chunk in hand behind the page's back. See
      audio/playback: not sound, and not something to be talked over. */
  /** More is coming: the gap between two sentences of one reply. */
  readonly expecting: boolean;
  readonly stalled: boolean;
  /** Seconds of speech finished. With position(), what has been heard. */
  readonly playedS: number;
  /** How long this stretch of speech has been going, 0 when there is none. */
  readonly sinceStartMs: number;
  position(): number;
}

export type VadEvent =
  | {type: 'listening'; active: boolean}
  | {type: 'utterance'; samples: Float32Array; seconds: number}
  | {type: 'barge'; spoken: boolean}
  | {type: 'dropped'; ms: number; barged: boolean}
  | {type: 'log'; text: string}
  /** What the detector decided, for the log: where the room stands when that
      changes, a turn begun, and sound refused for long enough to be somebody
      talking. Numbers only -- nothing anybody said is in it. */
  | {type: 'note'; text: string; level: 'debug' | 'info'};

/** The detector's numbers, for a console line when a microphone looks dead.
    Only numbers: nothing anybody said is in here, so it can go in a log. */
export interface Meter {
  /** Loudness now, the quiet floor, and the gate an ordinary voice must clear. */
  rms: number; floor: number; gate: number;
  /** The pill's voice as the mic hears it after the canceller, and the bar
      cut from it that a voice over the reply must clear. */
  residual: number; bar: number;
  /** Playback heard since the mic opened, against the learn-window. */
  learnedMs: number;
  /** Whether the room believes a reply is going out, and for how many blocks
      one said to be playing has brought nothing. */
  out: boolean; stuck: number;
  speaking: boolean; barge: boolean;
}

export interface Vad {
  /** Microphone audio. Anything but 16 kHz is resampled, as the page's was. */
  feed(samples: Float32Array, rate?: number): void;
  /** How loud the room is right now, and what it is measured against. */
  readonly level: number;
  readonly floor: number;
  /** Everything the detector is weighing right now. See Meter. */
  readonly meter: Meter;
  /** Hands free or push to talk, and the key when it is the latter. */
  mode: MicMode;
  ptt: boolean;
  /** Whether talking over the pill stops it. See bargeAllowed. */
  barge: boolean;
  tune(next: Tuning): void;
  /** A turn in progress is not a turn: the mic closed under it. */
  reset(): void;
  on(fn: (e: VadEvent) => void): () => void;
  /** The meter: level and floor, on every block. */
  onChange(fn: () => void): () => void;
}

export interface Options {
  speaker: Speaker;
  /** Where the room starts, before anything has been heard. */
  floor?: number;
  tuning?: Tuning;
}

/* ---- the two questions loudness cannot answer --------------------------- */

/** How periodic this block is, 0 to 1.
 *
 * A vowel repeats itself at the speaker's pitch, so it correlates strongly
 * with itself one period later. A cough, a keystroke or a chair scrape has no
 * period at all and scores near zero.
 */
export function voicedness(block: Float32Array, rate = RATE): number {
  const n = block.length;
  const lo = Math.floor(rate / 400), hi = Math.floor(rate / 70);   // 70-400 Hz, a human range
  if (n <= hi) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += block[i]!;
  mean /= n;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = block[i]! - mean;
  let zero = 0;
  for (let i = 0; i < n; i++) zero += a[i]! * a[i]!;
  if (zero <= 0) return 0;
  /* Only the lags a human pitch can be at -- 188 of them against the 512 a
     whole autocorrelation would compute, and the other 324 answer nothing
     anybody asks here. */
  let best = 0;
  for (let lag = lo; lag < hi; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += a[i]! * a[i + lag]!;
    if (sum > best) best = sum;
  }
  return best / zero;
}

/** How much of this block's energy is above 300 Hz.
 *
 * A direct transform of the ten bins *below* 300 Hz rather than a 512-point
 * FFT of the lot: the rest of the spectrum is what is left over once Parseval
 * has given the total from the samples themselves, so ten bins answer the
 * question and 246 of them would be arithmetic thrown away. Ten bins over 512
 * samples is also less work than the butterflies of a real FFT this size, and
 * an order of magnitude less code to be wrong in.
 */
export function highRatio(block: Float32Array, rate = RATE): number {
  const n = block.length;
  if (!n) return 0;
  // Hann, as np.hanning has it: symmetric, and zero at both ends.
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = block[i]! * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  let energy = 0, dc = 0, nyq = 0;
  for (let i = 0; i < n; i++) {
    energy += win[i]! * win[i]!;
    dc += win[i]!;
    nyq += i % 2 ? -win[i]! : win[i]!;
  }
  /* The one-sided total the same way numpy's rfft would sum it: every bin
     between DC and Nyquist stands for itself and its mirror, so the two-sided
     total from Parseval counts them twice and those two ends once. */
  const total = (n * energy + dc * dc + nyq * nyq) / 2;
  if (!(total > 0)) return 0;
  const top = Math.ceil((300 * n) / rate);      // the first bin at or above 300 Hz
  let low = dc * dc;
  for (let k = 1; k < top && k < n / 2; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      re += win[i]! * Math.cos(w * i);
      im += win[i]! * Math.sin(w * i);
    }
    low += re * re + im * im;
  }
  return Math.max(0, 1 - low / total);
}

/** Whether this block could be a voice, on two counts.
 *
 * Periodicity alone lets a resonant thump through -- a door closing is a
 * decaying low tone, and a tone is periodic. Speech carries its vowels in
 * formants well above the pitch, so requiring real energy above 300 Hz
 * separates a voice from a thud without touching a voice.
 *
 * Only ever called on a block that already passed the loudness gate, so it
 * costs nothing while the room is quiet.
 */
export function speechlike(block: Float32Array, voiced = TUNING.bargeVoiced, rate = RATE): boolean {
  if (voicedness(block, rate) < voiced) return false;
  return highRatio(block, rate) >= 0.1;
}

/* ---- the loop ----------------------------------------------------------- */

/** Why a voice-like block was not taken. See `refused` in createVad. */
type Refusal = 'off' | 'phantom' | 'grace' | 'learning' | 'under' | 'unvoiced' | 'gate';

function rmsOf(block: Float32Array): number {
  if (!block.length) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i]! * block[i]!;
  return Math.sqrt(sum / block.length);
}

/** Linear, as the page's own resampler is, and for the same reason: what is
    downstream is a voice detector and a speech model, not a mastering desk. */
function toRate(input: Float32Array, from: number): Float32Array {
  if (from === RATE || !input.length) return input;
  const n = Math.round((input.length * RATE) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * (input.length - 1)) / Math.max(1, n - 1);
    const i0 = Math.floor(x), f = x - i0;
    out[i] = (input[i0] ?? 0) * (1 - f) + (input[i0 + 1] ?? input[i0] ?? 0) * f;
  }
  return out;
}

export function createVad(o: Options): Vad {
  const speaker = o.speaker;
  let tune = o.tuning ?? {...TUNING};
  let level = 0;
  let floor = o.floor ?? FLOOR_MIN;
  let mode: MicMode = 'hands_free';
  let ptt = false, pttWas = false;
  let barge = true;

  const ears = new Set<(e: VadEvent) => void>();
  const eyes = new Set<() => void>();
  const emit = (e: VadEvent) => { for (const fn of [...ears]) fn(e); };
  const changed = () => { for (const fn of [...eyes]) fn(); };

  // Left over from the last block: capture hands us its own buffer size, and
  // 32 ms of 16 kHz is rarely a whole number of them.
  let carry = new Float32Array(0);

  let preroll: Float32Array[] = [];
  let collected: Float32Array[] = [];
  let speaking = false;
  let barged = false;          // this turn began by stopping the pill
  /* A turn begun while a reply was being made and none of it had sounded,
     which is to stop that reply once it has shown itself to be a turn. See
     `unsounded` below. */
  let early = false;
  let learnedMs = 0;           // playback heard since this mic opened
  let under = 0, saidUnder = false;   // a voice under the reply, and whether it was mentioned
  /* What the microphone hears of the reply: the pill's own voice after the
     canceller, tracked only while it is going out and nobody is speaking.
     Rises slowly and falls fast, so a sentence said over it lifts it little
     and a gap drops it at once. Trusted after a few blocks; until then the
     old bar, cut from the floor, stands in. */
  let residual = 0, residualBlocks = 0;
  let stuck = 0;               // blocks of "playing" with nothing arriving
  let heardS = 0;              // where that count last read the speaker
  let saidLearning = false;
  let onset = 0, voicedHits = 0, silenceMs = 0;
  let lastGate = 0, lastBar = 0, lastOut = false;   // for the meter
  /* For the log. Where the room stood at the last block, so a change is said
     once; and the voice-like sound refused lately, by why, so a run of it is
     said once -- every one of these was a silence before, and a silence is
     what a microphone that hears and does not listen looks like. */
  let regime = '';
  let clock = 0, refusedAt = -Infinity, saidRefusedAt = -Infinity;
  const refusals = new Map<Refusal, number>();
  let refusedBlocks = 0;
  const f4 = (n: number) => n.toFixed(4);
  const note = (text: string, level: 'debug' | 'info' = 'debug') =>
    emit({type: 'note', text, level});

  /** This block was a voice, or could have been, and it was not taken. */
  function refused(why: Refusal, rms: number): void {
    refusedAt = clock;
    refusedBlocks += 1;
    refusals.set(why, (refusals.get(why) ?? 0) + 1);
    if (refusedBlocks < REFUSED_BLOCKS || clock - saidRefusedAt < REFUSED_AGAIN_BLOCKS) return;
    saidRefusedAt = clock;
    let most: Refusal = why, n = 0;
    for (const [k, v] of refusals) if (v > n) { most = k; n = v; }
    refusals.clear();
    refusedBlocks = 0;
    const you = f4(rms);
    const said: Record<Refusal, string> = {
      off: `talking over the reply is off (you ${you}) — Skip, then speak`,
      phantom: `a reply is said to be going out and none is playing (${speaker.queuedS.toFixed(3)}s queued)`,
      grace: `the reply has only just begun (you ${you})`,
      learning: 'the browser is still learning to cancel the pill\'s own voice — Skip stops it',
      under: `under the bar a voice over the reply must clear (you ${you}, bar ${f4(lastBar)}, `
        + `the reply as heard ${f4(residual)}) — speak up, or Skip`,
      unvoiced: `no pitch in it (you ${you}, bar ${f4(lastBar)}) — not taken for a voice`,
      gate: `under the gate (you ${you}, gate ${f4(lastGate)}, floor ${f4(floor)})`,
    };
    note('hearing you but not taking it: ' + said[most], 'info');
  }

  function finish(blocks: Float32Array[]): void {
    if (!blocks.length) return;
    let n = 0;
    for (const b of blocks) n += b.length;
    if (n < (RATE * tune.minTurnMs) / 1000) return;
    const audio = new Float32Array(n);
    let at = 0;
    for (const b of blocks) { audio.set(b, at); at += b.length; }
    emit({type: 'utterance', samples: audio, seconds: n / RATE});
  }

  function step(block: Float32Array): void {
    const rms = rmsOf(block);
    level = rms;

    /* What the room can hear coming out of this page: the chunk sounding and
       the ones behind it waiting to.

       The queue is the whole of the fix for the gaps inside a reply. A reply
       is a run of sentences and the next is still being made while the last
       one plays, so for a moment nothing is sounding at all -- and a gate that
       read only "is a sound coming out" opened between two sentences and let
       the pill's next one in as something somebody said.

       Held is not one of them, and used to be. A held queue is a room that
       has gone quiet on purpose: nothing is coming out of it, and there is
       nothing to talk over. Counting it meant that pausing -- which is what
       somebody does in order to say something -- put the microphone into
       barge-in, where being heard takes six times the noise floor and a voiced
       onset instead of three. The mic was hardest of hearing at exactly the
       moment it was being spoken to. */
    /* And how much of it has actually reached the room, which is a different
       question from how long it has been going: a paused chunk and a gap
       between two sentences both teach an echo canceller nothing. */
    const heard = speaker.playedS + speaker.position();
    const gained = Math.max(0, heard - heardS);
    /* Sound that is not advancing is not sound. The page's idea of a chunk in
       hand comes from the browser's events, and a browser that drops one --
       Safari, with a page that was put away and brought back -- leaves a
       chunk in hand that never ends and never pauses. The room then waits
       for somebody to talk over a reply that is not going out, behind a
       learn-window that only heard playback can advance: every word said
       into it refused, and the one note about it already spent. So the
       speaker's own word is believed only while what it plays keeps
       coming; three seconds of nothing arriving, and this is a quiet room. */
    /* And a queue said to be waiting with nothing playing it, which is the
       same lie told the other way: a speaker plays whatever is queued the
       moment it is free, so that is never true for longer than a call. It was
       true for good once -- a running total that floating point left at
       2e-15 seconds behind an empty queue (see playback.ts) -- and the room
       waited for a reply that was over. */
    if (speaker.playing) {
      stuck = gained > 0 ? 0 : stuck + 1;
    } else if (speaker.queuedS > 0 && !speaker.held) {
      stuck += 1;
    } else {
      stuck = 0;
    }
    /* And a reply still being made, with nothing in hand: the hole between
       two sentences when the voice is slower than the speaker. Read as a
       quiet room, a word said into that hole began a turn, and the pill's
       next sentence was collected into it as the person's. */
    const outActive = !speaker.held && !speaker.stalled && stuck < STUCK_BLOCKS
                      && (speaker.playing || speaker.queuedS > 0 || speaker.expecting);
    heardS = heard;
    /* Credited here, wherever the playback was heard, and not only while the
       room is waiting to be talked over: a canceller learns from every second
       of the pill it hears, including the ones under a turn, and a window
       credited in one branch stayed open across the reply that followed. */
    learnedMs += gained * 1000;

    // Track the room's noise floor only while nothing else is going on.
    if (!speaking && !outActive && rms < Math.max(floor * 2, FLOOR_MIN * 2)) {
      floor = 0.98 * floor + 0.02 * rms;
    }
    floor = Math.max(floor, FLOOR_MIN * 0.5);
    changed();

    const gate = Math.max(floor * tune.floorMult, FLOOR_MIN);
    lastGate = gate;
    lastOut = outActive;
    const sustain = Math.max(floor * tune.sustainMult, FLOOR_MIN * 0.7);

    clock += 1;
    if (clock - refusedAt > REFUSED_GAP_BLOCKS && refusedBlocks) {
      refusedBlocks = 0;
      refusals.clear();
    }
    /* Where the room stands, said when it moves: whether what the mic hears
       is measured as a quiet room or as somebody talking over a reply. */
    const now = speaker.held ? 'held' : speaker.stalled ? 'stalled'
      : stuck >= STUCK_BLOCKS ? (speaker.playing ? 'stuck' : 'phantom')
      : outActive ? 'out' : 'quiet';
    if (now !== regime && mode === 'hands_free') {
      regime = now;
      note('detector: ' + (
        now === 'out' ? 'a reply going out — ' + (barge ? 'a voice over it takes the floor'
                                                        : 'talking over it is off')
        : now === 'held' ? `the voice is paused — a quiet room (gate ${f4(gate)})`
        : now === 'stalled' ? `the browser stopped the voice — a quiet room (gate ${f4(gate)})`
        : now === 'stuck' ? 'the voice says it is playing and nothing has played for 3 s — '
                            + `a quiet room (gate ${f4(gate)})`
        : now === 'phantom' ? `${speaker.queuedS.toFixed(3)}s said to be queued and nothing playing `
                              + `for 3 s — a quiet room (gate ${f4(gate)})`
        : `a quiet room (floor ${f4(floor)}, gate ${f4(gate)})`));
    }

    if (mode === 'push_to_talk') {
      if (ptt && !pttWas) {
        collected = [];
        preroll = [];
        // The key takes the floor without arguing about it, and without
        // telling the machine it was interrupted: pressing Talk is not talking
        // over the pill, it is asking for the microphone.
        emit({type: 'barge', spoken: false});
        emit({type: 'listening', active: true});
      }
      if (ptt) {
        collected.push(block);
      } else if (pttWas) {
        /* Let go of with the key, and said so when it was too brief to be a
           turn: a press that was heard and then lost in silence looks, from
           the page, like a key that does nothing. */
        const ms = collected.length * BLOCK_MS;
        if (ms >= tune.minTurnMs) finish(collected);
        else emit({type: 'dropped', ms, barged: false});
        collected = [];
        emit({type: 'listening', active: false});
      }
      pttWas = ptt;
      return;
    }

    // Hands-free. A turn already begun -- by talking over the pill -- is
    // collected below like any other, not detected again every three blocks
    // for as long as the sound takes to stop.
    if (outActive && !speaking) {
      /* Learned from the pill's echo, not from the person. An echo comes up
         with the reply and holds; a voice over it arrives as a jump, twice
         what was being heard a moment before, and a jump is left out of the
         estimate -- or the estimate would climb to meet the voice and the
         bar with it, and nobody could ever interrupt. */
      if (residualBlocks < 3 || rms <= Math.max(residual * 2, gate * 1.5)) {
        residual += (rms - residual) * (rms > residual ? .1 : .2);
        residualBlocks += 1;
      }
      const bar = residualBlocks >= RESIDUAL_BLOCKS
        ? Math.max(gate, residual * tune.bargeOver, FLOOR_MIN * 2)
        : Math.max(floor * tune.bargeMult, FLOOR_MIN * 2);
      lastBar = bar;
      /* A reply being made of which nothing has sounded yet: the model is
         still writing its first sentence, or the voice is still making it.
         Nothing has come out of this page, so there is nothing for a
         canceller to have learned and no echo for a voice to be mistaken
         for -- this is a quiet room with a reply on its way. It used to be
         read as the reply: the grace below is measured from the first sound
         and never began, so everything said in this stretch was dropped
         without a word -- the second of two lines said a breath apart, said
         while the first one's answer was being written. So it is heard as it
         would be in a quiet room, at the ordinary gate, and taken as talking
         over the reply: the turn starts here, and the reply is stopped once
         the turn is long enough to be one (a cough does not cost the pill
         its answer), or the moment the reply starts to sound, whichever is
         first, so the pill's voice is never collected into it. Where talking
         over is off it is not taken, and the room says so below. */
      const unsounded = !speaker.playing && speaker.queuedS <= 0 && speaker.sinceStartMs <= 0;
      if (unsounded && barge) {
        preroll.push(block);
        if (preroll.length > PREROLL_BLOCKS) preroll.shift();
        voicedHits = 0;
        if (rms > gate) {
          onset += 1;
          if (onset >= ONSET_BLOCKS) {
            collected = [...preroll];
            speaking = true;
            early = true;
            onset = 0;
            silenceMs = 0;
            note(`detector: hearing you before the reply has sounded (you ${f4(rms)}, gate ${f4(gate)})`);
          }
        } else {
          onset = 0;
        }
        return;
      }
      const loud = rms > bar;
      // (Still unsounded here only where talking over is off.)
      const pastGrace = unsounded || speaker.sinceStartMs > tune.bargeGraceMs;
      const learning = learnedMs < tune.bargeLearnMs;
      if (learning && barge && loud && pastGrace && !saidLearning) {
        // Only if somebody actually talked over it, and only once: otherwise
        // the one time this matters looks like the mic being broken.
        saidLearning = true;
        emit({type: 'log', text: 'not interrupting yet — the browser is still '
          + "learning to cancel the pill's own voice. Skip stops it"});
      }
      /* Heard, and let go of, said once. Under a reply the bar is the barge
         bar, and somebody talking at an ordinary level under it is dropped
         without a word -- which twice now looked like a microphone that had
         stopped working after the page came back. So the first time a voice
         clears the ordinary gate and not this one, the room says so, and says
         what would work. */
      /* And before the reply has made a sound, where talking over it is off:
         any voice there is somebody's, since nothing has come out yet. */
      if ((!loud || unsounded) && rms > gate && pastGrace && !saidUnder) {
        under += 1;
        if (under >= ONSET_BLOCKS) {
          saidUnder = true;
          emit({type: 'log', text: barge
            ? 'heard you under the reply, not loudly enough to interrupt it — '
              + 'speak up, or Skip'
            : 'heard you under the reply — talking over it is off; Skip stops it'});
        }
      } else if (!(rms > gate)) {
        under = 0;
      }
      /* Sound over the ordinary gate is what a voice would be, and each way
         it is not taken here is counted -- see `refused`. */
      if (rms > gate) {
        if (!barge) refused('off', rms);
        else if (!pastGrace) refused(speaker.sinceStartMs <= 0 ? 'phantom' : 'grace', rms);
        else if (learning) refused(loud ? 'learning' : 'under', rms);
        else if (!loud) refused('under', rms);
      }
      if (barge && loud && pastGrace && !learning) {
        onset += 1;
        // Somewhere in the run there has to be a voice. Consonants are
        // unvoiced, so one block out of the three is enough -- what this
        // rejects is a run with no pitch in it at all.
        if (tune.bargeVoiced && speechlike(block, tune.bargeVoiced)) voicedHits += 1;
        if (onset >= ONSET_BLOCKS && !voicedHits && tune.bargeVoiced) refused('unvoiced', rms);
        if (onset >= ONSET_BLOCKS && (voicedHits || !tune.bargeVoiced)) {
          note(`detector: hearing you over the reply (you ${f4(rms)}, bar ${f4(bar)})`);
          emit({type: 'barge', spoken: true});
          collected = [...preroll];
          speaking = true;
          onset = 0;
          silenceMs = 0;
          voicedHits = 0;
          // Remembered, because this decision is made in about a tenth of a
          // second and is sometimes wrong. A chair moving is loud and has
          // pitch in it. Whoever hears the end of this turn needs to know that
          // stopping the pill is riding on it.
          barged = true;
          emit({type: 'listening', active: true});
        }
      } else {
        onset = 0;
        voicedHits = 0;
      }
      preroll.push(block);
      if (preroll.length > PREROLL_BLOCKS) preroll.shift();
      return;
    }

    if (!speaking) {
      preroll.push(block);
      if (preroll.length > PREROLL_BLOCKS) preroll.shift();
      if (rms > gate) {
        onset += 1;
        if (onset >= ONSET_BLOCKS) {
          collected = [...preroll];
          speaking = true;
          onset = 0;
          silenceMs = 0;
          note(`detector: hearing you (you ${f4(rms)}, gate ${f4(gate)})`);
          emit({type: 'listening', active: true});
        }
      } else {
        onset = 0;
        /* Under the gate and still a voice: a room whose floor has risen to
           meet whoever is talking in it. Only asked of what is over the
           sustain bar, so a quiet room costs nothing. */
        if (rms > sustain && speechlike(block, tune.bargeVoiced || TUNING.bargeVoiced)) refused('gate', rms);
      }
      return;
    }

    collected.push(block);
    // The lower bar: still talking, rather than starting to. See sustainMult —
    // this is the difference between hearing a sentence and hearing its first
    // syllable.
    silenceMs = rms > sustain ? 0 : silenceMs + BLOCK_MS;
    const lengthMs = collected.length * BLOCK_MS;
    /* A turn begun before the reply made a sound, taking the floor from it:
       now that it is long enough to be a turn -- what is heard of it only
       grows from here, so it will not be dropped -- or now that the reply is
       about to be heard, so its voice is never collected into this one. */
    if (early && (lengthMs - silenceMs >= tune.minTurnMs
                  || speaker.playing || speaker.queuedS > 0)) {
      early = false;
      barged = true;
      emit({type: 'barge', spoken: true});
      emit({type: 'listening', active: true});
    }
    if (silenceMs >= tune.hangoverMs || lengthMs >= tune.maxTurnMs) {
      speaking = false;
      /* One that never took the floor never said it was listening: it was a
         noise in the room while the reply was being made, which goes on. */
      if (!early) emit({type: 'listening', active: false});
      early = false;
      if (lengthMs - silenceMs >= tune.minTurnMs) {
        finish(collected);
      } else {
        /* Too brief to be a sentence. It used to end here in silence, which
           looks from the page like the turn was heard and then quietly lost.

           And if the pill was stopped to make room for it, that was a mistake
           somebody can hear: a room noise took the reply away and put nothing
           in its place. Said so here, where both halves are known, so it can
           be put back. */
        emit({type: 'dropped', ms: Math.round(lengthMs - silenceMs), barged});
      }
      collected = [];
      preroll = [];
      barged = false;
    }
  }

  return {
    feed(samples: Float32Array, rate = RATE) {
      const at = toRate(samples, rate);
      const all = new Float32Array(carry.length + at.length);
      all.set(carry);
      all.set(at, carry.length);
      let i = 0;
      for (; i + BLOCK <= all.length; i += BLOCK) step(all.subarray(i, i + BLOCK));
      carry = all.slice(i);
    },

    get level() { return level; },
    get floor() { return floor; },
    get meter(): Meter {
      return {rms: level, floor, gate: lastGate, residual, bar: lastBar, learnedMs,
              out: lastOut, stuck, speaking, barge};
    },
    get mode() { return mode; },
    set mode(next: MicMode) { mode = next; },
    get ptt() { return ptt; },
    set ptt(down: boolean) { ptt = down; },
    get barge() { return barge; },
    set barge(on: boolean) { barge = on; },

    tune(next: Tuning) { tune = next; },

    /* The microphone closed. Nothing that was half-heard is a turn, and the
       canceller behind the next one starts from nothing -- it is the mic
       opening that it has to learn against, which is the whole of why the
       first reply is the one the pill talks over. */
    reset() {
      /* Said, if it had said the opposite: the page's state is left by
         `listening: false` and by nothing else, and a microphone the window
         took mid-turn left it on "listening" for as long as the page stood. */
      const was = (speaking && !early) || pttWas;
      carry = new Float32Array(0);
      preroll = [];
      collected = [];
      speaking = false;
      barged = false;
      early = false;
      pttWas = false;
      learnedMs = 0;
      heardS = speaker.playedS + speaker.position();
      saidLearning = false;
      under = 0;
      saidUnder = false;
      residual = 0;
      residualBlocks = 0;
      stuck = 0;
      onset = voicedHits = 0;
      silenceMs = 0;
      level = 0;
      regime = '';                   // said again when the next mic opens
      refusals.clear();
      refusedBlocks = 0;
      saidRefusedAt = -Infinity;
      changed();
      if (was) emit({type: 'listening', active: false});
    },

    on(fn: (e: VadEvent) => void) { ears.add(fn); return () => { ears.delete(fn); }; },
    onChange(fn: () => void) { eyes.add(fn); return () => { eyes.delete(fn); }; },
  };
}
