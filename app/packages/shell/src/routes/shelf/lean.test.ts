import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {EASE_MS, falloff, leaning, MOST_X, MOST_Y, REACH, target, type Clock} from './lean';

/* Two boxes in a row, 400 wide and 260 tall, 80 apart. */
const LEFT = {left: 100, right: 500, top: 300, bottom: 560};
const RIGHT = {left: 580, right: 980, top: 300, bottom: 560};
const MID = 430;

let media: Record<string, boolean>;
beforeEach(() => {
  media = {'(hover: hover)': true, '(prefers-reduced-motion: reduce)': false};
  vi.stubGlobal('matchMedia', (q: string) => ({matches: !!media[q], addEventListener() {}, removeEventListener() {}}));
});
afterEach(() => void vi.unstubAllGlobals());

test('a box faces the cursor: up for one above it, right for one to its right', () => {
  const above = target({x: 300, y: 280}, LEFT);
  expect(above.x).toBeGreaterThan(0);
  expect(above.y).toBe(0);
  const right = target({x: 520, y: MID}, LEFT);
  expect(right.y).toBeGreaterThan(0);
  expect(right.x).toBe(0);
  // Level under a cursor on its middle, and for no cursor at all.
  expect(target({x: 300, y: MID}, LEFT)).toEqual({x: 0, y: 0});
  expect(target(null, LEFT)).toEqual({x: 0, y: 0});
});

test('two boxes turn by where the cursor is to each of them, not to the window', () => {
  // Between them: towards each other.
  const between = {x: 540, y: MID};
  expect(target(between, LEFT).y).toBeCloseTo(MOST_Y * falloff(40 / 400), 5);
  expect(target(between, RIGHT).y).toBeCloseTo(-MOST_Y * falloff(40 / 400), 5);
  // Beside the left one: that one turns to it in full, the other barely.
  const beside = {x: 60, y: MID};
  expect(target(beside, LEFT).y).toBeCloseTo(-MOST_Y * falloff(40 / 400), 5);
  expect(Math.abs(target(beside, RIGHT).y)).toBeLessThan(MOST_Y * 0.15);
});

test('over a box it leans as the one box did over the window, most at its edges', () => {
  expect(target({x: 200, y: MID}, LEFT).y).toBeCloseTo(-MOST_Y / 2);
  expect(target({x: 500, y: 300}, LEFT)).toEqual({x: MOST_X, y: MOST_Y});
});

test('the falloff: whole at the edge, half at REACH widths beyond it, a fifth at twice that', () => {
  expect(falloff(0)).toBe(1);
  expect(falloff(-1)).toBe(1);
  expect(falloff(REACH)).toBeCloseTo(0.5);
  expect(falloff(REACH * 2)).toBeCloseTo(0.2);
  // Measured in the box's own widths: the same place is nearer to a bigger box.
  const far = {x: 100 + 400 + 200, y: MID};
  const big = {...LEFT, right: 100 + 800};
  expect(target({x: big.right + 200, y: MID}, big).y).toBeGreaterThan(target(far, LEFT).y);
  // And never past the most, however it is approached.
  for (const p of [{x: -5000, y: -5000}, {x: 501, y: 299}, {x: 5000, y: MID}]) {
    const l = target(p, LEFT);
    expect(Math.abs(l.x)).toBeLessThanOrEqual(MOST_X);
    expect(Math.abs(l.y)).toBeLessThanOrEqual(MOST_Y);
  }
});

/* The loop, on a clock run by hand. */
const clock = () => {
  let queue: ((t: number) => void)[] = [];
  let t = 0;
  const c: Clock & {run(ms: number): void; pending(): number} = {
    frame: (cb) => queue.push(cb),
    cancel: () => void (queue = []),
    run(ms) {
      for (const end = t + ms; t < end && queue.length;) {
        t += 16;
        const due = queue;
        queue = [];
        for (const cb of due) cb(t);
      }
    },
    pending: () => queue.length,
  };
  return c;
};
const shelf = () => {
  const a = document.createElement('a'), b = document.createElement('a');
  const c = clock();
  const l = leaning(c);
  l.place([{el: a, rect: LEFT}, {el: b, rect: RIGHT}]);
  const lean = (el: HTMLElement) => ({x: +el.style.getPropertyValue('--lean-x'), y: +el.style.getPropertyValue('--lean-y')});
  return {a, b, c, l, lean};
};
const move = (x: number, y: number, pointerType = 'mouse') =>
  dispatchEvent(Object.assign(new MouseEvent('pointermove', {clientX: x, clientY: y}), {pointerType}));
const out = () => document.dispatchEvent(Object.assign(new MouseEvent('pointerout', {relatedTarget: null}), {pointerType: 'mouse'}));

test('each box eases towards its own lean and then the loop sleeps', () => {
  const {a, b, c, l, lean} = shelf();
  move(540, MID);
  c.run(16);
  // One frame in: on its way, not there.
  expect(lean(a).y).toBeGreaterThan(0);
  expect(lean(a).y).toBeLessThan(MOST_Y * 0.2);
  expect(lean(b).y).toBeLessThan(0);
  c.run(EASE_MS * 8);
  expect(lean(a).y).toBeCloseTo(MOST_Y * falloff(40 / 400), 1);
  expect(lean(b).y).toBeCloseTo(-MOST_Y * falloff(40 / 400), 1);
  expect(c.pending()).toBe(0);
  l.dispose();
});

test('a cursor jumping from one box to the other turns them round, not snaps them', () => {
  const {a, c, l, lean} = shelf();
  move(60, MID);
  c.run(EASE_MS * 8);
  expect(lean(a).y).toBeLessThan(-MOST_Y * 0.9);
  move(540, MID);
  c.run(16);
  expect(lean(a).y).toBeLessThan(-MOST_Y * 0.7);
  c.run(EASE_MS * 8);
  expect(lean(a).y).toBeCloseTo(MOST_Y * falloff(40 / 400), 1);
  l.dispose();
});

test('the pointer leaving the window lets every box settle back level', () => {
  const {a, b, c, l, lean} = shelf();
  move(540, 280);
  c.run(EASE_MS * 8);
  expect(lean(a).x).not.toBe(0);
  out();
  c.run(16);
  expect(Math.abs(lean(a).y)).toBeGreaterThan(MOST_Y * 0.8); // easing, not dropped
  c.run(EASE_MS * 10);
  expect(lean(a)).toEqual({x: 0, y: 0});
  expect(lean(b)).toEqual({x: 0, y: 0});
  expect(c.pending()).toBe(0);
  l.dispose();
});

test('a touch leans nothing, and nor does a screen with no hover', () => {
  const {a, c, l} = shelf();
  move(540, MID, 'touch');
  c.run(1000);
  expect(a.style.getPropertyValue('--lean-y')).toBe('');
  l.dispose();
  media['(hover: hover)'] = false;
  const t = shelf();
  move(540, MID);
  t.c.run(1000);
  expect(t.a.style.getPropertyValue('--lean-y')).toBe('');
  t.l.dispose();
});

test('nobody who asked for less motion is shown a lean', () => {
  media['(prefers-reduced-motion: reduce)'] = true;
  const {a, c, l} = shelf();
  move(540, MID);
  c.run(1000);
  expect(a.style.getPropertyValue('--lean-y')).toBe('');
  l.dispose();
});

test('held while the table moves: nothing written, and on from where it was after', () => {
  const {a, c, l, lean} = shelf();
  move(540, MID);
  c.run(48);
  const was = lean(a).y;
  l.hold(true);
  move(60, MID);
  c.run(1000);
  expect(lean(a).y).toBe(was);
  l.hold(false);
  c.run(16);
  expect(lean(a).y).toBeLessThan(was);
  expect(lean(a).y).toBeGreaterThan(-MOST_Y * 0.5);
  c.run(EASE_MS * 8);
  expect(lean(a).y).toBeCloseTo(-MOST_Y * falloff(40 / 400), 1);
  l.dispose();
});

test('a box placed again leans from where it stands now, and gone listening stops', () => {
  const {a, c, l, lean} = shelf();
  move(540, MID);
  c.run(EASE_MS * 8);
  // The window resized: the left box is now where the cursor is beyond it.
  l.place([{el: a, rect: {left: 600, right: 1000, top: 300, bottom: 560}}]);
  c.run(EASE_MS * 8);
  expect(lean(a).y).toBeLessThan(0);
  l.dispose();
  const before = lean(a);
  move(2000, MID);
  c.run(1000);
  expect(lean(a)).toEqual(before);
});
