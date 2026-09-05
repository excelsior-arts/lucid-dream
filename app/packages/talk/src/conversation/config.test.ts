/* What the game is tuned to, and what a page does when it cannot be asked.
 *
 * Every trigger in the loop is one of these numbers, and they used to arrive in
 * pieces on a tick. A room that would not open because a config route was down
 * would be a worse failure than a fold arriving a turn late, so the defaults
 * here are the same numbers config.py ships with.
 */
import {expect, test} from 'vitest';
import {DEFAULTS, readConfig} from './config';

test('what the machine says is what is used', () => {
  const got = readConfig({
    memory: {enabled: false, fold_after: 1, max_bullets: 20},
    relation: {enabled: true, score: false},
    scene: {enabled: true, every_words: 120},
    llm: {context_turns: 12, context_words: 0, temperature: 0.6, top_p: 0.9},
  });
  expect(got.memory).toEqual({enabled: false, fold_after: 1, max_bullets: 20});
  expect(got.relation.score).toBe(false);
  expect(got.scene.every_words).toBe(120);
  expect(got.llm).toEqual({context_turns: 12, context_words: 0,
                           temperature: 0.6, top_p: 0.9});
});

test('and anything it does not say is what the game ships with', () => {
  expect(readConfig({})).toEqual(DEFAULTS);
  expect(readConfig(null)).toEqual(DEFAULTS);
  expect(readConfig('a file somebody broke')).toEqual(DEFAULTS);
});

test('and how long a room may be left and still be the same sitting', () => {
  expect(readConfig({resume_within_minutes: 60}).resume_within_minutes).toBe(60);
  // Zero is a setting rather than a missing key: always start fresh.
  expect(readConfig({resume_within_minutes: 0}).resume_within_minutes).toBe(0);
});

test('a key of the wrong kind is a key nobody set', () => {
  /* config.json is edited by hand while the thing is running. A word where a
     number should be must not become a fold that never fires or a window of
     NaN turns. */
  const got = readConfig({memory: {fold_after: 'often'}, llm: {context_turns: null}});
  expect(got.memory.fold_after).toBe(DEFAULTS.memory.fold_after);
  expect(got.llm.context_turns).toBe(DEFAULTS.llm.context_turns);
});
