/* A character apart from its room: what the two model calls do to its two
   files, and what stops them -- a hand on the file while they were out, or a
   caller that has moved on. Talk's room and Trip's narrator both go through
   here, so what is under test is the contract they share. */
import {beforeEach, expect, test, vi} from 'vitest';
import type {Message} from '@lucid/machine';

/* The model, as a queue of answers, and what it was asked. */
const model = vi.hoisted(() => ({answers: [] as string[], asked: [] as Message[][]}));
vi.mock('@lucid/machine', () => ({
  streamChat: (o: {messages: Message[]}) => {
    model.asked.push(o.messages);
    const text = model.answers.shift() ?? '';
    return (async function* () { yield text; })();
  },
}));

const said = vi.hoisted(() => [] as string[]);
/* Whether the model in use is a censored one, for the refusal guard. */
const where = vi.hoisted(() => ({censored: false}));
vi.mock('@lucid/shell', () => ({
  hatch: {say: (line: string) => { said.push(line); }},
  host: () => ({llm: 'machine', censored: where.censored}),
}));

/* The two files, as what was written to them. */
const disk = vi.hoisted(() => ({memory: [] as string[], relation: [] as unknown[], erased: 0}));
vi.mock('./files', () => ({
  memory: () => Promise.resolve('- he has a dog'),
  relation: () => Promise.resolve(null),
  saveMemory: (_slug: string, text: string) => { disk.memory.push(text); return Promise.resolve(); },
  saveRelation: (_slug: string, state: unknown) => { disk.relation.push(state); return Promise.resolve(); },
  resetRelation: () => { disk.erased += 1; return Promise.resolve(true); },
}));
vi.mock('./persona', () => ({
  effectivePersona: (slug: string) => Promise.resolve({
    slug, name: 'Cass', pill: 'Cass', voice: 'lucid_talk/personas/thinker', prompt: 'you are Cass',
    draft: false, internal: true,
  }),
  forget: () => {},
}));
vi.mock('./config', () => ({
  gameConfig: () => Promise.resolve({
    memory: {enabled: true, fold_after: 4, max_bullets: 8},
    relation: {enabled: true, score: true},
  }),
}));

const {fold, judge, openCharacter, remember, stand, unstand, front, card} = await import('./character');
const {blank} = await import('./relation');

const PROMPTS = {
  system: 'heard aloud',
  memory_intro: 'you remember:',
  relation_intro: 'where you stand:',
  fold_system: 'fold what is true. Your name is {name}.',
  fold_user: 'MEMORY:\n{existing}\n\nGONE:\n{dropped}\n\n{more}\n\n{max_bullets} bullets.',
  relation_system: 'judge it',
  relation_user: 'HIM:\n{him}\n\nHER:\n{her}',
};

const talk = (n: number): Message[] =>
  Array.from({length: n}, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: i % 2 ? 'Older or younger?' : 'I have a brother',
  } as Message));

beforeEach(() => {
  where.censored = false;
  model.answers.length = 0;
  model.asked.length = 0;
  said.length = 0;
  disk.memory.length = 0;
  disk.relation.length = 0;
  disk.erased = 0;
});

test('a character is its persona, its prompts, and its two files', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  expect(c.persona.name).toBe('Cass');
  expect(c.memory).toBe('- he has a dog');
  expect(c.relation).toBeNull();
  expect(front(c)).toContain('you are Cass');
  expect(front(c)).toContain('- he has a dog');
  expect(card(c)).toEqual({});
});

test('a fold rewrites the memory, names the character to itself, and takes what else it is told', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('- he has a brother\n- he walks straight until something stops him');
  const came = await fold(c, talk(4), {more: 'WHAT HE DID:\nwalked straight.'});
  expect(came).toBe('folded');
  expect(c.memory).toContain('brother');
  expect(disk.memory).toEqual([c.memory]);
  const [system, user] = model.asked[0]!;
  expect(system!.content).toContain('Your name is Cass');
  expect(user!.content).toContain('him: I have a brother');
  expect(user!.content).toContain('Cass: Older or younger?');
  expect(user!.content).toContain('WHAT HE DID:\nwalked straight.');
});

test('a fold that came back empty writes nothing', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('Here is the memory:');
  expect(await fold(c, talk(4))).toBe('empty');
  expect(c.memory).toBe('- he has a dog');
  expect(disk.memory).toEqual([]);
});

test('a hand on the memory while it was being folded wins', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('- he has a brother');
  const folding = fold(c, talk(4));
  await remember(c, 'narrator', '- he has no dog');
  expect(await folding).toBe('moved');
  expect(c.memory).toBe('- he has no dog');
  expect(disk.memory).toEqual(['- he has no dog']);
});

test('a caller that has moved on gets no fold, and a lane that declines gets none either', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('- he has a brother');
  expect(await fold(c, talk(4), {still: () => false})).toBe('left');
  expect(disk.memory).toEqual([]);
  expect(await fold(c, talk(4), {run: () => Promise.resolve(undefined)})).toBe('declined');
  expect(await fold(c, [])).toBe('empty');
});

test('a judgement moves the standing and says so in numbers, never in words', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('{"warmth": 2, "trust": 1, "mood": 0, "why": "he thanked her"}');
  const state = await judge(c, 'thank you', 'you are welcome');
  expect(state?.warmth).toBeGreaterThan(0);
  expect(c.relation).toBe(state);
  expect(disk.relation).toEqual([state]);
  expect(said[0]).toMatch(/^standing moved warmth\+/);
  expect(said.join('\n')).not.toContain('thanked');
});

test('zero is nothing, and a reset while it was being judged is kept', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('{"warmth": 0, "trust": 0, "mood": 0, "why": "nothing"}');
  expect(await judge(c, 'mm', 'mm-hm')).toBeNull();
  c.relation = blank();
  model.answers.push('{"warmth": 3, "trust": 0, "mood": 0, "why": "a kindness"}');
  const judging = judge(c, 'here', 'thanks');
  await unstand(c, 'narrator');
  expect(await judging).toBeNull();
  expect(c.relation).toBeNull();
  expect(disk.relation).toEqual([]);
  expect(disk.erased).toBe(1);
});

test('a standing set by hand is stamped now, and the judgement out at the model is dropped', async () => {
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  model.answers.push('{"warmth": -3, "trust": -3, "mood": 0, "why": "he was cruel"}');
  const judging = judge(c, 'go away', 'fine');
  const state = await stand(c, 40, 10);
  expect(state.warmth).toBe(40);
  expect(state.mood).toBe(10);
  expect(await judging).toBeNull();
  expect(c.relation?.warmth).toBe(40);
  expect(card(c).word).toBe('close');
});

test('from a censored model, what it said as itself is never folded, kept, or judged', async () => {
  where.censored = true;
  const c = await openCharacter('narrator', {prompts: PROMPTS});
  const refusal = "I can't continue this roleplay.";
  // Her refusal is not in what the fold is shown; his line is.
  model.answers.push('- he has a brother');
  const dropped: Message[] = [{role: 'user', content: 'I have a brother'}, {role: 'assistant', content: refusal}];
  expect(await fold(c, dropped)).toBe('folded');
  expect(model.asked[0]!.at(-1)!.content).toContain('I have a brother');
  expect(model.asked[0]!.at(-1)!.content).not.toContain(refusal);
  // A fold that came back refusing -- twice, so past the guard -- is not a memory.
  model.answers.push(refusal, refusal);
  expect(await fold(c, talk(4))).toBe('empty');
  expect(disk.memory).toEqual(['- he has a brother']);
  // And a refusal moves no standing: the judge is not even asked.
  const asked = model.asked.length;
  expect(await judge(c, 'kiss me', refusal)).toBeNull();
  expect(model.asked).toHaveLength(asked);
});

