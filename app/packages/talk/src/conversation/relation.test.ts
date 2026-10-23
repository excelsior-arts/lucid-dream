/* Where you stand with a pill: the arithmetic nobody would notice going wrong.
 *
 * The arithmetic, the decay, the prose it comes out as, and what is read back
 * out of the judge -- all of it here, because all of it is the game's. What the
 * machine keeps is a bag of numbers it never reads, behind
 * data/memory/<slug>.relation.json.
 *
 * This is the one part of the program with no visible output. A conversation
 * that reads a little colder than it should reads like the model having a day,
 * not like a constant that moved — so a regression here can live for weeks. The
 * numbers below are the ones the feel of the game is made of.
 */
import {expect, test} from 'vitest';
import type {Standing} from './relation';
import {
  AXES, GAIN, LIMIT, MAX_STEP, STEP_WEIGHT, apply, asPromptBlock, band, blank, conduct, decayed,
  describe, read, readDeltas, standing, standingCard,
} from './relation';

const now = 1_800_000_000;
const fresh = () => blank(now);
const like = (over: Partial<Standing>): Standing => ({...blank(now), ...over});

// ---- Arithmetic ------------------------------------------------------------

test('a blank slate is the middle', () => {
  const s = fresh();
  for (const axis of AXES) expect(s[axis]).toBe(0);
  expect(s.turns).toBe(0);
});

test('one ordinary turn barely moves anything', () => {
  /* Most turns are a 0 or a 1, and they have to be nearly free. This is what
     makes the state stable enough to be worth keeping: if a pleasant exchange
     were worth five points, a quiet evening would end in devotion. */
  const s = apply(fresh(), {warmth: 1}, '', now);
  expect(s.warmth).toBeCloseTo(1.0);
  expect(s.turns).toBe(1);
});

test('a rupture costs nine times an ordinary turn', () => {
  /* The steps are deliberately not a straight line. A 3 is contempt, a threat
     to leave, being lied to — and with linear steps ten insults were needed to
     turn a pill cold, which is not how anyone works. */
  const one = apply(fresh(), {warmth: 1}, '', now).warmth;
  const three = apply(fresh(), {warmth: 3}, '', now).warmth;
  expect(three).toBeCloseTo(one * 9);
});

test('trust is spent faster than it is earned', () => {
  // The asymmetry is most of what makes this feel true.
  const up = apply(fresh(), {trust: 3}, '', now).trust;
  const down = apply(fresh(), {trust: -3}, '', now).trust;
  expect(Math.abs(down)).toBeGreaterThan(Math.abs(up) * 3);
});

test('nothing can be pushed past the ends', () => {
  let s = fresh();
  for (let i = 0; i < 60; i++) s = apply(s, {warmth: 3, trust: 3, mood: 3}, '', now);
  for (const axis of AXES) expect(s[axis]).toBeLessThanOrEqual(LIMIT);
  for (let i = 0; i < 120; i++) s = apply(s, {warmth: -3, trust: -3, mood: -3}, '', now);
  for (const axis of AXES) expect(s[axis]).toBeGreaterThanOrEqual(-LIMIT);
});

test('a model shouting a hundred still moves one exchange worth', () => {
  // The judge is a language model and will occasionally return 40.
  const s = apply(fresh(), {warmth: 100}, '', now);
  expect(s.warmth).toBeCloseTo(STEP_WEIGHT[3]! * GAIN.warmth);
});

test('the log of how you got here does not grow forever', () => {
  let s = fresh();
  for (let i = 0; i < 40; i++) s = apply(s, {mood: 1}, 'something', now);
  expect(s.log.length).toBeLessThanOrEqual(20);
});

test('a turn that moved nothing is still a turn', () => {
  const s = apply(fresh(), {}, '', now);
  expect(s.turns).toBe(1);
  expect(s.log).toEqual([]);
});

// ---- Decay -----------------------------------------------------------------

test('a bad mood is gone by tomorrow and mistrust is not', () => {
  const after = decayed(like({warmth: 80, trust: -80, mood: -80, updated: now - 24 * 3600}), now);
  expect(Math.abs(after.mood)).toBeLessThan(10);        // six-hour half-life
  expect(Math.abs(after.trust)).toBeGreaterThan(75);    // three weeks
  expect(after.warmth).toBeGreaterThan(60);             // one week
});

test('almost nothing is rounded to nothing', () => {
  expect(decayed(like({mood: 0.4, updated: now - 3600}), now).mood).toBe(0);
});

test('a clock that went backwards does not undo a feeling', () => {
  /* Daylight saving, an NTP correction, a file copied from another machine.
     Negative elapsed time must not multiply a feeling upwards. */
  expect(decayed(like({warmth: 50, updated: now + 10 * 3600}), now).warmth).toBeCloseTo(50);
});

// ---- Prose -----------------------------------------------------------------

/* The numbers never reach the model; these sentences do. */

test('every value a pill can hold has something to say', () => {
  for (const axis of ['warmth', 'trust'] as const) {
    for (let v = -100; v <= 100; v += 5) {
      expect(band(axis, v), `${axis} at ${v} describes itself as nothing`).toBeTruthy();
    }
  }
});

test('the middle of a mood says nothing at all', () => {
  expect(band('mood', 0)).toBe('');
});

test('a word for the top of the page', () => {
  expect(standing(like({warmth: -70}))[0]).toBe('frozen');
  expect(standing(like({warmth: 70}))[0]).toBe('devoted');
});

test('liking you and still telling you nothing', () => {
  expect(standing(like({warmth: 30, trust: -40}))[1]).toBe('wary');
});

test('a temper beats a standing', () => {
  expect(standing(like({warmth: 30, mood: -70}))[1]).toBe('furious');
});

test('conduct is checkable where a mood is not', () => {
  expect(conduct(fresh())).toBe('');
  expect(conduct(like({warmth: -80})).toLowerCase()).toContain('nothing');
  // Trust alone is enough: a pill can like you and still be closed.
  expect(conduct(like({trust: -70}))).toBeTruthy();
});

test('a long absence is mentioned and a short one is not', () => {
  expect(describe(like({turns: 20, updated: now - 20 * 86400}), now)).toContain('days since');
  expect(describe(like({turns: 20, updated: now - 3600}), now)).not.toContain('days since');
});

/* And through the two doors it is actually said out of. Both decay the state
   first -- every read does -- and decay used to move the stamp the sentence is
   measured against to this second, so the absence was gone before anything
   could mention it: the prose above was true of a state nothing ever handed in.
   A week away must survive the read. */
test('an absence survives the read it is described through', () => {
  const away = read({warmth: 40, turns: 30, updated: now - 9 * 86400}, now);
  expect(asPromptBlock(away, 'Where you stand:', now)).toContain('9 days since they last spoke');
  expect(standingCard(away, now).why).toContain('9 days since they last spoke');
});

test('and the turn they come back on ends it', () => {
  const away = read({warmth: 40, turns: 30, updated: now - 9 * 86400}, now);
  const spoken = apply(away, {warmth: 1}, '', now);
  expect(asPromptBlock(spoken, 'Where you stand:', now)).not.toContain('days since');
  // And what is written down is the one stamp it has always been.
  expect(spoken.spoke).toBeUndefined();
  expect(spoken.updated).toBe(now);
});

test('reading a faded state twice does not fade it twice', () => {
  const once = decayed(like({mood: 80, updated: now - 6 * 3600}), now);
  expect(decayed(once, now).mood).toBeCloseTo(once.mood, 6);
});

// ---- WhatTheJudgeSaid ------------------------------------------------------

/* The scoring model is told to answer in JSON and does not always. */

test('json wrapped in talk', () => {
  const [deltas, why] = readDeltas(
    'Sure! Here you go:\n```json\n{"warmth": 1, "trust": -2, '
    + '"mood": 0, "why": "he apologized"}\n```\nHope that helps.');
  expect(deltas.warmth).toBe(1);
  expect(deltas.trust).toBe(-2);
  expect(why).toBe('he apologized');
});

test('nonsense moves nothing', () => {
  for (const raw of ['', 'I would rather not.', '{not json}', '{}', '[1,2]']) {
    const [deltas] = readDeltas(raw);
    expect(Object.values(deltas).some((v) => v), raw).toBe(false);
  }
});

test('a wild number is brought back to one exchange', () => {
  const [deltas] = readDeltas('{"warmth": -99, "trust": 50}');
  expect(deltas.warmth).toBe(-MAX_STEP);
  expect(deltas.trust).toBe(MAX_STEP);
});

test('a reason cannot be a paragraph', () => {
  const [, why] = readDeltas('{"warmth": 1, "why": "' + 'x'.repeat(500) + '"}');
  expect(why.length).toBeLessThanOrEqual(120);
});

test('the standing is said in whichever words the two of them have', async () => {
  const {describe, conduct, blank} = await import('./relation');
  const state = {...blank(), warmth: 40, trust: 40, mood: 0, turns: 100, updated: Date.now() / 1000, spoke: Date.now() / 1000};
  expect(describe(state)).toContain('She is fond of him. She wants him there.');
  expect(describe(state, undefined, {self: 'it', other: 'they'})).toContain('It is fond of them. It wants them there.');
  expect(describe(state, undefined, {self: 'they', other: 'she'})).toContain('They are fond of her. They want her there.');
  expect(conduct({...blank(), warmth: -80}, {self: 'it', other: 'they'})).toContain('You are done with them.');
});
