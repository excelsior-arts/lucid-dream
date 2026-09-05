import {useEffect, useRef} from 'react';
import {close, isOpen, useOn, useShown} from './open';
import './Sheet.css';

/* The controller next door is open.ts and not sheet.ts, and only for that: a
   Mac's disk does not tell `Sheet` from `sheet`, so `./sheet` would resolve
   to this file on the machine that wrote it and to the other one on the
   machine that builds it.
*/

/* The frame, and nothing that goes in it.
 *
 * One card in the middle of the screen, over whatever is there — a dashboard
 * has no panel to hang a sheet off, and a room's is somewhere off to one
 * side. Three bands: a title, whatever there is to read, and whatever there
 * is to press. The last of those is outside the scrolling part on purpose —
 * with the buttons inside it, a long memory pushed Save off the bottom of the
 * card and you had to scroll a text box to find the way to keep what you had
 * written.
 */
export default function Sheet() {
  /* What to draw, and whether it has faded in, are both the controller's to
     say — see sheet.ts. A component that keeps its own copy of them has to be
     told when to let go of it, and gets that wrong on exactly the frame where
     one sheet is asked for while another is still fading out. */
  const shown = useShown();
  const on = useOn();
  const scrim = useRef(false);

  // Escape closes it, and says so before the page underneath hears the key: a
  // sheet is the thing to deal with while it is up.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isOpen()) return;
      e.stopPropagation();
      close();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, []);

  if (!shown) return null;
  return (
    <div
      className={`sheet${on ? ' on' : ''}`}
      /* The scrim is the way out, and a press inside the card is not a press
         on the scrim — which is what makes a textarea usable in one of these.

         Both ends of the press, though, not just the one the browser reports.
         A click is delivered to the nearest ancestor the press and the release
         have in common, so selecting a line of text and letting go a few
         pixels outside the card arrives here as a click on the scrim: the
         sheet closed, and in the memory sheet it took the edit with it.
         Dragging out of a text box is how anybody selects to the end of a
         line, so this was reachable by ordinary use of the thing. */
      onPointerDown={(e) => {
        scrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && scrim.current) close();
      }}
    >
      <div className="sheet-card" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <b>{shown.title}</b>
          <button className="sheet-x" type="button" aria-label="close" onClick={close}>
            ×
          </button>
        </div>
        {shown.body}
      </div>
    </div>
  );
}
