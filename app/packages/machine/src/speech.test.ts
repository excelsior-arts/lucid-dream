/* How a reply is cut up before it is spoken.
 *
 * Five things a splitter can get wrong: where a sentence ends, where a
 * paragraph does, a line that is only a bracketed tag, whether the opening is
 * spoken whole, and what is stored when somebody cuts a reply off partway. The
 * junk filter is the sixth and is beside the ear instead, in
 * audio/junk.test.ts.
 *
 * Every input and expectation below is exact on purpose: a splitter that
 * agrees on prose and disagrees on one ellipsis is a difference nobody can
 * hear in the code and everybody can hear in the room.
 */
import {expect, test} from 'vitest';
import type {SplitOptions} from './speech';
import {
  MERGE_CHARS, MERGE_MAX_WORDS, MERGE_WORDS, hasWords, mergeFor, showable, splitForSpeech, spokenPrefix,
  tagsOnWords, wholeSentences, withoutTags,
} from './speech';

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

test('an end inside a closing quote or bracket is still an end', () => {
  expect(spoken('Say "please." Then come here.', {merge: 0})).toEqual(['Say "please."', 'Then come here.']);
  expect(spoken('\u201cCome here?\u201d Then I kiss you.', {merge: 0}))
    .toEqual(['\u201cCome here?\u201d', 'Then I kiss you.']);
  expect(spoken('Did you? (I knew it.) Good.', {merge: 0})).toEqual(['Did you?', '(I knew it.)', 'Good.']);
  // and an ellipsis inside one is still a pause
  expect(spoken('I said "Stay..." and you did.', {merge: 0})).toEqual(['I said "Stay..." and you did.']);
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

test('a tag the reply ends on, with no words of its own, rides with the line before it', () => {
  const out = spoken('I know. [sigh]');
  expect(out).toHaveLength(1);
  expect(out[0]).toContain('[sigh]');
});

test('a line that is only a tag at the very start', () => {
  expect(spoken('[laughs] Fine.').some((c) => c.includes('[laughs]'))).toBe(true);
});

test('a tag with a space in it is still a tag', () => {
  expect(spoken('I see. [clear throat]')).toEqual(['I see. [clear throat]']);
});

test('a tag at the start of a sentence stays with that sentence', () => {
  expect(spoken('Oh. [sigh] You came back.', {merge: 0}))
    .toEqual(['Oh.', '[sigh] You came back.']);
});

test('words: a tag has none of its own', () => {
  expect(hasWords('[sigh]')).toBe(false);
  expect(hasWords(' [sigh] [clear throat]. ')).toBe(false);
  expect(hasWords('[sigh] I know.')).toBe(true);
  expect(hasWords('Mm.')).toBe(true);
});

/* What the lover wrote on 10-12 in eleven replies of twelve: a "[sigh]" alone
   between two paragraphs. Handed to the voice as a chunk of its own it came
   back as a faint breath, lifted into a whoosh; in front of the words of the
   next sentence, a sigh in her voice. */
test('a tag on a line of its own opens the sentence after it', () => {
  expect(spoken('[sigh]\n\nYou came back.', {merge: 0})).toEqual(['[sigh] You came back.']);
  expect(spoken('I waited.\n\n[sigh]\n\nYou came back. Stay.', {merge: 0}))
    .toEqual(['I waited.\n', '[sigh] You came back.', 'Stay.']);
  expect(spoken('I waited.\n\n[sniff]\n\nYou came back.\n\n[mumble]\n\nStay.\n', {merge: 40}))
    .toEqual(['I waited.\n', '[sniff] You came back.\n', '[mumble] Stay.\n']);
});

test('and so does one after a sentence\'s end', () => {
  expect(spoken('It has been four days. [sigh]\n\nI am right here.', {merge: 0}))
    .toEqual(['It has been four days.\n', '[sigh] I am right here.']);
});

test('a sentence a tag opens starts a call of its own, however far the merge reaches', () => {
  // Turbo performs a sigh before the first words of what it is handed, and
  // lets it go after a sentence inside the same call.
  expect(spoken('Come closer. [sigh] I am right here. Stay.', {merge: 40}))
    .toEqual(['Come closer.', '[sigh] I am right here. Stay.']);
  // a tag inside a sentence is that sentence's, and merges with it
  expect(spoken('Come closer. You came back [laugh] I knew it.', {merge: 40}))
    .toEqual(['Come closer. You came back [laugh] I knew it.']);
});

/** A reply streamed a character at a time, handed over as reply.ts hands it:
    every chunk but the last of what has come, then the rest at the end. */
function streamed(text: string, merge: number): string[] {
  const sent: string[] = [];
  let buffer = '';
  for (const ch of text) {
    buffer += ch;
    const chunks = splitForSpeech(buffer, {merge});
    if (chunks.length > 1) {
      sent.push(...chunks.slice(0, -1));
      buffer = chunks.at(-1)!;
    }
  }
  return [...sent, ...splitForSpeech(buffer, {merge})];
}

test('streamed, a lone tag is never handed over alone, and opens the next sentence', () => {
  const reply = 'It has been four days.\n\nI am right here. I can hear you.\n\n[sigh]\n\nCome here.\n\n'
    + '[sniff] Closer. [clear throat]\n\nStay.';
  for (const merge of [0, 9, 40]) {
    const sent = streamed(reply, merge);
    for (const c of sent) expect(hasWords(c), `${merge}: ${JSON.stringify(c)}`).toBe(true);
    expect(sent.some((c) => c.startsWith('[sigh] Come here.')), `${merge}`).toBe(true);
    expect(sent.some((c) => c.startsWith('[sniff] Closer.')), `${merge}`).toBe(true);
    expect(sent.some((c) => c.startsWith('[clear throat] Stay.')), `${merge}`).toBe(true);
    // and no word lost or added on the way
    const all = (t: string) => t.split(/\s+/).filter(Boolean).sort();
    expect(all(sent.join(' '))).toEqual(all(reply));
  }
});

test('streamed, a reply that ends on a tag hands it over last, with no words to say', () => {
  const sent = streamed('Come here.\n\n[sigh]', 0);
  expect(sent.join(' ')).toContain('[sigh]');
  expect(sent.filter((c) => !hasWords(c)).length).toBeLessThanOrEqual(1);
});

// ---- Tags shown back to the model -----------------------------------------

test('shown back, a tag on a line of its own opens the sentence after it, and nothing else moves', () => {
  expect(tagsOnWords('Oh.\n\n[sigh]\n\nYou came back.')).toBe('Oh.\n\n[sigh] You came back.');
  expect(tagsOnWords('It has been four days. [sigh]\n\nI am here. And you.'))
    .toBe('It has been four days.\n\n[sigh] I am here. And you.');
  expect(tagsOnWords('A. [sniff]\nB.')).toBe('A.\n[sniff] B.');
  for (const same of ['I know. [sigh]', '[sigh]', 'You came back [laugh] I knew it.',
                      '[laugh] You came back.\n\nStay.', 'No tags.\n\n  Here.\n']) {
    expect(tagsOnWords(same)).toBe(same);
  }
});

test('streamed a token at a time, a tag is never cut through', () => {
  const text = 'Oh. [clear throat] You came back. [laugh] Fine.';
  for (let i = 1; i <= text.length; i++) {
    const chunks = splitForSpeech(text.slice(0, i), {merge: 0});
    // every chunk but the last is what gets handed over while streaming
    for (const c of chunks.slice(0, -1)) {
      expect(c.split('[').length, c).toBe(c.split(']').length);
      expect(/[a-zA-Z]/.test(c.replace(/\[[^\]]*\]/g, '')), c).toBe(true);
    }
  }
});

// ---- Tags off the glass -----------------------------------------------------

test('what is read has no tags, and no hole where one was', () => {
  expect(withoutTags('You came back [laugh] I did not think you would.'))
    .toBe('You came back I did not think you would.');
  expect(withoutTags('[sigh] Oh, you came back.')).toBe('Oh, you came back.');
  expect(withoutTags('You came back [laugh].')).toBe('You came back.');
  expect(withoutTags('Well [clear throat], then.')).toBe('Well, then.');
  expect(withoutTags('Oh.\n[sigh]\nYou came.')).toBe('Oh.\nYou came.');
  expect(withoutTags('Oh.\n\n[whispering] Come here.')).toBe('Oh.\n\nCome here.');
  expect(withoutTags('[Laugh] fine')).toBe('fine');
});

test('and what is not a tag is left alone', () => {
  for (const t of ['*mmm* yes', 'a (shrug) b', 'one [2] three', '[leans in, smiling] hi'])
    expect(withoutTags(t)).toBe(t);
});

test('streamed, what is shown only ever grows, and never shows a tag', () => {
  const text = 'Oh. [sigh] You came back [laugh] I did not think\n[chuckle]\nyou would [gasp].';
  let was = '';
  for (let i = 1; i <= text.length; i++) {
    const now = showable(text.slice(0, i));
    expect(now.startsWith(was), JSON.stringify([was, now])).toBe(true);
    expect(now).not.toMatch(/\[/);
    was = now;
  }
  expect(was).toBe(withoutTags(text).trim());
});

// ---- TheOpening -------------------------------------------------------------

/* The opening is a whole sentence like any other: never cut at a clause to
   start the voice sooner (10-08). It was, past twelve words. */
const LONG = 'I have been thinking about what you said last night, and about '
  + 'the way you said it, which is the part that stayed with me.';

test('a long opening is spoken whole, not cut at its commas', () => {
  expect(spoken(LONG)).toEqual([LONG]);
  expect(spoken(LONG, {merge: 0})).toEqual([LONG]);
  expect(spoken(LONG + ' And then some.', {merge: 0})).toEqual([LONG, 'And then some.']);
});

test('a dash or a colon in the opening is no cut either', () => {
  const dash = 'I come over and put my head against your chest — listening to the rain on that glass, '
    + 'the lamp low: all of it ours.';
  expect(spoken(dash, {merge: 0})).toEqual([dash]);
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

// ---- A reply that broke off ---------------------------------------------------

test('what of a broken-off reply was finished: up to its last whole sentence', () => {
  expect(wholeSentences('Come here. Sit down. I was thinking about the')).toBe('Come here. Sit down.');
  expect(wholeSentences('Did you? "Yes." And then he')).toBe('Did you? "Yes."');
  // Every sentence ended: all of it.
  expect(wholeSentences('Come here. Sit down. ')).toBe('Come here. Sit down.');
  // A line's end is an end too: the voice is handed it whole.
  expect(wholeSentences('A short line\nand half of the')).toBe('A short line');
  // An ellipsis is a pause, not an end, as it is for the voice.
  expect(wholeSentences('Stay... just like')).toBe('');
  // Nothing ended yet: nothing.
  expect(wholeSentences('I was thinking about the')).toBe('');
  expect(wholeSentences('')).toBe('');
});
