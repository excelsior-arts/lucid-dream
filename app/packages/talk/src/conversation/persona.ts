/* The character as this player has it: what the game ships, and what they
 * have changed about it.
 *
 * §2.5 of the plan, and the one place the two layers meet. The game's
 * characters travel in the bundle (conversation/bundle.ts) and are read-only:
 * editing a persona.md on the server was a habit of the old design, and in an
 * Electron build there is no server and no directory to edit. What replaces it
 * is an override kept in the player's own data, beside their memories:
 *
 *   data/personas/<slug>/prompt.md        the body, and only the body
 *   data/personas/<slug>/tunables.json    numbers and the voice, over the header
 *
 * Both through conversation/files.ts, which is to say both are ordinary values
 * in the store — the machine holds them the way it holds a memory file and has
 * no more idea what they are.
 *
 * ---- the rule, in one sentence ---------------------------------------------
 *
 * `prompt.md` replaces the shipped body and nothing else; `tunables.json`
 * replaces the shipped header a key at a time. So the pill's name, its colour,
 * its figure, its blurb and the room it opens in are the game's whatever a
 * player writes — those are what the box is drawn from and what a card *is* —
 * and what a player owns is the words in its mouth and how they come out.
 *
 * An override that says nothing is not an override: an empty prompt.md would
 * be a character with no words, which is not a character. So an empty save
 * deletes the file, which is what makes Save-on-an-empty-box a reset.
 *
 * ---- and the prompt cache --------------------------------------------------
 *
 * The system prompt is the head of the prefix the LLM server caches (see
 * `window` in prompt.ts, and the measurement in it). Layering here rather than
 * per turn means the assembled prompt changes exactly once when somebody sets
 * an override: the next turn misses the cache and pays for it, and every turn
 * after it is back on the same prefix. That is why this is cached and dropped
 * by hand on a write, rather than read fresh on every turn -- a file read per
 * turn would be cheap, but a prompt rebuilt per turn is an invitation to make
 * it vary per turn, and that costs about two seconds each time.
 */
import {voices} from '@lucid/machine';
import {voiceName} from './bundle';
import {hatch, host} from '@lucid/shell';
import type {PersonaCard} from '../link/shapes';
import {all} from './bundle';
import * as F from './files';

/** What may be tuned over a character's header.
 *
 * The first two are the model's and reach it on every reply. The middle three
 * are the voice's delivery, which the speaker does not read yet -- they are
 * the machine's own config today (machine/config.py, `tts`), and are accepted
 * here because the file is the player's record of what they want this
 * character to sound like and the day the speaker takes them is a day this
 * file does not have to be edited. `tune` says so out loud rather than letting
 * somebody set one and wonder why nothing moved. */
export interface Tunables {
  temperature?: number;
  top_p?: number;
  exaggeration?: number;
  cfg_weight?: number;
  pause?: number;
  voice?: string;
}

/** The numbers, and what each may sensibly be. Wide rather than tight: these
    are not the game's opinion about a good setting, only the range outside
    which a value is a typo. */
const BOUNDS: Record<string, [number, number]> = {
  temperature: [0, 2],
  top_p: [0, 1],
  exaggeration: [0, 2],
  cfg_weight: [0, 1],
  pause: [0, 5],
};

/** Every key `persona_tune` takes, in the order it lists them. */
export const TUNABLES: readonly string[] = [...Object.keys(BOUNDS), 'voice'];

/** The ones something actually acts on today. See Tunables. */
const HEEDED = new Set(['temperature', 'top_p', 'voice']);

/** The character the game ships, which is the only thing there is to layer
    over. Drafts included: a character written and not offered is still one
    somebody may be working on. */
function shipped(slug: string): PersonaCard {
  const found = all().find((p) => p.slug === slug);
  if (!found) throw new Error(`there is no pill called ${slug}`);
  return found;
}

/** Whatever is on disk, as the tunables it is allowed to be.
 *
 * A hand-edited file is the ordinary case here rather than a strange one --
 * these are two files in a player's own directory and somebody will open them
 * in an editor -- so a key nobody knows and a value of the wrong type are both
 * dropped, and the rest of the file still counts. The alternative is a
 * character that will not load because of a stray comma. */
export function tunablesOf(raw: unknown): Tunables {
  const out: Tunables = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'voice') {
      if (typeof value === 'string' && value.trim()) out.voice = value.trim();
      continue;
    }
    const bound = BOUNDS[key];
    if (!bound || typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value < bound[0] || value > bound[1]) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** The shipped character with the player's two files over it. */
export function layer(base: PersonaCard, body: string | null, mine: Tunables): PersonaCard {
  const out: PersonaCard = {...base};
  /* The whole file is the body. There is no frontmatter to read here and none
     is looked for: what a character is called and what colour it is are the
     game's, so a header in this file would be a set of keys quietly ignored --
     better that it is plainly part of the words, where whoever typed it can
     see what it did. */
  const words = (body ?? '').trim();
  if (words) out.prompt = words;
  for (const [key, value] of Object.entries(mine)) {
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/* ---- the effective character, read once per room ---------------------------
 *
 * Cached because everything that assembles a turn asks for it -- the prompt,
 * the temperature, the voice -- and dropped by hand whenever one of the two
 * files is written, which is the only way it can change. `forget` with no
 * argument is for a test, and for the day a second player can be switched to
 * without a reload.
 */
const held = new Map<string, Promise<PersonaCard>>();

export function forget(slug = ''): void {
  if (slug) held.delete(slug);
  else held.clear();
}

/** The character this player is actually talking to. */
export function effectivePersona(slug: string): Promise<PersonaCard> {
  const already = held.get(slug);
  if (already) return already;
  const work = read(slug);
  held.set(slug, work);
  /* A read that failed is not an answer to keep: a machine that was not
     answering when a room opened would otherwise be a character stuck as
     "could not read" for the life of the page. */
  void work.catch(() => { if (held.get(slug) === work) held.delete(slug); });
  return work;
}

async function read(slug: string): Promise<PersonaCard> {
  const base = shipped(slug);
  const [body, tuned] = await Promise.all([mine(slug), tuning(slug)]);
  return layer(base, body, await onTheShelf(base, tuned));
}

/** A tuned voice the machine has not got is not a voice.
 *
 * `tune` checks the name before it writes it, so the only way to reach this is
 * a tunables.json edited by hand or carried over from a checkout with a
 * different voice pack. Left alone, every chunk of every reply came back
 * refused: the words arrived, no sound did, and the amber banner flashed once
 * a sentence over a machine that was perfectly well. So the name is checked
 * where the character is read, once per room, and a name that is not there is
 * dropped -- the character speaks in what it ships with, and the console says
 * which and why.
 *
 * A machine that will not say what it has is not an answer to act on: the
 * shelf is unknown, not empty, and the tuning stands. */
/* Whose shelf of voices it is: the machine's, or -- with nothing behind the
   page -- this browser's own. */
const here = (): string => (host().machine ? 'this machine' : 'this browser');

async function onTheShelf(base: PersonaCard, tuned: Tunables): Promise<Tunables> {
  // A bare word in the file is one of this game's own, the way the header's is.
  const want = tuned.voice && voiceName(tuned.voice);
  if (!want || want === base.voice) return want ? {...tuned, voice: want} : tuned;
  const shelf = await voices().catch(() => null);
  if (!shelf || shelf.includes(want)) return {...tuned, voice: want};
  hatch.say(`${base.pill || base.name || base.slug} is tuned to a voice called `
    + `"${want}" and ${here()} has ${shelf.length ? shelf.join(', ') : 'none'} `
    + `— speaking in "${base.voice}" instead`, 'warn');
  const rest = {...tuned};
  delete rest.voice;
  return rest;
}

/* Nothing written is the ordinary case, and so is a machine that will not
   answer: a room whose overrides could not be read opens as the shipped
   character rather than not opening. The console has plenty to say about a
   machine that is down; a character is not the place to say it again. */
const mine = (slug: string): Promise<string | null> =>
  F.personaPrompt(slug).catch(() => null);

const tuning = (slug: string): Promise<Tunables> =>
  F.personaTunables(slug).then(tunablesOf, () => ({}));

// ---- what a player changes --------------------------------------------------

/** Put this character's words in the player's own hand.
 *
 * An empty save is a reset, and deliberately: there is no such thing as a
 * character with nothing to say, so a box somebody has cleared is a box asking
 * for the shipped words back. Answers whether there is now an override. */
export async function setPrompt(slug: string, text: string): Promise<boolean> {
  shipped(slug);                       // a slug this game does not have is a mistake
  const words = (text || '').trim();
  if (words) await F.savePersonaPrompt(slug, words);
  else await F.forgetPersonaPrompt(slug);
  forget(slug);
  return !!words;
}

/** One tunable, written over the shipped header. Answers with the line to say.
 *
 * A voice is checked against the shelf before it is written, because it is the
 * one tunable whose being wrong is silent from in here: the words arrive, the
 * sound does not, and the only sign is a line in the console as the next room
 * opens. Everything else is a number and says so at once.
 */
export async function tune(slug: string, key: string, raw: string): Promise<string> {
  shipped(slug);
  const name = (key || '').trim().toLowerCase();
  if (!TUNABLES.includes(name))
    throw new Error(`there is nothing called ${name || 'that'} to tune — `
      + TUNABLES.join(', '));
  const said = (raw || '').trim();
  let value: number | string;
  if (name === 'voice') {
    if (!said) throw new Error(`which voice: a name on ${here()}'s shelf`);
    const full = voiceName(said);
    const shelf = await voices().catch(() => null);
    if (!shelf)
      throw new Error(`${here()} did not say which voices it has, so `
        + `"${full}" could not be checked — try again`);
    if (!shelf.includes(full))
      throw new Error(`${here()} has no voice called "${full}" — it has `
        + (shelf.length ? shelf.join(', ') : 'none at all'));
    value = full;
  } else {
    const n = Number(said);
    if (!said || !Number.isFinite(n)) throw new Error(`${name} is a number`);
    const [lo, hi] = BOUNDS[name] as [number, number];
    if (n < lo || n > hi) throw new Error(`${name} is between ${lo} and ${hi}`);
    value = n;
  }
  const now: Tunables = {...(await tuning(slug)), [name]: value};
  await F.savePersonaTunables(slug, now);
  forget(slug);
  return `${name} is ${value}`
    + (HEEDED.has(name) ? '' : ` — nothing reads ${name} yet: the delivery is `
       + `${host().machine ? "the machine's" : "the voice's"} own setting, and this is kept for the day it is not`);
}

/** Both files gone, and the shipped character back. Answers whether there was
    anything there to remove. */
export async function resetPersona(slug: string): Promise<boolean> {
  shipped(slug);
  const [words, tuned] = await Promise.all([
    F.forgetPersonaPrompt(slug), F.forgetPersonaTunables(slug),
  ]);
  forget(slug);
  return words || tuned;
}

// ---- what the console says about it -----------------------------------------

const show = (v: unknown): string => (typeof v === 'number' ? String(v) : String(v ?? ''));

/** How this character is set, and which of it is the player's. */
export function settings(now: PersonaCard, mine: Tunables): string {
  const said = TUNABLES
    .filter((key) => key in mine || now[key] !== undefined && now[key] !== null)
    .map((key) => `${key} ${show(now[key])}${key in mine ? ' (yours)' : ''}`);
  return said.length ? said.join(' · ') : 'nothing set either way';
}

/** Which parts of this character are the player's, and what it is tuned to.
 *
 * Never the words themselves: the console is a log, this game's logs never
 * carry what was said, and a persona body is several hundred of them. How many
 * lines there are is a size, and /persona_set is where the text is read. */
export async function describe(slug: string): Promise<string> {
  const base = shipped(slug);
  const [body, tuned] = await Promise.all([mine(slug), tuning(slug)]);
  const now = layer(base, body, tuned);
  const words = (body ?? '').trim();
  const lines = words ? words.split('\n').filter((l) => l.trim()).length : 0;
  const head = words
    ? `prompt overridden: ${lines} lines of yours, which /persona_set reads`
    : 'shipped; nothing here is yours yet';
  return `${base.pill || base.name || slug} — ${head}\n${settings(now, tuned)}`;
}

/** The same second line on its own, for `persona_tune` with nothing after it. */
export async function tunedTo(slug: string): Promise<string> {
  const base = shipped(slug);
  const [body, tuned] = await Promise.all([mine(slug), tuning(slug)]);
  return `${settings(layer(base, body, tuned), tuned)}\n`
    + `persona_tune <${TUNABLES.join('|')}> <value>`;
}
