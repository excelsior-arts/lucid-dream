/* Asking before something cannot be undone.
 *
 * In the page's own colors, because a browser dialog arrives in a different
 * typeface wearing the name of the machine — and because confirm() blocks the
 * thread the room is drawn on.
 *
 * The question is asked from anywhere and drawn in one place, so this half is
 * the asking and ConfirmDialog is the drawing. Nothing mounted means nothing
 * to ask with, and the safe answer is no.
 */
export interface Question {
  title: string;
  body: string;
  /** What the dangerous button says. Escape and the backdrop are always No. */
  yes: string;
  answer: (said: boolean) => void;
}

type Shown = (q: Question | null) => void;

let show: Shown | null = null;

/** The dialog, saying where to draw. Returns the way to stop. */
export function drawnBy(fn: Shown): () => void {
  show = fn;
  return () => { if (show === fn) show = null; };
}

export function ask(title: string, body: string, yes = 'Yes'): Promise<boolean> {
  if (!show) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    show?.({title, body, yes, answer: resolve});
  });
}
