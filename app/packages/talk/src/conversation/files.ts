/* This game's words, and the two shapes the machine keeps them in.
 *
 * Everything below is a path under `/store/lucid-talk/`, which is storage with
 * no vocabulary: values by path, and append-only logs by path. See
 * machine/store.py. Memory, standing, rooms and conversations are four words
 * this game uses for four paths, and this file is the only place the two
 * meet — the machine that holds them would hold a game with none of them
 * equally well.
 *
 *   data/config.json                 what this player has changed
 *   data/memory/<slug>.md            what a pill remembers about you
 *   data/memory/<slug>.relation.json where you stand with it
 *   data/personas/<slug>/prompt.md   a character in this player's own words
 *   data/personas/<slug>/tunables.json  and how they want it set
 *   data/rooms/<id>.json             what hands did in one conversation's room
 *   logs/sessions/<id>.jsonl         the conversation itself
 *
 * `data` and `logs` say which of the two shapes a path is being read as, and
 * are not directories: all of them land under
 * `userdata/players/<who>/lucid-talk/` exactly where they always have. The
 * layout was never the machine's to change — it is a player's, there is one
 * copy of it, and somebody may have years of evenings in it.
 *
 * One name for three things, and that is deliberate: `lucid-talk` is the
 * namespace in the address, the directory under a player's, and the package
 * this file is in. Three names for one thing would be two of them going stale.
 *
 * The one rule worth knowing: an append says which version of the log it
 * expects to follow, which is the line count as this page last read it. Two
 * tabs in one conversation is the only real collision there is, and the loser
 * is told the count rather than overwriting.
 */
import {beacon, call} from '@lucid/machine';
import {hatch} from '@lucid/shell';
import type {LedgerPill, RoomState, SessionCard} from '../link/shapes';
import {personas} from './bundle';
import {nameFor, whose} from './named';

export const GAME = 'lucid-talk';

/* A path on the store, asked of whoever answers the machine's routes on this
   page: the machine, or -- with nothing behind the page -- the stand-in that
   keeps the same two shapes in this browser (page/store.ts in
   @lucid/machine). Nothing here knows which. */
const base = () => `/store/${GAME}`;

/** A value, as text, or nothing at all where nothing has been written.
 *
 * Nothing written is the ordinary case rather than a failure everywhere in
 * here: a pill nobody has spoken to has no memory file, and "not there" and
 * "empty" are the same thing to everything on this page that reads one. The
 * store answers that with no bytes; a 404 means the same and is taken the same
 * way. Anything else is a real failure and is thrown. */
async function value(path: string): Promise<string | null> {
  const res = await call(`${base()}/data/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  const text = await res.text();
  return text === '' ? null : text;
}

/** The same, parsed. A file somebody has hand-edited into nonsense reads as
    nothing rather than throwing: it is one file of theirs, and the room it
    belongs to should still open. */
async function parsed<T>(path: string): Promise<T | null> {
  const raw = await value(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function write(path: string, body: string, type: string): Promise<void> {
  const res = await call(`${base()}/data/${path}`, {
    method: 'PUT',
    headers: {'Content-Type': type},
    body,
  });
  if (!res.ok) throw new Error(`writing ${path} answered ${res.status}`);
}

async function erase(path: string): Promise<boolean> {
  const res = await call(`${base()}/data/${path}`, {method: 'DELETE'});
  if (!res.ok) throw new Error(`deleting ${path} answered ${res.status}`);
  return ((await res.json()) as {removed?: boolean}).removed ?? false;
}

const asJson = (path: string, body: unknown) =>
  write(path, JSON.stringify(body, null, 2) + '\n', 'application/json');

// ---- what this player has changed -----------------------------------------

/** The settings on disk, which are only what somebody has actually set. The
    shipped answers are the manifest's and the merge is config.ts's -- so a key
    added there tomorrow arrives without this being edited. */
export const config = (): Promise<unknown> =>
  parsed<unknown>('config.json').then((got) => got ?? {});

/** Change one of them. A patch and not a file: merged a section at a time over
 *  what is there, so setting how long a dose lasts does not mean sending back
 *  every other number to keep it.
 *
 * Read, merged and written here rather than on the machine, which is the whole
 * of what moved: a store that merged would be a store that knows a section
 * from a key, and this end is the one that knows what either means. The file
 * appearing is still the record that somebody has set something. */
export async function saveConfig(patch: unknown): Promise<unknown> {
  const now = deeply((await config()) as Record<string, unknown>,
                     patch as Record<string, unknown>);
  await asJson('config.json', now);
  return now;
}

/** Merge a section at a time, not a file at a time. A patch that says
    {"memory": {"max_bullets": 12}} is answering one question, not replacing
    the block. */
function deeply(base: Record<string, unknown>,
                over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const [k, v] of Object.entries(over ?? {})) {
    const mine = out[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)
              && mine && typeof mine === 'object' && !Array.isArray(mine))
      ? deeply(mine as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
}

// ---- what a pill has become of yours ---------------------------------------

/* ---- the two files that are written whole ---------------------------------
 *
 * Memory and standing are not logs: each save replaces the file. There is no
 * version on either, so two pages that read the same copy and both write make
 * the second one's write the only one that happened -- and a fold's bullets,
 * which are the distillate of an evening and exist nowhere else, are gone.
 *
 * The machine has no vocabulary to check a version with, and it is not going
 * to grow one for this. What it can do is answer a read, so a save re-reads
 * first and compares against what this page last saw. Unchanged, it writes.
 * Changed, the two are reconciled -- and how they are reconciled is different
 * for the two files, because they are different kinds of thing:
 *
 *   memory is a list of true things, so the bullets that appeared while this
 *   page was away are kept and this page's are written on top of them. A
 *   memory with a duplicate line in it is a smaller wrong than one with an
 *   evening missing.
 *
 *   a standing is one state of one relationship, and there is no merging two
 *   of them: warmth 12 and warmth -4 do not average into anything anybody
 *   felt. The last writer wins, which is what already happened, and it is said
 *   in the console rather than done quietly.
 *
 * It is not a lock and it is not meant to be: two saves inside the same
 * round trip still lose one. What it stops is the ordinary case, which is two
 * pages an evening apart.
 */

/** What this page last saw in a file it rewrites whole, by path. */
const saw = new Map<string, string>();

const note = (path: string, raw: string | null): string => {
  const text = (raw ?? '').trim();
  saw.set(path, text);
  return text;
};

/** The file as it is now, for comparing against what this page last read. */
const nowOnDisk = (path: string): Promise<string> =>
  value(path).then((raw) => (raw ?? '').trim(), () => saw.get(path) ?? '');

export const memory = (slug: string): Promise<string> =>
  value(`memory/${slug}.md`).then((text) => note(`memory/${slug}.md`, text));

export async function saveMemory(slug: string, text: string): Promise<void> {
  const path = `memory/${slug}.md`;
  let kept = text.trim();
  const was = saw.get(path);
  const now = await nowOnDisk(path);
  if (was !== undefined && now !== was && now) {
    /* Lines somebody else wrote while this page was holding its copy. Kept, on
       top of this page's, and only the ones that are new: a fold rewrites the
       whole memory, so most of what is there will be in both.

       Line by line on both sides. "Already in what this page read" used to be
       a substring search over the whole of it, so a bullet that is the front
       of one already there -- "he has a dog" against "he has a dog named
       Spot" -- read as known and was dropped. Which is the one shape a
       rewrite takes: somebody's shorter, truer version of a line. */
    const mine = new Set(kept.split('\n').map((l) => l.trim()));
    const had = new Set(was.split('\n').map((l) => l.trim()));
    const theirs = now.split('\n')
      .filter((l) => l.trim() && !mine.has(l.trim()) && !had.has(l.trim()));
    if (theirs.length) {
      kept = [kept, ...theirs].filter((l) => l.trim()).join('\n');
      hatch.say(`${slug}'s memory had ${theirs.length} line(s) written by another `
        + 'page — they are kept alongside this one\'s', 'warn');
    }
  }
  await write(path, kept ? kept + '\n' : '', 'text/markdown');
  saw.set(path, kept);
}

/** Whatever is on disk for this persona. Unshaped on purpose: relation.read is
    what turns it into a standing, and it is written to survive a hand edit. */
export async function relation(slug: string): Promise<unknown> {
  const path = `memory/${slug}.relation.json`;
  const raw = await value(path);
  note(path, raw);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function saveRelation(slug: string, state: unknown): Promise<void> {
  const path = `memory/${slug}.relation.json`;
  const body = JSON.stringify(state, null, 2) + '\n';
  const was = saw.get(path);
  const now = await nowOnDisk(path);
  if (was !== undefined && now !== was && now && now !== body.trim()) {
    // No merging two standings. Said, so that it is not a silent overwrite.
    hatch.say(`where you stand with ${slug} was written by another page — `
      + 'this one\'s reading is what is on disk now', 'warn');
  }
  await write(path, body, 'application/json');
  saw.set(path, body.trim());
}

/** Back to nothing between you and this pill. Warmth, trust and mood, and the
    record of how you got here; what it remembers about you is not touched.
    The file goes rather than being zeroed, so a fresh start does not read as a
    suspiciously blank history. */
export const resetRelation = (slug: string): Promise<boolean> =>
  erase(`memory/${slug}.relation.json`)
    .then((gone) => { saw.delete(`memory/${slug}.relation.json`); return gone; });

// ---- a character, in this player's own hand --------------------------------

/* Two files per character, both absent until somebody changes something, and
 * both under this player's directory beside their memories: what the game
 * ships is in the bundle and is never written to. The layering is
 * conversation/persona.ts; these are only the paths.
 *
 * A character's slug is a path segment here, which the store is conservative
 * about (letters, digits, `_ - . ~ :`, no dotfiles) -- and every slug is a
 * directory name in `content/personas/` already, so anything the game ships is
 * a name it will take. */

/** This player's words for a character, or nothing where they have not
    written any. */
export const personaPrompt = (slug: string): Promise<string | null> =>
  value(`personas/${slug}/prompt.md`);

export const savePersonaPrompt = (slug: string, text: string): Promise<void> =>
  write(`personas/${slug}/prompt.md`, text.trim() + '\n', 'text/markdown');

export const forgetPersonaPrompt = (slug: string): Promise<boolean> =>
  erase(`personas/${slug}/prompt.md`);

/** Whatever is on disk for how they want it set. Unshaped on purpose, the way
    a standing is: persona.ts is what turns it into tunables, and it is written
    to survive a hand edit. */
export const personaTunables = (slug: string): Promise<unknown> =>
  parsed<unknown>(`personas/${slug}/tunables.json`);

export const savePersonaTunables = (slug: string, tuned: unknown): Promise<void> =>
  asJson(`personas/${slug}/tunables.json`, tuned);

export const forgetPersonaTunables = (slug: string): Promise<boolean> =>
  erase(`personas/${slug}/tunables.json`);

// ---- what a hand did to a room ---------------------------------------------

/* The room as it was last read or written, per conversation.
 *
 * A save keeps whatever is already on disk that this room did not mention --
 * take a fitting out for a redesign, put it back four commits later, and its
 * state is still there. The machine merged that for us and cannot any more, so
 * it is merged here, against what this page has already read rather than
 * against a fresh request: a hand moves things by the dozen, and a read before
 * every write would be a round trip per book pushed. */
const rooms = new Map<string, RoomState>();

/** The version every save is stamped with.
 *
 * 2 is the shape that keeps the shoves in the order they were made, beside
 * the counts. 1 was the counts alone, and one of those still opens — the room
 * redoes them in the order its own file registered things in and writes the
 * result back in this shape the next time anything is saved, which is what
 * this stamp going on every write is for. */
const V = 2;

export async function roomState(id: string): Promise<RoomState> {
  const got = (await parsed<RoomState>(`rooms/${id}.json`)) ?? {};
  rooms.set(id, got);
  return got;
}

export async function saveRoomState(id: string, state: RoomState): Promise<RoomState> {
  /* Shallow, and that is right for both halves of it: a count this room did
     not mention is a fitting taken out for a redesign and is kept, and the
     shoves are one record of one evening and are replaced whole. A merged
     list would be two evenings interleaved. */
  const merged = {...(rooms.get(id) ?? {}), ...state, v: V};
  rooms.set(id, merged);
  await asJson(`rooms/${id}.json`, merged);
  return merged;
}

/** Put a room back to nothing, leaving the conversation exactly as it was.
    The room's own reset, for when a design change has made a save absurd --
    books back up the spiral, cushions back onto the bed. */
export async function forgetRoomState(id: string): Promise<RoomState> {
  await erase(`rooms/${id}.json`);
  rooms.delete(id);
  return {};
}

// ---- the conversations themselves ------------------------------------------

/** One log, as the store's listing offers it: `head` is its first line, which
    is where this game writes whose conversation it is. */
interface Kept {
  id: string;
  lines: number;
  at: number;
  head: {persona?: string; persona_name?: string} | null;
}

/** Every conversation on disk, newest first, and one request for all of them.
 *
 * The store reads each log's first line for the listing, so whose an evening
 * was is known without opening any of them -- which is what makes the sheet
 * inside the lid one call plus two per pill rather than one per conversation. */
export async function conversations(persona = ''): Promise<Kept[]> {
  const res = await call(`${base()}/logs/sessions/`);
  if (!res.ok) throw new Error(`the conversations answered ${res.status}`);
  const got = ((await res.json()) as {items?: Kept[]}).items ?? [];
  const mine = got.map((x) => ({...x, id: x.id.replace(/\.jsonl$/, '')}));
  // Whose it is, off the first line, and off the name for anything written
  // before there were first lines -- the name has carried the pill since the
  // beginning. See named.ts.
  return persona
    ? mine.filter((x) => (x.head?.persona || whose(x.id)) === persona)
    : mine;
}

/** When it was last spoken in, for reading. The machine formatted this while
    it was the end that had the file; the moment itself is what it hands over
    now, and this is the same six words in the same order. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');
export function when(at: number): string {
  const d = new Date(at * 1000);
  return `${MONTHS[d.getMonth()]} ${two(d.getDate())} `
    + `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Recent conversations, newest first, with what each one was about.
 *
 * The count and the first line somebody said are in the file, so this reads
 * the ones it is going to offer and no others -- which is what `limit` is: a
 * number of conversations to draw, not a number of files to open. Anything
 * nobody ever said anything in is left out; a name handed out and abandoned is
 * not somewhere to return to.
 */
export async function sessions(persona = '', limit = 40): Promise<SessionCard[]> {
  const kept = await conversations(persona);
  const card = async (one: Kept): Promise<SessionCard> => {
    const {turns} = await readSession(one.id);
    const first = turns.find((t) => t.role === 'user')?.content ?? '';
    return {
      id: one.id,
      persona: one.head?.persona || whose(one.id),
      persona_name: one.head?.persona_name || '',
      turns: turns.length,
      when: when(one.at),
      /* The same moment as a number. `when` is for reading; this is for
         deciding, and the one thing anybody decides from it is whether coming
         back to a room is the same sitting or a new one. */
      at: one.at,
      preview: first.length > 70 ? first.slice(0, 70) + '…' : first,
    };
  };
  /* `limit` is a number of conversations to draw, not a number of files to
     open -- so the empty ones are dropped and the next ones read in their
     place. Cutting to `limit` first and dropping afterwards handed back
     fewer rows than were asked for, and a History that grew shorter the more
     conversations somebody had opened and said nothing in. Read in batches,
     because the ordinary case is that none of them are empty and one round of
     reads is the whole answer. */
  const out: SessionCard[] = [];
  for (let at = 0; at < kept.length && out.length < limit;) {
    const batch = kept.slice(at, at + (limit - out.length));
    at += batch.length;
    const cards = await Promise.all(batch.map(card));
    out.push(...cards.filter((x) => x.turns > 0));
  }
  return out;
}

export interface Transcript {
  id: string;
  /** `step` and `region` only on a conversation held on a walk. */
  turns: Array<{role: 'user' | 'assistant'; content: string; sent?: string; cut?: boolean; ts?: number;
                step?: number; region?: string}>;
  scenes: Array<{text: string; ts?: number}>;
  /** The lines that are neither: another game's rows, kept for it to read
      the way it wrote them. A room's transcript has none. */
  rows: Line[];
  version: number;
  persona: string;
}

/** One line of a transcript, as it is written on disk. */
export type Line = {kind?: string; role?: string; content?: string; sent?: string; cut?: boolean; text?: string;
                    persona?: string; ts?: number; step?: number; region?: string;
                    arc?: unknown; beat?: number; again?: number} | null;

/** The file as it is, line for line.
 *
 * Ordinarily nobody wants this -- a transcript is what a room reads, and
 * `readSession` is that. What wants the lines themselves is an append that was
 * refused: the question then is which of the lines in the file this page did
 * not put there, and that is asked by position. A torn last line is a `null`
 * and counts as one line on both ends, so the indexes agree with the version.
 */
export async function lines(id: string): Promise<{lines: Line[]; version: number}> {
  const res = await call(`${base()}/logs/sessions/${id}.jsonl`);
  /* Not there and empty are the same thing, here as for a value: a
     conversation exists from its first line, and one nobody has spoken in
     yet is a file with no lines and a version of nothing to follow. */
  if (res.status === 404) return {lines: [], version: 0};
  if (!res.ok) throw new Error(`${id} answered ${res.status}`);
  const got = (await res.json()) as {lines?: Line[]; version?: number};
  const all = got.lines ?? [];
  return {lines: all, version: got.version ?? all.length};
}

export async function readSession(id: string): Promise<Transcript> {
  const {lines: kept, version} = await lines(id);
  const meta = kept.find((l) => l?.kind === 'meta');
  return {
    id,
    turns: kept.filter((l) => l?.kind === 'turn').map((l) => ({
      role: l?.role === 'user' ? 'user' : 'assistant',
      content: l?.content ?? '',
      /* What the model was shown for it, where that was not the words: see
         Kept in prompt.ts. Only a string is taken, and only a non-empty one. */
      ...(typeof l?.sent === 'string' && l.sent ? {sent: l.sent} : {}),
      // A reply that broke off part-way: see brokenOff in turn.ts.
      ...(l?.cut === true ? {cut: true} : {}),
      ts: l?.ts,
      ...(typeof l?.step === 'number' ? {step: l.step} : {}),
      ...(l?.region ? {region: l.region} : {}),
    })),
    scenes: kept.filter((l) => l?.kind === 'scene')
      .map((l) => ({text: l?.text ?? '', ts: l?.ts})),
    rows: kept.filter((l) => l && l.kind !== 'turn' && l.kind !== 'scene' && l.kind !== 'meta'),
    version,
    persona: meta?.persona ?? whose(id),
  };
}

/** Name a conversation without creating it.
 *
 * Named here rather than asked for: a log exists from its first append, so
 * there is nothing on the machine to ask -- the name is the moment and the
 * pill, and the file appears when something is actually said. Which is what
 * keeps History clear of evenings nobody had. */
export const newSession = (persona: string): Promise<{id: string}> =>
  Promise.resolve({id: nameFor(persona)});

export type Row =
  /** `step` and `region` are another game's: a conversation held on a walk
      says where each line was said, and a room reads past them. */
  | {kind: 'turn'; role: 'user' | 'assistant'; content: string; sent?: string; cut?: boolean;
     step?: number; region?: string}
  | {kind: 'scene'; text: string}
  /** `game` names whose evening it was when it was not a room's; a room's
      leaves it out. */
  | {kind: 'meta'; persona: string; persona_name: string; game?: string}
  /** Another game's again: the script a character is playing him through on
      a walk, and each beat of it as it comes. What is in `arc` is that game's
      shape and not read here; `text` is only so no two such rows are one
      line to `mark`. A room reads past them. */
  | {kind: 'arc'; text: string; arc?: unknown; beat?: number; again?: number; step?: number};

/** What an append answers with: the new count, or the count it actually is. */
export interface Appended {
  version: number;
  /** True when nothing was written because the conversation had moved on. */
  stale?: boolean;
}

/** Add one line, following the version this page believes it is at.
 *
 * The moment is stamped here, where the line is made. `started` on the header
 * and `ts` on everything else, which is what is on disk and what History and
 * the transcript both read. */
export async function append(id: string, row: Row, version: number): Promise<Appended> {
  const now = Date.now() / 1000;
  const line = row.kind === 'meta' ? {...row, started: now} : {...row, ts: now};
  const res = await call(`${base()}/logs/sessions/${id}.jsonl`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({line, version}),
  });
  const said = (await res.json()) as {version?: number};
  // 409 is not an error: it is the other tab, and it comes back carrying the
  // count this page should have been following.
  if (res.status === 409) return {version: said.version ?? version, stale: true};
  if (!res.ok) throw new Error(`appending answered ${res.status}`);
  return {version: said.version ?? version};
}

/** The same append, from a page that is going away.
 *
 * `fetch` does not survive `pagehide` -- the document is gone and the request
 * with it -- and `sendBeacon` is the browser's answer to exactly that: the
 * body is handed to the network stack and sent whether or not this page still
 * exists. Nothing comes back, so nothing here can be checked: a beacon that
 * lands on the wrong version is refused by the store and that is the end of
 * it, which is the right trade for a line that would otherwise be lost.
 *
 * The Blob's type is how a beacon says what it is sending: there are no
 * headers to set. The store reads the body as JSON whatever it arrives as, so
 * this is for the sake of anything watching the wire rather than for the
 * route. Answers whether the browser took it.
 */
export function beaconAppend(id: string, row: Row, version: number): boolean {
  const line = {...row, ts: Date.now() / 1000};
  return beacon(`${base()}/logs/sessions/${id}.jsonl`, JSON.stringify({line, version}));
}

/** What a delete answers with: whether the line went, and the count to follow.
 *
 * `stale` is the same word an append uses for the same thing, because it is
 * the same thing: the file is not at the version this page was following, so
 * nothing was done to it. */
export interface Removed {
  removed: boolean;
  version: number;
  /** True when nothing was deleted because the conversation had moved on. */
  stale?: boolean;
}

/** Take a turn back out: the most recent line that says exactly that.
 *
 * Found here and deleted by position, which is the one thing the store's own
 * delete takes. It is the right way round: this end has just read the lines
 * and knows which one it means, and asking the machine to match a body would
 * be asking it to look at one.
 *
 * And the position alone is not enough. A read and a delete are two requests,
 * and a line arriving between them moves every position after it: the delete
 * then takes the neighbour of the turn somebody asked for, out of a file that
 * looks untouched. So the delete carries the version this page believes the
 * file is at -- the room's, rather than the one this read just saw, which is
 * true by construction and therefore says nothing -- and the store compares it
 * while holding the same lock the write is under. A refusal comes back as
 * `stale`, carrying the count the file actually is at.
 */
export async function removeTurn(
  id: string, role: 'user' | 'assistant', text: string, version: number,
): Promise<Removed> {
  const {lines: kept, version: read} = await lines(id);
  const want = text.trim();
  const index = kept.findLastIndex(
    (l) => l?.kind === 'turn' && l.role === role && (l.content ?? '').trim() === want);
  if (index < 0) {
    return {removed: false, version: read};
  }
  const gone = await call(`${base()}/logs/sessions/${id}.jsonl`, {
    method: 'DELETE',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({index, version}),
  });
  const said = (await gone.json().catch(() => ({}))) as
    {removed?: boolean; version?: number};
  // 409 is not an error: it is the file having moved between the read above
  // and this, and it comes back carrying the count it actually is at.
  if (gone.status === 409) {
    return {removed: false, version: said.version ?? read, stale: true};
  }
  if (!gone.ok) throw new Error(`removing a turn answered ${gone.status}`);
  return {removed: said.removed ?? true, version: said.version ?? version};
}

// ---- the sheet inside the lid ----------------------------------------------

/** A row per pill, and what each has cost you.
 *
 * Composed here, out of the conversations listing and two reads per pill.
 * It was one route on the machine, which is exactly the sort of thing a
 * machine with no vocabulary cannot answer: `doses` is a count of logs whose
 * first line names a pill, `remembered` is lines in a file, and `standing` is
 * a bag of numbers this end does the arithmetic on. Nothing in it is a score;
 * it is a record, the way a notebook is.
 */
export async function ledger(): Promise<{doses: number; pills: LedgerPill[]}> {
  const kept = await conversations();
  const pills = await Promise.all(personas().map(async (p) => {
    const [remembered, standing] = await Promise.all([
      memory(p.slug), relation(p.slug),
    ]);
    const mine = kept.filter((x) => (x.head?.persona || whose(x.id)) === p.slug);
    return {
      slug: p.slug,
      name: p.pill || p.name || p.slug,
      color: p.color ?? '',
      doses: mine.length,
      remembered: remembered.split('\n').filter((l) => l.trim()).length,
      standing,
      last: mine.length && mine[0] ? when(mine[0].at) : '',
    };
  }));
  /* The total is the sum of the lines above it, and not the number of logs on
     disk: the rows are the pills the box offers, and a conversation with a
     character that has since been drafted or renamed is counted in neither.
     Two numbers that did not add up, with nothing on the page to say why. */
  return {doses: pills.reduce((n, p) => n + p.doses, 0), pills};
}
