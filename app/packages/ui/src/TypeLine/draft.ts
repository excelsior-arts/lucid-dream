/* Nothing you typed is lost.
 *
 * A reload, a crash, a phone that decides to reclaim the tab: none of them
 * should cost you a sentence you had written. Two things are kept — what is
 * in the box right now, and what has been sent but not yet echoed back by the
 * server, which is the window where a message could vanish in transit.
 *
 * The same two keys the page has always used, so a draft written before this
 * rewrite is still there after it.
 */
export const DRAFT = 'lucid.draft';
export const UNSENT = 'lucid.unsent';

/** Where a draft and an unacknowledged line are kept, so a game with more
    than one line to write in can keep them apart. */
export interface Keys {
  draft: string;
  unsent: string;
}

/* The two lines below are the whole of it, and they are here rather than
   beside the component because a game keeps things of its own this way too —
   which way in you were last using, which figure a card is backed with — and
   there is no sense in two shrugs at a browser that refuses to keep
   anything. */

export function store(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* private window, or storage refused — nothing to do */ }
}

export function stored(key: string): string {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
