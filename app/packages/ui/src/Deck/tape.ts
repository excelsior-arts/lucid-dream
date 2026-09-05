/* The tape clock.
 *
 * How much tape a Play would give you, as a clock rather than as a word. "15
 * min" is a label; a pair of digits counting down is the machine telling you
 * where it has got to, which is what the rest of the panel is doing.
 *
 * It is kept out of React on purpose. The server says how many minutes are
 * left, five times a second, rounded to a tenth — which is plenty to keep a
 * clock honest and nothing like enough to make one tick: a countdown that
 * moves in the steps the machine happens to speak in reads as a broken clock
 * rather than as a running one. So the deadline is kept here and the seconds
 * are counted off it locally, and the server's answer corrects it whenever
 * the two have drifted more than a second or two apart. The count is this
 * page's, the truth is the machine's — and neither of those is a render.
 */

export interface Reading {
  mm: string;
  ss: string;
  /** Run out, and it says so by going the color of a thing that has stopped. */
  spent: boolean;
}

export interface Told {
  continuous: boolean;
  /** How long a Play would run, from the strength set on the box. */
  minutes: number;
  /** And how much of a running one is left, as the machine has it. */
  left: number;
  held: boolean;
}

export interface Tape {
  subscribe(fn: () => void): () => void;
  get(): Reading;
  tell(told: Told): void;
  dispose(): void;
}

const face = (secs: number, continuous: boolean): Reading => ({
  mm: String(Math.floor(secs / 60)).padStart(2, '0'),
  ss: String(Math.floor(secs % 60)).padStart(2, '0'),
  spent: continuous && secs < 1,
});

export function createTape(now: () => number = Date.now): Tape {
  let continuous = false, minutes = 15, held = false;
  /* When the tape runs out, in this page's own clock — and, while it is held,
     how much of it was left at the moment it stopped. The clock stops where
     it is rather than waiting to be told: the machine stops it too, but the
     page is the thing somebody is looking at while they press the key, and a
     clock that runs on for another second after a pause reads as a pause that
     did not take. */
  let ends = 0, heldFor = 0;
  let snap: Reading = face(minutes * 60, false);
  let beat: ReturnType<typeof setInterval> | null = null;
  const ears = new Set<() => void>();

  const read = (): Reading => face(
    continuous ? (heldFor ? heldFor / 1000 : Math.max(0, (ends - now()) / 1000))
               : minutes * 60,
    continuous);

  function show() {
    const next = read();
    if (next.mm === snap.mm && next.ss === snap.ss && next.spent === snap.spent) return;
    snap = next;
    for (const fn of [...ears]) fn();
  }

  // Its own second. Everything else in the panel is repainted when the server
  // says something, which is often enough for a word and not for a clock.
  function running(on: boolean) {
    if (on === !!beat) return;
    if (on) beat = setInterval(show, 500);
    else { clearInterval(beat!); beat = null; }
  }

  return {
    subscribe(fn) {
      ears.add(fn);
      return () => { ears.delete(fn); };
    },
    get: () => snap,
    tell(told) {
      const was = {continuous, held};
      continuous = told.continuous;
      minutes = told.minutes;
      held = told.held;
      if (!continuous) heldFor = 0;       // a run that ended cannot still be paused
      if (held !== was.held) {
        if (held && !heldFor) heldFor = Math.max(0, ends - now());
        else if (!held && heldFor) { ends = now() + heldFor; heldFor = 0; }
      }
      // Corrected against the machine, and never while it is stopped: then
      // the machine agrees with the clock.
      if (continuous && !heldFor) {
        const to = now() + Math.max(0, told.left) * 60000;
        if (Math.abs(to - ends) > 1500) ends = to;
      }
      running(continuous);
      show();
    },
    dispose() {
      running(false);
      ears.clear();
    },
  };
}
