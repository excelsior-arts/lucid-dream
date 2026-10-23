/* The shelf's box, its lid up, handed to its open page.
 *
 * Both pages draw the same object in the same place on that frame, so the
 * page change must not be seen. It was: a page change here is a cut (the page
 * has no picture of its own in a transition, tokens.css), and the open page's
 * room holds itself back until its box is fitted -- so the box went dark for
 * a few frames and faded back up, a flat dip between two boxes that had
 * depth. Here the shelf's last frame stays on the glass while the open page
 * comes up over it. The rules are `[data-handoff]` in tokens.css; this only
 * says when.
 *
 * Shutting needs none of it: the shelf draws its first frame primed, the shut
 * box where the open page left it, and the cut is not seen.
 */
export function handOff(change: () => void) {
  if (!document.startViewTransition) {
    change();
    return;
  }
  const root = document.documentElement;
  root.dataset.handoff = '';
  const t = document.startViewTransition(change);
  void t.finished.finally(() => delete root.dataset.handoff);
}
