/* A build that moved under an open tab: its old chunks are gone, and the press reloads, once. */
import {beforeEach, expect, test, vi} from 'vitest';
import {reloadOnce, stale} from './lazy';

beforeEach(() => { sessionStorage.clear(); vi.useRealTimers(); });

test('a module the server no longer has is told from any other failure, in each engine\'s words', () => {
  expect(stale(new TypeError('error loading dynamically imported module: http://x/assets/trip-abc.js'))).toBe(true);
  expect(stale(new TypeError('Failed to fetch dynamically imported module: http://x/assets/trip-abc.js'))).toBe(true);
  expect(stale(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(stale(new Error('the chunk did not come'))).toBe(false);
  expect(stale(null)).toBe(false);
});

test('the page reloads once, and not again while that reload is fresh', () => {
  const reload = vi.fn();
  expect(reloadOnce(reload)).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(reloadOnce(reload)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  // A minute on, a build that moved again is a new reason.
  vi.useFakeTimers({now: Date.now() + 61_000});
  expect(reloadOnce(reload)).toBe(true);
  vi.useRealTimers();
});
