/* Where the two of you are, trimmed down to something that can ride along with
   every turn. Python has no test class of its own for this -- the trimming was
   exercised through the session -- so what is here is the rules conversation/scene.ts
   states: four lines at most, seventy words at most, no preamble, and nothing
   that pretends to be prose. */
import {expect, test} from 'vitest';
import {ASK_ALL, ASK_PLACE, GUESS, SETTLED, asPromptBlock, isNowhere, trim} from './scene';

test('bullets and dashes are taken off', () => {
  expect(trim('- Place: a kitchen\n• Now: he is standing')).toBe(
    'Place: a kitchen\nNow: he is standing');
});

test('the model saying what it is about to do is not a scene', () => {
  expect(trim('Here is the scene:\nPlace: a kitchen')).toBe('Place: a kitchen');
  expect(trim('Sure!\nScene: a kitchen\nPlace: a kitchen')).toBe('Place: a kitchen');
});

test('four lines at most', () => {
  expect(trim('one\ntwo\nthree\nfour\nfive').split('\n')).toHaveLength(4);
});

test('and seventy words at most, cut on a whole line', () => {
  const long = ['a '.repeat(60).trim(), 'b '.repeat(30).trim()].join('\n');
  expect(trim(long).split('\n')).toHaveLength(1);
});

test('nothing at all is nothing', () => {
  expect(trim('')).toBe('');
  expect(trim('\n\n')).toBe('');
});

test('they are not anywhere, in the words a model uses for it', () => {
  for (const said of ['none', 'None.', 'no scene', 'nothing', 'N/A', '-']) {
    expect(isNowhere(said), said).toBe(true);
  }
  expect(isNowhere('Place: a kitchen')).toBe(false);
});

test('the block goes in brackets, and an empty scene puts nothing in front of a turn', () => {
  expect(asPromptBlock('', 'Where you are:')).toBe('');
  expect(asPromptBlock('Place: a kitchen', 'Where you are:'))
    .toBe('\n\n[Where you are:\nPlace: a kitchen]');
});

test('the two headings say whether the place was earned or guessed', () => {
  // A scene the conversation earned is a position somebody has taken; a seed is
  // the room describing itself to an empty chair.
  expect(SETTLED).not.toBe(GUESS);
  expect(ASK_PLACE).not.toBe(ASK_ALL);
});
