/* What this game ships with: its characters and the text it sends the model.
 *
 * Reading these files used to be the server's job, and that it is not any more
 * is the point of it. A persona is content the game owns — the words in its
 * mouth, what it is called, what it is tuned to — and the machine has no
 * business parsing any of it. So the files travel in the package
 * (`app/packages/talk/content/`), Vite reads them into the bundle at build
 * time, and this is the only thing that knows what a frontmatter key means.
 *
 * ---- read at build rather than on each use ---------------------------------
 *
 * The Python read every file on every ask, so editing a persona and starting a
 * new conversation was enough to hear it. That is gone with the server that
 * did it: the content is compiled in, and an edit takes a rebuild. What
 * replaces it is the thread §2.5 of the plan is about — a player's own
 * override, kept in their data and layered over the shipped text — which is
 * the door an Electron build has and a directory of markdown on a server is
 * not.
 */
import {hatch, host} from '@lucid/shell';
import type {PersonaCard} from '../link/shapes';
import type {Prompts} from './prompt';
import {pronoun} from './pronouns';

/** A markdown file's header and its body.
 *
 * The same shape a persona and half the static-site generators in the world
 * use. A file with no header is all body, which is a file somebody has not got
 * round to describing rather than a mistake.
 */
/* Where this game's clips sit on the machine's shelf.

   A voice is a path on the shelf, and the shelf is the published pack laid
   down as it is: this game's clips are inside its own folder there, one per
   character. The machine knows nothing of what the folders mean; the game
   does, and this is the whole of what it knows. A persona writes one word --
   `voice: lover` -- and the word is placed in that folder here, so the file
   stays short and the shelf can hold other games' voices beside ours. A name
   with a slash in it is taken as written: another game's voice, or a clip
   somebody cut and shelved themselves. One beginning `@` is in the player's
   own store, where an uploaded clip lives. */
export const VOICES = 'lucid_talk/personas';

export function voiceName(name: string): string {
  const said = name.trim();
  if (!said || said.includes('/') || said.startsWith('@')) return said;
  return `${VOICES}/${said}`;
}

export function frontmatter(raw: string): [Record<string, unknown>, string, string] {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return [{}, raw, ''];
  try {
    return [keys(m[1] ?? ''), m[2] ?? '', ''];
  } catch (e) {
    /* A header that will not parse loses the header and not the body: the
       prompt is the half that cannot be defaulted. What it must not do is lose
       it silently -- every value in that header has a default, and the
       defaults are a character that un-drafts itself, is called by its slug,
       and speaks in a voice the shelf may not have. So the trouble is handed
       back, and `card` treats a file it could not read as one somebody is
       still working on. */
    return [{}, m[2] ?? '', e instanceof Error ? e.message : String(e)];
  }
}

/* ---- the subset of YAML a header is written in ----------------------------
 *
 * `key: value` a line at a time, `#` comments, and `key: |` for the one thing
 * that needs paragraphs. That is every construct in every file this game
 * ships, and writing the twenty lines below is cheaper than carrying a YAML
 * parser into the bundle for them. Anything outside it — a list, a nested map,
 * a flow sequence — throws, and a header that throws is a header ignored, for
 * the same reason: the prompt is the half that cannot be defaulted.
 */

/** One `key: value` line's value, as the type it was written as. */
function scalar(raw: string): unknown {
  const text = raw.trim();
  if (!text) return '';
  // Quoted first, and with the trailing comment allowed after the closing
  // quote: a colour is written `"205, 111, 184"   # not a violet`, and the
  // hash is the file's own aside rather than part of the value.
  const quoted = /^"([^"]*)"\s*(?:#.*)?$|^'([^']*)'\s*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[1] ?? quoted[2];
  // And the same aside on a bare value, which is where every persona says why
  // a number is what it is.
  const bare = text.replace(/\s+#.*$/, '').trim();
  if (bare === 'true') return true;
  if (bare === 'false') return false;
  if (bare === 'null' || bare === '~') return null;
  if (/^[[{]/.test(bare)) throw new Error('flow collections are not read here');
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(bare)) return Number(bare);
  return bare;
}

function keys(header: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = header.split('\n');
  const held = (from: number): [string, number] => {
    /* A block scalar: every following indented line, with the indent of the
       first taken off the rest. `place` is written this way, and it is a
       paragraph the model is shown as it was typed. */
    const body: string[] = [];
    let indent = 0;
    let i = from;
    for (let next = lines[i + 1]; next !== undefined; next = lines[i + 1]) {
      if (next.trim() && !/^\s/.test(next)) break;
      i += 1;
      if (!next.trim()) {
        body.push('');
        continue;
      }
      if (!indent) indent = next.length - next.trimStart().length;
      body.push(next.slice(indent));
    }
    return [body.join('\n').replace(/\s+$/, '') + '\n', i];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) throw new Error('nested keys are not read here');
    const at = line.indexOf(':');
    if (at < 0) throw new Error('not a bag of keys');
    const name = line.slice(0, at).trim();
    const rest = line.slice(at + 1);
    if (/^\s*\|\s*(#.*)?$/.test(rest)) {
      [out[name], i] = held(i);
      continue;
    }
    out[name] = scalar(rest);
  }
  return out;
}

/* ---- the characters -------------------------------------------------------
 *
 *   content/personas/<slug>/persona.md
 *
 * The body is the system prompt; the header is what the character is tuned to.
 * `?raw` and `eager` because there are four of them and they are read on the
 * way into the box: a lazy import here would be a box that draws its cards a
 * frame late.
 */
const FILES = import.meta.glob<string>('../../content/personas/*/persona.md',
                                       {query: '?raw', import: 'default', eager: true});

/** The house answer for a character that says nothing about its colour. Grey
    brass: a card, and plainly not one anybody chose a colour for. */
const PLAIN = '150, 140, 130';

const titled = (slug: string): string =>
  slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** A key the machine used to read off a persona and hand over as it found it.
    Kept as a number or as nothing at all: a character with no opinion about
    its temperature takes the machine's, and 0 is an opinion. */
const number = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function card(path: string, raw: string): PersonaCard {
  const slug = path.split('/').at(-2) ?? '';
  const [meta, body, broken] = frontmatter(raw);
  const title = titled(slug);
  if (broken) {
    hatch.say(`${slug}'s persona.md has a header that will not parse (${broken}) `
      + '— it is kept out of the box until it does', 'warn');
  }
  return {
    /* Whatever else the header happens to say, through unread: `exaggeration`
       and `cfg_weight` are the voice's, `place` is the room's, and a key
       invented tomorrow reaches whoever knows what it is for without this
       file being edited. */
    ...meta,
    slug,
    /* Written, but not shown: kept out of the box until it is ready, without
       the directory going and without old conversations with it closing. A
       header nobody could read is the same thing, and for the same reason:
       everything a card is drawn from would be a default. */
    draft: Boolean(meta.draft) || !!broken,
    /* Kept in the tray and out of the box: a character another game speaks
       through. See character.ts. */
    internal: Boolean(meta.internal),
    /* Two names, and the split is the point. `name` is the character's own,
       used where a character is being addressed — the prompt, and nothing
       else. `pill` is what a player is handed. */
    name: String(meta.name ?? title),
    pill: String(meta.pill ?? title),
    /* Which clip on the machine's shelf it speaks from: its own name, unless
       it says it borrows another's. Two characters that should sound alike is
       the only reason to write `voice:` — see GET /machine/voices, which is
       the list this has to be a name in. A bare word is one of this game's
       own, in the folder the pack ships them in; see voiceName. */
    voice: voiceName(String(meta.voice ?? slug)),
    blurb: String(meta.blurb ?? ''),
    color: String(meta.color ?? PLAIN),
    figure: String(meta.figure ?? ''),
    /* Where this begins, for the model. Only ever a first line — see room.ts,
       where the scene takes over from it. */
    place: typeof meta.place === 'string' ? meta.place : '',
    temperature: number(meta.temperature),
    top_p: number(meta.top_p),
    /* Nothing said for this many seconds, and it speaks first. Off unless
       the header says. */
    silence: number(meta.silence),
    silence_line: typeof meta.silence_line === 'string' ? meta.silence_line : '',
    /* What to call it in the third person. The pills were written as she,
       and a header that says nothing is one of them. */
    pronouns: pronoun(meta.pronouns, 'she'),
    prompt: body.trim(),
  };
}

const CARDS: PersonaCard[] = Object.entries(FILES)
  .map(([path, raw]) => card(path, raw));

/** Every character in the package, drafts and all. */
export const all = (): PersonaCard[] => CARDS;

/** The characters on offer, as the box and the room read them. Drafts are
    written and not offered, internal ones are offered elsewhere, and the
    order is the one the tray is laid out in. */
export const personas = (): PersonaCard[] =>
  CARDS.filter((p) => !p.draft && !p.internal)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

/* ---- the text it sends the model ------------------------------------------
 *
 * Which prompts there are is the directory, not a list written down: a prompt
 * invented tomorrow is a file dropped in beside these, and whoever assembles a
 * turn asks for it by name.
 */
const TEXT = import.meta.glob<string>('../../content/prompts/*.md',
                                      {query: '?raw', import: 'default', eager: true});

/** Every prompt, by name.
 *
 * Words that are read rather than heard get system_text.md in place of
 * system.md: the sound rules mean nothing there, and what a small model needs
 * said instead is to stay in the first person and off the asterisks (the
 * research of 10-08 found the 2B and the 4B doing both). That is a Mac whose
 * voice is not on its shelf, and a browser, whose words come from a small
 * model in this page, a voice there or not.
 *
 * A censored model -- one that sometimes answers as the model rather than as
 * the character (host().censored; see refusal.ts), all of the browser's builds
 * today -- gets system_page.md, wherever it runs: the same text, opened the
 * way system.md opens: "You are heard aloud, not read." The research of 10-09
 * found system.md's opening kept the browser 4B from answering as the model
 * on a first line more often than the text-mode one did. Its voice lines were
 * tried there as well, and the 4B wrote its replies as stage directions
 * between asterisks, which the page strips: 73 of 108 replies over six
 * evenings, five of them all evening, against 21 with this opening alone.
 *
 * And in a browser the content limit, page_limits.md, after it and before
 * the persona: a rule of the web build, whatever its model. With no model
 * flagged, a Mac's prompt -- with its voice or without -- is the one it
 * always was, byte for byte. Read when a room opens, and again when the
 * model in use turns out to be another (room.ts). */
export const prompts = (): Prompts => {
  const all: Record<string, string> = Object.fromEntries(Object.entries(TEXT).map(
    ([path, raw]) => [path.split('/').at(-1)?.replace(/\.md$/, '') ?? '', raw.trim()]));
  if (host().censored && all.system_page) all.system = all.system_page;
  else if ((!host().voice || host().llm === 'page') && all.system_text) all.system = all.system_text;
  if (host().llm === 'page' && all.page_limits) all.system = `${all.system ?? ''}\n${all.page_limits}`;
  delete all.system_page;
  delete all.page_limits;
  return all;
};
