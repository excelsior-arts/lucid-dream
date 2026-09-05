/* ---- what is not worth answering -----------------------------------------
 *
 * Parakeet is far better than Whisper here, but a near-silent clip still
 * yields filler — the words a recognizer says when it heard the room. They are
 * the model's guess at nothing, and answering one is the pill talking to a
 * fridge.
 *
 * The machine does not do this: what counts as nothing worth answering is the
 * caller's question, not the recognizer's. See /machine/stt.
 */
/* Not "you": a one-word "you?" is a question somebody asked, and it was
   being dropped as the fridge. */
export const JUNK: ReadonlySet<string> = new Set([
  'thank you', 'thanks', 'thanks for watching', 'thank you for watching',
  'thanks for listening', 'thank you for listening', 'bye', 'goodbye',
  'please subscribe', 'subscribe', 'the end',
]);

/** Down to the words, so punctuation and case do not make a new sentence.
 *
 * Letters and digits of any script, which is what Python's \w means here: a
 * recognizer that hears a name with an accent in it has not said junk. */
export function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}_\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function isJunk(text: string): boolean {
  const n = normalize(text);
  return !n || JUNK.has(n);
}
