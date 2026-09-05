/* How a reply is cut up before it is spoken.
 *
 * Nothing here touches a model -- it is text in and text out -- and it decides
 * most of what the voice sounds like: where it breathes, how long you wait for
 * the first word, whether a pause is a pause or a hard cut between two clips.
 *
 * It belongs on this side of the wire: the page is what streams the reply and
 * what decides, token by token, whether there is a whole sentence to hand
 * over yet. The machine is handed a chunk and speaks it.
 */

/** Python's `str.split()`: any run of whitespace, and no empty pieces. */
function words(text: string): string[] {
  const t = text.trim();
  return t ? t.split(/\s+/) : [];
}

// The first chunk decides how soon it starts talking; the rest decide how much
// total work there is. Chatterbox has a fixed cost per call, so many small
// chunks are more expensive than a few larger ones. Measured with
// lab/bench_tts.py, Chatterbox Turbo on an M-series Mac: a call costs ~0.4s
// before it says anything and ~80ms a word after, and a word plays for ~0.3s.
// Six sentences cost 7.5s of generation spoken one at a time, 5.6s in pairs,
// 5.2s as one call -- and every call is one piece of audio: nothing of it is
// heard until the whole of it is made.
export const MERGE_WORDS = 14;

// The most one call is ever asked to say, however deep the queue is. Past a
// few hundred characters Chatterbox drifts -- hurries, flattens, skips a word
// -- and a stop after a long call wastes all of it: the machine finishes the
// clip it is on.
export const MERGE_MAX_WORDS = 40;
export const MERGE_CHARS = 250;

/** How far to merge, given how much audio is already waiting to play.
 *
 * The trade a merge makes is a longer wait for the next sound against fewer
 * seams and less work, and the wait only matters when nothing is playing. A
 * fast model has a reply written while the voice is on its second sentence,
 * and the queue is what shows it: seconds of audio the page has not played
 * yet, which is time the voice can spend on a bigger call without a gap.
 *
 * Nothing under a second and a half: a sentence goes the moment it is
 * complete, which is what a slow model needs. From there nine words a
 * second, so three seconds queued merges to the old cap and six to the most
 * a call is asked for. Read against the numbers above: forty words are ~3.5s
 * to make, well inside the six seconds of audio that permit them.
 */
export function mergeFor(queuedS: number): number {
  return Math.max(0, Math.min(MERGE_MAX_WORDS, Math.round((queuedS - 1.5) * 9)));
}

// How long the very first thing said may be. Everything after it is already
// covered by audio playing, so only this one is worth hurrying: a reply that
// opens with a forty-word sentence takes ~3s to write and ~3s to synthesise
// before a sound comes out, and a comma seven words in is a place a person
// would pause anyway.
export const FIRST_CHUNK_WORDS = 12;
export const CLAUSE_END = /[,;:—–]\s/g;

/** Cut the first chunk at a clause boundary, if it is long enough to wait for. */
export function shortenOpening(chunk: string): string[] {
  if (words(chunk).length <= FIRST_CHUNK_WORDS) return [chunk];
  let cut = 0;
  const finder = new RegExp(CLAUSE_END.source, 'g');
  for (let m = finder.exec(chunk); m; m = finder.exec(chunk)) {
    const end = m.index + m[0].length;
    if (words(chunk.slice(0, end)).length > FIRST_CHUNK_WORDS) break;
    cut = end;
  }
  if (!cut) return [chunk];
  const head = chunk.slice(0, cut).trim(), tail = chunk.slice(cut).trim();
  return head && tail ? [head, tail] : [chunk];
}

/** As much of the model's own text as was actually said out loud.
 *
 * A reply that was interrupted is stored as what was heard, not as what was
 * written — anything else puts words in a transcript that nobody in the room
 * ever heard. The obvious way to get that is to rejoin the chunks that were
 * spoken, and it is wrong: the splitter has already taken the model's blank
 * lines out and left one newline in their place, so rejoining with spaces
 * stores "one paragraph.\n another" where the model wrote two. Read back from
 * History a day later, a reply that arrived with air in it is a block with
 * stray spaces down the left. Measured on this machine: 92 of 279 stored
 * replies carry that signature.
 *
 * So the words are counted rather than joined, and the count is used to cut
 * the model's own text where the voice stopped. Whitespace, breaks and all
 * come back exactly as they were written.
 */
export function spokenPrefix(full: string, chunks: readonly string[]): string {
  const want = chunks.reduce((n, c) => n + words(c).length, 0);
  if (!want || !full.trim()) return '';
  let seen = 0;
  const finder = /\S+/g;
  for (let m = finder.exec(full); m; m = finder.exec(full)) {
    seen += 1;
    if (seen >= want) return full.slice(0, m.index + m[0].length);
  }
  return full;
}

export interface SplitOptions {
  /** Hurry the opening: only the first chunk of a reply, and only until
      something is playing. */
  firstShort?: boolean;
  /** How many words a chunk may reach by merging the sentence after it in,
      from mergeFor. Given, every sentence is merged up to it, the first of the
      text included, and 0 is one sentence per call. Left out, the text is a
      whole line spoken from a standing start -- a replay -- and gets the fixed
      rule: the first sentence alone so the voice starts sooner, then
      MERGE_WORDS. */
  merge?: number;
}

/** Split a reply into speakable chunks.
 *
 * A paragraph is a unit of thought, so it is never merged into the next one:
 * the model put the break there, and letting one call span it flattens the
 * arc it was building. Within a paragraph, sentences are merged up to a cap
 * in words, because the per-call overhead costs more than the extra words do
 * and one call carries its intonation across a seam that two calls would
 * cut. Where the cap comes from is the caller's: a reply being streamed
 * passes what the queue allows (see mergeFor), a line replayed from a
 * standing start takes the fixed rule described on `merge`.
 */
export function splitForSpeech(text: string, o: SplitOptions = {}): string[] {
  let out: string[] = [];
  const cap = o.merge ?? MERGE_WORDS;
  // A sentence that could be merged into the one before it. Under the fixed
  // rule the very first of the text is spared, so the voice starts sooner.
  const joinable = (merged: string[]): boolean =>
    merged.length > 0 && (o.merge !== undefined || merged.length > 1 || out.length > 0);
  // Keep track of whether each paragraph was actually terminated in the text.
  // While a reply is streaming the last one is still being written, and
  // marking it made the caller treat every new token as a finished paragraph
  // -- which came out as one word at a time.
  const pieces = (text ?? '').split(/(\n\s*\n+|\n)/);
  const paras: Array<[string, boolean]> = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const body = pieces[i] ?? '';
    const terminated = i + 1 < pieces.length;
    if (body.trim()) paras.push([body.trim(), terminated]);
  }
  for (const [para, terminated] of paras) {
    // "Stay... just like that." is one sentence: an ellipsis is a pause,
    // not a boundary, and splitting there makes it a hard cut between clips.
    //
    // Both spellings of it. The three-dot one was held together and the
    // single character was cut at, so the same line delivered two ways
    // depending on which key the model happened to reach for — and the
    // typed one is the one it reaches for most.
    const parts = para.split(/(?<=[.!?])(?<!\.\.\.)\s+/)
      .map((t) => t.trim())
      .filter((t) => t);
    const merged: string[] = [];
    for (const part of parts) {
      const wordless = !/[a-zA-Z0-9]/.test(part.replace(/\[[a-z-]+\]/g, ''));
      if (merged.length && wordless) {
        // a tag with no words of its own would be dropped before synthesis
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
      } else if (joinable(merged)
                 && words(merged[merged.length - 1]!).length < cap
                 && merged[merged.length - 1]!.length + part.length < MERGE_CHARS) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
      } else {
        merged.push(part);
      }
    }
    if (merged.length && terminated) {
      // A trailing newline marks the end of a paragraph. trim_silence
      // strips the natural tail off every chunk, so without this the next
      // paragraph starts instantly and the break the model wrote is
      // inaudible.
      merged[merged.length - 1] += '\n';
    }
    out = out.concat(merged);
  }
  // Only the opening of a reply. Doing this everywhere would trade the wait
  // for a stream of small calls, and Chatterbox charges a fixed cost each.
  if (o.firstShort && out.length) out = [...shortenOpening(out[0]!), ...out.slice(1)];
  return out;
}
