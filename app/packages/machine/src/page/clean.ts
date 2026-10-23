/* What a small model writes that nobody should read, taken out as it streams.
 *
 * Two things, both measured in the in-browser spike (scratchpad research,
 * 10-08). Qwen told not to think still opens its reply with an empty
 * `<think>\n\n</think>` -- WebLLM puts it there itself -- and the 2B and 4B
 * write stage directions between asterisks (`*leans back, smiling*`), which
 * system.md forbids and which the 27B never wrote. Read aloud they were
 * flat; on the glass they are a stage play nobody asked for.
 *
 * An action is a run of one line between two asterisks that hug their words
 * -- `*sighs*`, not `5 * 3 * 2` and not a `* ` bullet, which is how a fold
 * writes a memory. Anything not yet closed is held back until it is, so what
 * has been handed out is never taken back; at the end what was held is let go
 * of as it is.
 *
 * Only on a page with no machine: the machine's 27B is shown its words as it
 * wrote them, and nothing here touches them.
 */

const THINK = /^\s*<think>[\s\S]*?<\/think>\s*/;
const ACTION = /\*(?=[^\s*])[^*\n]*?(?<=[^\s*])\*/g;

/** The part of `raw` that is settled enough to show: complete thoughts and
    actions out, and anything that may still turn into one held back. */
export function shown(raw: string, final = false): string {
  let text = raw;
  // A thought still open at the front is held whole until it closes.
  if (/^\s*<think>/.test(text)) {
    const closed = THINK.exec(text);
    if (!closed) return '';
    text = text.slice(closed[0].length);
  } else if (!final && /^\s*<(t(h(i(nk?)?)?)?)?$/.test(text)) {
    return '';                                  // the front of a `<think>`
  }
  text = text.replace(ACTION, '');
  if (!final) {
    // An asterisk that opens something on this line and has not closed yet.
    const open = /\*(?=[^\s*])[^*\n]*$/.exec(text);
    if (open) text = text.slice(0, open.index);
    else if (text.endsWith('*')) text = text.slice(0, -1);
  }
  // What an action leaves behind: two spaces where it was, or a line that
  // was nothing else.
  return text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:])/g, '$1')
    .replace(/\n[ \t]+\n/g, '\n\n').replace(/^\s+/, '');
}

/** A stream of raw deltas, as a stream of shown ones. */
export function cleaner(): {take(delta: string): string; end(): string; raw(): string} {
  let raw = '';
  let given = '';
  const step = (final: boolean): string => {
    const now = shown(raw, final);
    /* Only ever forward. A collapse that reaches back past what was already
       handed out -- a space given and then doubled -- leaves that space where
       it is and goes on from the end. */
    if (!now.startsWith(given)) {
      const more = now.length > given.length ? now.slice(given.length) : '';
      given += more;
      return more;
    }
    const more = now.slice(given.length);
    given = now;
    return more;
  };
  return {
    take(delta) { raw += delta; return step(false); },
    end() { return step(true); },
    raw: () => raw,
  };
}

/** One way of writing a reply for looking it up by: the words, without the
    spacing a page may have changed on the way to its transcript. */
export const keyOf = (text: string): string => text.replace(/\s+/g, ' ').trim();
