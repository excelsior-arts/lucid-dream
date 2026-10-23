/* Every address a static build writes has a picture a chat can show.
 *
 * The pictures are kept in docs/og/ and named by address; one an address has
 * not got is its game's, and one a game has not got is the shelf's. These
 * tests hand pages() a folder of their own, so what is in docs/og/ today is
 * not what they test -- except the two things that are only true of it: that
 * every picture alt.json speaks of is there, and that Burning Man is
 * previewed by its own card.
 */
import {copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {jpegSize, OG, pages} from './static-host.ts';

/** The smallest file jpegSize reads: the start, an APP0 to step over, a frame header, the end. */
const jpeg = (width: number, height: number): Buffer => Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
  0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true}); });

/** A docs/og/ of the test's own, holding these pictures. */
function og(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'og-')) + '/';
  dirs.push(dir);
  for (const f of files) writeFileSync(dir + f, jpeg(1200, 630));
  return dir;
}

const ADDRESSES = ['', 'talk', 'talk/lover', 'talk/thinker', 'trip', 'trip/burning-man'];

test('every address the house knows is a page', () => {
  expect(pages(og('shelf.jpg')).map((p) => p.at)).toEqual(ADDRESSES);
});

test('each address by its own picture, named by its address', () => {
  const all = og('shelf.jpg', 'talk.jpg', 'talk-lover.jpg', 'talk-thinker.jpg', 'trip.jpg', 'trip-burning-man.jpg');
  expect(pages(all).map((p) => p.image.file)).toEqual(
    ['shelf.jpg', 'talk.jpg', 'talk-lover.jpg', 'talk-thinker.jpg', 'trip.jpg', 'trip-burning-man.jpg']);
});

test('one it has not got is its game\'s, and one the game has not got is the shelf\'s', () => {
  const some = og('shelf.jpg', 'trip.jpg', 'talk-lover.jpg');
  expect(pages(some).map((p) => [p.at, p.image.file])).toEqual([
    ['', 'shelf.jpg'],
    ['talk', 'shelf.jpg'],
    ['talk/lover', 'talk-lover.jpg'],
    ['talk/thinker', 'shelf.jpg'],
    ['trip', 'trip.jpg'],
    ['trip/burning-man', 'trip.jpg'],
  ]);
});

test('the words for a picture are those of whose picture it is', () => {
  const p = pages(og('shelf.jpg', 'trip.jpg'));
  const alt = (at: string) => p.find((x) => x.at === at)!.image.alt;
  expect(alt('')).toBe('The Lucid Trip and Lucid Talk boxes on the shelf');
  // The card stands in with the box's picture, and is said as the box.
  expect(alt('trip/burning-man')).toBe('The Lucid Trip box');
  expect(alt('talk/lover')).toBe('The Lucid Trip and Lucid Talk boxes on the shelf');
});

test('alt.json says what a picture shows, over what it stands for', () => {
  const dir = og('shelf.jpg', 'talk-thinker.jpg');
  writeFileSync(dir + 'alt.json', JSON.stringify({'talk-thinker.jpg': 'A library at night'}));
  expect(pages(dir).find((p) => p.at === 'talk/thinker')!.image.alt).toBe('A library at night');
});

test('the size is read off the file', () => {
  const dir = og();
  writeFileSync(dir + 'shelf.jpg', jpeg(2400, 1260));
  expect(pages(dir)[0]!.image).toMatchObject({width: 2400, height: 1260});
});

test('with no picture for the shelf the build stops rather than ship a bare link', () => {
  expect(() => pages(og('trip.jpg'))).toThrow(/no picture for \/, and none for the shelf/);
  expect(() => jpegSize(join(og(), '..', 'nothing.jpg'))).toThrow();
  const dir = og();
  writeFileSync(dir + 'shelf.jpg', 'not a picture');
  expect(() => pages(dir)).toThrow(/is not a JPEG/);
});

test('every picture alt.json speaks of is in docs/og', () => {
  const said = JSON.parse(readFileSync(OG + 'alt.json', 'utf8')) as Record<string, string>;
  const there = readdirSync(OG);
  for (const file of Object.keys(said)) expect(there).toContain(file);
});

test('Burning Man is previewed by its own card, as its own repository had it', () => {
  // docs/og/ as it is, with a shelf to stand on if it has none yet.
  const dir = og();
  for (const f of readdirSync(OG)) copyFileSync(OG + f, dir + f);
  if (!readdirSync(OG).includes('shelf.jpg')) writeFileSync(dir + 'shelf.jpg', jpeg(1200, 630));
  expect(pages(dir).find((p) => p.at === 'trip/burning-man')!.image).toEqual({
    file: 'trip-burning-man.jpg', width: 2400, height: 1260,
    alt: 'A burning figure walking a dark dune at dusk, the desert behind him',
  });
});
