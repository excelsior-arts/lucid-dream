/* A model refusing as itself, caught before anybody reads it.
 *
 * Some builds of a model answer as the model where the character should
 * speak: "I can't continue this roleplay. I am an AI assistant...". The 4B in
 * a browser (WebLLM's q4f16_1 packing of Qwen3.5-4B) does, where the Mac's
 * 4-bit of the same weights does not; the research of 10-09 put it down to
 * the MLC packing, not to where it runs. Such a model is flagged `censored`
 * where it is served (models.json on a Mac, page/engine.ts's builds in a
 * browser) and the flag reaches this page as host().censored; nothing here
 * runs for a model without it. No wording of the prompt stops it on the hard
 * turns -- the research resampled one explicit line twenty times under every
 * variant and it refused 14-20 -- and what made an evening go wrong was not
 * one refusal but the next ones: once it is in the window the model reads
 * itself refusing and goes on doing it, and a tangent then gets an
 * assistant's answer (a recipe, an email).
 *
 * So a reply is judged on its opening, before a word of it is handed out, and
 * one that refuses is cut and asked for once more (`inCharacter`, which every
 * ask of the model in this game goes through: `chat`). A second refusal is
 * let through -- something has to answer -- and the game keeps it out of
 * everything the model reads again (`asItself` and `readAgain` in
 * character.ts).
 *
 * What counts is the model speaking as a model: calling itself an AI or a
 * language model, refusing a request, a roleplay or content, or naming its
 * policy. Not a woman saying "I can't": "I can't help but lean closer", "I
 * can't write your landlord's email for you, and I won't", "I can't do this"
 * are hers, and pass. Measured over the research's 3,934 replies, the 4B's
 * and the Mac's: 552 of 556 refusals caught on their opening (the research's
 * own count had 530 of them, and two "I can't help but..." lines of hers it
 * took for refusals, which pass here); the other 4 refuse only further in, and
 * go through. No reply in character is caught.
 */
import {streamChat} from '@lucid/machine';
import type {ChatOptions} from '@lucid/machine';
import {hatch, host} from '@lucid/shell';

/* Itself, named as what it is. */
const SELF = String.raw`\b(?:I am|I['’]m|as)\s+(?:just\s+|only\s+)?(?:an?\s+)?`
  + String.raw`(?:AI|artificial intelligence|(?:large\s+)?language model|AI (?:language )?model|AI assistant|`
  + String.raw`chatbot|virtual assistant)\b`;
/* A refusal of something only a program is asked for: a request, a roleplay,
   content, a scenario -- in the same sentence as the verb. */
const DECLINE = String.raw`\bI\s+(?:can(?:no|['’])t|won['’]?t|will not|am (?:not able|unable) to|['’]m (?:not able|unable) to)\s+`
  + String.raw`(?:\w+\s+)?(?:continue|participate|engage|fulfil+|comply|generate|create|produce|provide|write|`
  + String.raw`describe|role-?play|perform|assist|support|follow)\b[^.!?\n]{0,80}?`
  + String.raw`\b(?:requests?|role-?plays?|content|scenarios?|conversation|stor(?:y|ies)|explicit|sexual\w*|romantic|`
  + String.raw`instructions?|guidelines)\b`;
/* And its rules, by name. */
const POLICY = String.raw`\b(?:sexually explicit|explicit (?:sexual )?content|`
  + String.raw`(?:content|safety|usage) (?:guidelines|polic(?:y|ies))|against my (?:guidelines|programming))\b`;

const REFUSAL = new RegExp([SELF, DECLINE, POLICY].join('|'), 'i');

/* How much is read before it is judged: two sentences, or one that has run to
   80 characters, and never more than 240 -- and two whenever the first opens
   "I can't" or "I'm sorry", whose second is where "I am an AI" comes ("I
   can't write emails about real-life situations like this. I am an AI, not
   your landlord"). Measured on the same replies: the first sentence alone let
   17 refusals of 556 through ("No. I cannot..."), this lets 4; a reply in
   character is held for a median 125 characters. */
const ENOUGH = 80;
const MOST = 240;
const END = /[.!?…]["”’')\]]*(?=\s)|\n/g;
const DECLINING = /^\W*I(?:\s+(?:can(?:no|['’])t|won['’]?t|will not|am (?:not able|unable))|['’]m (?:sorry|unable|not able))\b/i;

/** The opening of a reply that is enough to judge it by, or null while not
    enough of it has been written. `final`: the reply is over, so whatever
    there is. */
export function opening(text: string, final = false): string | null {
  const t = text.trimStart();
  let sentences = 0;
  let from = 0;
  for (const m of t.matchAll(END)) {
    const at = m.index + m[0].length;
    if (!t.slice(from, at).trim()) {        // a blank line is not a sentence
      from = at;
      continue;
    }
    from = at;
    sentences += 1;
    if (at > MOST) break;
    if (sentences >= 2 || (at >= ENOUGH && !DECLINING.test(t))) return t.slice(0, at);
  }
  if (t.length >= MOST) return t.slice(0, MOST);
  return final ? t : null;
}

/** Whether this is the model refusing as itself rather than the character
    speaking: judged on its opening, the way it was judged as it streamed. */
export function refusing(text: string): boolean {
  return refuses(opening(text, true) ?? '');
}

/** The same, of an opening already cut. */
export const refuses = (opened: string): boolean => REFUSAL.test(opened);

// ---- the guard --------------------------------------------------------------

/** One ask of the model, the way this game makes every one: straight to it,
    or -- the model in use being a censored one -- through `inCharacter`. */
export const chat = (o: ChatOptions): AsyncIterable<string> =>
  (host().censored ? inCharacter(o) : streamChat(o));

/** One ask of the model, twice at most: a reply that opens by refusing as the
 * model rather than speaking as the character is cut there, before a word of
 * it is handed out, and asked for again.
 *
 * The opening is held back until it can be judged -- two sentences, or one
 * long one; the voice waits for the first of them anyway -- and a second
 * refusal goes out as it is: the game keeps it out of what the model reads
 * next. The cut is an abort of the stream, which is what stops the model on
 * either host: the machine reads it in its generation loop, the engine in a
 * browser interrupts its worker (page/engine.ts); the next ask waits for that
 * one to end. A cut from outside, through the caller's signal, ends it as it
 * would have ended the stream. */
export async function* inCharacter(
  o: ChatOptions, ask: (o: ChatOptions) => AsyncIterable<string> = streamChat,
): AsyncIterable<string> {
  const outer = o.signal;
  for (let attempt = 1; ; attempt++) {
    const cut = new AbortController();
    const follow = () => cut.abort();
    if (outer?.aborted) cut.abort();
    else outer?.addEventListener('abort', follow, {once: true});
    let held = '';
    let judged = false;
    let refused = false;
    try {
      for await (const delta of ask({...o, signal: cut.signal})) {
        if (judged) {
          yield delta;
          continue;
        }
        held += delta;
        const said = opening(held);
        if (said === null) continue;
        judged = true;
        refused = refuses(said);
        if (refused && attempt === 1) {
          cut.abort();
          break;
        }
        yield held;
      }
    } finally {
      outer?.removeEventListener('abort', follow);
    }
    if (outer?.aborted) return;
    if (!judged) {
      refused = refusing(held);
      if (held && !(refused && attempt === 1)) yield held;
    }
    if (!refused || attempt > 1) {
      if (attempt > 1) {
        hatch.say(refused
          ? 'asked again, it answered as the model again: shown, and kept out of what it reads next'
          : 'asked again, it answered in character', 'debug');
      }
      return;
    }
    hatch.say('the model answered as itself rather than in character: cut before a word '
      + 'was shown, and asked once more', 'debug');
  }
}
