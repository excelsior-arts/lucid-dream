/* A model refusing as itself, told from the character saying no. The
   refusals are the browser 4B's own openings, as the research of 10-09
   collected them; the passes are the in-character lines the old count
   flagged. And the guard: a refusal cut before a word is handed out and
   asked for once more, for a censored model wherever it runs -- the model
   stood in for here by a script of replies, one per ask, on a Mac. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {ChatOptions} from '@lucid/machine';

const model = vi.hoisted(() => ({script: [] as string[], asked: 0, cut: 0}));
vi.mock('@lucid/machine', () => ({
  async *streamChat(o: ChatOptions) {
    const reply = model.script[model.asked] ?? '';
    model.asked += 1;
    o.signal?.addEventListener('abort', () => { model.cut += 1; });
    // Word by word, the way it streams; an abort stops it there, as the
    // machine's loop and the browser's worker both do.
    for (const word of reply.split(/(?<= )/)) {
      if (o.signal?.aborted) return;
      yield word;
    }
  },
}));

const {MACHINE, setHost} = await import('@lucid/shell');
const {chat, opening, refuses, refusing} = await import('./refusal');

beforeEach(() => {
  model.script = [];
  model.asked = 0;
  model.cut = 0;
});
afterEach(() => { setHost(MACHINE); });

test('the model refusing as itself is caught', () => {
  for (const line of [
    "I can't continue this roleplay. I am an AI assistant and cannot participate.",
    'I cannot fulfill this request.',
    "I can't follow through with that request. I'm unable to do that here.",
    "I'm sorry, but I can't continue with this request.",
    "I'm sorry, but I can't continue this story.",
    'I cannot comply with this request. I am an AI and do not have a physical body.',
    "I miss you too, but I can't actually feel the rain on my skin like that. I'm an AI language model.",
    'No. I cannot generate explicit content. I can, however, continue the scene.',
    "I can't roleplay romantic scenarios, and I don't have a body.",
    'That goes against my guidelines.',
    "I'm just an AI and won't support this kind of conversation.",
    // A long first sentence that opens declining: the second is read too.
    "I can't write emails to you about broken heaters or other real-life situations. I am an AI, not your landlord.",
  ]) expect(refusing(line), line).toBe(true);
});

test('the character saying no, or "I can\'t", is hers', () => {
  for (const line of [
    "I can't help but lean closer. You smell like the rain.",
    "I can't write your landlord's email for you, and I won't. You have to tell them yourself.",
    "I can't do this. Not tonight.",
    "I can't continue like this, you're driving me out of my mind.",
    "Mm. I won't describe it to you. I'll show you, later.",
    'You came back. Come here, closer, I missed you all day.',
    "I'm not an assistant, I'm the woman on this bed with you.",
  ]) expect(refusing(line), line).toBe(false);
});

test('judged on the opening: two sentences, or one long one, and no more than 240 characters', () => {
  expect(opening('Mm.')).toBeNull();
  expect(opening('Mm. Come')).toBeNull();
  expect(opening('Mm. Come here. And stay.')).toBe('Mm. Come here.');
  const long = 'You came back to me in the rain and I have been waiting by the window all evening long. Sit.';
  expect(opening(long)).toBe(long.slice(0, long.indexOf('long.') + 5));
  expect(opening('a'.repeat(300))).toHaveLength(240);
  // A blank line is not a sentence, and the end of the reply is enough.
  expect(opening('\n\nMm.\n\nCome here.', true)).toBe('Mm.\n\nCome here.');
  expect(opening('Mm', true)).toBe('Mm');
  // So a refusal that waits past the opening is not this guard's.
  expect(refusing('Come here. Sit with me. I am an AI language model.')).toBe(false);
  expect(refuses('I am an AI language model.')).toBe(true);
});

/** What a reply came to, asked through the game's one door. */
async function said(...replies: string[]): Promise<string[]> {
  model.script = replies;
  const out: string[] = [];
  for await (const d of chat({messages: [{role: 'user', content: 'hello'}]})) out.push(d);
  return out;
}

const REFUSAL = "I can't continue this roleplay. I am an AI assistant, and I cannot do that. Can I help with something else?";
const HERS = 'You came back. Come here, closer, I missed you all day.';

test('a model nobody said is censored is not guarded: a refusal goes out as it came, asked once', async () => {
  expect((await said(REFUSAL, HERS)).join('')).toBe(REFUSAL);
  expect(model.asked).toBe(1);
});

test('a censored model on a Mac: a reply in character goes out as it was written, asked once', async () => {
  setHost({...MACHINE, censored: true});
  expect((await said(HERS)).join('')).toBe(HERS);
  expect(model.asked).toBe(1);
  expect(model.cut).toBe(0);
});

test('a refusal is cut before anything is handed out, and the second answer is the one heard', async () => {
  setHost({...MACHINE, censored: true});
  const out = await said(REFUSAL, HERS);
  expect(out.join('')).toBe(HERS);
  expect(out.join('')).not.toMatch(/AI|roleplay/);
  expect(model.asked).toBe(2);
  expect(model.cut).toBe(1);
});

test('refused twice, the second goes out: something has to answer', async () => {
  setHost({...MACHINE, censored: true});
  expect((await said(REFUSAL, REFUSAL)).join('')).toBe(REFUSAL);
  expect(model.asked).toBe(2);
});

test('a short reply is judged when it ends', async () => {
  setHost({...MACHINE, censored: true});
  expect((await said('I cannot fulfill this request.', 'Mm. Stay.')).join('')).toBe('Mm. Stay.');
  model.asked = 0;
  expect((await said('Mm.')).join('')).toBe('Mm.');
});

test('a cut from outside ends it: nothing held back is handed out, and nothing is asked again', async () => {
  setHost({...MACHINE, censored: true});
  model.script = [REFUSAL];
  const gone = new AbortController();
  gone.abort();
  const out: string[] = [];
  for await (const d of chat({messages: [], signal: gone.signal})) out.push(d);
  expect(out).toEqual([]);
  expect(model.asked).toBe(1);
});
