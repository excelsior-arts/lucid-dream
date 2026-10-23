/* The count, kept: through the store's own routes, answered here the way the
 * browser answers them with nothing behind the page -- the same routes, the
 * same bodies and the same 409 the machine on a Mac sends (machine/store.py).
 */
import {afterEach, beforeEach, expect, test} from 'vitest';
import {answeredBy, call} from '@lucid/machine';
import {memoryDrawer, storeAnswer} from '@lucid/machine/page/store.js';
import type {Drawer} from '@lucid/machine/page/store.js';
import {doses, doseWords, takeDose} from './doses';

let drawer: Drawer;

beforeEach(() => {
  drawer = memoryDrawer();
  answeredBy(storeAnswer(drawer));
});

afterEach(() => answeredBy(null));

test('nothing taken is no count at all, and not a failure', async () => {
  expect(await doses()).toEqual({});
});

test('a dose is a line in the card\'s own log, under the player\'s Lucid Trip', async () => {
  expect(await takeDose('burning-man')).toBe(1);
  expect(await takeDose('burning-man')).toBe(2);
  expect(await takeDose('another')).toBe(1);
  expect(await doses()).toEqual({'burning-man': 2, another: 1});
  // Where it lands: userdata/players/<who>/lucid-trip/doses/<card>.jsonl.
  const kept = await drawer.get('players/player1/lucid-trip/doses/burning-man.jsonl');
  const lines = kept!.text.trim().split('\n').map((l) => JSON.parse(l) as {kind: string; ts: number});
  expect(lines).toHaveLength(2);
  expect(lines.every((l) => l.kind === 'dose' && l.ts > 0)).toBe(true);
});

test('two pages taking the same trip are two doses, not one written over the other', async () => {
  const [a, b] = await Promise.all([takeDose('burning-man'), takeDose('burning-man')]);
  expect([a, b].sort()).toEqual([1, 2]);
  expect(await doses()).toEqual({'burning-man': 2});
});

test('a store that will not answer is said, not read as nothing taken', async () => {
  answeredBy(async () => new Response('{}', {status: 500}));
  await expect(doses()).rejects.toThrow(/500/);
  await expect(takeDose('burning-man')).rejects.toThrow(/500/);
  // And the stand-in is a real answer: the listing is the store's own route.
  answeredBy(storeAnswer(drawer));
  expect((await call('/store/lucid-trip/logs/doses/')).ok).toBe(true);
});

test('the words: never taken, one dose, n doses', () => {
  expect(doseWords(0)).toBe('never taken');
  expect(doseWords(1)).toBe('1 dose');
  expect(doseWords(12)).toBe('12 doses');
});
