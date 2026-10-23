/* The store kept in this browser, against what machine/store.py promises.
 *
 * Asked the way files.ts asks the machine -- paths, methods, bodies -- and
 * answered out of the drawer in memory, which is IndexedDB's stand-in here:
 * jsdom has no IndexedDB, and what is under test is the contract rather than
 * the database. The cases are tests/machine/test_store.py's, the ones a game
 * leans on. */
import {expect, test} from 'vitest';
import {memoryDrawer, storeAnswer} from './store';

const fresh = () => storeAnswer(memoryDrawer());
const post = (body: unknown): RequestInit => ({method: 'POST', body: JSON.stringify(body)});

test('a value nobody wrote is no bytes, and one written comes back as written', async () => {
  const ask = fresh();
  const none = await ask('/store/lucid-talk/data/memory/lover.md');
  expect(none.status).toBe(200);
  expect(await none.text()).toBe('');
  await ask('/store/lucid-talk/data/memory/lover.md', {method: 'PUT', body: '- he has a dog\n'});
  const got = await ask('/store/lucid-talk/data/memory/lover.md');
  expect(await got.text()).toBe('- he has a dog\n');
  expect(got.headers.get('Content-Type')).toContain('text/markdown');
  expect(await (await ask('/store/lucid-talk/data/memory/lover.md', {method: 'DELETE'})).json())
    .toEqual({removed: true});
  expect(await (await ask('/store/lucid-talk/data/memory/lover.md', {method: 'DELETE'})).json())
    .toEqual({removed: false});
});

test('an append follows the version it names, and the loser is told the count', async () => {
  const ask = fresh();
  const at = '/store/lucid-talk/logs/sessions/x.jsonl';
  const first = await ask(at, post({line: {kind: 'meta', persona: 'lover'}, version: 0}));
  expect(first.status).toBe(201);
  expect(await first.json()).toEqual({version: 1});
  const stale = await ask(at, post({line: {kind: 'turn'}, version: 0}));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({version: 1});
  expect((await ask(at, post({line: {kind: 'turn', role: 'user', content: 'hi'}, version: 1}))).status)
    .toBe(201);
  expect(await (await ask(at)).json()).toEqual({
    lines: [{kind: 'meta', persona: 'lover'}, {kind: 'turn', role: 'user', content: 'hi'}], version: 2});
});

test('the listing is newest first, with each log\'s first line and count', async () => {
  const ask = fresh();
  await ask('/store/g/logs/sessions/a.jsonl', post({line: {persona: 'a'}, version: 0}));
  await new Promise((go) => setTimeout(go, 5));
  await ask('/store/g/logs/sessions/b.jsonl', post({line: {persona: 'b'}, version: 0}));
  await ask('/store/g/logs/sessions/b.jsonl', post({line: {kind: 'turn'}, version: 1}));
  const {items} = await (await ask('/store/g/logs/sessions/')).json() as
    {items: Array<{id: string; lines: number; head: unknown}>};
  expect(items.map((x) => [x.id, x.lines, x.head])).toEqual([
    ['b.jsonl', 2, {persona: 'b'}], ['a.jsonl', 1, {persona: 'a'}]]);
});

test('a delete takes a line by position only at the version it was read at', async () => {
  const ask = fresh();
  const at = '/store/g/logs/s.jsonl';
  for (const [i, c] of ['one', 'two', 'three'].entries()) await ask(at, post({line: {c}, version: i}));
  const stale = await ask(at, {method: 'DELETE', body: JSON.stringify({index: 1, version: 2})});
  expect(stale.status).toBe(409);
  const gone = await ask(at, {method: 'DELETE', body: JSON.stringify({index: 1, version: 3})});
  expect(await gone.json()).toEqual({removed: true, version: 2});
  expect((await (await ask(at)).json() as {lines: unknown[]}).lines).toEqual([{c: 'one'}, {c: 'three'}]);
});

test('a path the machine would refuse is refused here too', async () => {
  const ask = fresh();
  expect((await ask('/store/g/data/../x')).status).toBe(400);
  expect((await ask('/store/g/data/.hidden')).status).toBe(400);
  expect((await ask('/store/g/logs/x.jsonl', post({line: 'nope', version: 0}))).status).toBe(400);
  expect((await ask('/store/g/logs/x.jsonl', post({line: {}, version: 'x'}))).status).toBe(400);
});
