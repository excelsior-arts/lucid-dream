/* The words of a line, as they go onto the glass.
 *
 * Split out of the component so the component's file exports one thing, and
 * because this is the part a test can hold still: what a bubble does to the
 * text it is given.
 */
import type {ReactNode} from 'react';

/* A space after every line break, and the bubble keeps whitespace (pre-wrap),
   so a reply written as short lines came out with a step down the left of it:
   nothing here put it there and nothing on the server did either. A tokenizer
   carries the space in front of a word as part of the word, so the token after
   a newline is " You're" rather than "You're", and the model streams exactly
   that. It never reaches the voice — split_for_speech strips each line before
   it is spoken — so this is the only place it shows. */
export function render(text: string): ReactNode[] {
  const tidy = text.replace(/\n[ \t]+/g, '\n');
  const out: ReactNode[] = [];
  const tag = /\[[a-z-]+\]/g;
  let at = 0;
  for (let m = tag.exec(tidy); m; m = tag.exec(tidy)) {
    if (m.index > at) out.push(tidy.slice(at, m.index));
    out.push(<span className="tag" key={m.index}>{m[0]}</span>);
    at = m.index + m[0].length;
  }
  if (at < tidy.length) out.push(tidy.slice(at));
  return out;
}

