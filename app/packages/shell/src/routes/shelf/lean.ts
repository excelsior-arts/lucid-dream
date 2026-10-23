/* Each box on the shelf turns to face a mouse that comes near it.
 *
 * The lean was the window's: the pointer's place in the whole window, set on
 * <html>, and every box turned by it -- so two boxes turned in unison, both
 * to the right for a cursor between them (Eugene, 10-11). Now each box takes
 * the pointer's place relative to itself. Over a box it leans as the one box
 * did across the window, level under a cursor on its middle and at the most
 * at its edges; beyond its edges it keeps facing the cursor, by less the
 * further off it is. So a cursor between two boxes turns them towards each
 * other, and one beside the left box turns that one and barely the other.
 *
 * Eased here, a frame at a time, towards where the pointer says: a cursor
 * jumping from one box to the other, or coming into the window, never snaps a
 * box round, and leaving the window lets every box settle back level. One
 * loop for the shelf, asleep while nothing is turning. What a lean looks like
 * stays in the stylesheet, on --lean-x and --lean-y on each box.
 *
 * Only a mouse or a pen: a touch screen reports every tap as a pointer move,
 * and a box leaning towards wherever a thumb last landed reads as a box
 * leaning against the side of the window. And nobody who has asked for less
 * motion is shown it.
 */
import type {Rect} from './arrange';

/** The most a box turns, in degrees: about its horizontal axis (a cursor
    above or below it) and its vertical one (to its left or right). The
    window-wide lean's own most. */
export const MOST_X = 2.5;
export const MOST_Y = 3;
/** How far beyond a box's edge, in box widths, it still turns half as far. */
export const REACH = 0.5;
/** How quickly a box follows: the ease's time constant, in milliseconds --
    two thirds of the way there in this long, all but a hair in four times it. */
export const EASE_MS = 160;
/** Closer than this, in degrees, and it is there. */
const NEAR = 0.01;

export interface Lean {
  x: number;
  y: number;
}
export const LEVEL: Lean = {x: 0, y: 0};

/** How much of its most a box turns for a pointer `e` box widths beyond its
    edge: all of it at the edge and inside, half at REACH, a fifth at twice
    that, and on towards nothing. Flat where it meets the edge, so crossing
    the edge changes nothing in how it moves. */
export const falloff = (e: number) => 1 / (1 + (Math.max(0, e) / REACH) ** 2);

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** Where a box standing at `box` (on screen) turns for a pointer at `p`, or
    level for no pointer. Facing it: a cursor to its right turns its face
    right (rotateY +), one above turns it up (rotateX +). */
export function target(p: {x: number; y: number} | null, box: Rect): Lean {
  const w = box.right - box.left, h = box.bottom - box.top;
  if (!p || !(w > 0) || !(h > 0)) return LEVEL;
  // Across the box, -1 at one edge to 1 at the other, and held there beyond.
  const ux = clamp((p.x - (box.left + box.right) / 2) / (w / 2));
  const uy = clamp((p.y - (box.top + box.bottom) / 2) / (h / 2));
  // How far beyond its edge, in widths of this box.
  const ex = Math.max(box.left - p.x, 0, p.x - box.right);
  const ey = Math.max(box.top - p.y, 0, p.y - box.bottom);
  const s = falloff(Math.hypot(ex, ey) / w);
  return {x: uy ? -uy * MOST_X * s : 0, y: ux ? ux * MOST_Y * s : 0};
}

export interface Leaning {
  /** The boxes and where each stands at rest on screen, measured with the
      table's layout, never on a pointer's move. */
  place(boxes: {el: HTMLElement; rect: Rect}[]): void;
  /** The table is moving: nothing turns, and nothing is written, until it is
      still again. A box opening or stepping away has its own transform then,
      and the others arriving are on a transition a new lean would restart. */
  hold(moving: boolean): void;
  dispose(): void;
}

export interface Clock {
  frame(cb: (t: number) => void): number;
  cancel(id: number): void;
}

export function leaning(clock: Clock = {
  frame: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
}): Leaning {
  let boxes: {el: HTMLElement; rect: Rect}[] = [];
  let now: Lean[] = [];
  let pointer: {x: number; y: number} | null = null;
  let held = false;
  let raf: number | null = null;
  let last: number | null = null;

  const write = (el: HTMLElement, l: Lean) => {
    el.style.setProperty('--lean-x', l.x.toFixed(2));
    el.style.setProperty('--lean-y', l.y.toFixed(2));
  };

  const tick = (t: number) => {
    raf = null;
    // A frame's worth at the first, and never more than four at once: a
    // hidden tab's frames stop, and the first one back is not a leap.
    const dt = last === null ? 16 : Math.min(64, Math.max(0, t - last));
    last = t;
    const k = 1 - Math.exp(-dt / EASE_MS);
    let turning = false;
    boxes.forEach(({el, rect}, i) => {
      const at = now[i] ?? LEVEL, to = target(pointer, rect);
      if (at.x === to.x && at.y === to.y) return;
      const close = Math.abs(to.x - at.x) < NEAR && Math.abs(to.y - at.y) < NEAR;
      const next = close ? to : {x: at.x + (to.x - at.x) * k, y: at.y + (to.y - at.y) * k};
      now[i] = next;
      write(el, next);
      if (!close) turning = true;
    });
    if (turning) raf = clock.frame(tick);
    else last = null;
  };
  const wake = () => {
    if (raf === null && !held) raf = clock.frame(tick);
  };
  const sleep = () => {
    if (raf !== null) clock.cancel(raf);
    raf = null;
    last = null;
  };

  const hovers = matchMedia('(hover: hover)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    pointer = {x: e.clientX, y: e.clientY};
    wake();
  };
  // Out of the window altogether, not just off one element onto another.
  const onOut = (e: PointerEvent) => {
    if (e.relatedTarget || e.pointerType === 'touch') return;
    pointer = null;
    wake();
  };
  const listening = hovers && !still.matches;
  if (listening) {
    addEventListener('pointermove', onMove, {passive: true});
    document.addEventListener('pointerout', onOut, {passive: true});
  }

  return {
    place(next) {
      boxes = next;
      now = next.map((_, i) => now[i] ?? LEVEL);
      wake();
    },
    hold(moving) {
      held = moving;
      if (moving) sleep();
      else wake();
    },
    dispose() {
      sleep();
      if (listening) {
        removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerout', onOut);
      }
    },
  };
}
