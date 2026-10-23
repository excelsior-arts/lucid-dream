/* A character, as this player has it.
 *
 * Two layers and one rule: the game ships the words and the header, the player
 * may replace the words and any of the numbers, and nothing else about a
 * character is theirs to change. So what is worth holding still here is what
 * an override *does not* touch — the pill's name, its colour, the room it
 * opens in — and that the whole of it comes back when the two files go.
 *
 * The shipped half is the real content, read out of the package the way the
 * game reads it: this is the seam between what travels in the bundle and what
 * sits in a player's directory, and stubbing both sides of a seam tests
 * nothing. The player's half is a bag standing in for the store, because what
 * is under test is the layering and files.test.ts already owns the addresses.
 */
import {beforeEach, expect, test, vi} from 'vitest';
import type {PersonaCard} from '../link/shapes';

const disk = vi.hoisted(() => ({
  /** The player's two files, by the path files.ts would write them at. */
  files: new Map<string, string>(),
  /** Every read, so the cache can be counted. */
  read: [] as string[],
  /** What the machine says it can speak in; nothing is one not answering. */
  shelf: ['lucid_talk/personas/lover', 'lucid_talk/personas/thinker'] as string[] | null,
  /** The store, refusing. Not the ordinary "nothing written yet": that is no
      bytes and reads as no override. */
  down: false,
}));

const at = (slug: string, name: string) => `personas/${slug}/${name}`;

vi.mock('./files', () => ({
  personaPrompt: (slug: string) => {
    disk.read.push(`prompt ${slug}`);
    if (disk.down) return Promise.reject(new Error('the machine is not answering'));
    return Promise.resolve(disk.files.get(at(slug, 'prompt.md')) ?? null);
  },
  savePersonaPrompt: (slug: string, text: string) => {
    disk.files.set(at(slug, 'prompt.md'), text.trim() + '\n');
    return Promise.resolve();
  },
  forgetPersonaPrompt: (slug: string) =>
    Promise.resolve(disk.files.delete(at(slug, 'prompt.md'))),
  personaTunables: (slug: string) => {
    disk.read.push(`tunables ${slug}`);
    const raw = disk.files.get(at(slug, 'tunables.json'));
    return Promise.resolve(raw === undefined ? null : JSON.parse(raw));
  },
  savePersonaTunables: (slug: string, tuned: unknown) => {
    disk.files.set(at(slug, 'tunables.json'), JSON.stringify(tuned));
    return Promise.resolve();
  },
  forgetPersonaTunables: (slug: string) =>
    Promise.resolve(disk.files.delete(at(slug, 'tunables.json'))),
}));

/* The shelf, which is the one thing a tunable is checked against: a voice is a
   clip on the machine and naming one it has not got is silent from in here --
   the words arrive and the sound does not. */
vi.mock('@lucid/machine', () => ({
  voices: () => (disk.shelf ? Promise.resolve(disk.shelf)
                            : Promise.reject(new Error('the machine is not answering'))),
}));

const {all} = await import('./bundle');
const P = await import('./persona');
const {systemFor} = await import('./prompt');

/** What the game ships for the pill every one of these is about. */
const SHIPPED = all().find((p) => p.slug === 'lover') as PersonaCard;

const PROMPTS = {system: 'You are heard aloud, not read.\n'};
const front = (persona: PersonaCard) => systemFor(persona, PROMPTS, '', null);

beforeEach(() => {
  disk.files.clear();
  disk.read.length = 0;
  disk.shelf = ['lucid_talk/personas/lover', 'lucid_talk/personas/thinker'];
  disk.down = false;
  P.forget();
});

// ---- the two layers ---------------------------------------------------------

test('with nothing of the player’s, the character is the one the game ships', async () => {
  expect(await P.effectivePersona('lover')).toEqual(SHIPPED);
});

test('a prompt of their own replaces the words and nothing else', async () => {
  /* The header-derived half is not in that file and is not theirs: what a pill
     is called, what colour it is and where it begins are what the box is drawn
     from, and a character that could rename itself out of its own card is a
     card pointing at nothing. */
  disk.files.set(at('lover', 'prompt.md'), 'You are somebody else entirely.\n');
  const now = await P.effectivePersona('lover');
  expect(now.prompt).toBe('You are somebody else entirely.');
  expect(now.pill).toBe(SHIPPED.pill);
  expect(now.name).toBe(SHIPPED.name);
  expect(now.color).toBe(SHIPPED.color);
  expect(now.figure).toBe(SHIPPED.figure);
  expect(now.place).toBe(SHIPPED.place);
  expect(now.voice).toBe(SHIPPED.voice);
  expect(now.temperature).toBe(SHIPPED.temperature);
});

test('and tunables come over the header one key at a time', async () => {
  disk.files.set(at('lover', 'tunables.json'), '{"temperature": 0.4, "voice": "thinker"}');
  const now = await P.effectivePersona('lover');
  expect(now.temperature).toBe(0.4);
  // A bare word in the file is one of this game's own, the way the header's is.
  expect(now.voice).toBe('lucid_talk/personas/thinker');
  // The rest of the header is exactly as it shipped, and so are the words.
  expect(now.top_p).toBe(SHIPPED.top_p);
  expect(now.prompt).toBe(SHIPPED.prompt);
});

test('a key nobody knows and a value of the wrong kind are dropped, not thrown', async () => {
  /* Two files in a player's own directory: somebody will open them in an
     editor, and one bad line must cost that line rather than the character. */
  disk.files.set(at('lover', 'tunables.json'),
    '{"temperature": "warm", "top_p": 0.5, "colour": "green", "voice": "  "}');
  const now = await P.effectivePersona('lover');
  expect(now.top_p).toBe(0.5);
  expect(now.temperature).toBe(SHIPPED.temperature);
  expect(now.voice).toBe(SHIPPED.voice);
  expect(now.colour).toBeUndefined();
});

test('a number outside anything sensible is a typo, and is left out', () => {
  expect(P.tunablesOf({temperature: 40})).toEqual({});
  expect(P.tunablesOf({top_p: 0.9})).toEqual({top_p: 0.9});
});

test('a machine that will not answer is the shipped character, not a room that will not open',
  async () => {
    disk.down = true;
    expect((await P.effectivePersona('lover')).prompt).toBe(SHIPPED.prompt);
  });

// ---- what a player writes ---------------------------------------------------

test('an empty save is a reset: there is no character with nothing to say', async () => {
  await P.setPrompt('lover', 'You always mention the rain.');
  expect(disk.files.has(at('lover', 'prompt.md'))).toBe(true);
  await P.setPrompt('lover', '   \n  ');
  expect(disk.files.has(at('lover', 'prompt.md'))).toBe(false);
  expect((await P.effectivePersona('lover')).prompt).toBe(SHIPPED.prompt);
});

test('a voice this machine has not got is refused, and nothing is written', async () => {
  await expect(P.tune('lover', 'voice', 'gold')).rejects.toThrow(/no voice called "lucid_talk\/personas\/gold"/);
  expect(disk.files.has(at('lover', 'tunables.json'))).toBe(false);
  // And one it has is taken, written in full so the file says where it is.
  await P.tune('lover', 'voice', 'thinker');
  expect((await P.effectivePersona('lover')).voice).toBe('lucid_talk/personas/thinker');
});

test('and in a browser the shelf is the browser\'s', async () => {
  const {MACHINE, PAGE, setHost} = await import('@lucid/shell');
  setHost(PAGE);
  try {
    await expect(P.tune('lover', 'voice', 'gold')).rejects.toThrow(/^this browser has no voice called/);
  } finally {
    setHost(MACHINE);
  }
  await expect(P.tune('lover', 'voice', 'gold')).rejects.toThrow(/^this machine has no voice called/);
});

test('and a shelf nobody answered with is not a shelf to check against', async () => {
  /* Refused rather than written: the whole point of the check is that a wrong
     voice is silent from in here, and writing one unchecked would be the bug
     the check exists for, arrived at politely. */
  disk.shelf = null;
  await expect(P.tune('lover', 'voice', 'thinker')).rejects.toThrow(/could not be checked/);
  expect(disk.files.has(at('lover', 'tunables.json'))).toBe(false);
});

test('a tunable keeps the ones set before it', async () => {
  await P.tune('lover', 'temperature', '0.4');
  await P.tune('lover', 'top_p', '0.8');
  const now = await P.effectivePersona('lover');
  expect(now.temperature).toBe(0.4);
  expect(now.top_p).toBe(0.8);
});

test('what is not a key, and what is not a number, are said rather than written', async () => {
  await expect(P.tune('lover', 'mood', '3')).rejects.toThrow(/nothing called mood/);
  await expect(P.tune('lover', 'temperature', 'warm')).rejects.toThrow(/is a number/);
  await expect(P.tune('lover', 'top_p', '4')).rejects.toThrow(/between 0 and 1/);
  expect(disk.files.size).toBe(0);
});

test('a reset takes both files', async () => {
  await P.setPrompt('lover', 'You always mention the rain.');
  await P.tune('lover', 'temperature', '0.4');
  expect(await P.resetPersona('lover')).toBe(true);
  expect(disk.files.size).toBe(0);
  // And again is not a failure: there was simply nothing of yours left.
  expect(await P.resetPersona('lover')).toBe(false);
});

// ---- and what the model is shown --------------------------------------------

test('the assembled prompt changes with the override, and comes back after a reset',
  async () => {
    /* The whole of why any of this exists, in one test. The system prompt is
       the head of the prefix the LLM server caches, so this changing is a
       measurable thing: one missed cache on the next turn, and the same bytes
       every turn after it. */
    const before = front(await P.effectivePersona('lover'));
    await P.setPrompt('lover', 'You are Lover, and you always mention the rain.');
    const after = front(await P.effectivePersona('lover'));
    expect(after).not.toBe(before);
    expect(after).toContain('you always mention the rain');
    expect(after.startsWith('You are heard aloud, not read.')).toBe(true);
    await P.resetPersona('lover');
    expect(front(await P.effectivePersona('lover'))).toBe(before);
  });

test('the two files are read once a room, and again once they are written', async () => {
  await P.effectivePersona('lover');
  await P.effectivePersona('lover');
  expect(disk.read).toEqual(['prompt lover', 'tunables lover']);
  await P.setPrompt('lover', 'You always mention the rain.');
  await P.effectivePersona('lover');
  expect(disk.read.filter((x) => x.startsWith('prompt'))).toHaveLength(2);
});

test('what the console is told about a character is never what it says', async () => {
  expect(await P.describe('lover')).toContain('shipped');
  await P.setPrompt('lover', 'You always mention the rain.');
  await P.tune('lover', 'temperature', '0.4');
  const said = await P.describe('lover');
  expect(said).toContain('prompt overridden');
  expect(said).toContain('temperature 0.4 (yours)');
  expect(said).not.toContain('rain');
  // Nor when it is only being listed for tuning.
  expect(await P.tunedTo('lover')).not.toContain('rain');
});

test('a pill this game does not have is a mistake and says so', async () => {
  await expect(P.effectivePersona('nobody')).rejects.toThrow(/no pill called nobody/);
  await expect(P.setPrompt('nobody', 'hello')).rejects.toThrow(/no pill called nobody/);
});

test('a voice the shelf has not got is dropped rather than spoken into silence', async () => {
  /* Only a hand-edited file reaches this -- `tune` checks the name before it
     writes it -- and left alone it is the worst kind of quiet: every chunk of
     every reply refused, the words arriving, no sound, and the amber banner
     flashing once a sentence over a machine that is perfectly well. */
  disk.files.set(at('lover', 'tunables.json'), '{"voice": "gold", "temperature": 0.4}');
  const now = await P.effectivePersona('lover');
  expect(now.voice).toBe(SHIPPED.voice);
  expect(now.temperature).toBe(0.4);          // the rest of the file still counts
});

test('but a machine that will not say what it has leaves the tuning alone', async () => {
  /* The shelf is unknown, not empty. Dropping a good voice because a request
     failed would be a character that sounds different after a hiccup. */
  disk.files.set(at('lover', 'tunables.json'), '{"voice": "thinker"}');
  disk.shelf = null;
  expect((await P.effectivePersona('lover')).voice).toBe('lucid_talk/personas/thinker');
});
