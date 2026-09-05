/* What hands have done in the room, and how a run of the same thing reads.
 *
 * A press is a turn like any other, and it arrives at whatever moment a hand
 * happens to move. Whether one becomes a turn is the loop's -- a dose that must
 * not be poked, a voice worth taking the floor from, a reply still being
 * written. What is here is the pool it waits in, the settle it waits out, and
 * the words a run of the same press comes out as: from session.py's `did`,
 * `HANDS_SETTLE`, `AGAIN` and `take_hands`.
 *
 * They pool rather than queue. Pressing is instant and a reply is not, so one
 * turn per press would be five replies talking over each other. While the pill
 * is speaking, whatever hands do is gathered and handed over at the next turn;
 * in the quiet, a short settle lets a flurry of presses arrive as one thing
 * done rather than four.
 */

/** A flurry, not a drum solo. Presses past this are dropped rather than kept:
    forty of them are one thing done forty times, and the pill has already been
    told that by the second. */
export const POOL_MAX = 12;

/* What a run of the same press reads as. Pressing one thing four times is not
   four things: sent as four identical sentences it came out as a wall of
   copy-paste, which is a strange thing for a person to hand somebody in the
   middle of a conversation. */
export const AGAIN: Readonly<Record<number, string>> = {
  2: '(and again)',
  3: '(and again, twice more)',
};
export const AGAIN_MORE = '(and again, and again)';

/** Add one press to the pool, if there is room for it. The pool is handed in
    and handed back so nothing here holds state a room could get stuck in. */
export function pool(done: readonly string[], line: string): string[] {
  const said = (line || '').trim();
  if (!said) return [...done];
  if (done.length >= POOL_MAX) return [...done];
  return [...done, said];
}

/** Everything hands have done since anybody last looked.
 *
 * In order, with runs of the same thing collapsed — because that is what it
 * was: one thing, done a few times over.
 */
export function takeHands(done: readonly string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < done.length) {
    let n = 1;
    while (i + n < done.length && done[i + n] === done[i]) n += 1;
    out.push(done[i]!);
    if (n > 1) out.push(AGAIN[n] ?? AGAIN_MORE);
    i += n;
  }
  return out.join(' ');
}

/* ---- the pool itself ------------------------------------------------------
 *
 * One per page, the way the room is: presses belong to whoever is in front of
 * the screen, not to a component that may be re-rendered mid-flurry.
 */

/** Seconds of no further pressing before a turn. */
export const HANDS_SETTLE = 1.3;

let waiting: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** The room reporting that a hand has been put to something. */
export function press(line: string): void {
  waiting = pool(waiting, line);
}

/** What is waiting, for a test and for whoever is deciding whether to look. */
export const pressed = (): readonly string[] => waiting;

/** Everything hands have done since anybody last looked, and the settle with
    it: whatever is taken here is no longer waiting to be. */
export function take(): string {
  cancel();
  const done = waiting;
  waiting = [];
  return takeHands(done);
}

/** Come back to this once the settle has gone by with nothing else pressed. */
export function settle(then: () => void, after = HANDS_SETTLE): void {
  cancel();
  timer = setTimeout(then, after * 1000);
}

export function cancel(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Whether a turn is already promised to what is in the pool. */
export const settling = (): boolean => timer !== null;
