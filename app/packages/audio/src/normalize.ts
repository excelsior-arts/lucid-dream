/* Loudness, so a voice and an interface can be in the same room.
 *
 * The voice model hands back whatever level it happens to speak at, and it is
 * usually well under full scale. Left alone, the interface clicks sit over the
 * top of it -- and dropping the clicks far enough to fix that just makes the
 * whole game quiet. So each piece of speech is brought up to a known loudness
 * before it plays.
 *
 * Loudness is an average, and the thing that stops you reaching it is a single
 * sample. Speech from this model runs about 20 dB of crest -- a sentence at
 * 0.044 RMS peaks at 0.44 -- so lifting it to the figure below would put its
 * loudest sample past full scale. Held to the absolute peak, the gain is then
 * decided by whichever consonant happened to be sharpest, which is per
 * sentence and has nothing to do with how loud the sentence sounds. Measured
 * on one six-sentence reply before this was written: the ceiling governed five
 * of the six, and they played 5.9 dB apart -- wider than the 5.2 dB the model
 * had put there itself.
 *
 * So the peak that sets the ceiling is the one 0.5% of samples exceed, not the
 * maximum, and the handful above it are rounded over rather than clipped flat.
 * The ceiling itself sits a little under full scale to leave the rounding
 * somewhere to happen: at 0.97 the loudest sentence of a reply was arriving
 * with its peaks pressed against the top of the knee, which is a limiter
 * working hard rather than a limiter catching something.
 *
 * The lift is still one slowly-moving figure for the whole voice, which is
 * what keeps a whisper a whisper.
 */
export const VOICE = {
  /** Where speech should sit, of full scale. */
  RMS: 0.14,
  /** And where the loud 0.5% is held. */
  CEILING: 0.94,
  /** Above this, gently; see soften(). */
  KNEE: 0.8,
  /** The fraction of samples allowed past the ceiling. */
  TAIL: 0.005,
  /* Below this is the pause on the end of a sentence, not the sentence.

     Loudness is measured over what was actually said. A chunk is one sentence
     plus the gap after it, and every sentence gets the same gap -- so a short
     one is mostly silence, its average reads as far quieter than the speech in
     it, and the lift computed from that average lands the line above
     everything round it. Measured: "Kiss me." on its own is 0.26s of speech in
     a chunk that is 77% quiet, and came out 6.3 dB over its target against
     2.7-4.5 dB for the long lines beside it -- which is a line jumping out of
     a paragraph for no reason anybody reading it could hear. */
  QUIET: 0.01,
  /** 0.1s at 24k; less than this, trust the whole chunk. */
  ENOUGH: 2400,
} as const;

/* One slowly-moving figure for the whole voice, carried across sentences by
   whoever is playing them. Zero is "nothing has been heard yet": the first
   chunk takes its own figure whole rather than easing up from a number that
   was never measured. (The page kept `null` here for the same job; a number
   the multiplier can never legitimately be says it just as clearly and keeps
   this pure arithmetic.) */
export interface Lift {
  voiceLift: number;
}

/* Peaks rounded rather than cut. A sample over the knee is compressed into
   what is left below full scale, so the few that the ceiling no longer holds
   down bend instead of breaking -- the difference between a limiter and a
   razor, and audible on plosives. */
export function soften(v: number): number {
  const a = Math.abs(v);
  if (a <= VOICE.KNEE) return v;
  const over = (a - VOICE.KNEE) / (1 - VOICE.KNEE);
  const bent = VOICE.KNEE + (1 - VOICE.KNEE) * Math.tanh(over);
  return v < 0 ? -bent : bent;
}

/** In place: the bytes handed in are the bytes played. */
export function normalize(bytes: Uint8Array, lift: Lift): Uint8Array {
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  // One pass for both: the loudness, and a histogram to read the working peak
  // off without sorting forty thousand samples on the thread that draws.
  const BINS = 512;
  const hist = new Int32Array(BINS);
  let sum = 0, said = 0, voiced = 0, peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]! / 32768;
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > VOICE.QUIET) { said += v * v; voiced++; }
    if (a > peak) peak = a;
    const b = (a * BINS) | 0;
    const bin = b >= BINS ? BINS - 1 : b;
    hist[bin] = hist[bin]! + 1;
  }
  if (!pcm.length || !peak) return bytes;
  // The speech, where there is enough of it to measure. A whisper, or a chunk
  // that is nearly all breath, falls back to the whole thing rather than being
  // lifted off a handful of samples.
  const rms = voiced >= VOICE.ENOUGH ? Math.sqrt(said / voiced) : Math.sqrt(sum / pcm.length);

  // The level the loudest half a percent sits above. A stray sample in a
  // plosive no longer decides how loud a whole sentence is played.
  let allowed = Math.floor(pcm.length * VOICE.TAIL), edge = BINS - 1;
  for (let b = BINS - 1; b >= 0; b--) {
    allowed -= hist[b]!;
    if (allowed <= 0) { edge = b; break; }
  }
  // Never below twice the loudness, which is a floor rather than a
  // measurement: a chunk that is mostly the pause on the end of it has almost
  // all its samples at nothing, and a percentile read off that would call the
  // sentence quiet and lift it into the ceiling.
  const working = Math.max((edge + 1) / BINS, rms * 2);

  // One lift for the voice, not one per sentence. Speech arrives a sentence at
  // a time, and correcting each one to the same loudness would iron out the
  // difference between a line it raises and a line it drops to -- the whisper
  // would come back as loud as the shout. So the figure moves slowly across
  // sentences: the overall quietness is fixed, the shape of the delivery is
  // not. Within a sentence nothing is touched at all -- this is one constant
  // multiplier, not a compressor.
  const want = Math.max(1, VOICE.RMS / (rms || 1));
  lift.voiceLift = lift.voiceLift ? lift.voiceLift * 0.85 + want * 0.15 : want;

  // The one thing allowed to override it, per sentence -- but measured against
  // the working peak, so it binds when a sentence is genuinely hot rather than
  // whenever one sample is.
  const gain = Math.max(1, Math.min(lift.voiceLift, VOICE.CEILING / working));
  if (gain > 1.01) {
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.round(soften((pcm[i]! / 32768) * gain) * 32768);
      pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
  return bytes;
}
