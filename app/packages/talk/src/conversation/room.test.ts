/* Which conversation a room opens, and what it does when there is none.
 *
 * Three questions with one answer each: coming back to a room is the same
 * sitting if it has not been long, a name in the address is opened or refused,
 * and a conversation that has moved on without this page is said rather than
 * written over.
 *
 * Everything below the bags is mocked at the bags: what is under test is the
 * decision, and the routes have their own tests in Python.
 */
import {beforeEach, expect, test, vi} from 'vitest';
import type {SessionCard} from '../link/shapes';

const bags = vi.hoisted(() => ({
  sessions: [] as SessionCard[],
  made: 0,
  appends: [] as unknown[],
  /** What the machine answers an append with; `stale` is the other tab. */
  version: 0,
  stale: false,
  /** How many of the next appends are refused whatever `stale` says. One is
      the ordinary case: the file grew, and what happens next depends on who
      grew it. */
  refuse: 0,
  /** The file as a re-read finds it, which is what tells the two apart. */
  lines: [] as unknown[],
  /** And as a whole transcript, for the page that has to read it again. */
  session: null as unknown,
}));

const PILLS = [{slug: 'lover', pill: 'Purple', voice: 'lover', place: 'a library'}];
vi.mock('./bundle', () => ({
  personas: () => PILLS,
  // What the game ships, which is what conversation/persona.ts layers over.
  all: () => PILLS,
  prompts: () => ({}),
}));

vi.mock('./files', () => ({
  config: () => Promise.resolve({}),
  memory: () => Promise.resolve(''),
  // Nothing of this player's over the shipped character: the layering has its
  // own test, and what is under test here is which conversation opens.
  personaPrompt: () => Promise.resolve(null),
  personaTunables: () => Promise.resolve(null),
  relation: () => Promise.reject(new Error('nothing yet')),
  roomState: () => Promise.resolve({}),
  saveRoomState: (_id: string, state: Record<string, unknown>) => Promise.resolve({...state, v: 2}),
  sessions: (slug: string, limit = 40) =>
    Promise.resolve(bags.sessions.filter((x) => x.persona === slug).slice(0, limit)),
  newSession: () => {
    bags.made += 1;
    return Promise.resolve({id: `2026-03-03T03-03-0${bags.made}_lover`});
  },
  readSession: () => Promise.resolve(
    bags.session ?? {id: '', turns: [], scenes: [], version: 0, persona: 'lover'}),
  append: (_id: string, row: unknown) => {
    bags.appends.push(row);
    if (bags.refuse > 0) {
      bags.refuse -= 1;
      return Promise.resolve({version: bags.version, stale: true});
    }
    return Promise.resolve({version: bags.version, stale: bags.stale});
  },
  lines: () => Promise.resolve({lines: bags.lines, version: bags.version}),
}));

const machine = vi.hoisted(() => ({tags: [] as string[], down: false}));

vi.mock('@lucid/machine', () => ({
  openVoice: () => ({close: () => {}}),
  // The shelf, for the line a room says when a pill's voice is not on it.
  voices: () => Promise.resolve(['lover']),
  shelf: () => (machine.down ? Promise.reject(new Error('down'))
    : Promise.resolve({voices: ['lover'], tags: machine.tags})),
}));

const {DEFAULTS} = await import('./config');
const {Nowhere, leaveRoom, openRoom, recentSession, reread, saveRoomState, write} =
  await import('./room');
const {link, EMPTY} = await import('../link/store');

/** One conversation of this pill's, last spoken in that long ago. */
const quietFor = (minutes: number): SessionCard => ({
  id: '2026-08-28T12-12-26_lover',
  persona: 'lover',
  persona_name: 'Purple',
  turns: 4,
  when: 'Aug 28 15:22',
  at: Date.now() / 1000 - minutes * 60,
  preview: 'word',
});

beforeEach(() => {
  bags.sessions = [];
  bags.made = 0;
  bags.appends = [];
  bags.version = 0;
  bags.stale = false;
  bags.refuse = 0;
  bags.lines = [];
  bags.session = null;
  machine.tags = [];
  machine.down = false;
  sessionStorage.clear();
  link.setState({...EMPTY});
  leaveRoom();
});

/** Four lines nobody looks at, and then whatever this page is asked about. */
const fileWith = (...tail: unknown[]) => [null, null, null, null, ...tail];

/* ---- the window is short --------------------------------------------------
 *
 * A dose is a dream and each one starts new. But a reload, a dropped socket or
 * a phone locking itself in a pocket are not new dreams, and losing the thread
 * to any of them is a bug wearing a design's clothes. */

test('a minute ago is the same sitting', async () => {
  bags.sessions = [quietFor(1)];
  expect(await recentSession('lover', DEFAULTS)).toBe(quietFor(1).id);
});

test('and four minutes still is', async () => {
  bags.sessions = [quietFor(4)];
  expect(await recentSession('lover', DEFAULTS)).toBe(quietFor(4).id);
});

test('but ten minutes is a new one, and so is an afternoon', async () => {
  bags.sessions = [quietFor(10)];
  expect(await recentSession('lover', DEFAULTS)).toBe('');
  bags.sessions = [quietFor(150)];
  expect(await recentSession('lover', DEFAULTS)).toBe('');
});

test('the setting is what decides it', async () => {
  bags.sessions = [quietFor(30)];
  expect(await recentSession('lover', DEFAULTS)).toBe('');
  expect(await recentSession('lover', {...DEFAULTS, resume_within_minutes: 60}))
    .toBe(quietFor(30).id);
});

test('and zero always starts fresh', async () => {
  bags.sessions = [quietFor(0)];
  expect(await recentSession('lover', {...DEFAULTS, resume_within_minutes: 0})).toBe('');
});

test('the shipped default is the short one', () => {
  // The number in config.py is what anybody who has not edited theirs gets.
  expect(DEFAULTS.resume_within_minutes).toBe(5);
});

/* ---- and what a room does with it ---------------------------------------- */

test('no name in the address picks the sitting back up', async () => {
  bags.sessions = [quietFor(2)];
  const room = await openRoom('lover');
  expect(room.sessionId).toBe(quietFor(2).id);
  expect(bags.made).toBe(0);         // nothing new was named
});

test('and starts a fresh one when there is nothing to pick up', async () => {
  const room = await openRoom('lover');
  expect(room.sessionId).toBe('2026-03-03T03-03-01_lover');
  expect(link.getState().sid).toBe(room.sessionId);
});

test('the room knows which tags its voice performs, and a silent machine is none', async () => {
  machine.tags = ['[laugh]', '[sigh]'];
  expect((await openRoom('lover')).tags).toEqual(['[laugh]', '[sigh]']);
  leaveRoom();
  machine.down = true;
  expect((await openRoom('lover')).tags).toEqual([]);
});

test('a name in the address is opened, spoken in or not', async () => {
  const room = await openRoom('lover', '2026-01-02T03-04-05_lover');
  expect(room.sessionId).toBe('2026-01-02T03-04-05_lover');
  expect(link.getState().nowhere).toBe(false);
});

test('and a name this room could never have made is said, not replaced', async () => {
  for (const bad of ['nope', '2026-01-02T03-04-05_thinker', '../../etc/passwd']) {
    leaveRoom();
    link.setState({nowhere: false});
    await expect(openRoom('lover', bad)).rejects.toBeInstanceOf(Nowhere);
    expect(link.getState().nowhere, bad).toBe(true);
    // And nothing was opened in its place: the address bar is the request.
    expect(bags.made).toBe(0);
  }
});

/* ---- two tabs, one conversation ------------------------------------------ */

test('the first line of a conversation is the header it is owed', async () => {
  /* Owed at the first line rather than when the name was handed out: a
     conversation nobody has said anything in has no file at all. The machine
     wrote it while it knew whose a conversation was; this end knows now. */
  const room = await openRoom('lover');
  bags.version = 1;
  await write(room, {kind: 'turn', role: 'user', content: 'hello'});
  expect(bags.appends).toEqual([
    {kind: 'meta', persona: 'lover', persona_name: 'Purple'},
    {kind: 'turn', role: 'user', content: 'hello'},
  ]);
});

test('and a conversation already written in gets no second header', async () => {
  const room = await openRoom('lover');
  room.version = 4;
  bags.version = 5;
  await write(room, {kind: 'turn', role: 'user', content: 'hello'});
  expect(bags.appends).toEqual([{kind: 'turn', role: 'user', content: 'hello'}]);
});

test('an append refused over a line of this page\'s own is written once more', async () => {
  /* The one refusal that is not another tab: an append that landed with its
     answer lost. The file holds this page's own line and nothing else new, so
     the count is adopted and the line goes in against it. */
  const room = await openRoom('lover');
  room.version = 4;                    // already spoken in; no header owed
  bags.refuse = 1;
  bags.version = 5;
  bags.lines = fileWith({kind: 'turn', role: 'user', content: 'hello'});
  expect(await write(room, {kind: 'turn', role: 'user', content: 'hello'}))
    .toBe('written');
  expect(bags.appends).toHaveLength(2);
  expect(room.version).toBe(5);
  expect(link.getState().nowhere).toBe(false);
});

test('a header refused takes the line behind it, and no first line goes in', async () => {
  /* The first line of a conversation is two appends: the header and the turn.
     The header's own refusal is this conversation belonging to another page
     from its very first line -- and the turn used to be appended behind it
     anyway, into a file this page had already been told is not its own, with
     the banner up over a line that landed. */
  const room = await openRoom('lover');
  room.version = 0;                    // nothing said yet: a header is owed
  bags.refuse = 1;
  bags.version = 5;
  bags.lines = fileWith({kind: 'turn', role: 'user', content: 'from the other tab'});
  expect(await write(room, {kind: 'turn', role: 'user', content: 'hello'}))
    .toBe('nowhere');
  expect(bags.appends).toEqual([{kind: 'meta', persona: 'lover', persona_name: 'Purple'}]);
  expect(link.getState().nowhere).toBe(true);
});

test('but a line this page did not write ends its claim on the conversation', async () => {
  /* Two pages typing into one conversation at each other, which is the one
     real collision there is. Adopting the count and writing anyway -- which is
     what this did -- meant two tabs each took one refusal per turn and then
     succeeded: the file interleaved both conversations, each page held half of
     it, and the banner needed two refusals in a row and never saw them. */
  const room = await openRoom('lover');
  room.version = 4;
  bags.refuse = 1;
  bags.version = 5;
  bags.lines = fileWith({kind: 'turn', role: 'user', content: 'from the other tab'});
  expect(await write(room, {kind: 'turn', role: 'user', content: 'hello'}))
    .toBe('nowhere');
  expect(bags.appends, 'it wrote over the other page anyway').toHaveLength(1);
  expect(link.getState().nowhere).toBe(true);
});

test('and a second refusal is this page being the one that moved on', async () => {
  const room = await openRoom('lover');
  room.version = 4;
  bags.stale = true;
  bags.version = 12;
  bags.lines = fileWith({kind: 'turn', role: 'user', content: 'hello'});
  await write(room, {kind: 'turn', role: 'user', content: 'hello'});
  expect(link.getState().nowhere).toBe(true);
});

test('a conversation read again is the conversation this page is then in', async () => {
  /* For the one thing a page does that is neither a write nor an open: a turn
     taken back out is a read and then a delete by position, and a file that
     moved between the two is refused. Nothing is spliced then -- this page is
     looking at a transcript that is out of date, and the honest answer is to
     look again. */
  const room = await openRoom('lover');
  room.windowFrom = 2;
  bags.session = {
    id: room.sessionId, persona: 'lover', version: 7,
    turns: [{role: 'user', content: 'hello'}, {role: 'assistant', content: 'there'}],
    scenes: [{text: 'a shop, late'}],
  };
  await reread(room);
  expect(room.history.map((m) => m.content)).toEqual(['hello', 'there']);
  expect(room.version).toBe(7);
  expect(room.windowFrom, 'every index past the change has moved').toBe(-1);
  expect(link.getState().transcript.map((t) => t.text)).toEqual(['hello', 'there']);
  expect(link.getState().scene).toBe('a shop, late');
});

test('a conversation somebody else is in this second is not resumed', async () => {
  /* Opening the same pill in a second tab within the resume window put both
     pages in one conversation, and from there every line either of them wrote
     cost the other a refusal. A page arriving into a conversation somebody is
     speaking in gets one of its own. */
  bags.sessions = [quietFor(0.05)];    // three seconds ago, and not by us
  expect(await recentSession('lover', DEFAULTS)).toBe('');
});

test('but this page\'s own reload picks that same conversation back up', async () => {
  /* The difference is sessionStorage: it comes with a tab through a reload and
     is invisible to a second one. */
  const last = quietFor(0.05);
  bags.sessions = [last];
  sessionStorage.setItem('lucid.talk.wrote',
                         JSON.stringify({id: last.id, at: last.at}));
  expect(await recentSession('lover', DEFAULTS)).toBe(last.id);
});

test('what a hand did is in the store as well as on disk', async () => {
  /* The page hands the room its record again whenever the record changes,
     and it changes after every scored turn. A record still carrying the state
     the room was opened with put the lamp back on two turns after a hand had
     turned it off. */
  await openRoom('lover');
  expect(link.getState().room?.state).toEqual({});
  await saveRoomState({lamp: 0, 'book-2-1': 3,
                       shoves: [{name: 'book-2-1', steps: 0},
                                {name: 'book-2-1', steps: 88},
                                {name: 'book-2-1', steps: 74}]});
  expect(link.getState().room?.state).toEqual(
    {lamp: 0, 'book-2-1': 3, v: 2,
     shoves: [{name: 'book-2-1', steps: 0},
              {name: 'book-2-1', steps: 88},
              {name: 'book-2-1', steps: 74}]});
  expect(link.getState().room?.persona).toBe('lover');
});

test('an open overtaken by another pill plants nothing', async () => {
  /* The route is one component for every pill, so lover → thinker is two
     opens in flight at once. The slower used to land last: the page showing
     one pill was handed the other's transcript, session and voice. */
  const lover = PILLS[0]!;
  PILLS.push({...lover, slug: 'thinker'});
  try {
    const first = openRoom('lover');
    const second = openRoom('thinker');
    const [a, b] = await Promise.all([first, second]);
    expect(b.slug).toBe('thinker');
    expect(a).toBe(b);                                 // the overtaken call is given the room
    expect(link.getState().slug).toBe('thinker');
  } finally {
    PILLS.pop();
  }
});

/* ---- another page, through the surface ----------------------------------- */

test('a page that says where a line was said has it on every turn, and nothing else changes', async () => {
  const {attach, quiet} = await import('./surface');
  const told: string[] = [];
  attach({
    ...quiet,
    where: () => ({step: 420, region: 'the Salt Flats'}),
    transcript: (m) => { told.push(m.type); },
  });
  try {
    const room = await openRoom('lover');
    bags.version = 1;
    await write(room, {kind: 'turn', role: 'assistant', content: 'the wind'});
    await write(room, {kind: 'scene', text: 'a slope'});
    expect(bags.appends).toEqual([
      {kind: 'meta', persona: 'lover', persona_name: 'Purple'},
      {kind: 'turn', role: 'assistant', content: 'the wind', step: 420, region: 'the Salt Flats'},
      {kind: 'scene', text: 'a slope'},
    ]);
    // The page's own store was not written into: this is not its room.
    expect(link.getState().slug).toBe('');
    expect(link.getState().transcript).toEqual([]);
  } finally {
    attach(null);
  }
  // And Talk's own is back.
  leaveRoom();
  const again = await openRoom('lover');
  expect(link.getState().slug).toBe('lover');
  expect(link.getState().sid).toBe(again.sessionId);
});
