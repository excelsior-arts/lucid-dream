/* This game's words against the two shapes the machine keeps.
 *
 * The other half of what tests/machine/test_store.py checks. That end owns the
 * files and knows nothing about them; this end owns the meaning and never
 * touches a file — so what is worth checking here is the mapping itself: which
 * address each of these words becomes, that a page composes the sheet inside
 * the lid out of a listing rather than being handed one, and that a turn is
 * taken back out by the position this end found it at.
 *
 * The machine is a stub that remembers what it was asked, because what is
 * under test is the asking.
 */
import {beforeEach, expect, test, vi} from 'vitest';
import * as F from './files';

interface Asked {url: string; method: string; body?: string}

const asked: Asked[] = [];
/** What the stub answers, by the address asked. First match wins. */
let answers: Array<[RegExp, unknown]> = [];

/** An answer that is not a 200. The store's two refusals -- an append and a
    delete that named a version the file is not at -- are 409s carrying the
    count it actually is at, and a stub that only ever says 200 cannot tell
    this end's handling of one from its handling of anything else. */
const refused = (status: number, body: unknown) => ({lucidStatus: status, body});

const reply = (url: string) => {
  for (const [what, body] of answers) if (what.test(url)) return body;
  return undefined;
};

const statusOf = (said: unknown): number =>
  (said as {lucidStatus?: number} | null)?.lucidStatus ?? 200;
const bodyOf = (said: unknown): unknown =>
  statusOf(said) === 200 ? said : (said as {body: unknown}).body;

beforeEach(() => {
  asked.length = 0;
  answers = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    asked.push({url, method: init?.method ?? 'GET', body: init?.body as string});
    const said = reply(url + ' ' + (init?.method ?? 'GET'));
    if (said === undefined) return Promise.resolve({ok: false, status: 404});
    const status = statusOf(said);
    const body = bodyOf(said);
    return Promise.resolve({
      ok: status === 200,
      status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  });
});

/* The addresses, with the machine's own root off the front: it is
   http://localhost:3000 under jsdom and the page's own origin in a browser,
   and neither is what these tests are about. See @lucid/machine's address.ts. */
const urls = () =>
  asked.map((a) => `${a.method} ${a.url.replace(/^https?:\/\/[^/]+/, '')}`);

// ---- which address each word becomes ---------------------------------------

test('what a pill remembers is a value by path', async () => {
  answers = [[/data\/memory\/lover\.md/, '- he sleeps late\n']];
  expect(await F.memory('lover')).toBe('- he sleeps late');
  expect(urls()).toEqual(['GET /store/lucid-talk/data/memory/lover.md']);
});

test('and nothing written yet is nothing rather than a failure', async () => {
  expect(await F.memory('lover')).toBe('');
});

test('where you stand is a value beside it', async () => {
  answers = [[/lover\.relation\.json/, {warmth: -12.5}]];
  expect(await F.relation('lover')).toEqual({warmth: -12.5});
  expect(urls()).toEqual(['GET /store/lucid-talk/data/memory/lover.relation.json']);
});

test('and a standing nobody has scored is nothing at all', async () => {
  /* Not an empty state: a pill nobody has spoken to has no standing, which is
     a different thing from one that has come back to the middle. */
  expect(await F.relation('lover')).toBeNull();
});

test('a hand-edited file that will not parse loses the file, not the room', async () => {
  answers = [[/lover\.relation\.json/, '{not json']];
  expect(await F.relation('lover')).toBeNull();
});

test('resetting a standing deletes the file', async () => {
  answers = [[/relation\.json DELETE/, {removed: true}]];
  expect(await F.resetRelation('lover')).toBe(true);
  expect(urls()).toEqual(
    ['DELETE /store/lucid-talk/data/memory/lover.relation.json']);
});

test('a room is a value under the conversation it happened in', async () => {
  answers = [[/data\/rooms/, {lamp: 3}]];
  expect(await F.roomState('a_lover')).toEqual({lamp: 3});
  expect(urls()).toEqual(['GET /store/lucid-talk/data/rooms/a_lover.json']);
});

test('and a later save keeps what it did not mention', async () => {
  /* Take a fitting out for a redesign, put it back four commits later, and its
     state is still there. The machine merged this while it knew what a room
     was; this end does now. */
  answers = [[/data\/rooms/, {lamp: 3, shelf: 2}], [/rooms.*PUT/, {bytes: 1}]];
  await F.roomState('a_lover');
  await F.saveRoomState('a_lover', {lamp: 1});
  const wrote = asked.find((a) => a.method === 'PUT');
  expect(JSON.parse(wrote!.body!)).toEqual({lamp: 1, shelf: 2, v: 2});
});

test('a save from before the order was kept opens as it is', async () => {
  // `v` 1, or none at all: a count per name and nothing else. Nothing here
  // rewrites it — the room does that, once it has worked out what the steps
  // between those shoves turned out to be.
  answers = [[/data\/rooms/, {lamp: 2, 'book-2-1': 3}]];
  expect(await F.roomState('a_lover')).toEqual({lamp: 2, 'book-2-1': 3});
});

test('and the shoves are one record of one evening, replaced whole', async () => {
  /* The counts merge, because a name this room did not mention is a fitting
     taken out for a redesign. The list does not: two of them merged is two
     evenings interleaved, and the room that came out of it was in neither. */
  answers = [[/data\/rooms/, {v: 2, lamp: 1, shelf: 2,
                              shoves: [{name: 'book-1-0', steps: 0},
                                       {name: 'book-1-0', steps: 91}]}],
             [/rooms.*PUT/, {bytes: 1}]];
  await F.roomState('a_lover');
  await F.saveRoomState('a_lover', {lamp: 1, shoves: [{name: 'cushion-1', steps: 0}]});
  const wrote = asked.find((a) => a.method === 'PUT');
  expect(JSON.parse(wrote!.body!)).toEqual(
    {lamp: 1, shelf: 2, v: 2, shoves: [{name: 'cushion-1', steps: 0}]});
});

test('the settings are one value, and a change is merged into it', async () => {
  answers = [[/config\.json GET/, {ui: {continuous_minutes: 15}, scene: {enabled: true}}],
             [/config\.json PUT/, {bytes: 1}]];
  await F.saveConfig({ui: {continuous_minutes: 20}});
  const wrote = asked.find((a) => a.method === 'PUT');
  expect(urls()).toContain('PUT /store/lucid-talk/data/config.json');
  // A patch answers one question. Merged shallowly it would take the block
  // with it, and what runs instead are the fallbacks in config.ts.
  expect(JSON.parse(wrote!.body!)).toEqual(
    {ui: {continuous_minutes: 20}, scene: {enabled: true}});
});

// ---- the conversations -----------------------------------------------------

const LOG = '/store/lucid-talk/logs/sessions/2026-03-03T03-03-03_lover.jsonl';

const transcript = (lines: unknown[]) => [
  [/logs\/sessions\/.*jsonl GET/, {lines, version: lines.length}] as [RegExp, unknown],
];

test('a conversation is a log, and its lines are what is on disk', async () => {
  answers = transcript([
    {kind: 'meta', persona: 'lover', persona_name: 'Purple'},
    {kind: 'turn', role: 'user', content: 'there you are'},
    {kind: 'scene', text: 'a shop, late'},
    null,                                  // a torn last line, holding its place
  ]);
  const got = await F.readSession('2026-03-03T03-03-03_lover');
  expect(got.turns).toEqual([{role: 'user', content: 'there you are', ts: undefined}]);
  expect(got.scenes).toEqual([{text: 'a shop, late', ts: undefined}]);
  expect(got.persona).toBe('lover');
  expect(got.version).toBe(4);
  expect(urls()).toEqual([`GET ${LOG}`]);
});

test('an append says which version it expects to follow', async () => {
  answers = [[/jsonl POST/, {version: 3}]];
  const out = await F.append('2026-03-03T03-03-03_lover',
                             {kind: 'turn', role: 'user', content: 'hello'}, 2);
  expect(out).toEqual({version: 3});
  const sent = JSON.parse(asked[0]!.body!) as {version: number; line: Record<string, unknown>};
  expect(sent.version).toBe(2);
  expect(sent.line.kind).toBe('turn');
  expect(typeof sent.line.ts).toBe('number');
});

test('and a header carries the moment it was started instead', async () => {
  answers = [[/jsonl POST/, {version: 1}]];
  await F.append('2026-03-03T03-03-03_lover',
                 {kind: 'meta', persona: 'lover', persona_name: 'Purple'}, 0);
  const sent = JSON.parse(asked[0]!.body!) as {line: Record<string, unknown>};
  expect(typeof sent.line.started).toBe('number');
  expect(sent.line.ts).toBeUndefined();
});

test('a turn is taken back out by the position it was found at', async () => {
  /* The most recent line that says exactly that. Found here, where the lines
     have just been read, and deleted by index -- asking the machine to match a
     body would be asking it to look at one. */
  answers = [...transcript([
    {kind: 'turn', role: 'user', content: 'again'},
    {kind: 'turn', role: 'assistant', content: 'in between'},
    {kind: 'turn', role: 'user', content: 'again'},
  ]), [/jsonl DELETE/, {removed: true, version: 4}]];
  const out = await F.removeTurn('2026-03-03T03-03-03_lover', 'user', 'again', 3);
  expect(out).toEqual({removed: true, version: 4});
  const gone = asked.find((a) => a.method === 'DELETE');
  // The position, and the version this page believes the file is at: between
  // the read above and this, a line from another page moves every position
  // after it and the delete would take the wrong turn.
  expect(JSON.parse(gone!.body!)).toEqual({index: 2, version: 3});
});

test('and one that is not there removes nothing', async () => {
  answers = transcript([{kind: 'turn', role: 'user', content: 'one'}]);
  expect(await F.removeTurn('2026-03-03T03-03-03_lover', 'user', 'two', 1))
    .toEqual({removed: false, version: 1});
  expect(asked.some((a) => a.method === 'DELETE')).toBe(false);
});

test('and a file that moved under it deletes nothing and says where it got to',
  async () => {
    /* The store compares the version while holding the lock the writes are
       under, so this is the answer to the whole race: the line the position
       named is not the line this page meant, and nothing was taken out. */
    answers = [...transcript([
      {kind: 'turn', role: 'user', content: 'again'},
    ]), [/jsonl DELETE/, refused(409, {version: 7})]];
    expect(await F.removeTurn('2026-03-03T03-03-03_lover', 'user', 'again', 3))
      .toEqual({removed: false, version: 7, stale: true});
  });

// ---- the sheet inside the lid ----------------------------------------------

const listing = (items: unknown[]) =>
  [/logs\/sessions\/ GET/, {items}] as [RegExp, unknown];

test('whose an evening was is read off the listing', async () => {
  /* One request for all of them: the store hands over each log's first line,
     which is where this game writes whose conversation it is. */
  answers = [listing([
    {id: '2026-03-03T04-00-00_thinker.jsonl', lines: 4, at: 1,
     head: {persona: 'thinker'}},
    {id: '2026-03-03T03-00-00_lover.jsonl', lines: 2, at: 0,
     head: {persona: 'lover'}},
  ])];
  const mine = await F.conversations('lover');
  expect(mine.map((x) => x.id)).toEqual(['2026-03-03T03-00-00_lover']);
  expect(urls()).toEqual(['GET /store/lucid-talk/logs/sessions/']);
});

test('and off the name for anything written before there were first lines', async () => {
  answers = [listing([
    {id: '2026-03-03T03-00-00_lover.jsonl', lines: 2, at: 0, head: null},
  ])];
  expect((await F.conversations('lover')).length).toBe(1);
});

test('the sheet is composed here, out of a listing and two reads a pill', async () => {
  /* It was one route on the machine, which is exactly what a machine with no
     vocabulary cannot answer: doses are logs whose first line names a pill,
     what is remembered is lines in a file, and a standing is a bag of numbers
     this end does the arithmetic on. */
  answers = [
    listing([{id: '2026-03-03T03-00-00_lover.jsonl', lines: 6, at: 1,
              head: {persona: 'lover'}}]),
    [/data\/memory\/lover\.md/, '- he sleeps late\n- and says so\n'],
    [/lover\.relation\.json/, {warmth: 30}],
  ];
  const got = await F.ledger();
  expect(got.doses).toBe(1);
  const lover = got.pills.find((p) => p.slug === 'lover');
  expect(lover?.doses).toBe(1);
  expect(lover?.remembered).toBe(2);
  expect(lover?.standing).toEqual({warmth: 30});
  expect(lover?.name).toBe('Purple');
  // A pill nobody has taken has no row of zeroes to explain away.
  expect(got.pills.find((p) => p.slug === 'thinker')?.doses).toBe(0);
});

test('and a conversation nobody said anything in is not offered', async () => {
  /* A name handed out and abandoned is not somewhere to return to, and it is
     what keeps History clear of evenings nobody had. */
  answers = [listing([{id: '2026-03-03T03-00-00_lover.jsonl', lines: 1, at: 1,
                       head: {persona: 'lover'}}]),
             ...transcript([{kind: 'meta', persona: 'lover'}])];
  expect(await F.sessions('lover')).toEqual([]);
});

test('what a conversation was about is read from the ones it will offer', async () => {
  answers = [listing([{id: '2026-03-03T03-00-00_lover.jsonl', lines: 3, at: 1,
                       head: {persona: 'lover', persona_name: 'Purple'}}]),
             ...transcript([
               {kind: 'meta', persona: 'lover'},
               {kind: 'turn', role: 'user', content: 'a'.repeat(200)},
               {kind: 'turn', role: 'assistant', content: 'and back'},
             ])];
  const [card] = await F.sessions('lover');
  expect(card?.turns).toBe(2);
  expect(card?.persona_name).toBe('Purple');
  expect(card?.preview.endsWith('…')).toBe(true);
  expect(card?.preview.length).toBe(71);
});

test('a moment comes back as the six words it was formatted as', () => {
  const at = new Date(2026, 7, 28, 15, 22).getTime() / 1000;
  expect(F.when(at)).toBe('Aug 28 15:22');
});

/* ---- the two files that are written whole --------------------------------- */

test('a memory written by another page is kept alongside this one\'s', async () => {
  /* Neither file has a version and the machine has no vocabulary to check one
     with, so a save re-reads and compares against what this page last saw. A
     fold's bullets are the distillate of an evening and exist nowhere else. */
  answers = [[/memory\/lover\.md GET/, '- he sleeps late\n'],
             [/memory\/lover\.md PUT/, '']];
  expect(await F.memory('lover')).toBe('- he sleeps late');
  // Somebody else's fold lands while this page holds its copy.
  answers = [[/memory\/lover\.md GET/, '- he sleeps late\n- he has a brother\n'],
             [/memory\/lover\.md PUT/, '']];
  await F.saveMemory('lover', '- he sleeps late\n- he hates the cold');
  const put = asked.find((a) => a.method === 'PUT');
  expect(put?.body).toBe('- he sleeps late\n- he hates the cold\n- he has a brother\n');
});

test('and a shorter line is not swallowed by the longer one it replaces', async () => {
  /* "Already in what this page read" was a search through the whole file, so a
     bullet that is the front of one already in it -- which is what a rewrite
     of a line looks like -- was taken for one this page had seen and dropped
     on the floor. */
  answers = [[/memory\/lover\.md GET/, '- he has a dog named Spot\n'],
             [/memory\/lover\.md PUT/, '']];
  await F.memory('lover');
  // The other page corrected it while this one held the old copy.
  answers = [[/memory\/lover\.md GET/, '- he has a dog\n'],
             [/memory\/lover\.md PUT/, '']];
  await F.saveMemory('lover', '- he sleeps late');
  const put = asked.find((a) => a.method === 'PUT');
  expect(put?.body).toBe('- he sleeps late\n- he has a dog\n');
});

test('and an unchanged file is written without any of that', async () => {
  answers = [[/memory\/lover\.md GET/, '- he sleeps late\n'],
             [/memory\/lover\.md PUT/, '']];
  await F.memory('lover');
  await F.saveMemory('lover', '- he sleeps late\n- and later');
  const put = asked.find((a) => a.method === 'PUT');
  expect(put?.body).toBe('- he sleeps late\n- and later\n');
});

test('two standings do not merge: the last writer wins, out loud', async () => {
  /* Warmth 12 and warmth -4 do not average into anything anybody felt. */
  answers = [[/relation\.json GET/, {warmth: 4}], [/relation\.json PUT/, '']];
  await F.relation('lover');
  answers = [[/relation\.json GET/, {warmth: -20}], [/relation\.json PUT/, '']];
  await F.saveRelation('lover', {warmth: 12});
  const put = asked.find((a) => a.method === 'PUT');
  expect(JSON.parse(put?.body ?? '{}')).toEqual({warmth: 12});
});
