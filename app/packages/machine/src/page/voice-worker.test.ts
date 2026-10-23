/* What the voice worker hands its engine: one whole sentence at a time, cut
   where the reply's splitter cuts (speech.ts, SENTENCE_END) and nowhere else. */
import {expect, test} from 'vitest';
import {sentences, voiceText} from './voice-worker';

test('a merged chunk is cut back into its sentences', () => {
  expect(sentences('Yes. Come here! Are you? Good.')).toEqual(['Yes.', 'Come here!', 'Are you?', 'Good.']);
});

test('an ellipsis is a pause inside a sentence, both spellings, as on the Mac', () => {
  expect(sentences('Stay... just like that.')).toEqual(['Stay... just like that.']);
  expect(sentences('Stay… just like that.')).toEqual(['Stay… just like that.']);
});

test('an end inside a closing quote or bracket is an end', () => {
  expect(sentences('“Come here?” Then I kiss you.')).toEqual(['“Come here?”', 'Then I kiss you.']);
  expect(sentences('Did you? (I knew it.) Good.')).toEqual(['Did you?', '(I knew it.)', 'Good.']);
});

test('never at a comma, a dash, a colon or a semicolon', () => {
  const one = 'I come over and put my head on your chest, listening to the rain — the lamp low; all of it: ours.';
  expect(sentences(one)).toEqual([one]);
});

test('a tag with no words of its own goes with the sentence after it, never alone', () => {
  expect(sentences('Come closer. [sigh]. I am here.')).toEqual(['Come closer.', '[sigh]. I am here.']);
  expect(sentences('I know. [sigh]')).toEqual(['I know. [sigh]']);
  expect(sentences('[sigh]')).toEqual([]);
});

test('and a sentence that is only tags is nothing to say', () => {
  expect(voiceText('[sigh]', ['[sigh]'])).toBe('');
  expect(voiceText('[sigh] [mumble]', ['[sigh]'])).toBe('');
  expect(voiceText('[sigh] I know.', ['[sigh]'])).toBe('[sigh] I know.');
});
