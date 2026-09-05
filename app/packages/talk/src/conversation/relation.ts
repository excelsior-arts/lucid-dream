/* Where you stand with her: a small state that outlives the conversation.
 *
 * Memory records what is true about you. This records what you are to her,
 * which is a different thing and moves differently -- facts accumulate, a
 * relationship swings. Three axes, kept per persona:
 *
 *     warmth   contempt ... fondness      moves slowly, both ways
 *     trust    guarded ... open           falls fast, rises slowly
 *     mood     today's temper             decays in hours
 *
 * Two more come free and need no judgement at all: how many turns you have
 * spent together, and how long you have been away.
 *
 * The numbers never reach the model. They are quantised into named bands and
 * rendered as a sentence, because a model does something sensible with "she is
 * guarded with him" and nothing sensible with "trust: -40". Bands also give the
 * stance hysteresis: a value wobbling between -38 and -42 does not change a
 * word of the prompt, so she does not flip register turn to turn.
 *
 * That hysteresis is worth keeping for a second reason nobody had in mind when
 * it was written. These axes move on every scored turn, and the banded prose is
 * what goes into the system prompt -- which is the front of the prefix the LLM
 * server caches between turns. Bands mean a prompt that changes a few times an
 * evening instead of every turn. Anything added here that rendered a number
 * directly would read the same to a person and cost a cache miss, and about two
 * seconds, per exchange. See prompt.ts, `window`.
 *
 * The file on disk is the player's: `data/memory/<slug>.relation.json`, a bag
 * of numbers it keeps and never reads. Everything below — the axes, how fast
 * each fades, what a value comes out as in English — is here, which is all of
 * it that can be wrong in a way nobody sees.
 */

import type {Standing as TopLine} from '../link/shapes';

export const AXES = ['warmth', 'trust', 'mood'] as const;
export type Axis = (typeof AXES)[number];
export const LIMIT = 100.0;

/** The state as it is kept, and as the files API hands it back. */
export interface Standing {
  warmth: number;
  trust: number;
  mood: number;
  turns: number;
  /** Seconds since the epoch, the way Python writes it. When the numbers were
      last stamped, which is what the fade is measured from. */
  updated: number;
  /** And when they last actually spoke, which is a different question and the
      one "how long have you been away" asks. Absent on disk while the two are
      the same moment: a file is only ever written by a turn, so its `updated`
      is its last contact. `decayed` is what pulls them apart, and it is the
      reason this exists — it restamps `updated` as the fade point, and every
      read goes through it. */
  spoke?: number;
  log: Array<{at: string; moved: string; why: string}>;
}

// How long it takes for half of a feeling to fade, with no contact at all.
// Anger cools over days; a bad mood is gone by tomorrow; trust, once lost,
// is the slowest thing here.
//
// Counted in evenings rather than in calendar months, which is the correction:
// this is taken nightly, and a season-long trust is one that never moves. At
// ninety days a week away healed five percent of a bad night and a single
// sitting healed nothing at all, so the standing stopped being something you
// mend and became something you reset. These are the same three-to-one shape,
// at the tempo of a life that does not come back to things for a quarter.
export const HALF_LIFE_HOURS: Record<Axis, number> = {
  warmth: 24 * 7,
  trust: 24 * 21,
  mood: 6,
};

/** The most one exchange may move an axis. */
export const MAX_STEP = 3.0;

// What each step is worth, and it is deliberately not a straight line. Most
// turns are a 0 or a 1 and should barely register -- that is what makes the
// state stable enough to trust. A 3 is a rupture: contempt, a threat to leave,
// being lied to. Linear steps made those cost 2.4 points out of 100, so ten
// insults were needed to turn her cold, which is not how anyone works.
export const STEP_WEIGHT: Record<number, number> = {0: 0.0, 1: 1.0, 2: 3.0, 3: 9.0};

// Trust is asymmetric, which is most of what makes it feel true: it is spent
// faster than it is earned.
export const GAIN: Record<Axis, number> = {warmth: 1.0, trust: 0.6, mood: 1.4};
export const LOSS: Record<Axis, number> = {warmth: 1.2, trust: 2.0, mood: 1.4};

// The top band used to start at 100, which no axis ever reaches and none of
// them has to: 60 and up fell through the lookup to the fallback below, which
// returns this same line. The behavior was right and the table said otherwise,
// and a table that only reads correctly if you also read the function is a trap
// for whoever tunes these next.
export const BANDS: Record<Axis, ReadonlyArray<readonly [number, number, string]>> = {
  warmth: [
    [-100, -60, 'She cannot stand him. Every exchange costs her something.'],
    [-60, -25, 'She is cold with him, and does not pretend otherwise.'],
    [-25, -8, 'She is distant. Present, but nothing is being offered.'],
    [-8, 8, 'She is neither drawn to him nor put off. It could go either way.'],
    [8, 25, 'She likes him, mildly, and it shows in small ways.'],
    [25, 60, 'She is fond of him. She wants him there.'],
    [60, 101, 'She is deeply attached to him, and does not hide it.'],
  ],
  trust: [
    [-100, -60, 'She does not believe what he tells her.'],
    [-60, -25, 'She is guarded. She keeps things back.'],
    [-25, -8, 'She is careful with him — not suspicious, not open.'],
    [-8, 8, 'She has no particular reason to trust or doubt him.'],
    [8, 25, 'She takes him at his word.'],
    [25, 60, 'She is open with him, including about things she would not tell most people.'],
    [60, 101, 'She trusts him completely.'],
  ],
  mood: [
    [-100, -60, 'Right now she is angry.'],
    [-60, -25, 'Right now she is irritated with him.'],
    [-25, -8, 'Something in the last few minutes has put her slightly off.'],
    [-8, 8, ''],
    [8, 25, 'She is in a good mood.'],
    [25, 60, 'She is in high spirits.'],
    [60, 101, 'She is delighted, and it is spilling into everything she says.'],
  ],
};

// What she DOES, as opposed to how she feels.
//
// The bands above are adjectives, and a model renders an adjective as tone and
// then goes on doing what the persona told it to do -- which here is to be
// curious and give a full paragraph. Conduct is checkable where a mood is not:
// no questions, nothing offered, a handful of words.
//
// There was a token ceiling here too, and it was the wrong instrument: a cap
// cannot shorten a reply, it can only cut one off, and what it cut had to be
// either spoken as a fragment or hidden from you. The instructions do the work
// on their own -- measured, they produce "Good." and "Get out." unaided.
export const CONDUCT: ReadonlyArray<readonly [number, number | null, string]> = [
  [-75, null,
   'You are done with him. A handful of words, or nothing at all. Ask him '
   + 'nothing, explain nothing, help him with nothing. Contempt is allowed, '
   + 'and so is refusing him outright, in whatever words are yours. Do not '
   + 'soften it at the end and do not leave him a way back in.'],
  [-40, -60,
   'Give him nothing he has not asked for. One or two short sentences. No '
   + 'questions back, no examples, no helping him think it through. Cold is '
   + 'the point; do not warm it up at the end.'],
  [-15, -30,
   'Keep it short and flat. Nothing offered, nothing drawn out, no question '
   + 'back to him.'],
];

/** How she behaves right now. Empty when nothing needs saying. */
export function conduct(state: Standing): string {
  for (const [warmthAt, trustAt, text] of CONDUCT) {
    if (state.warmth <= warmthAt || (trustAt !== null && state.trust <= trustAt)) return text;
  }
  return '';
}

/** Seconds since the epoch, which is the clock the file is stamped with. */
const seconds = () => Date.now() / 1000;

export function blank(now = seconds()): Standing {
  return {warmth: 0, trust: 0, mood: 0, turns: 0, updated: now, log: []};
}

/** Whatever came back off disk, as a standing.
 *
 * A hand-edited file is still a file. An axis that cannot be read is an axis at
 * rest: this used to raise, and it raised from inside the prompt block — so one
 * bad character in a file nobody was supposed to open ended every reply that
 * persona tried to make.
 */
export function read(raw: unknown, now = seconds()): Standing {
  const out = blank(now);
  if (!raw || typeof raw !== 'object') return out;
  const state = raw as Record<string, unknown>;
  if (typeof state.turns === 'number') out.turns = Math.trunc(state.turns);
  if (typeof state.updated === 'number') out.updated = state.updated;
  // A file written before there were two of these has one: the moment it was
  // stamped, which was the moment of the exchange that stamped it.
  if (typeof state.spoke === 'number') out.spoke = state.spoke;
  if (Array.isArray(state.log)) out.log = state.log as Standing['log'];
  for (const a of AXES) {
    const v = Number(state[a] ?? 0);
    out[a] = Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, v)) : 0;
  }
  return out;
}

/** Let time do to a feeling what time does. Never called on its own — every
    read and every write goes through it, so the state on disk is only ever a
    snapshot of a moment that has since passed. */
export function decayed(state: Standing, now = seconds()): Standing {
  const hours = Math.max(0, (now - (state.updated || now)) / 3600);
  if (hours < 0.01) return {...state};
  const out = {...state};
  for (const a of AXES) {
    out[a] = out[a] * Math.pow(0.5, hours / HALF_LIFE_HOURS[a]);
    if (Math.abs(out[a]) < 0.5) out[a] = 0;
  }
  /* The fade point moves to now -- decaying a state twice must not fade it
     twice -- and the last contact stays where it was. It used to be the same
     field, so a week away was a week of fading and "it has been 7 days since
     they last spoke" that no read could ever say: the sentence was written
     against a stamp this line had already moved. */
  out.spoke = state.spoke ?? state.updated;
  out.updated = now;
  return out;
}

/** A stamp for the log, in the shape Python's time.strftime wrote. */
function stamp(now: number): string {
  const d = new Date(now * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} `
    + `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export type Deltas = Partial<Record<Axis, number>>;

/** Move the axes by one exchange's worth, and write it down. */
export function apply(state: Standing, deltas: Deltas, why = '', now = seconds()): Standing {
  const out = decayed(state, now);
  const moved: string[] = [];
  for (const a of AXES) {
    let d = Number(deltas[a] ?? 0) || 0;
    d = Math.max(-MAX_STEP, Math.min(MAX_STEP, d));
    if (!d) continue;
    const weight = STEP_WEIGHT[Math.round(Math.abs(d))] ?? Math.abs(d);
    d = Math.sign(d) * weight * (d > 0 ? GAIN[a] : LOSS[a]);
    out[a] = Math.max(-LIMIT, Math.min(LIMIT, out[a] + d));
    moved.push(`${a}${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(1)}`);
  }
  out.turns = (out.turns || 0) + 1;
  out.updated = now;
  /* And they are speaking now, which is the one thing that puts the two stamps
     back together. Dropped rather than set, so the file on disk keeps the shape
     it has always had: one timestamp, which is both. */
  delete out.spoke;
  if (moved.length) {
    // Enough history to see how you got here, not enough to grow forever.
    out.log = [...(out.log || []).slice(-19),
               {at: stamp(now), moved: moved.join(' '), why: why.slice(0, 120)}];
  }
  return out;
}

// One word for the header, so you can see where you stand without reading a
// paragraph — and without a number, which would turn a relationship into a
// score you try to farm. Temperature, because that is what warmth is.
export const STANDING: ReadonlyArray<readonly [number, string]> = [
  [-60, 'frozen'], [-25, 'cold'], [-8, 'cool'], [8, 'even'],
  [25, 'warm'], [60, 'close'], [101, 'devoted'],
];

/** A word and a temper, for the top of the page. */
export function standing(state: Standing): [string, string] {
  const word = STANDING.find(([edge]) => state.warmth < edge)?.[1]
    ?? STANDING[STANDING.length - 1]![1];
  let temper = '';
  if (state.mood <= -60) temper = 'furious';
  else if (state.mood <= -25) temper = 'annoyed';
  else if (state.mood >= 60) temper = 'delighted';
  else if (state.mood >= 25) temper = 'bright';
  // Trust lagging well behind warmth is its own thing: she likes you and still
  // would not tell you anything.
  else if (state.trust <= -25 && state.warmth > -25) temper = 'wary';
  return [word, temper];
}

/** How a pill is holding you, in a word, for a list of pills.
 *
 * One word — and a temper after it, when there is one — because that is what
 * fits in a column eight characters wide on the sheet inside the lid. Nothing
 * at all for a pill nobody has taken: a standing that has never been scored is
 * not the same as one that has come back to the middle, and the machine hands
 * over the state as it is on disk so the difference survives the trip.
 *
 * Empty as well when the relation is switched off, which is the caller's to
 * say: off means off, whatever is still on disk from when it was not.
 */
export function summary(raw: unknown, now = seconds()): string {
  if (!raw || typeof raw !== 'object') return '';
  const [word, temper] = standing(decayed(read(raw, now), now));
  return temper ? `${word} · ${temper}` : word;
}

export function band(axis: Axis, value: number): string {
  for (const [lo, hi, text] of BANDS[axis]) if (lo <= value && value < hi) return text;
  return value > 0 ? BANDS[axis][BANDS[axis].length - 1]![2] : BANDS[axis][0]![2];
}

/** The state as prose. Empty when there is nothing worth saying. */
export function describe(state: Standing, now = seconds()): string {
  const parts = AXES.map((a) => band(a, state[a]));

  const turns = state.turns || 0;
  if (turns >= 400) parts.push('They have been talking for a long time now.');
  else if (turns >= 80) parts.push('They know each other well by now.');
  else if (turns <= 6) parts.push('They barely know each other yet.');

  const away = (now - (state.spoke ?? state.updated ?? now)) / 86400;
  if (away >= 14) parts.push(`It has been about ${Math.trunc(away)} days since they last spoke.`);
  else if (away >= 3) parts.push(`It has been ${Math.trunc(away)} days since they last spoke.`);

  return parts.filter((p) => p).join(' ');
}

/** What goes into the system prompt, or nothing at all. `intro` is the
    relation_intro prompt, which lives in a file the machine serves. */
export function asPromptBlock(state: Standing, intro: string, now = seconds()): string {
  const text = describe(decayed(state, now), now);
  if (!text) return '';
  return '\n\n' + intro.replace(/\s+$/, '') + '\n' + text;
}

/** Pull the judgement out of whatever the model wrapped it in. */
export function readDeltas(raw: string): [Deltas, string] {
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [{}, ''];
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return [{}, ''];
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [{}, ''];
  const deltas: Deltas = {};
  for (const a of AXES) {
    const v = Number(data[a] ?? 0);
    deltas[a] = Number.isFinite(v) ? Math.max(-MAX_STEP, Math.min(MAX_STEP, v)) : 0;
  }
  return [deltas, String(data.why ?? '').slice(0, 120)];
}

/** Where you stand, in a word, for the top of the page.
 *
 * From session.py `_standing`. The room is lit by the numbers; a person reads
 * this. Nothing at all when the relation is switched off, which is what the
 * empty card means to everything that draws it.
 */
export function standingCard(state: Standing | null, now = seconds()): TopLine {
  if (!state) return {};
  const it = decayed(state, now);
  const [word, temper] = standing(it);
  return {
    word, temper,
    why: describe(it, now),
    cold: it.warmth <= -25,
    warm: it.warmth >= 25,
    /* Nothing has happened between you yet, so there is nothing to undo — the
       page hides the reset rather than offering a button that would do
       nothing. Python asked whether the file was there; a standing that has
       never been scored is the same answer and does not need a second read. */
    fresh: (it.turns || 0) === 0,
  };
}
