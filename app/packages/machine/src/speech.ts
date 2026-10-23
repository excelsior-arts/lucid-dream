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

/* ---- tags: heard, never seen ------------------------------------------------
 *
 * A model may mark a sound in its reply -- "You came back [laugh] I didn't
 * think you would." Chatterbox Turbo performs the tags its tokenizer knows
 * and the machine strips every other one (see machine/models.py, voice_text),
 * so on the way to the voice they stay. Everywhere a reply is read rather than
 * heard -- the transcript, what is kept, what the model is shown again -- they
 * go. The shape is the machine's: letters, spaces and hyphens in square
 * brackets, on one line.
 */
const TAG_BODY = String.raw`\[[A-Za-z][A-Za-z -]*\]`;
const TAG = new RegExp(TAG_BODY, 'g');
/* A tag with the blanks around it, and a line break after it when it has one:
   a tag on a line of its own goes with its line. */
const TAG_AROUND = new RegExp(String.raw`([ \t]*)` + TAG_BODY + String.raw`([ \t]*)(\n?)`, 'g');
/* A sentence that opens with a tag. */
const TAG_FIRST = new RegExp(String.raw`^\s*` + TAG_BODY);
/* The start of a tag still being written: held back until it closes, or until
   a character it could not contain says it was never one. */
const TAG_OPENING = /\[[A-Za-z]?[A-Za-z -]{0,30}$/;

/** Whether a piece of a reply has words of its own, its tags aside: "[sigh]"
 * has none, "[sigh] I know." has two.
 *
 * A tag with no words around it is never handed to a voice. Rendered 10-12,
 * the lover's clip on the Mac's Turbo, seven seeds a tag: "[sigh]" on its own
 * came back in five of seven as a breath 15-32 dB under her speech -- noise,
 * nothing of her voice in it, which the playback then lifted by up to 40 dB
 * into a whoosh -- and the ear heard "Yeah." in four; [gasp] alone was as
 * faint in all seven, [whispering] a stray word ("Okay.", "See me now.").
 * In front of the words of a sentence the same tags were the sound a body
 * makes before it speaks, in her voice: a sigh leading into the line in all
 * seven (voiced in three) -- the one Eugene heard and kept (10-12) -- a gasp,
 * a laugh. */
export function hasWords(text: string): boolean {
  return /[a-zA-Z0-9]/.test((text ?? '').replace(TAG, ''));
}

/** A reply as it is read: every tag out, and the spacing around it mended.
 *
 * "back [laugh] I" is "back I"; at the edge of a line, or against the
 * punctuation that follows it, a tag takes its blanks with it, so "[sigh] Oh."
 * is "Oh." and "back [laugh]." is "back.". */
export function withoutTags(text: string): string {
  return (text ?? '').replace(TAG_AROUND, (m, _a: string, _b: string, nl: string,
                                           at: number, s: string) => {
    const end = at + m.length;
    const opens = at === 0 || s[at - 1] === '\n';
    if (nl) return opens ? '' : '\n';
    const closes = end >= s.length || /[\n,.;:!?\u2026)\]]/.test(s[end]!);
    return opens || closes ? '' : ' ';
  });
}

/** What of a reply still being written can be shown yet.
 *
 * withoutTags, less a tag still being written and the blanks at the very end
 * -- both of which the next token can change the meaning of. What this
 * returns for a longer text always starts with what it returned for a
 * shorter one, so a stream of it is a stream of deltas. */
export function showable(written: string): string {
  const open = TAG_OPENING.exec(written);
  const settled = open ? written.slice(0, open.index) : written;
  return withoutTags(settled).replace(/\s+$/, '').replace(/^\s+/, '');
}

/** Where a sentence ends: a . ! or ? -- not the last dot of an ellipsis --
    and any closing quotes or brackets after it, then a space. */
export const SENTENCE_END = /(?<=(?<!\.\.)[.!?]["'\u201d\u2019)\]]*)\s+/;

/** A text up to the end of its last whole sentence -- a sentence's end
    (`SENTENCE_END`) or a line's -- and '' where none has ended: what of a
    reply that broke off was finished. The rule the voice is handed
    sentences by, so what this keeps is what could have been said. */
export function wholeSentences(text: string): string {
  const t = `${text.trimEnd()} `;
  const ends = new RegExp(`${SENTENCE_END.source}|\\n`, 'g');
  let at = 0;
  for (let m = ends.exec(t); m; m = ends.exec(t)) at = m.index;
  return t.slice(0, at).trimEnd();
}

/** A reply with each tag that has no words of its own moved onto the start
 * of the sentence after it, as the voice now says it (see splitForSpeech):
 * "Oh.\n\n[sigh]\n\nYou came back." is "Oh.\n\n[sigh] You came back.", and
 * "I know. [sigh]" with nothing after it stays as it is. Everything else --
 * every blank, every break -- comes back exactly as written.
 *
 * For the one reader that sees a reply's tags: the model, next turn. Shown
 * its own replies with a "[sigh]" alone between two paragraphs, it writes the
 * next one the same way, and the next: in the lover's room on 10-12 eleven
 * replies of twelve had a [sigh] on a line by itself, from the second on. */
export function tagsOnWords(text: string): string {
  const t = text ?? '';
  if (t.search(TAG) < 0) return t;
  // Sentences with what follows each: the blank it was cut on, a break, or
  // nothing at the very end.
  const cut = new RegExp(`(${SENTENCE_END.source}|\\s*\\n\\s*)`, 'g');
  const pieces: Array<{body: string; gap: string}> = [];
  let at = 0;
  for (let m = cut.exec(t); m; m = cut.exec(t)) {
    pieces.push({body: t.slice(at, m.index), gap: m[0]});
    at = m.index + m[0].length;
  }
  pieces.push({body: t.slice(at), gap: ''});
  /* The tags waiting for a sentence, as they stood. A break is worth more
     than a blank: what a lifted tag leaves between the two sentences either
     side of it is the widest of the gaps it stood between. */
  let held: Array<{body: string; gap: string}> = [];
  const breaks = (gap: string) => gap.split('\n').length;
  const out: Array<{body: string; gap: string}> = [];
  for (const p of pieces) {
    if (!p.body.trim()) {
      const into = held.length ? held[held.length - 1]! : out[out.length - 1];
      if (into) into.gap += p.gap;
      else out.push(p);
      continue;
    }
    if (!hasWords(p.body)) {
      held.push({...p});
      continue;
    }
    if (!held.length) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev) {
      for (const h of held) if (breaks(h.gap) > breaks(prev.gap)) prev.gap = h.gap;
    }
    const tags = held.map((h) => h.body.trim()).join(' ');
    const lead = /^\s*/.exec(p.body)![0];
    out.push({body: `${lead}${tags} ${p.body.slice(lead.length)}`, gap: p.gap});
    held = [];
  }
  // Nothing after them: they stay where they were written.
  out.push(...held);
  return out.map((p) => p.body + p.gap).join('');
}

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

// The opening is a whole sentence too. It was once cut at a clause -- a
// comma, a dash -- when it ran past twelve words, so the voice would start a
// moment sooner; that is a sentence said as two, each with an intonation of
// its own, and the voice speaks whole sentences, never part of one (10-08).
// Measured in a browser on 10-09, twelve lines a pill: the opening was cut at
// its first comma in all twelve of the lover's replies on the 4B, six on the
// 2B, four of the thinker's -- "I settle beside you," and then, as a second
// sentence, "letting the heavy silence roll between us as I trace your hand."
// The same code cuts the Mac's.

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
  /* Tags with no words of their own, waiting for the sentence they open --
     the next one, whichever paragraph it is in. */
  let carry = '';
  let carried = false;          // whether the paragraph `carry` came from ended
  for (const [para, terminated] of paras) {
    // "Stay... just like that." is one sentence: an ellipsis is a pause,
    // not a boundary, and splitting there makes it a hard cut between clips.
    //
    // Both spellings of it. The three-dot one was held together and the
    // single character was cut at, so the same line delivered two ways
    // depending on which key the model happened to reach for — and the
    // typed one is the one it reaches for most.
    //
    // And a sentence that ends inside a closing quote or bracket -- 'Say
    // "please."', "Did you? (I knew it.)" -- ends there all the same: before,
    // only a bare . ! ? was an end, and such a sentence was carried into the
    // next one even where every sentence should go alone. The voice worker
    // in a browser cuts by the same rule (page/voice-worker.ts, sentences).
    const parts = para.split(SENTENCE_END)
      .map((t) => t.trim())
      .filter((t) => t);
    const merged: string[] = [];
    for (const raw of parts) {
      /* A tag with no words of its own opens the sentence after it -- "[sigh]"
         on a line of its own, or after a sentence's end, is "[sigh] You came
         back." -- and never goes to the voice alone (see hasWords). */
      if (!hasWords(raw)) {
        carry = `${carry} ${raw}`.trim();
        carried = terminated;
        continue;
      }
      const opens = !!carry || TAG_FIRST.test(raw);
      const part = carry ? `${carry} ${raw}` : raw;
      carry = '';
      /* And a sentence a tag opens starts a call of its own: Turbo performs a
         sigh or a gasp before the first word of what it is handed, and after
         a sentence inside the same call it let them go -- [sigh] two times
         in four, [gasp] in none. */
      if (!opens && joinable(merged)
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
  if (carry) {
    /* Nothing after it, as far as the text goes. While a reply is streaming
       that is only so far -- the chunk is held until the next sentence comes
       and takes it (reply.ts keeps the last chunk back) -- and at the end of
       one it is said with the line before it, or, with no line left to say,
       not at all (reply.ts, and the voices: a tag alone says nothing). */
    const last = out.pop();
    if (last === undefined) out.push(carry + (carried ? '\n' : ''));
    else {
      const ends = last.endsWith('\n') || carried;
      out.push(`${last.replace(/\n$/, '')} ${carry}${ends ? '\n' : ''}`);
    }
  }
  return out;
}
