/* Which delivery tags a voice says well: the map in voice-tags.json, the one
 * place both ends read -- the machine for its own voice (machine/models.py,
 * voice_tags) and the page for the voices it runs in a browser.
 *
 * A voice keeps, and the prompt offers, the tags its tokenizer knows that its
 * entry says; every other one is stripped before synthesis. A voice with no
 * entry keeps all its tokenizer knows, so a new model tries the whole range
 * and is pruned by ear -- it never inherits another voice's exclusions.
 */
import map from './voice-tags.json';

interface Entry {
  model?: string;
  /** Another entry this voice is the same model as. */
  as?: string;
  /** The tags it says well (or is on trial for), each with a note. */
  say?: Record<string, string>;
  /** The ones it does not, and why, in a word. */
  not?: Record<string, string>;
}

const VOICES = (map as {voices: Record<string, Entry>}).voices;

/** A voice's entry, following `as`; undefined for a voice with none. */
export function tagEntry(voice: string, voices: Record<string, Entry> = VOICES): Entry | undefined {
  let e = voices[voice];
  for (let hops = 0; e?.as && hops < 4; hops++) e = voices[e.as];
  return e;
}

/** The tags a voice keeps, of those its tokenizer knows, in the tokenizer's
    order; and whether the map has an entry for it. */
export function voiceTags(voice: string, tokenizer: readonly string[],
                          voices: Record<string, Entry> = VOICES): {tags: string[]; known: boolean} {
  const e = tagEntry(voice, voices);
  if (!e) return {tags: [...tokenizer], known: false};
  const say = e.say ?? {};
  return {tags: tokenizer.filter((t) => Object.hasOwn(say, t)), known: true};
}
