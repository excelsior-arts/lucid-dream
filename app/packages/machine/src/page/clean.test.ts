/* What a small model writes that nobody should read, taken out as it streams. */
import {expect, test} from 'vitest';
import {cleaner, shown} from './clean';

const streamed = (raw: string, step = 3): string => {
  const c = cleaner();
  let out = '';
  for (let i = 0; i < raw.length; i += step) out += c.take(raw.slice(i, i + step));
  return out + c.end();
};

test('the empty thought Qwen opens with goes, however it arrives', () => {
  expect(streamed('<think>\n\n</think>\n\nYou came back.', 1)).toBe('You came back.');
  expect(streamed('<think>\n\n</think>\n\nYou came back.', 5)).toBe('You came back.');
});

test('a stage direction goes, and the spacing it leaves', () => {
  expect(streamed('*leans back, smiling* You came back. *sighs* Sit.', 2))
    .toBe('You came back. Sit.');
  expect(shown('I know *laughs*, I know.', true)).toBe('I know, I know.');
});

test('arithmetic and a bullet are not actions', () => {
  expect(streamed('Two * three is six.')).toBe('Two * three is six.');
  expect(streamed('* he has a dog\n* he hates rain', 4)).toBe('* he has a dog\n* he hates rain');
});

test('an asterisk that never closes is let go of at the end', () => {
  expect(streamed('You *really')).toBe('You *really');
});
