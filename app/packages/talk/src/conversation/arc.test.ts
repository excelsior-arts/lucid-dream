/* A dose with a shape, rather than a quarter of an hour of middle.
 *
 * What is tested here is the shape, not the words — those are the game's
 * writing and are meant to be rewritten. The shape is: it starts quiet, it does
 * not ask for an ending before the end, it does ask for one at the end, and it
 * does not hand the same sentence to two turns running.
 */
import {expect, test} from 'vitest';
import {ARC, continuousNudge} from './arc';

const CLOSING = ['bring it to rest', 'land it', 'last thing', 'finish what this',
                 'end where it wants', 'nearly gone'];

const asksToClose = (text: string) =>
  CLOSING.some((phrase) => text.toLowerCase().includes(phrase));

const pct = (f: number) => Math.round(f * 100) + '%';

// ---- ItStartsQuietAndEndsFinished ------------------------------------------

test('the opening does not ask for an ending', () => {
  for (let turn = 0; turn < 4; turn++) {
    expect(asksToClose(continuousNudge(0.02, turn)),
      'it asked the pill to finish in the first minute').toBe(false);
  }
});

test('nor does the middle', () => {
  for (const spent of [0.25, 0.4, 0.5, 0.6, 0.75]) {
    for (let turn = 0; turn < 4; turn++) {
      expect(asksToClose(continuousNudge(spent, turn)),
        `asked for an ending at ${pct(spent)}`).toBe(false);
    }
  }
});

test('the end asks for an ending', () => {
  for (const spent of [0.86, 0.95, 1.0]) {
    for (let turn = 0; turn < 4; turn++) {
      expect(asksToClose(continuousNudge(spent, turn)),
        `the dose ran out with no ending asked for at ${pct(spent)}`).toBe(true);
    }
  }
});

test('past the end is still the end', () => {
  /* Clocks drift and a turn can start a moment late. Falling off the last band
     and back to the opening would reopen an evening that was closing. */
  expect(asksToClose(continuousNudge(1.4, 0))).toBe(true);
});

// ---- AShortDoseStillFinishes -----------------------------------------------

/* Turns are coarse — ten or twenty seconds of talk each — so a five minute
   dose is a handful of them, and the arithmetic alone can put the last one at
   80% of the way through, still being told to push. Then the clock runs out and
   nothing ever asked it to land. */

test('the turn with no time after it closes', () => {
  for (const spent of [0.35, 0.6, 0.8]) {
    expect(asksToClose(continuousNudge(spent, 0, true)),
      `the last turn of the dose was still pushing at ${pct(spent)}`).toBe(true);
  }
});

test('and it is only the last one', () => {
  expect(asksToClose(continuousNudge(0.6, 0, false)),
    'every turn was told to wrap up').toBe(false);
});

test('a dose of four turns gets all four parts', () => {
  // 0%, 25%, 50%, 75% — and the fourth is the last there is room for.
  const said = [0.0, 0.25, 0.5, 0.75].map((f, i) => continuousNudge(f, i, i === 3));
  expect(new Set(said).size, 'two turns of four were the same').toBe(4);
  expect(asksToClose(said[said.length - 1]!), 'it stopped rather than finished').toBe(true);
  for (const early of said.slice(0, -1)) {
    expect(asksToClose(early), 'it wound up before the end').toBe(false);
  }
});

// ---- ItDoesNotRepeatItself -------------------------------------------------

test('two turns running are not the same words', () => {
  /* The surest way to be told the same thing twice is to ask the same way
     twice, and an echo chamber is what this was reported as. */
  for (const spent of [0.1, 0.4, 0.7, 0.95]) {
    expect(continuousNudge(spent, 0), `the same sentence twice at ${pct(spent)}`)
      .not.toBe(continuousNudge(spent, 1));
  }
});

test('every part of the arc has more than one way to say it', () => {
  for (const [edge, lines] of ARC) {
    expect(lines.length, `one phrasing only, up to ${edge}`).toBeGreaterThan(1);
    expect(new Set(lines).size, `duplicates up to ${edge}`).toBe(lines.length);
  }
});

// ---- WhatEveryTurnStillSays ------------------------------------------------

test('the pill is told nobody spoke', () => {
  /* Load-bearing, and older than the arc: without it the model answers as
     though somebody had said something, and the reply comes back addressed to
     a question nobody asked. */
  for (const spent of [0.0, 0.3, 0.6, 0.9, 1.0]) {
    for (let turn = 0; turn < 2; turn++) {
      expect(continuousNudge(spent, turn), `at ${pct(spent)}`).toContain('not said anything');
    }
  }
});
