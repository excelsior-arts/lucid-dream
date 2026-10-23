import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {intent, REST_MS, WARM_MS, WARM_REST_MS} from './intent';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const watch = () => {
  const shown: string[] = [];
  return {shown, eye: intent((id) => shown.push(id))};
};

test('a pointer passing over a box lifts nothing', () => {
  const {shown, eye} = watch();
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS - 50);
  eye.leave('a');
  eye.enter('b');
  vi.advanceTimersByTime(REST_MS - 50);
  eye.leave('b');
  vi.advanceTimersByTime(2000);
  expect(shown).toEqual([]);
});

test('a pointer resting on a box peeks it, once, after the rest', () => {
  const {shown, eye} = watch();
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS - 1);
  expect(shown).toEqual([]);
  eye.enter('a'); // moving on it restarts nothing
  vi.advanceTimersByTime(1);
  expect(shown).toEqual(['a']);
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS);
  expect(shown).toEqual(['a']);
});

test('from a peeking box straight to its neighbour is quick: the warm window', () => {
  const {shown, eye} = watch();
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS);
  eye.leave('a');
  vi.advanceTimersByTime(WARM_MS - 100);
  eye.enter('b');
  vi.advanceTimersByTime(WARM_REST_MS);
  expect(shown).toEqual(['a', '', 'b']);
});

test('the window cools: long after a peek, the next box waits the whole rest', () => {
  const {shown, eye} = watch();
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS);
  eye.leave('a');
  vi.advanceTimersByTime(WARM_MS + 1);
  eye.enter('b');
  vi.advanceTimersByTime(WARM_REST_MS);
  expect(shown).toEqual(['a', '']);
  vi.advanceTimersByTime(REST_MS - WARM_REST_MS);
  expect(shown).toEqual(['a', '', 'b']);
});

test('leaving a peeking box lets it down at once, and a warm pass-through still does nothing', () => {
  const {shown, eye} = watch();
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS);
  eye.leave('a');
  expect(shown).toEqual(['a', '']);
  eye.enter('b');
  vi.advanceTimersByTime(WARM_REST_MS - 10);
  eye.leave('b');
  vi.advanceTimersByTime(1000);
  expect(shown).toEqual(['a', '']);
});

test('a reset (the table moving) drops the peek, the wait and the warmth', () => {
  const {shown, eye} = watch();
  eye.enter('a');
  vi.advanceTimersByTime(REST_MS);
  eye.enter('b'); // still on a, as far as leave is concerned
  eye.reset();
  vi.advanceTimersByTime(1000);
  expect(shown).toEqual(['a', '']);
  eye.enter('b');
  vi.advanceTimersByTime(WARM_REST_MS);
  expect(shown).toEqual(['a', '']);
});
