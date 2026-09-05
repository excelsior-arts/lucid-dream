/* What the model is shown, and in what order.
 *
 * Python has no test class for the assembly -- it was six methods on a Session
 * that wanted three models to build. What is tested here is the three rules
 * those methods exist to keep, and the first of them is worth about two seconds
 * a turn: stable in front, append-only in the middle, volatile pressed onto the
 * end.
 */
import {expect, test} from 'vitest';
import type {Message} from '@lucid/machine';
import type {PersonaCard} from '../link/shapes';
import {blank} from './relation';
import type {Standing} from './relation';
import {
  scenePress, statePress, systemFor, systemPrompt, unstick, window, windowCut,
} from './prompt';

const PILL = {slug: 'lover', prompt: 'You are Lover. You are warm.'} as unknown as PersonaCard;

const PROMPTS = {
  system: 'You are heard aloud, not read.\n',
  memory_intro: 'What you know about him:',
  relation_intro: 'How you are with him:',
  scene_intro: 'Where you are:',
};

const at = 1_800_000_000;
const like = (over: Partial<Standing>): Standing => ({...blank(at), ...over});

const user = (content: string): Message => ({role: 'user', content});
const her = (content: string): Message => ({role: 'assistant', content});

// ---- the front holds still --------------------------------------------------

test('the system prompt is the house first and the character last', () => {
  // The model weights what it read most recently, so anything generic sitting
  // after a persona quietly overrides it.
  expect(systemPrompt(PILL, PROMPTS))
    .toBe('You are heard aloud, not read.\n\nYou are Lover. You are warm.');
});

test('the prefix is the same bytes on the next turn, and the turn after', () => {
  /* The whole cache argument in one test. mlx_lm re-uses the longest prefix it
     has already processed; anything in front of the history that moves turn to
     turn costs a miss, and about two seconds, every time. */
  const mem = '- he has a brother';
  const first = systemFor(PILL, PROMPTS, mem, like({warmth: -38, turns: 20}), at);
  const later = systemFor(PILL, PROMPTS, mem, like({warmth: -38, turns: 20}), at);
  expect(later).toBe(first);
});

test('and a feeling that moved without crossing a band changes nothing in it', () => {
  /* Bands are what give the stance hysteresis: a value wobbling between -38 and
     -42 does not change a word of the prompt, so she does not flip register
     turn to turn -- and the prefix in front of the conversation holds. */
  const mem = '- he has a brother';
  const before = systemFor(PILL, PROMPTS, mem, like({warmth: -38, trust: -10, turns: 20}), at);
  const after = systemFor(PILL, PROMPTS, mem, like({warmth: -42, trust: -12, turns: 20}), at);
  expect(after).toBe(before);
});

test('a band actually crossed does change it, or none of this would be worth having', () => {
  const cold = systemFor(PILL, PROMPTS, '', like({warmth: -70, turns: 20}), at);
  const warm = systemFor(PILL, PROMPTS, '', like({warmth: 40, turns: 20}), at);
  expect(warm).not.toBe(cold);
});

test('a pill with nothing remembered and no standing is the persona alone', () => {
  expect(systemFor(PILL, PROMPTS, '', null, at)).toBe(systemPrompt(PILL, PROMPTS));
});

// ---- what moves goes on the end ---------------------------------------------

const HISTORY: Message[] = [user('hello'), her('Hello yourself.'), user('are you there')];

test('the scene goes in front of what he said, on his turn and nowhere else', () => {
  const out = scenePress(HISTORY, 'Place: a kitchen', PROMPTS);
  expect(out[out.length - 1]!.content).toBe('[Where you are:\nPlace: a kitchen]\n\nare you there');
  // Everything before the last message is untouched, so the cached prefix is
  // the same length either way.
  expect(out.slice(0, -1)).toEqual(HISTORY.slice(0, -1));
});

test('and never onto a turn of hers', () => {
  const ended = [user('hello'), her('Hello yourself.')];
  expect(scenePress(ended, 'Place: a kitchen', PROMPTS)).toEqual(ended);
});

test('what she does about a standing is pressed on the same turn', () => {
  const out = statePress(HISTORY, like({warmth: -80}), at);
  expect(out[out.length - 1]!.content).toMatch(/^are you there\n\n\[You are done with him\./);
  expect(out.slice(0, -1)).toEqual(HISTORY.slice(0, -1));
});

test('and nothing is pressed when there is nothing to say', () => {
  expect(statePress(HISTORY, like({warmth: 40}), at)).toEqual(HISTORY);
  expect(statePress(HISTORY, null, at)).toEqual(HISTORY);
});

test('the two presses stack, the room in front and the conduct behind', () => {
  const out = scenePress(statePress(HISTORY, like({warmth: -80}), at), 'Place: a kitchen', PROMPTS);
  const said = out[out.length - 1]!.content;
  expect(said.indexOf('Place: a kitchen')).toBeLessThan(said.indexOf('are you there'));
  expect(said.indexOf('are you there')).toBeLessThan(said.indexOf('You are done with him'));
});

// ---- the nudge --------------------------------------------------------------

test('two clipped replies in a row are answered with a nudge', () => {
  /* Once one clipped reply is in context the model imitates it, and every turn
     after that is one line -- reliably, from a single one-word cue. */
  const out = unstick([user('hi'), her('Mm.'), user('and?'), her('Fine.'), user('well?')]);
  expect(out[out.length - 1]!.content).toContain('Your last replies were single lines');
  expect(out[out.length - 1]!.content).toContain('Do not start it with "fine" again');
});

test('one full reply in the last two is enough to leave it alone', () => {
  const said: Message[] = [user('hi'), her('Mm.'), user('and?'),
                           her('I thought so. It was always going to be.'), user('well?')];
  expect(unstick(said)).toEqual(said);
});

test('the nudge only rides along on a user turn', () => {
  const said: Message[] = [user('hi'), her('Mm.'), user('and?'), her('Fine.')];
  expect(unstick(said)).toEqual(said);
});

test('and never before there are two replies to read', () => {
  const said: Message[] = [user('hi'), her('Mm.'), user('well?')];
  expect(unstick(said)).toEqual(said);
});

// ---- the window -------------------------------------------------------------

test('it keeps whole turns and drops whole turns', () => {
  const long: Message[] = [];
  for (let i = 0; i < 20; i++) { long.push(user('q' + i)); long.push(her('a' + i)); }
  const out = window(long, {contextTurns: 3, contextWords: 0});
  expect(out).toHaveLength(6);
  expect(out).toEqual(long.slice(-6));
});

test('and a ceiling on their length, because a reply can be two hundred words', () => {
  /* contextTurns alone counts messages, not their length, so the prompt -- and
     with it time-to-first-token -- swung by roughly 5x depending on how
     talkative the pill had been. */
  const long: Message[] = [user('one'), her('x '.repeat(200).trim()), user('two'),
                           her('y '.repeat(200).trim()), user('three')];
  const out = window(long, {contextTurns: 6, contextWords: 250});
  expect(out.map((m) => m.content)).toEqual(['two', 'y '.repeat(200).trim(), 'three']);
});

test('the last exchange is always kept, however long it is', () => {
  const huge: Message[] = [user('one'), her('x '.repeat(5000).trim())];
  expect(window(huge, {contextTurns: 6, contextWords: 10})).toHaveLength(1);
});

test('a short conversation is the whole of it', () => {
  expect(window(HISTORY)).toEqual(HISTORY);
});

test('the window holds still between cuts, so the prefix does', () => {
  /* The one place that threw the cache away. `history[-turns:]` moves its start
     forward by one exchange every exchange, so from the turn a conversation
     outgrows the window on, every turn changes the first token of the prompt
     and mlx_lm's longest-matching-prefix cache matches nothing -- measured at
     2.6s against 0.58s, at exactly the length where it was paying for itself.

     Cut in chunks: the window is left where it is until it has overrun by half
     again, and only then moved. What is under test is the byte-stability of
     everything in front of the last message, over the turns in between. */
  const history: Message[] = [];
  const prefixes: string[] = [];
  const cuts: number[] = [];
  for (let i = 0; i < 30; i++) {
    history.push(user('q' + i), her('a' + i));
    const cut = windowCut(history, {contextTurns: 6, contextWords: 0,
                                    from: cuts[cuts.length - 1]});
    cuts.push(cut.from);
    // The prompt in front of the last message, as bytes: what the model
    // server matches its cache against.
    prefixes.push(cut.messages.slice(0, -1)
      .map((m) => `${m.role}: ${m.content}\n`).join(''));
  }
  // It does move -- a window that never moved would be the whole conversation.
  const moves = cuts.filter((at, i) => i > 0 && at !== cuts[i - 1]).length;
  expect(moves).toBeGreaterThan(0);
  // But rarely: the old cut moved on every turn past the seventh.
  expect(moves).toBeLessThan(8);
  /* And between two moves the prefix is the same bytes, which is the whole
     point: history is only appended to, so a start that does not move is a
     prompt whose front does not change. */
  for (let i = 1; i < prefixes.length; i++) {
    if (cuts[i] !== cuts[i - 1]) continue;
    expect(prefixes[i]!.startsWith(prefixes[i - 1]!), `turn ${i}`).toBe(true);
  }
});

test('and a window that has overrun far enough is cut back to fit', () => {
  const history: Message[] = [];
  for (let i = 0; i < 30; i++) history.push(user('q' + i), her('a' + i));
  // Handed a mark from the start of a long conversation, it does not simply
  // keep it: that would be no window at all.
  const cut = windowCut(history, {contextTurns: 6, contextWords: 0, from: 0});
  expect(cut.messages.length).toBe(12);
  expect(cut.from).toBe(48);
});

test('a caller with nowhere to keep a mark gets the tight cut', () => {
  const history: Message[] = [];
  for (let i = 0; i < 10; i++) history.push(user('q' + i), her('a' + i));
  expect(window(history, {contextTurns: 3, contextWords: 0})).toEqual(history.slice(-6));
});
