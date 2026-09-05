/* Tidying what a model hands back: bullets only, capped, preamble dropped.
   When a fold runs at all is in after.test.ts, and the file it writes is the
   machine's. */
import {expect, test} from 'vitest';
import {asPromptBlock, clean} from './memory';

test('preamble is dropped and lines become bullets', () => {
  // Models like to add preamble, and bullets are the whole format.
  expect(clean('Here is the memory:\n- one\ntwo\n* three\n• four', 10).split('\n'))
    .toEqual(['- one', '- two', '- three', '- four']);
});

test('it stops at the cap', () => {
  const forty = Array.from({length: 40}, (_, i) => `- line ${i}`).join('\n');
  expect(clean(forty, 5).split('\n')).toHaveLength(5);
});

test('pure preamble leaves nothing', () => {
  expect(clean('Certainly!', 10)).toBe('');
  expect(clean('', 10)).toBe('');
});

test('nothing remembered is nothing in the prompt', () => {
  expect(asPromptBlock('', 'What you remember about him:')).toBe('');
  expect(asPromptBlock('- he has a brother', 'What you remember about him:'))
    .toContain('brother');
});
