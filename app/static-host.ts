/* What a build for a static host needs that the machine's does not.
 *
 * The machine answers every address with the one document (machine/web.py)
 * and serves its icons from machine/static, so none of this is written for
 * it. A static host -- GitHub Pages, where the page lives at
 * https://excelsior-arts.github.io/lucid-dream/ -- has no server to ask:
 * a file is there or it is not. So the build lays down, beside the one
 * document,
 *
 *   - a copy of it at every address the house knows: the shelf, /talk, each
 *     pill's room, /trip and each trip, each with its own <title> and its own
 *     og: lines, so a link pasted into a chat is previewed as what it opens
 *     and the host answers 200 rather than its 404;
 *   - 404.html, the same document again, which Pages serves (with a 404) for
 *     any other address -- the old /lucid-talk/... ones among them, which the
 *     page then moves to where they are now;
 *   - the web manifest with its addresses under the base;
 *   - the pictures the previews name, copied from docs/og/. Every address
 *     has one, by its name there: `shelf.jpg` for the shelf, and the rest by
 *     their address with the slashes as dashes -- `talk.jpg`, `talk-lover.jpg`,
 *     `trip.jpg`, `trip-burning-man.jpg`. An address with no picture of its
 *     own is previewed by its game's, and a game with none by the shelf's, so
 *     a link is never pasted into a chat as a bare line. JPEG, because a WebP
 *     is shown by some chat apps and not by others, and 1200x630, the shape
 *     every one of them takes -- with what matters inside the middle square,
 *     which is what X and iMessage cut it to (Burning Man's is its own
 *     repository's share card, at twice that). The size the tags say is read
 *     off the file, and what it shows, for somebody who cannot see it, off
 *     docs/og/alt.json -- a picture not named there is said by what it stands
 *     for: "The Lucid Trip box". README's pictures stay where they are, beside
 *     it in docs/: they are drawn for a page, framed, and not this shape.
 *
 * Which pages there are is read from the source as the bundle does: the
 * pills off content/personas/<slug>/persona.md (those not drafts and not
 * internal), the trips off trips/<id>/trip.ts, the two games' names and lines
 * off their manifest.ts. A file it cannot read -- the shelf's picture among
 * them, which every other address falls back to -- stops the build rather than
 * shipping a page that previews as nothing.
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const PACKAGES = HERE + 'packages/';
/** Where the previews' pictures are kept. */
export const OG = HERE + '../docs/og/';

export interface Picture {
  /** Its name in docs/og/, and under og/ in the build. */
  file: string;
  width: number;
  height: number;
  /** What it shows, for somebody who cannot see it. */
  alt: string;
}

export interface Page {
  /** Under the base, without slashes at either end; '' is the shelf. */
  at: string;
  title: string;
  description: string;
  /** What a link to it is previewed by: its own picture, its game's, or the shelf's. */
  image: Picture;
}

const must = (what: string, got: string | undefined): string => {
  if (!got) throw new Error(`static-host: could not read ${what}`);
  return got;
};

/** `key: 'value'` out of a manifest or a trip's card. */
const field = (src: string, key: string, file: string): string =>
  must(`${key} in ${file}`, new RegExp(`\\b${key}: '([^']*)'`).exec(src)?.[1]);

/** A persona's header: `key: value`, a trailing `# comment` off. */
function header(file: string): Record<string, string> {
  const text = readFileSync(file, 'utf8');
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const m = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** A JPEG's width and height, off its frame header. */
export function jpegSize(file: string): {width: number; height: number} {
  const b = readFileSync(file);
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error(`static-host: ${file} is not a JPEG`);
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    // The frame headers: every SOFn but DHT (c4), JPG (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return {height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7)};
    // Standalone markers have no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0xff) { i += 2; continue; }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`static-host: ${file} has no frame header`);
}

function game(dir: string): {name: string; blurb: string; path: string} {
  const file = `${PACKAGES}${dir}/src/manifest.ts`;
  const src = readFileSync(file, 'utf8');
  return {name: field(src, 'name', file), blurb: field(src, 'blurb', file), path: field(src, 'path', file)};
}

/** Every address the house knows, what each says about itself, and the
    picture it is previewed by, out of `og` (docs/og/ unless a test says). */
export function pages(og = OG): Page[] {
  const talk = game('talk');
  const trip = game('trip');
  /* Each address with the picture it would have if it had its own, and whose
     picture stands in for it when it has not: its game's. */
  const want: Array<Omit<Page, 'image'> & {alt: string; game?: string}> = [
    {at: '', title: 'Lucid Dream',
     description: `${trip.name}: ${trip.blurb} ${talk.name}: ${talk.blurb}`,
     alt: `The ${trip.name} and ${talk.name} boxes on the shelf`},
    {at: talk.path, title: talk.name, description: talk.blurb, alt: `The ${talk.name} box`},
  ];
  const personas = `${PACKAGES}talk/content/personas/`;
  for (const slug of readdirSync(personas).sort()) {
    const file = `${personas}${slug}/persona.md`;
    if (!existsSync(file)) continue;
    const h = header(file);
    if (/^true\b/.test(h.draft ?? '') || /^true\b/.test(h.internal ?? '')) continue;
    const pill = must(`pill in ${file}`, h.pill);
    want.push({at: `${talk.path}/${slug}`, title: `${pill} — ${talk.name}`,
               description: h.blurb || talk.blurb, alt: `${pill}'s room in ${talk.name}`, game: talk.path});
  }
  want.push({at: trip.path, title: trip.name, description: trip.blurb, alt: `The ${trip.name} box`});
  const trips = `${PACKAGES}trip/src/trips/`;
  for (const id of readdirSync(trips).sort()) {
    const file = `${trips}${id}/trip.ts`;
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const title = field(src, 'title', file);
    want.push({at: `${trip.path}/${field(src, 'id', file)}`,
               title: `${title} — ${trip.name}`,
               description: field(src, 'blurb', file), alt: `${title}, a trip in ${trip.name}`, game: trip.path});
  }
  const name = (at: string) => (at ? at.replace(/\//g, '-') : 'shelf') + '.jpg';
  const byAt = new Map(want.map((w) => [w.at, w]));
  const said = existsSync(og + 'alt.json')
    ? JSON.parse(readFileSync(og + 'alt.json', 'utf8')) as Record<string, string> : {};
  return want.map((w) => {
    // Its own, its game's, the shelf's: the first of them that is there.
    const at = [w.at, w.game, ''].find((a) => a !== undefined && existsSync(og + name(a)));
    if (at === undefined) throw new Error(`static-host: no picture for /${w.at}, and none for the shelf (${og}shelf.jpg)`);
    const file = name(at);
    return {at: w.at, title: w.title, description: w.description,
            image: {file, ...jpegSize(og + file), alt: said[file] ?? byAt.get(at)!.alt}};
  });
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The one document, dressed as one page. */
function dressed(html: string, page: Page, base: string, site: string): string {
  const url = `${site}${base}${page.at ? page.at + '/' : ''}`;
  const lines = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:type" content="website">`,
    ...(site ? [`<meta property="og:url" content="${esc(url)}">`] : []),
    `<meta property="og:image" content="${esc(`${site}${base}og/${page.image.file}`)}">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:width" content="${page.image.width}">`,
    `<meta property="og:image:height" content="${page.image.height}">`,
    `<meta property="og:image:alt" content="${esc(page.image.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image:alt" content="${esc(page.image.alt)}">`,
  ];
  if (!html.includes('<title>Lucid Dream</title>')) throw new Error('static-host: index.html has no <title> to replace');
  return html.replace('<title>Lucid Dream</title>', lines.join('\n'));
}

/** The plugin: on a build for a static host, after the bundle is written. */
export function staticHost(o: {base: string; site: string}): Plugin {
  // Wherever the build was told to write, which is dist/ unless --outDir says otherwise.
  let out = HERE + 'dist/';
  return {
    name: 'lucid-static-host',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir) + '/';
    },
    closeBundle() {
      const html = readFileSync(out + 'index.html', 'utf8');
      const all = pages();
      for (const page of all) {
        const dir = out + (page.at ? page.at + '/' : '');
        mkdirSync(dir, {recursive: true});
        writeFileSync(dir + 'index.html', dressed(html, page, o.base, o.site));
        mkdirSync(out + 'og', {recursive: true});
        copyFileSync(OG + page.image.file, out + 'og/' + page.image.file);
      }
      // Anything else: the shelf's document, which routes from the address.
      writeFileSync(out + '404.html', dressed(html, all[0]!, o.base, o.site));
      // The manifest's addresses are the root's; under a base they are not.
      const mf = out + 'shared/manifest.webmanifest';
      const m = JSON.parse(readFileSync(mf, 'utf8')) as {
        start_url: string; scope: string; icons: Array<{src: string}>};
      m.start_url = o.base;
      m.scope = o.base;
      for (const icon of m.icons) icon.src = o.base + icon.src.replace(/^\//, '');
      writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
    },
  };
}
