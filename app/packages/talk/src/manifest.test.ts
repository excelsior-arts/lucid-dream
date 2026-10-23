/* Lucid Talk's address is not its name. */
import {expect, test} from 'vitest';
import {talk} from './manifest';
import {GAME} from './conversation/files';

test('at /talk, kept under lucid-talk, and arrived at from the old address', () => {
  expect(talk.path).toBe('talk');
  expect(talk.slug).toBe('lucid-talk');
  // The files are the game's name, which an address never moves.
  expect(GAME).toBe(talk.slug);
  expect(talk.was).toEqual(['lucid-talk']);
  expect(talk.where('/talk/lover')).toBe('room');
  expect(talk.where('/talk')).toBe('');
});

test('an address that is nobody else\'s', () => {
  /* The machine answers these itself and never hands them to the page, and a
     static build writes files under them (static-host.ts): a game at one of
     them would be a game nobody could reach. */
  const TAKEN = ['shared', 'assets', 'machine', 'store', 'og', 'favicon.ico', 'apple-touch-icon.png'];
  expect(TAKEN).not.toContain(talk.path);
  expect(talk.path).toMatch(/^[a-z][a-z0-9-]*$/);
});
