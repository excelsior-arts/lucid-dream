/* A browser voice at the machine's loudness.
 *
 * Each engine speaks at a level of its own. The same lines, measured as below
 * (10-09): the Mac's Turbo at -25.4 LUFS for the lover and -27.0 for the
 * thinker, the browser's Turbo at -17.4 / -18.4, Nano -18.6 / -18.6, Sopro
 * -23.9 / -20.7 -- up to 8 dB hotter than the Mac, whose level the room's
 * mix, the clicks and the music, is set against. (Most of Turbo's 8 dB is
 * the clip: the machine loudness-normalises it before deriving the voice
 * from it, the ONNX export does not, and the Mac's Turbo without that step
 * speaks at -16.1 / -17.7.) The playback's own lift (normalize.ts in
 * @lucid/audio) raises the Mac's quiet voice and never lowers anything, so
 * most of that gap closes before it is heard -- but not all: through it the
 * browser's voices still played 0.7-1.6 dB over the Mac's (eighteen lines a
 * pill), and Turbo and Nano came out of the model past full scale, clipped
 * flat in 26 and 22 of 36 lines. So every finished sentence of a browser
 * voice is brought to the Mac's level here, before it is sent, and from
 * there on it is handled exactly as a sentence from the Mac: heard within
 * 0.6 dB of it, nothing clipped.
 *
 * Loudness is ITU-R BS.1770's, as broadcast meters read it: K-weighted, in
 * 400 ms blocks, gated at -70 LUFS and again 10 LU under the sentence's own
 * level, so the pauses and the breath between words are not averaged in.
 *
 * The gain is not one per sentence. Correcting each sentence to the same
 * figure would iron out the delivery -- a whisper raised to the line beside
 * it -- which the playback's lift already refuses to do. So the gain follows
 * one slowly-moving figure per voice: what this engine, in this clone, speaks
 * at. The first sentence sets it; each one after moves it by its share of
 * the last ~20 s of speech (a two-second line, a tenth or so). A sentence
 * that is only a tag ("[sigh]"), asks to be quiet ([whispering], [shush]) or
 * has under half a second of speech in it is levelled with the figure but
 * does not move it; before there is a figure such a sentence is only ever
 * turned down, never up.
 *
 * Nothing is clipped: a sentence the gain would take past the ceiling has
 * those peaks taken down by a limiter that sees the whole sentence (it is
 * finished), starting a few milliseconds early and letting go over ~60 ms.
 */

/** Where the Mac's Turbo speaks, in LUFS (gated, per sentence). Measured
    10-09 on the machine's own output (machine/models.py's speak, its clip
    loudness-normalised as it always is): the lover -25.4 over 30 sentences,
    the thinker -27.0 over 30, the narrator -27.0 over 12 -- one figure for
    every engine and every pill, halfway between, 0.8 from each. */
export const TARGET = -26.2;
/** The limiter's ceiling, -1 dBFS. */
export const CEILING = 0.891;
/** Most a figure may lift or drop a voice, in dB. */
const RANGE = 18;
/** How long a voice's figure remembers, in seconds of speech. */
const MEMORY = 20;
/** Less gated speech than this, in seconds, and a sentence does not teach. */
const STEADY_S = 0.5;
/** Delivery that is meant to be quieter than the voice. */
const QUIET_TAG = /\[(whispering|shush)\]/i;

/** One biquad, run over the whole of `x`. */
function biquad(x: Float32Array, b: number[], a: number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const out = b[0]! * v + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

/** BS.1770's K-weighting at any rate: the head's shelf (+4 dB from ~1.7 kHz)
    and the low cut (~38 Hz), from their analog design (as pyloudnorm and
    libebur128 derive them), so 24 kHz is weighted as 48 kHz is. */
function kWeighted(x: Float32Array, rate: number): Float32Array {
  const shelf = (() => {
    const A = 10 ** (3.99984385397 / 40);
    const w = 2 * Math.PI * 1681.9744509555319 / rate;
    const alpha = Math.sin(w) / (2 * 0.7071752369554193);
    const c = Math.cos(w), r = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) - (A - 1) * c + r;
    return {
      b: [A * ((A + 1) + (A - 1) * c + r), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - r)]
        .map((v) => v / a0),
      a: [1, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - r) / a0],
    };
  })();
  const low = (() => {
    const w = 2 * Math.PI * 38.13547087613982 / rate;
    const alpha = Math.sin(w) / (2 * 0.5003270373253953);
    const c = Math.cos(w), a0 = 1 + alpha;
    return {
      b: [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0],
      a: [1, -2 * c / a0, (1 - alpha) / a0],
    };
  })();
  return biquad(biquad(x, shelf.b, shelf.a), low.b, low.a);
}

export interface Loudness {
  /** Gated loudness in LUFS; -Infinity for silence. */
  lufs: number;
  /** Seconds of the sentence that passed both gates (block hops). */
  speech_s: number;
}

/** A sentence's loudness, gated so its pauses do not count. Under one block
    long, the whole of it is the one block. */
export function loudness(a: Float32Array, rate: number): Loudness {
  if (!a.length) return {lufs: -Infinity, speech_s: 0};
  const k = kWeighted(a, rate);
  const block = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  // Running sum of squares, so each block is two lookups.
  const sq = new Float64Array(k.length + 1);
  for (let i = 0; i < k.length; i++) sq[i + 1] = sq[i]! + k[i]! * k[i]!;
  const z: number[] = [];
  if (k.length <= block) z.push(sq[k.length]! / k.length);
  else for (let s = 0; s + block <= k.length; s += hop) z.push((sq[s + block]! - sq[s]!) / block);
  const lk = (p: number) => -0.691 + 10 * Math.log10(p);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const loud = z.filter((p) => p > 0 && lk(p) > -70);
  if (!loud.length) return {lufs: -Infinity, speech_s: 0};
  const bar = lk(mean(loud)) - 10;
  const kept = loud.filter((p) => lk(p) > bar);
  const span = k.length <= block ? k.length / rate : kept.length * hop / rate;
  return {lufs: lk(mean(kept)), speech_s: span};
}

/** `a` times `gain`, with every sample held under `ceiling`: the gain the
    loudest stretches need is found first, eased in over ~3 ms ahead of each
    peak and let go over ~60 ms after, and never above what a sample allows. */
export function limited(a: Float32Array, gain: number, rate: number, ceiling = CEILING): Float32Array {
  const out = new Float32Array(a.length);
  let over = false;
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i]! * gain;
    if (Math.abs(out[i]!) > ceiling) over = true;
  }
  if (!over) return out;
  const g = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]!);
    g[i] = v > ceiling ? ceiling / v : 1;
  }
  const release = 1 - Math.exp(-1 / (0.06 * rate));
  const attack = 1 - Math.exp(-1 / (0.003 * rate));
  for (let i = 1; i < g.length; i++) g[i] = Math.min(g[i]!, g[i - 1]! + (1 - g[i - 1]!) * release);
  for (let i = g.length - 2; i >= 0; i--) g[i] = Math.min(g[i]!, g[i + 1]! + (1 - g[i + 1]!) * attack);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * g[i]!;
  return out;
}

/** Whether a sentence may move its voice's figure: it has words, and does not
    ask to be quiet. */
export function steady(said: string): boolean {
  return !QUIET_TAG.test(said) && /[A-Za-z0-9]/.test(said.replace(/\[[^\]]*\]/g, ' '));
}

/** The levelling for one engine: a figure per voice, kept for as long as the
    engine is. `say` is the sentence as the engine was handed it. */
export function leveller(target = TARGET) {
  const figures = new Map<string, {db: number; weight: number}>();
  return (a: Float32Array, rate: number, voice: string, said: string): Float32Array => {
    const {lufs, speech_s} = loudness(a, rate);
    let fig = figures.get(voice);
    const teaches = Number.isFinite(lufs) && speech_s >= STEADY_S && steady(said);
    if (teaches) {
      // The first sentence is taken as half the memory's worth: a figure to
      // start from, which the next lines refine rather than overturn.
      if (!fig) fig = {db: lufs, weight: MEMORY / 2};
      else {
        const old = fig.weight * Math.exp(-speech_s / MEMORY);
        fig = {db: (fig.db * old + lufs * speech_s) / (old + speech_s), weight: old + speech_s};
      }
      figures.set(voice, fig);
    }
    let db = fig ? target - fig.db : Number.isFinite(lufs) ? Math.min(0, target - lufs) : 0;
    db = Math.max(-RANGE, Math.min(RANGE, db));
    return limited(a, 10 ** (db / 20), rate);
  };
}
