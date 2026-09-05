/* What comes back from the recognizer when it heard the room.
 *
 * Ported from test_speech.WhatIsNotWorthAnswering, and it moved for the same
 * reason the listening did: the machine's /machine/stt returns what the model
 * said, and what is worth answering is the caller's question.
 */
import {expect, test} from 'vitest';
import {isJunk, normalize} from './junk';

test('the usual noises are junk', () => {
  for (const noise of ['', '   ', 'thank you', 'Thank you!']) {
    expect(isJunk(noise)).toBe(true);
  }
});

test('something somebody said is not', () => {
  for (const real of ['are you there', 'I have been thinking', 'no']) {
    expect(isJunk(real)).toBe(false);
  }
});

test('punctuation and case do not make a new sentence', () => {
  expect(normalize('  Thank  YOU!! ')).toBe('thank you');
});

test('and a name with an accent in it is not punctuation', () => {
  // Python's \w is every letter there is, and a recognizer that heard a name
  // has not heard nothing.
  expect(normalize('Renée!')).toBe('renée');
  expect(isJunk('Renée')).toBe(false);
});

test('one word can be a question, and "you?" is one', () => {
  // It was on the list as the recognizer's guess at nothing, and a person
  // asking "you?" was answered with a note about no usable speech.
  expect(isJunk('You?')).toBe(false);
});
