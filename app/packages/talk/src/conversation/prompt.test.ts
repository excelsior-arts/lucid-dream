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
import {voiceTags} from '@lucid/machine';
import type {PersonaCard} from '../link/shapes';
import {blank} from './relation';
import type {Standing} from './relation';
import {
  asSent, ifTags, offersTags, scenePress, soundPress, statePress, systemFor, systemPrompt, unstick,
  window, windowCut,
} from './prompt';

/** What Chatterbox's tokenizer knows, and what the Mac's Turbo keeps of it by
    the map (voice-tags.json in @lucid/machine). */
const TOKENIZER = ['[advertisement]', '[angry]', '[chuckle]', '[clear throat]', '[cough]', '[crying]',
  '[dramatic]', '[fear]', '[gasp]', '[groan]', '[happy]', '[laugh]', '[narration]', '[sarcastic]',
  '[shush]', '[sigh]', '[sniff]', '[surprised]', '[whispering]'];
const TURBO = voiceTags('chatterbox-turbo', TOKENIZER).tags;
import {all, prompts as shipped} from './bundle';

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

test('a voice that performs tags is offered the ones it keeps, after the house and before the character', () => {
  const tags = ['[laugh]', '[sigh]'];
  const got = systemPrompt(PILL, {...PROMPTS, sounds: 'Sounds: {tags}.'}, undefined, tags);
  expect(got).toBe('You are heard aloud, not read.\nSounds: [laugh] [sigh].\n\nYou are Lover. You are warm.');
});

test('and a voice that performs none is asked for none', () => {
  const plain = systemPrompt(PILL, PROMPTS);
  expect(systemPrompt(PILL, {...PROMPTS, sounds: 'Sounds: {tags}.'}, undefined, [])).toBe(plain);
});

test('the shipped line names every sound it offers, and offers only sounds', () => {
  const line = systemPrompt(PILL, shipped(), undefined, TURBO);
  expect(TURBO.length).toBeGreaterThan(0);
  for (const t of TURBO) expect(line).toContain(t);
  for (const t of ['[advertisement]', '[narration]', '[dramatic]', '[angry]', '[happy]'])
    expect(line).not.toContain(t);
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

test('the sounds are pressed on his turn when the voice performs some', () => {
  const p = {...PROMPTS, sounds: 'Sounds: {tags}.', sounds_press: 'A sound, if the moment has one.'};
  const out = soundPress([her('hi'), user('so')], p, ['[laugh]']);
  expect(out.at(-1)!.content).toBe('so\n\n[A sound, if the moment has one.]');
  expect(out[0]).toEqual(her('hi'));
});

test('and not right after a reply that made one: a pill making sounds is left to make them', () => {
  const p = {...PROMPTS, sounds: 'Sounds: {tags}.', sounds_press: 'A sound, if the moment has one.'};
  const msgs = [user('hi'), her('You came back [laugh] good.'), user('so')];
  expect(soundPress(msgs, p, ['[laugh]'])).toEqual(msgs);
  // a quiet one before it does not count: it is the last reply that is read
  const after = [user('hi'), her('[sigh] Fine.'), user('so'), her('Quiet now.'), user('and')];
  expect(soundPress(after, p, ['[laugh]']).at(-1)!.content).toContain('[A sound');
});

test('and not when it performs none, or on a turn of hers', () => {
  const p = {...PROMPTS, sounds: 'Sounds: {tags}.', sounds_press: 'A sound, if the moment has one.'};
  expect(soundPress([user('so')], p, [])).toEqual([user('so')]);
  expect(soundPress([user('so'), her('hm')], p, ['[laugh]'])).toEqual([user('so'), her('hm')]);
});

// ---- a voice with tags, and one without --------------------------------------

test('a file says a thing two ways, and the voice decides which is read', () => {
  const t = 'so is {if tags}a sound described{else}naming a sound{end}.{if no tags} No brackets.{end}';
  expect(ifTags(t, true)).toBe('so is a sound described.');
  expect(ifTags(t, false)).toBe('so is naming a sound. No brackets.');
  // verbatim between the marks, line breaks and all; and text without them untouched
  expect(ifTags('a{if tags} b\nc{end}d', true)).toBe('a b\ncd');
  expect(ifTags('plain {him} words', false)).toBe('plain {him} words');
  // an unclosed mark is left where it is, to be seen rather than guessed at
  expect(ifTags('a {if tags}b', true)).toBe('a {if tags}b');
});

test('tags are offered only where sounds.md is there to offer them and the voice keeps one', () => {
  expect(offersTags({sounds: 'x'}, ['[laugh]'])).toBe(true);
  expect(offersTags({sounds: 'x'}, ['[narration]'])).toBe(true);
  expect(offersTags({sounds: 'x'}, [])).toBe(false);
  expect(offersTags({}, ['[laugh]'])).toBe(false);
});

test('the system prompt takes the blocks for its voice, in the house and in the character', () => {
  const pill = {...PILL, prompt: 'You {if tags}[laugh]{else}laugh as words{end}.'} as PersonaCard;
  const p = {...PROMPTS, system: 'Aloud.{if no tags} No brackets.{end}\n', sounds: 'Sounds: {tags}.'};
  expect(systemPrompt(pill, p, undefined, ['[laugh]'])).toBe('Aloud.\nSounds: [laugh].\n\nYou [laugh].');
  expect(systemPrompt(pill, p, undefined, [])).toBe('Aloud. No brackets.\n\nYou laugh as words.');
});

test('the shipped words: today\'s for a voice with tags, the original approach for one without', () => {
  const p = shipped();
  const lover = all().find((c) => c.slug === 'lover')!;
  const tagged = systemPrompt(lover, p, undefined, TURBO);
  const tagless = systemPrompt(lover, p, undefined, []);
  expect(tagged).toContain('so is a sound described in words instead of made.');
  expect(tagged).toContain('front of the words it comes with: "[laugh] You\'re soaked. Come\nhere."');
  expect(tagged).toContain('when your voice has [groan], it is the sound you\nreach for most');
  expect(tagless).toContain('so is naming a sound instead of making it.');
  expect(tagless).toContain('make sounds by writing them as words, put exactly where the sound falls.');
  expect(tagless).toContain('Nothing goes in square brackets');
  expect(tagless).not.toContain('tag your voice');
});

test('and no shipped prompt shows a tagless voice a tag, or leaves a mark in, for any character', () => {
  const p = shipped();
  for (const system of [p.system!, p.system_text!]) {
    for (const c of all()) {
      for (const tags of [[], TURBO]) {
        const got = systemPrompt(c, {...p, system}, undefined, tags);
        expect(got, c.slug).not.toMatch(/\{(if|else|end)\b/);
        if (!tags.length) expect(got, c.slug).not.toMatch(/\[[A-Za-z][A-Za-z -]*\]/);
      }
    }
  }
});

test('her replies are shown back without their tags to a voice that performs none, his lines as sent', () => {
  const h = [{role: 'user' as const, content: 'hi', sent: 'Where: a room\n\nhi'},
             {role: 'assistant' as const, content: 'Back.', sent: 'Back [laugh].'}];
  expect(asSent(h).map((m) => m.content)).toEqual(['Where: a room\n\nhi', 'Back [laugh].']);
  expect(asSent(h, false).map((m) => m.content)).toEqual(['Where: a room\n\nhi', 'Back.']);
});

test('her lone tags are shown back opening the sentence after them, not alone on a line', () => {
  const h = [{role: 'user' as const, content: 'hi'},
             {role: 'assistant' as const, content: 'Four days.\n\nHere.', sent: 'Four days.\n\n[sigh]\n\nHere.'}];
  expect(asSent(h).map((m) => m.content)).toEqual(['hi', 'Four days.\n\n[sigh] Here.']);
  expect(asSent(h, false).map((m) => m.content)).toEqual(['hi', 'Four days.\n\nHere.']);
});

test('the prompt follows the map: the Mac\'s Turbo is offered no [whispering] and no [sniff]', () => {
  expect(TURBO).toContain('[sigh]');
  const line = systemPrompt(PILL, shipped(), undefined, TURBO);
  for (const bad of ['[whispering]', '[sniff]', '[narration]', '[angry]']) {
    expect(TURBO).not.toContain(bad);
    expect(line).not.toContain(bad);
  }
});

test('and a voice with no entry is offered every tag its tokenizer knows, to be pruned by ear', () => {
  const nano = voiceTags('browser:nano', TOKENIZER);
  expect(nano).toEqual({tags: TOKENIZER, known: false});
  const line = systemPrompt(PILL, shipped(), undefined, nano.tags);
  for (const t of ['[sniff]', '[whispering]', '[narration]']) expect(line).toContain(t);
});

test('the shipped words ask for a tag in front of words, now and then, never alone', () => {
  const p = shipped();
  expect(p.sounds).toContain('at the start of the sentence it comes with');
  expect(p.sounds).toContain('never stands on a line by itself');
  expect(p.sounds_press).toContain('in front of the words it comes with');
});

test('the shipped reminder names no tag of its own', () => {
  const text = shipped().sounds_press ?? '';
  expect(text.trim()).not.toBe('');
  expect(text).not.toMatch(/\[/);
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

test('the model is shown each line as it was sent, and only the role and the words', () => {
  const kept = [user('hello'), {...her('You came back.'), sent: 'You came back [laugh]'}, her('Plain.')];
  expect(asSent(kept)).toEqual([user('hello'), her('You came back [laugh]'), her('Plain.')]);
  // nothing else rides along to the model server
  expect(Object.keys(asSent(kept)[1]!)).toEqual(['role', 'content']);
});

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
