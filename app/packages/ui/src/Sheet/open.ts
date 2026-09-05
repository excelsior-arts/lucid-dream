/* Which sheet is open.
 *
 * A sheet is one card in the middle of the screen, over whatever is there,
 * with something to read and something to press. What is on it is the game's;
 * what is here is the one at a time, and the fade.
 *
 * Asked for from anywhere and drawn in one place, which is why this half is
 * outside the component: a room asks for one through the console, a dashboard
 * asks for one off a row, and neither of them is anywhere near the card.
 */
import type {ReactNode} from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';

/** How long the fade out lasts; see Sheet.css. */
export const FADE_MS = 160;

export interface Sheet {
  /** What the head says, in the head's own small caps. */
  title: string;
  /** The rest of the card: a `.sheet-body`, and a `.sheet-foot` if there is
      anything to press. Built by the game at the moment it asks, so whatever
      it closes over is what was true then. */
  body: ReactNode;
}

interface Sheets {
  /** What is open. Null is shut. */
  open: Sheet | null;
  /** What is drawn, which outlives what is open by the length of the fade. */
  shown: Sheet | null;
  /** Faded in. One frame late, always: the card fades and lifts from where it
      is drawn, and a class put on in the same frame as the element itself has
      nothing to animate from. */
  on: boolean;
}

const sheets = createStore<Sheets>()(() => ({open: null, shown: null, on: false}));

/* The fade lives here rather than in the component, and deliberately: it is
   two timers and a rule about which of them wins, which is state about the
   sheet — and a component that keeps a copy of external state in its own has
   to be told when to let go of it, which is a bug waiting for a slow frame. */
let hiding: ReturnType<typeof setTimeout> | null = null;

/** What to draw. Null is nothing. */
export function useShown(): Sheet | null {
  return useStore(sheets, (s) => s.shown);
}

/** Whether it has faded in yet. */
export function useOn(): boolean {
  return useStore(sheets, (s) => s.on);
}

export function openSheet(sheet: Sheet): void {
  if (hiding) clearTimeout(hiding); // an older close must not hide this one
  hiding = null;
  sheets.setState({open: sheet, shown: sheet, on: false});
  requestAnimationFrame(() => {
    if (sheets.getState().open === sheet) sheets.setState({on: true});
  });
}

export function close(): void {
  if (!sheets.getState().open) return;
  sheets.setState({open: null, on: false});
  /* The hiding waits for the fade, and the fade is long enough to reopen
     inside it — where the old timer still fired and hid a sheet that had just
     been asked for. */
  if (hiding) clearTimeout(hiding);
  hiding = setTimeout(() => {
    hiding = null;
    if (!sheets.getState().open) sheets.setState({shown: null});
  }, FADE_MS);
}

export function isOpen(): boolean {
  return sheets.getState().open !== null;
}
