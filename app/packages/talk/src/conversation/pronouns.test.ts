/* Two words in two places, and every sentence about either person said in
   the right ones. */
import {expect, test} from 'vitest';
import {conjugate, pronoun, say, words} from './pronouns';
import {ifTags} from './prompt';

test('a template reads as it was written for she and he, and agrees for they and it', () => {
  const t = '{S} {v:is} fond of {him}. {S} {v:keeps} {p} distance, and {he} {w:has} noticed. {He} {w:misses} {o}.';
  expect(say(t, {self: 'she', other: 'he'})).toBe('She is fond of him. She keeps her distance, and he has noticed. He misses her.');
  expect(say(t, {self: 'they', other: 'she'})).toBe('They are fond of her. They keep their distance, and she has noticed. She misses them.');
  expect(say(t, {self: 'it', other: 'they'})).toBe('It is fond of them. It keeps its distance, and they have noticed. They miss it.');
  expect(say('What {HE} said, and what {SS} said', {self: 'she', other: 'they'})).toBe('What THEY said, and what SHE said');
  // Values in the same pass, and a token nobody knows is left alone.
  expect(say('{name} is {s}; {other}', {self: 'he', other: 'he'}, {name: 'Cass'})).toBe('Cass is he; {other}');
  expect(say('{v:is}', {self: 'they', other: 'he'}, {})).toBe('are');
});

test('verbs agree the way English does, and the odd ones are known', () => {
  expect(conjugate('is', true)).toBe('are');
  expect(conjugate('has', true)).toBe('have');
  expect(conjugate('does', true)).toBe('do');
  expect(conjugate('goes', true)).toBe('go');
  expect(conjugate('was', true)).toBe('were');
  expect(conjugate('tries', true)).toBe('try');
  expect(conjugate('pushes', true)).toBe('push');
  expect(conjugate('misses', true)).toBe('miss');
  expect(conjugate('says', true)).toBe('say');
  expect(conjugate('keeps', false)).toBe('keeps');
  expect(conjugate("doesn't", true)).toBe("don't");
});

test('a word that is not a pronoun is the default, and the words for prose come as a set', () => {
  expect(pronoun('They', 'he')).toBe('they');
  expect(pronoun('xe', 'he')).toBe('he');
  expect(pronoun(undefined, 'she')).toBe('she');
  const w = words('they');
  expect(`${w.He} ${w.v('walks')} ${w.his} own way, and ${w.he} ${w.v('is')} not sorry.`).toBe('They walk their own way, and they are not sorry.');
  expect(words('it').himself).toBe('itself');
});

test('every shipped prompt is said whole: no pronoun token is left in it, only the content slots', async () => {
  const {prompts: shipped} = await import('./bundle');
  const prompts = shipped() as Record<string, string>;
  const slots = new Set(['name', 'existing', 'dropped', 'more', 'max_bullets', 'him_said', 'her_said',
                         'heading', 'previous', 'recent', 'ask', 'memory', 'standing', 'scene', 'tags']);
  for (const voice of [{self: 'she', other: 'he'}, {self: 'it', other: 'they'}] as const) {
    for (const [name, text] of Object.entries(prompts)) {
      // Said the way systemPrompt says it: for a voice with tags, and one without.
      for (const tagged of [true, false]) {
        const left = [...say(ifTags(text, tagged), voice).matchAll(/\{(\w+)(?::\w+)?\}/g)]
          .map((m) => m[1]!).filter((n) => !slots.has(n));
        expect(left, `${name} for ${voice.self}/${voice.other}, tags ${tagged}`).toEqual([]);
      }
    }
  }
  // And the words came out right where it matters most.
  expect(say(prompts.fold_system ?? '', {self: 'it', other: 'they'})).toContain('Write about\nthem as "they"');
  /* The one sentence a persona's header writes about the player -- what the
     quiet reads as -- is said in tokens too, and so is the engine's own. */
  const {all} = await import('./bundle');
  const {SILENCE} = await import('./loop');
  for (const card of all()) {
    const line = String((card as {silence_line?: unknown}).silence_line ?? '');
    if (!line) continue;
    expect(line.replace(/\{[^}]*\}/g, ''), `${card.slug} silence_line`).not.toMatch(/\b(he|she|him|her|his|they)\b/);
    expect(say(line, {self: 'it', other: 'they'})).not.toMatch(/\{\w+/);
  }
  expect(say(SILENCE, {self: 'it', other: 'they'})).toBe('(they have said nothing for a while)');
});
