/* The map of which tags each voice says well (voice-tags.json), the one list
 * both the machine and the page read. */
import {expect, test} from 'vitest';
import map from './voice-tags.json';
import {tagEntry, voiceTags} from './voice-tags';
import {ENGINES} from './page/voice';

const TOKENIZER = ['[advertisement]', '[angry]', '[chuckle]', '[clear throat]', '[cough]', '[crying]',
  '[dramatic]', '[fear]', '[gasp]', '[groan]', '[happy]', '[laugh]', '[narration]', '[sarcastic]',
  '[shush]', '[sigh]', '[sniff]', '[surprised]', '[whispering]'];

test('Turbo keeps what his ear kept, never [sniff] or [whispering]', () => {
  const {tags, known} = voiceTags('chatterbox-turbo', TOKENIZER);
  expect(known).toBe(true);
  expect(tags).toContain('[sigh]');
  for (const bad of ['[sniff]', '[whispering]', '[narration]', '[angry]']) expect(tags).not.toContain(bad);
});

test('only what the tokenizer knows: an entry adds no tag the model has no token for', () => {
  expect(voiceTags('chatterbox-turbo', ['[sigh]', '[sniff]']).tags).toEqual(['[sigh]']);
});

test('a voice with no entry keeps all its tokenizer knows, and inherits nothing', () => {
  expect(voiceTags('browser:nano', TOKENIZER)).toEqual({tags: TOKENIZER, known: false});
  expect(voiceTags('some-new-voice', ['[sniff]'])).toEqual({tags: ['[sniff]'], known: false});
});

test('the browser\'s Turbo is the Mac\'s model and reads its entry; Nano has none', () => {
  expect(tagEntry('browser:turbo')).toBe(tagEntry('chatterbox-turbo'));
  const card = (id: string) => ENGINES.find((e) => e.id === id)!;
  expect(card('turbo').tags).toEqual(voiceTags('chatterbox-turbo', TOKENIZER).tags);
  expect(card('nano').tags).toEqual(TOKENIZER);
  expect(card('sopro').tags).toEqual([]);
});

test('every tag in an entry has a note, and none is both said and not', () => {
  for (const [name, e] of Object.entries(map.voices as Record<string, {say?: Record<string, string>;
                                                                        not?: Record<string, string>}>)) {
    for (const note of [...Object.values(e.say ?? {}), ...Object.values(e.not ?? {})]) {
      expect(note.trim(), name).not.toBe('');
    }
    for (const t of Object.keys(e.say ?? {})) expect(Object.keys(e.not ?? {}), `${name} ${t}`).not.toContain(t);
  }
});
