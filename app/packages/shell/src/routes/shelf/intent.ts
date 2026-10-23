/* Which box a pointer means, as a tooltip decides it.
 *
 * Under :hover a box lifted its lid the instant a pointer crossed it, so a
 * mouse swept over the shelf on its way somewhere else flapped every lid it
 * passed (Eugene, 10-11). A peek is now asked for: the pointer has to rest on
 * a box for REST_MS before its lid lifts, and leaving before then does
 * nothing at all. Once one box is peeking, the pointer going straight on to a
 * neighbour is still looking, so for WARM_MS after it leaves the next box
 * peeks after only WARM_REST_MS -- the tooltip's warm window. Leaving a
 * peeking box drops the peek at once, and the stylesheet's own transition
 * takes the lid back down from wherever it had got to.
 *
 * Only the timing is here. What a peek looks like stays in the stylesheet,
 * on the class this hands out.
 */
export const REST_MS = 300;
export const WARM_MS = 300;
export const WARM_REST_MS = 60;

export interface Intent {
  /** A pointer came onto this box (or moved on it, which restarts nothing). */
  enter(id: string): void;
  /** It left. */
  leave(id: string): void;
  /** Nothing peeks, nothing is waiting, and the window is cold: the shelf is moving. */
  reset(): void;
  dispose(): void;
}

export function intent(show: (id: string) => void): Intent {
  let peeked = '';
  let waiting = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let warmUntil = 0;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    waiting = '';
  };
  const peek = (id: string) => {
    if (peeked === id) return;
    peeked = id;
    show(id);
  };

  return {
    enter(id) {
      if (peeked === id || waiting === id) return;
      stop();
      waiting = id;
      const warm = !!peeked || Date.now() < warmUntil;
      timer = setTimeout(() => {
        timer = null;
        waiting = '';
        peek(id);
      }, warm ? WARM_REST_MS : REST_MS);
    },
    leave(id) {
      if (waiting === id) stop();
      if (peeked === id) {
        warmUntil = Date.now() + WARM_MS;
        peek('');
      }
    },
    reset() {
      stop();
      warmUntil = 0;
      peek('');
    },
    dispose: stop,
  };
}
