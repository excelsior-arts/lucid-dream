/* What a conversation may be called, and what a room may be pointed at.
 *
 * The name-grammar half of test_names.py. The other half of that file is about
 * paths and files and stays in Python, where the paths and the files are.
 */
import {expect, test} from 'vitest';
import {canOpen, nameFor, namedWell, whose} from './named';

test('the ones this program makes', () => {
  for (const good of ['2026-08-21T10-49-23_thinker',
                      '2026-08-21T10-49-23-2_lover',
                      '2026-01-01T00-00-00_some-pill']) {
    expect(namedWell(good), good).toBe(true);
  }
});

test('and nothing else', () => {
  for (const bad of ['', '../../../etc/passwd', 'thinker',
                     '2026-08-21T10-49-23_thinker/../../x',
                     '/etc/passwd', '2026-08-21_thinker', '..', 'x'.repeat(300)]) {
    expect(namedWell(bad), JSON.stringify(bad)).toBe(false);
  }
});

test('a name says whose it is', () => {
  expect(whose('2026-08-21T10-49-23_thinker')).toBe('thinker');
  expect(whose('2026-08-21T10-49-23-2_some-pill')).toBe('some-pill');
  expect(whose('../../etc/passwd')).toBe('');
});

test('a room opens its own pill\'s conversations, spoken in or not', () => {
  // Whether there is a file behind it is not a question this end can ask, and
  // does not need to be: the name was only ever a name.
  expect(canOpen('2026-03-03T03-03-03_lover', 'lover')).toBe(true);
});

test('and nothing else at all', () => {
  expect(canOpen('2026-03-03T03-03-03_lover', 'thinker')).toBe(false);
  for (const bad of ['20260621T10-49-23_thinker', 'hello', '../../etc/passwd', '']) {
    expect(canOpen(bad, 'thinker'), bad).toBe(false);
  }
});

test('a new conversation is named the moment and the pill', () => {
  const id = nameFor('lover');
  expect(namedWell(id), id).toBe(true);
  expect(whose(id)).toBe('lover');
});

test('and two begun in one second are two conversations', () => {
  /* Take a pill, change your mind, take it again; or open a room twice while
     the first is still settling. Both would have been the same file, and the
     second's turns would have landed in the first. */
  const names = [nameFor('lover'), nameFor('lover'), nameFor('lover')];
  expect(new Set(names).size).toBe(3);
  for (const id of names) expect(namedWell(id), id).toBe(true);
});
