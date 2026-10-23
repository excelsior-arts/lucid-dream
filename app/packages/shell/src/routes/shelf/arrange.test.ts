import {expect, test} from 'vitest';
import {centring, chooseColumns, columnChoices, overlaps, placed} from './arrange';

test('only balanced grids are tried: never a full row over a lonely box', () => {
  expect(columnChoices(1)).toEqual([1]);
  expect(columnChoices(2)).toEqual([1, 2]);
  expect(columnChoices(4)).toEqual([1, 2, 4]);
  // Five: one column, three and two, or one row -- never four and one.
  expect(columnChoices(5)).toEqual([1, 2, 3, 5]);
});

test('the largest layout wins, and between near equals the one along the window', () => {
  // Two boxes on a laptop: a row and a column stand about the same size.
  const laptop = (c: number) => (c === 2 ? 0.714 : 0.75);
  expect(chooseColumns(2, laptop, true)).toBe(2);
  // On a tablet held upright side by side is far smaller, and loses.
  const tablet = (c: number) => (c === 2 ? 0.515 : 0.822);
  expect(chooseColumns(2, tablet, false)).toBe(1);
  expect(chooseColumns(2, tablet, true)).toBe(1);
  // A phone held upright, two of near the same size: the column.
  expect(chooseColumns(2, () => 0.8, false)).toBe(1);
  // Nothing measured (no layout yet): along the window.
  expect(chooseColumns(3, () => 0, true)).toBe(3);
});

test('the group is moved to the middle of its room, after its scale', () => {
  const group = {left: 100, right: 300, top: 50, bottom: 150};
  const origin = {x: 200, y: 200};
  const room = {left: 0, right: 1000, top: 0, bottom: 800};
  const by = centring(group, 0.5, origin, room);
  const at = placed(group, 0.5, origin, by);
  expect((at.left + at.right) / 2).toBeCloseTo(500);
  expect((at.top + at.bottom) / 2).toBeCloseTo(400);
  expect(at.right - at.left).toBeCloseTo(100);
  expect(overlaps(at, {left: 540, right: 600, top: 0, bottom: 1000})).toBe(true);
  expect(overlaps(at, {left: 560, right: 600, top: 0, bottom: 1000})).toBe(false);
});
