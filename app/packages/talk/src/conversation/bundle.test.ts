/* What this game ships with, as it is in the package.
 *
 * These questions used to be asked of the Python that read the same files off
 * disk, and they are the same questions. A character is content rather than
 * code — a prompt and the name of a voice — so most of what can go wrong is a
 * file that no longer parses into what the rest of the game expects, and the
 * first anybody hears of it is a pill that will not open.
 *
 * The other half is the line the reader holds. Nothing in it knows what a
 * persona is *for*: it parses whatever header is there, hands it over unread,
 * and has an opinion about exactly two things — a draft is written but not
 * offered, and a character may borrow another's voice.
 */
import {expect, test} from 'vitest';
import {all, frontmatter, personas, prompts, voiceName} from './bundle';

// ---- the header ------------------------------------------------------------

test('a header and a body', () => {
  const [meta, body] = frontmatter('---\nname: Ada\n---\nyou are Ada.\n');
  expect(meta.name).toBe('Ada');
  expect(body.trim()).toBe('you are Ada.');
});

test('a file with no header is all body', () => {
  const [meta, body] = frontmatter('just words\n');
  expect(meta).toEqual({});
  expect(body).toBe('just words\n');
});

test('a header that will not parse loses the header, and says so', () => {
  /* Silently, every value in that header would be a default: a character that
     un-drafts itself, is called by its slug and speaks in a voice the shelf
     may not have. So the trouble comes back with the body, and `card` keeps
     such a file out of the box. */
  const [meta, body, broken] = frontmatter('---\nname: [unclosed\n---\nthe body\n');
  expect(meta).toEqual({});
  expect(body.trim()).toBe('the body');
  expect(broken).toBeTruthy();
});

test('and one that is not a bag of keys', () => {
  const [meta, , broken] = frontmatter('---\n- one\n- two\n---\nbody\n');
  expect(meta).toEqual({});
  expect(broken).toBeTruthy();
});

test('a file with a header that reads is not broken', () => {
  const [, , broken] = frontmatter('---\nname: Ada\n---\nyou are Ada.\n');
  expect(broken).toBe('');
});

test('what a value was written as is what it comes back as', () => {
  const [meta] = frontmatter(
    '---\n'
    + 'temperature: 0.9 # 0.99 turns into word-salad\n'
    + 'color: "205, 111, 184"   # not a violet\n'
    + '# a whole line of why\n'
    + 'draft: true\n'
    + 'place: |\n'
    + '  A warm room in the evening,\n'
    + '  and it is raining outside.\n'
    + '---\nbody\n');
  expect(meta.temperature).toBe(0.9);
  expect(meta.color).toBe('205, 111, 184');
  expect(meta.draft).toBe(true);
  expect(meta.place).toBe('A warm room in the evening,\nand it is raining outside.\n');
});

// ---- the characters we ship ------------------------------------------------

test('there are some', () => {
  expect(personas().length).toBeGreaterThan(0);
});

test('every one has what the game reads off it', () => {
  for (const card of personas()) {
    for (const key of ['slug', 'name', 'pill', 'voice', 'prompt'] as const) {
      expect(card[key], `${card.slug} has no ${key}`).toBeTruthy();
    }
  }
});

test('and whatever else it happens to say', () => {
  /* The keys the game invents come through as they were written. A reader with
     a list of allowed names would be a reader somebody has to edit to add a
     colour. */
  const lover = personas().find((p) => p.slug === 'lover');
  expect(lover?.figure).toBe('diamond');
  expect(lover?.temperature).toBe(0.9);
  expect(lover?.place).toContain('rain');
});

test('a character is never shown its own name', () => {
  /* `name` is the prompt's and `pill` is the player's, and the split is what
     keeps the interface free of who the character happens to be this month. */
  for (const card of personas()) expect(card.pill).not.toBe(card.name);
});

test('a voice is a path on the shelf, its own unless it borrows one', () => {
  /* The shelf is the published pack as it is, so this game's clips sit in
     its own folder there; a persona writes one word and the folder is put
     in front of it here. A name with a slash is taken as written. */
  for (const card of all()) {
    expect(card.voice, `${card.slug} names no voice`)
      .toMatch(/^(@[A-Za-z0-9_.~:-]+\/)?[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/);
  }
  expect(personas().find((p) => p.slug === 'lover')?.voice).toBe('lucid_talk/personas/lover');
  expect(voiceName('lover')).toBe('lucid_talk/personas/lover');
  expect(voiceName('lucid_trip/personas/narrator')).toBe('lucid_trip/personas/narrator');
  expect(voiceName('@lucid-talk/personas/lover')).toBe('@lucid-talk/personas/lover');
  expect(voiceName('mine/nova')).toBe('mine/nova');
});

test('a draft is written and not offered', () => {
  const offered = new Set(personas().map((p) => p.slug));
  const drafts = all().filter((p) => !offered.has(p.slug) && !p.internal);
  expect(drafts.length, 'no draft to check with').toBeGreaterThan(0);
  for (const one of drafts) expect(one.draft, one.slug).toBe(true);
});

test('a character that says nothing about its colour is a character', () => {
  for (const card of all()) expect(card.color).toBeTruthy();
});

// ---- the prompts -----------------------------------------------------------

test('they are the text of the files', () => {
  expect(prompts().system?.trim()).toBeTruthy();
});

test('which ones there are is the directory', () => {
  /* Not a list written down: a prompt invented tomorrow is a file dropped in
     beside the others, and whoever assembles a turn asks for it by name. */
  const names = Object.keys(prompts());
  expect(names).toContain('fold_system');
  expect(names).toContain('scene_user');
  expect(names.every((n) => !n.endsWith('.md'))).toBe(true);
});

test('a prompt that is not there is empty rather than an error', () => {
  /* A missing one must not end a turn: every use is `prompts.x ?? ''`. */
  expect(prompts().no_such_prompt).toBeUndefined();
});
