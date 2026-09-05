import {afterEach, expect, test, vi} from 'vitest';
import {backend} from './backend';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('the page it was served by, spoken to as a socket', () => {
  expect(backend()).toBe(location.origin.replace(/^http/, 'ws'));
});

test('a backend set at build time wins', () => {
  vi.stubEnv('VITE_BACKEND', 'ws://127.0.0.1:6969');
  expect(backend()).toBe('ws://127.0.0.1:6969');
});
