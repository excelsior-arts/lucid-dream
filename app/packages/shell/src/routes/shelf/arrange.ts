/* How the boxes stand on the table: how many to a row, and where the group
 * stands in the room.
 *
 * Rows are balanced, never a full row and a lonely last box: five boxes are
 * three and two, not four and one. Of the ways to lay them out, the one that
 * stands them largest wins -- except that a layout within 15 percent of it
 * that runs along the window (rows across a wide one, a column down a tall
 * one) is preferred, so two boxes stand side by side on a laptop and one
 * above the other on a phone or a tablet held upright, where side by side
 * made them half the size with the window empty above and below.
 */

/** The column counts worth trying for n boxes: each a balanced grid. */
export function columnChoices(n: number): number[] {
  const out = new Set<number>();
  for (let c = 1; c <= n; c++) out.add(Math.ceil(n / Math.ceil(n / c)));
  return [...out];
}

/** Within this share of the largest, a layout that runs along the window wins. */
export const ALONG = 0.15;

export function chooseColumns(n: number, scaleAt: (cols: number) => number, wide: boolean): number {
  const tried = columnChoices(n).map((cols) => ({cols, s: scaleAt(cols)}))
    .filter((t) => Number.isFinite(t.s) && t.s > 0);
  if (!tried.length) return wide ? n : 1;
  const best = Math.max(...tried.map((t) => t.s));
  const close = tried.filter((t) => t.s >= best * (1 - ALONG)).map((t) => t.cols);
  return wide ? Math.max(...close) : Math.min(...close);
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far to move a group, drawn at `group` and then scaled by `s` about
    `origin`, for it to stand in the middle of `room`. */
export function centring(group: Rect, s: number, origin: {x: number; y: number}, room: Rect) {
  const gx = (group.left + group.right) / 2, gy = (group.top + group.bottom) / 2;
  return {
    x: (room.left + room.right) / 2 - (origin.x + s * (gx - origin.x)),
    y: (room.top + room.bottom) / 2 - (origin.y + s * (gy - origin.y)),
  };
}

/** The group's rectangle once scaled about `origin` and moved by `by`. */
export function placed(group: Rect, s: number, origin: {x: number; y: number}, by: {x: number; y: number}): Rect {
  return {
    left: origin.x + s * (group.left - origin.x) + by.x,
    right: origin.x + s * (group.right - origin.x) + by.x,
    top: origin.y + s * (group.top - origin.y) + by.y,
    bottom: origin.y + s * (group.bottom - origin.y) + by.y,
  };
}

export const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
