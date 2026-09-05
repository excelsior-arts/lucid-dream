/* How a reply is cut up before it is spoken.
 *
 * Five things a splitter can get wrong: where a sentence ends, where a
 * paragraph does, a line that is only a bracketed tag, how long the very first
 * chunk may be, and what is stored when somebody cuts a reply off partway. The
 * junk filter is the sixth and is beside the ear instead, in
 * audio/junk.test.ts.
 *
 * Every input and expectation below is exact on purpose: a splitter that
 * agrees on prose and disagrees on one ellipsis is a difference nobody can
 * hear in the code and everybody can hear in the room.
 */
import {expect, test} from 'vitest';
import type {SplitOptions} from './speech';
import {MERGE_CHARS, MERGE_MAX_WORDS, MERGE_WORDS, mergeFor, splitForSpeech, spokenPrefix} from './speech';

const spoken = (text: string, o: SplitOptions = {}) => splitForSpeech(text, o);

// ---- Sentences --------------------------------------------------------------

test('the first sentence goes alone so speech starts sooner', () => {
  expect(spoken('Yes. I thought so too. It was always going to be.')[0]).toBe('Yes.');
});

test('short sentences after it are carried together', () => {
  // The per-call overhead costs more than the extra words do.
  const out = spoken('Yes. Come here. Sit down. Stay a while.');
  expect(out).toHaveLength(2);
  expect(out[1]).toContain('Come here.');
  expect(out[1]).toContain('Stay a while.');
});

test('an ellipsis is a pause and not a boundary', () => {
  // "Stay... just like that." is one sentence, and splitting it makes a hard
  // cut between two clips where a breath belongs.
  expect(spoken('Stay... just like that.')).toEqual(['Stay... just like that.']);
});

test('a real ellipsis character too', () => {
  expect(spoken('Stay… just like that.')).toHaveLength(1);
});

test('a question and a shout are still ends', () => {
  expect(spoken('Are you there? I said are you there!')[0]).toBe('Are you there?');
});

// ---- The cap, from the queue ------------------------------------------------

/* Merging trades a longer wait for the next sound against fewer seams and
   less work, and the wait only matters when nothing is playing. So the cap is
   the queue's: seconds of audio the page has not played yet. */

test('nothing queued, nothing merged', () => {
  expect(mergeFor(0)).toBe(0);
  expect(mergeFor(1.4)).toBe(0);
});

test('three seconds queued is the fixed cap, six the most a call is asked for', () => {
  expect(mergeFor(3)).toBe(MERGE_WORDS);
  expect(mergeFor(6)).toBe(MERGE_MAX_WORDS);
  expect(mergeFor(60)).toBe(MERGE_MAX_WORDS);
});

test('given a cap of nothing, every sentence goes alone', () => {
  expect(spoken('Yes. Come here. Sit down.', {merge: 0}))
    .toEqual(['Yes.', 'Come here.', 'Sit down.']);
});

test('given a cap, the first sentence is merged like any other', () => {
  // There is no opening to hurry: what is being split is the unspoken rest of
  // a reply, and the voice is already sounding.
  expect(spoken('Yes. Come here. Sit down.', {merge: 20}))
    .toEqual(['Yes. Come here. Sit down.']);
});

test('a chunk stops taking sentences once it is over the cap', () => {
  const out = spoken('One two three four five. Six seven. Eight nine.', {merge: 5});
  expect(out).toEqual(['One two three four five.', 'Six seven. Eight nine.']);
});

test('and never grows past what the voice can carry in one call', () => {
  const sentence = 'The rain kept on through the evening and nobody minded.';
  const out = spoken(Array(12).fill(sentence).join(' '), {merge: 1000});
  expect(out.length).toBeGreaterThan(1);
  for (const c of out) expect(c.length).toBeLessThanOrEqual(MERGE_CHARS);
});

test('a paragraph break is still a wall, whatever the cap', () => {
  expect(spoken('One.\n\nTwo.\n', {merge: 40})).toHaveLength(2);
});

// ---- Paragraphs -------------------------------------------------------------

test('a paragraph is never merged into the next', () => {
  // The model put the break there, and letting one call span it flattens the
  // arc it was building.
  expect(spoken('One.\n\nTwo.\n')).toHaveLength(2);
});

test('a finished paragraph keeps the break the model wrote', () => {
  // trim_silence strips the natural tail off every chunk, so without this the
  // next paragraph starts instantly and the break is inaudible.
  expect(spoken('One.\n\nTwo.\n')[0]?.endsWith('\n')).toBe(true);
});

test('a paragraph still being written is not treated as finished', () => {
  /* This is the "one word at a time" bug. Every new token arriving mid
     sentence used to look like a completed paragraph and be sent to the voice
     on its own. */
  for (const soFar of ['She', 'She looked', 'She looked up', 'She looked up at']) {
    const out = spoken(soFar);
    expect(out, soFar).toHaveLength(1);
    expect(out[0]?.endsWith('\n'), soFar).toBe(false);
  }
});

test('a single newline is a break as well', () => {
  expect(spoken('One.\nTwo.\n')).toHaveLength(2);
});

test('nothing at all comes back as nothing', () => {
  for (const empty of ['', '   ', '\n\n']) expect(spoken(empty), empty).toEqual([]);
});

// ---- Tags: [sigh] and friends are delivery, not words -----------------------

test('a tag with no words of its own rides with the line before it', () => {
  // On its own it would be dropped before synthesis and the delivery would go
  // with it.
  const out = spoken('I know. [sigh]');
  expect(out).toHaveLength(1);
  expect(out[0]).toContain('[sigh]');
});

test('a line that is only a tag at the very start', () => {
  expect(spoken('[laughs] Fine.').some((c) => c.includes('[laughs]'))).toBe(true);
});

// ---- TheOpening -------------------------------------------------------------

/* firstShort is the trade between waiting and a stream of small calls, and it
   is only made once, at the top of a reply. */
const LONG = 'I have been thinking about what you said last night, and about '
  + 'the way you said it, which is the part that stayed with me.';

test('a long opening is cut at a clause so the voice starts sooner', () => {
  const plain = spoken(LONG);
  const short = spoken(LONG, {firstShort: true});
  expect(plain).toHaveLength(1);
  expect(short).toHaveLength(2);
  expect(short[0]!.split(/\s+/).length).toBeLessThan(plain[0]!.split(/\s+/).length);
});

test('the words are all still there and in order', () => {
  expect(spoken(LONG, {firstShort: true}).join(' ').split(/\s+/)).toEqual(LONG.split(/\s+/));
});

test('an opening that is already short is left alone', () => {
  expect(spoken('Yes. And no.', {firstShort: true})[0]).toBe('Yes.');
});

test('only the opening is treated this way', () => {
  const out = spoken('Yes.\n\n' + LONG, {firstShort: true});
  expect(out[out.length - 1]?.trim()).toBe(LONG);
});

// ---- AnInterruptedReplyKeepsItsShape ---------------------------------------

/* Stopped mid-reply, a transcript holds what was heard — and holds it the way
   it was written.

   Rebuilding it out of the chunks it was spoken in loses the model's blank
   lines, because the splitter took them out and left one newline behind. A
   reply that arrived with air in it then reads back from History as a block
   with stray spaces down the left, which is not what anybody saw. */
const WRITTEN = 'She put the glass down.\n\n'
  + '*a long pause*\n\n'
  + 'You were saying something. Go on.';

/** The chunks the voice got through before it was stopped. */
const spoke = (upto: number) => splitForSpeech(WRITTEN).slice(0, upto);

test('the paragraphs the model wrote are still there', () => {
  expect(spokenPrefix(WRITTEN, spoke(2)), 'the blank line was flattened').toContain('\n\n');
});

test('and nothing is stored that was never heard', () => {
  expect(spokenPrefix(WRITTEN, spoke(1)),
    'a line the voice never reached is in the transcript').not.toContain('You were saying');
});

test('what was heard is all there', () => {
  const said = spokenPrefix(WRITTEN, spoke(2));
  expect(said).toContain('She put the glass down.');
  expect(said).toContain('*a long pause*');
});

test('a whole reply comes back whole', () => {
  expect(spokenPrefix(WRITTEN, splitForSpeech(WRITTEN)).trim()).toBe(WRITTEN.trim());
});

test('nothing spoken is nothing stored', () => {
  expect(spokenPrefix(WRITTEN, [])).toBe('');
});

test('no stray space down the left', () => {
  // The signature of the old rejoin: a newline with a space after it.
  expect(spokenPrefix(WRITTEN, spoke(2))).not.toContain('\n ');
});
