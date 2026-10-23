/* userdata/ in a browser: the layout a Mac keeps, the move from the first
   preview's keys, and a zip out and back in. */
import {afterEach, expect, test} from 'vitest';
import {memoryDrawer, storeAnswer} from './store';
import type {Drawer} from './store';
import {exported, imported, named, settings, settle, whoIsHere} from './userdata';
import {unzip, zip} from './zip';

afterEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});

const post = (body: unknown): RequestInit => ({method: 'POST', body: JSON.stringify(body)});
const keys = async (d: Drawer) => (await d.list('')).map(([k]) => k).sort();
const enc = new TextEncoder();

test('a game\'s files are players/<who>/<game>/<path>, and the player is never in the address', async () => {
  const d = memoryDrawer();
  const pete = storeAnswer(d, () => 'pete');
  await pete('/store/lucid-talk/data/memory/lover.md', {method: 'PUT', body: '- a dog\n'});
  await pete('/store/lucid-talk/logs/sessions/a.jsonl', post({line: {kind: 'meta'}, version: 0}));
  expect(await keys(d)).toEqual([
    'players/pete/lucid-talk/memory/lover.md', 'players/pete/lucid-talk/sessions/a.jsonl']);
  // Somebody else's evening is not this player's.
  const them = storeAnswer(d, () => 'player1');
  expect(await (await them('/store/lucid-talk/data/memory/lover.md')).text()).toBe('');
});

test('the player: ?user=, kept until changed, player1 by default, paths.py\'s names', () => {
  expect(whoIsHere()).toBe('player1');
  history.replaceState(null, '', '/talk/lover?user=Pete&session=x');
  expect(whoIsHere()).toBe('pete');
  expect(location.search).toBe('?session=x');     // taken out of the address
  expect(whoIsHere()).toBe('pete');                // and kept
  const said: string[] = [];
  history.replaceState(null, '', '/?user=../root');
  expect(whoIsHere((l) => said.push(l))).toBe('pete');
  expect(said[0]).toMatch(/not a name/);
  expect(named('.hidden')).toBeNull();
  expect(named('a'.repeat(33))).toBeNull();
});

test('config.json: the defaults with the file over them, and only what was set written', async () => {
  const d = memoryDrawer();
  const cfg = settings(d);
  expect((await cfg.load()).llm.size).toBe('');
  await cfg.note({llm: {size: '4b'}});
  expect((await cfg.load()).llm.size).toBe('4b');
  expect(JSON.parse((await d.get('config.json'))!.text)).toEqual({llm: {size: '4b'}});
});

test('config.json: the voice is off and Turbo until said, and one key of a section is written alone', async () => {
  const d = memoryDrawer();
  const cfg = settings(d);
  expect((await cfg.load()).tts).toEqual({enabled: false, engine: 'turbo'});
  await cfg.note({llm: {size: '2b'}});
  // Written together, as the first-open card and the voice's switch may be.
  await Promise.all([cfg.noteIn('tts', {enabled: true}), cfg.noteIn('tts', {engine: 'sopro'}),
                     cfg.noteIn('llm', {size: '4b'})]);
  expect(JSON.parse((await d.get('config.json'))!.text))
    .toEqual({llm: {size: '4b'}, tts: {enabled: true, engine: 'sopro'}});
  expect((await cfg.load()).tts).toEqual({enabled: true, engine: 'sopro'});
});

test('the first preview\'s keys move under players/player1, once, and nothing is overwritten', async () => {
  const d = memoryDrawer();
  const e = (text: string) => ({text, type: '', at: 1});
  await d.put('lucid-talk/logs/sessions/a.jsonl', e('{"kind":"meta"}\n'));
  await d.put('lucid-talk/data/memory/lover.md', e('- old\n'));
  await d.put('players/player1/lucid-talk/memory/lover.md', e('- new\n'));
  localStorage.setItem('lucid.page.llm', '2b');
  expect(await settle(d)).toBe(2);
  expect(await keys(d)).toEqual(['config.json', 'players/player1/lucid-talk/memory/lover.md',
    'players/player1/lucid-talk/memory/lover.md.strayed', 'players/player1/lucid-talk/sessions/a.jsonl']);
  expect((await d.get('players/player1/lucid-talk/memory/lover.md'))!.text).toBe('- new\n');
  expect((await settings(d).load()).llm.size).toBe('2b');
  expect(localStorage.getItem('lucid.page.llm')).toBeNull();
  expect(await settle(d)).toBe(0);
});

test('the voice chosen in localStorage moves into config.json once, and never over one written there', async () => {
  const d = memoryDrawer();
  localStorage.setItem('lucid.page.voice', 'nano');
  await settle(d);
  expect(JSON.parse((await d.get('config.json'))!.text)).toEqual({tts: {enabled: true, engine: 'nano'}});
  expect(localStorage.getItem('lucid.page.voice')).toBeNull();
  await settings(d).noteIn('tts', {enabled: false});
  localStorage.setItem('lucid.page.voice', 'sopro');
  await settle(d);
  expect((await settings(d).load()).tts).toEqual({enabled: false, engine: 'nano'});
  expect(localStorage.getItem('lucid.page.voice')).toBeNull();
});

test('out as a zip of userdata/ and back in, the same files', async () => {
  const d = memoryDrawer();
  const store = storeAnswer(d, () => 'player1');
  await store('/store/lucid-talk/logs/sessions/a.jsonl', post({line: {kind: 'meta', persona: 'lover'}, version: 0}));
  await store('/store/lucid-talk/data/memory/lover.md', {method: 'PUT', body: '- ünïcode ✓\n'});
  await settings(d).note({llm: {size: '2b'}});
  const z = await exported(d);
  expect((await unzip(z)).map((f) => f.name).sort()).toEqual([
    'config.json', 'players/player1/lucid-talk/memory/lover.md', 'players/player1/lucid-talk/sessions/a.jsonl']);
  const again = memoryDrawer();
  const got = await imported(again, z);
  expect(got.added).toHaveLength(3);
  for (const [k, e] of await d.list('')) expect((await again.get(k))!.text).toBe(e.text);
  // And again: all of it already here.
  expect((await imported(again, z)).same).toHaveLength(3);
});

test('an import keeps what differs unless told, and refuses what the store would', async () => {
  const d = memoryDrawer();
  await d.put('players/player1/lucid-talk/memory/lover.md', {text: 'mine\n', type: '', at: 1});
  const z = zip([
    {name: 'userdata/players/player1/lucid-talk/memory/lover.md', data: enc.encode('theirs\n')},
    {name: 'userdata/players/player1/log/lucid.log', data: enc.encode('x')},
    {name: 'userdata/players/player1/lucid-talk/.secret', data: enc.encode('x')},
    {name: 'userdata/certs/lucid.pem', data: enc.encode('x')},
    {name: 'userdata/players/Bad Name/lucid-talk/a.md', data: enc.encode('x')},
    {name: 'userdata/players/player1/lucid-talk/b.bin', data: new Uint8Array([0xff, 0xfe, 0x00])},
  ]);
  const got = await imported(d, z);
  expect(got.kept).toEqual(['players/player1/lucid-talk/memory/lover.md']);
  expect(got.refused.map((r) => r.name.split('/').slice(-1)[0])).toEqual(
    ['lucid.log', '.secret', 'lucid.pem', 'a.md', 'b.bin']);
  expect((await d.get('players/player1/lucid-talk/memory/lover.md'))!.text).toBe('mine\n');
  expect((await imported(d, z, {replace: true})).replaced).toHaveLength(1);
  expect((await d.get('players/player1/lucid-talk/memory/lover.md'))!.text).toBe('theirs\n');
});

test('one player\'s folder zipped on its own lands as that player, deflated or not', async () => {
  const raw = enc.encode('{"kind":"meta","persona":"thinker"}\n');
  const squeezed = new Uint8Array(await new Response(new Response(raw).body!
    .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  /* As Finder's Compress writes it: deflated. The stored zip is made and its
     one entry rewritten to method 8 with the squeezed bytes. */
  const name = 'pete/lucid-talk/sessions/b.jsonl';
  const stored = zip([{name, data: squeezed}]);
  const v = new DataView(stored.buffer);
  v.setUint16(8, 8, true);
  v.setUint32(22, raw.length, true);
  const dir = 30 + name.length + squeezed.length;
  v.setUint16(dir + 10, 8, true);
  v.setUint32(dir + 24, raw.length, true);
  expect(new TextDecoder().decode((await unzip(stored))[0]!.data)).toBe(new TextDecoder().decode(raw));
  const d = memoryDrawer();
  expect((await imported(d, stored)).added).toEqual(['players/pete/lucid-talk/sessions/b.jsonl']);
  expect((await d.get('players/pete/lucid-talk/sessions/b.jsonl'))!.text).toBe(new TextDecoder().decode(raw));
});
