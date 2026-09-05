/* The line you write in, when there is one.
 *
 * It takes the space the keys leave and no more, so the panel stays a row of
 * controls with somewhere to write rather than a form with some buttons under
 * it. Two lines rather than one, and the height of the keys beside it: a
 * single line the width of the panel is a form; two short ones are a note
 * being written on the machine, which is what this is.
 */
import {useEffect, useRef} from 'react';
import type {Keys} from './draft';
import {DRAFT, UNSENT, store, stored} from './draft';
import './TypeLine.css';

export interface Props {
  /** Opened by the Type key. */
  open: boolean;
  disabled: boolean;
  /** Sends the line. False means it did not go — and then it stays in the
      box, where it can still be sent or changed. */
  onSubmit: (text: string) => boolean;
  /** Escape puts the line away rather than leaving it open and empty. */
  onEscape: () => void;
  /** Whatever was in the box when the page went away, back where it was. */
  onRestored: (text: string) => void;
  /** The two storage keys, if the defaults are not wanted. */
  keys?: Keys;
}

const KEPT: Keys = {draft: DRAFT, unsent: UNSENT};

export default function TypeLine({open, disabled, onSubmit, onEscape, onRestored,
                                  keys = KEPT}: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const was = useRef(open);

  // Whatever was in the box when the page went away, plus anything sent that
  // was never acknowledged — the window in which a message could be lost in
  // transit. It comes back into the box rather than being re-sent, so you
  // decide.
  useEffect(() => {
    const back = [stored(keys.unsent), stored(keys.draft)].filter(Boolean).join(' ').trim();
    if (!back || !box.current) return;
    box.current.value = back;
    store(keys.unsent, '');
    store(keys.draft, back);
    onRestored(back);
    // Once, on the way in: this is what was on the page before it reloaded,
    // and asking again later would put it back over what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Opened by the key, so the cursor goes there — but never on the way in. A
     page that focuses a field as it loads is a page that has decided you came
     to type, and on a phone it opens the keyboard over the room. */
  useEffect(() => {
    const opened = open && !was.current;
    was.current = open;
    if (!opened) return;
    const at = setTimeout(() => box.current?.focus(), 30);
    return () => clearTimeout(at);
  }, [open]);

  function submit() {
    const text = box.current?.value.trim() ?? '';
    if (!text) return;
    /* Emptied only once it has actually gone. It used to empty first and send
       afterwards, so a socket that was down — or a machine held by another
       window — took the words off the screen and gave nothing back for them.
       Left in the field they are still there to send, or to change. */
    if (!onSubmit(text)) return;
    store(keys.unsent, text);       // cleared when the server echoes it back
    if (box.current) box.current.value = '';
    store(keys.draft, '');
  }

  return (
    <div id="say" hidden={!open}>
      {/* The placeholder is short because the line is narrow: the keys have
          the row and the panel is set by the room, not the window. A hint that
          wraps inside its own box reads as something broken rather than as a
          hint. What it does not say any more is on the Type key, in its
          title, which is where somebody wondering about it will be looking. */}
      <textarea
        id="text" rows={2} spellCheck={false} placeholder="type to steer"
        ref={box} disabled={disabled}
        onChange={() => store(keys.draft, box.current?.value ?? '')}
        onKeyDown={(e) => {
          /* Return sends; shift-return is a new line. Which is the way round
             every message box anybody has used works, and it is now a box with
             two lines in it rather than a field, so the question exists. */
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          // The console has its own Escape and takes it first, so this only
          // fires when the console is shut.
          else if (e.key === 'Escape') { onEscape(); box.current?.blur(); }
        }}
      />
    </div>
  );
}
