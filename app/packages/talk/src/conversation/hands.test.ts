/* Presses on things in the room, and what a run of them reads as.
 *
 * What is here is the pooling: the same press over and over is one sentence
 * with a count on it, different things keep their order, and a drum solo is
 * not written out in full. When a run becomes a turn at all is timing, and is
 * beside the loop -- see loop.test.ts.
 */
import {expect, test} from 'vitest';
import {pool, takeHands} from './hands';

test('the same press over and over', () => {
  for (const [n, want] of [[1, ''], [2, '(and again)'], [3, '(and again, twice more)'],
                           [5, '(and again, and again)']] as const) {
    const done = Array<string>(n).fill('(he pushes a book)');
    expect(takeHands(done), `${n} presses`).toBe(('(he pushes a book) ' + want).trim());
  }
});

test('different things keep their order', () => {
  expect(takeHands(['(a)', '(b)', '(b)', '(c)'])).toBe('(a) (b) (and again) (c)');
});

test('a drum solo is not kept in full', () => {
  let done: string[] = [];
  for (let i = 0; i < 40; i++) done = pool(done, '(he pushes a book)');
  expect(done.length).toBeLessThanOrEqual(12);
});

test('nothing at all is not a press', () => {
  expect(pool([], '')).toEqual([]);
  expect(pool([], '   ')).toEqual([]);
});

test('nothing done is nothing said', () => {
  expect(takeHands([])).toBe('');
});
