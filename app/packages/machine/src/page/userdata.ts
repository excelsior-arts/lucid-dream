/* userdata/, kept in this browser.
 *
 * On a Mac everything of anybody's is under one directory (machine/paths.py):
 *
 *   userdata/config.json              the machine's settings, over its defaults
 *   userdata/players/<who>/<game>/... each player's files, a game at a time
 *
 * and the player is the run's -- `./run.sh --user pete`, player1 if not said
 * -- and never in an address. A page with no machine behind it keeps the same
 * tree in IndexedDB, key for path (store.ts), so that the one can be written
 * out as the other and read back:
 *
 *   - the player is `?user=<name>` in the address the page was opened at,
 *     kept for this browser until another is asked for (one pointer in
 *     localStorage, which is where a per-browser choice belongs); player1 if
 *     nobody ever said. The same names paths.py takes.
 *   - config.json at the root is the browser's own settings -- the model it
 *     runs, `llm.size`, its voice, `tts.enabled` and `tts.engine`, and its
 *     ear, `stt.enabled` and `stt.engine` --
 *     merged over its defaults as config.py merges, and written as config.py
 *     writes: only what somebody set.
 *   - exported, it is a .zip laid out as userdata/ is on disk; imported, such
 *     a zip (or one player's folder zipped on its own) is read back, refusing
 *     what store.py would refuse and keeping what is already here when the two
 *     differ, unless told to replace it.
 *   - what the first preview kept -- keys that began at the game -- is folded
 *     under players/player1 once, the way paths.py folds a userdata/ from
 *     before there were players: a file that would land on another is kept
 *     beside it, as <name>.strayed.
 */
import type {Drawer, Entry} from './store';
import {unzip, zip} from './zip';
import type {ZipFile} from './zip';

// ---- the player ------------------------------------------------------------

export const FIRST = 'player1';
/** paths.py's SHAPE: a directory name, so no separators, nothing hidden. */
const SHAPE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

/** The name as a directory can hold it, or null for one it cannot. */
export function named(raw: string | null | undefined): string | null {
  const who = (raw || FIRST).trim().toLowerCase();
  return SHAPE.test(who) ? who : null;
}

const POINTER = 'lucid.page.user';

/** Who is playing in this browser: `?user=` if the address says (and kept
    from now on), else whoever was kept, else player1. A name that is not one
    is said and ignored. The parameter is taken out of the address once read,
    so a link copied from here does not carry somebody's name. */
export function whoIsHere(say: (line: string, level?: 'info' | 'warn') => void = () => {}): string {
  let kept: string | null = null;
  try { kept = named(localStorage.getItem(POINTER)); } catch { /* nothing kept */ }
  const url = new URL(location.href);
  const asked = url.searchParams.get('user');
  if (asked !== null) {
    url.searchParams.delete('user');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    const who = named(asked);
    if (!who) {
      say(`'${asked}' is not a name: letters, digits, - . _ , 32 at most, starting with a `
        + 'letter or a digit', 'warn');
    } else {
      try { localStorage.setItem(POINTER, who); } catch { /* this visit only */ }
      return who;
    }
  }
  return kept ?? FIRST;
}

// ---- the browser's own config.json -------------------------------------------

/** What this page is set to when nobody has said: the in-browser stand-in's
    side of config.py's DEFAULTS. Only what applies here; a key the machine
    has and this does not is read and kept, never used. */
export const DEFAULTS = {
  llm: {size: ''},
  /* The voice: off until somebody switches it on (a download of hundreds of
     megabytes), and which engine then -- turbo, nano or sopro, see ENGINES in
     voice.ts. The machine's tts section has a model path and no switch: a
     Mac's voice is on its shelf and always offered. */
  tts: {enabled: false, engine: 'turbo'},
  /* The ear, the same way: off until the microphone's section of the models
     panel brings one down, and which -- see EARS in ear.ts. */
  stt: {enabled: false, engine: 'moonshine'},
};

export type Config = typeof DEFAULTS & Record<string, unknown>;

const isBag = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** config.py's `deeply`: a section at a time, never a file at a time. */
export function deeply(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const [k, v] of Object.entries(over)) {
    out[k] = isBag(v) && isBag(out[k]) ? deeply(out[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

export const CONFIG = 'config.json';

/* One queue per drawer for writes to config.json: a note reads the file and
   writes it back, and two made in the same moment (the model and the voice
   chosen together) would otherwise each write over the other's. */
const queues = new WeakMap<Drawer, Promise<unknown>>();

export function settings(drawer: Drawer) {
  /** The file as somebody wrote it: nothing merged. */
  const written = async (): Promise<Record<string, unknown>> => {
    const got = await drawer.get(CONFIG);
    try {
      const parsed = JSON.parse(got?.text ?? '{}') as unknown;
      return isBag(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  /** Read the file and write it back changed, after any write already on
      its way. */
  const rewrite = (change: (w: Record<string, unknown>) => Record<string, unknown>): Promise<void> => {
    const next = (queues.get(drawer) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await drawer.put(CONFIG, {text: JSON.stringify(change(await written()), null, 2) + '\n',
                                type: 'application/json', at: Date.now() / 1000});
    });
    queues.set(drawer, next);
    return next;
  };
  return {
    written,
    /** The defaults, with the file over them. */
    load: async (): Promise<Config> =>
      deeply(JSON.parse(JSON.stringify(DEFAULTS)) as Record<string, unknown>, await written()) as Config,
    /** config.py's `note`: a section or two written over what is on disk,
        and nothing else -- the defaults are never frozen into the file. */
    note: (changes: Record<string, unknown>): Promise<void> =>
      rewrite((w) => ({...w, ...changes})),
    /** The same for keys inside one section: the rest of that section as it
        is on disk, and of the file. */
    noteIn: (section: string, changes: Record<string, unknown>): Promise<void> =>
      rewrite((w) => ({...w, [section]: {...(isBag(w[section]) ? w[section] : {}), ...changes}})),
  };
}

// ---- what the first preview kept -------------------------------------------

/** The key a file that would land on `key` is kept at instead, as paths.py's
    fold keeps it: beside, `.strayed`, `.strayed2`... */
async function beside(drawer: Drawer, key: string): Promise<string> {
  for (let n = 1; ; n++) {
    const at = `${key}.strayed${n > 1 ? n : ''}`;
    if (!(await drawer.get(at))) return at;
  }
}

/** Fold keys from before there were players under players/player1, and the
    model and voice choices from localStorage into config.json. Once: what has moved is
    not there to move again. Answers how many files moved. */
export async function settle(drawer: Drawer): Promise<number> {
  let moved = 0;
  for (const [key, entry] of await drawer.list('')) {
    if (key === CONFIG || key.startsWith('players/')) continue;
    // `<game>/<data|logs>/<path>` was the first preview's key: the two shapes
    // were part of it. A key of any other shape is somebody else's and stays.
    const m = /^([^/]+)\/(?:data|logs)\/(.+)$/.exec(key);
    if (!m) continue;
    let to = `players/${FIRST}/${m[1]}/${m[2]}`;
    const there = await drawer.get(to);
    if (there && there.text !== entry.text) to = await beside(drawer, to);
    if (!there || there.text !== entry.text) await drawer.put(to, entry);
    await drawer.delete(key);
    moved += 1;
  }
  try {
    const was = localStorage.getItem('lucid.page.llm');
    if (was) {
      const cfg = settings(drawer);
      const llm = (await cfg.written()).llm;
      if (!isBag(llm) || !llm.size) await cfg.note({llm: {...(isBag(llm) ? llm : {}), size: was}});
      localStorage.removeItem('lucid.page.llm');
    }
    /* The voice was one key, the engine, and none for off. */
    const voice = localStorage.getItem('lucid.page.voice');
    if (voice) {
      const cfg = settings(drawer);
      const tts = (await cfg.written()).tts;
      if (!isBag(tts) || !('engine' in tts || 'enabled' in tts)) {
        await cfg.noteIn('tts', {enabled: true, engine: voice});
      }
      localStorage.removeItem('lucid.page.voice');
    }
  } catch { /* no localStorage: nothing was kept there either */ }
  return moved;
}

// ---- out, as a zip of userdata/ --------------------------------------------

/** Everything, as the files userdata/ would hold. */
export async function exported(drawer: Drawer): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder();
  const files: ZipFile[] = (await drawer.list(''))
    .filter(([key]) => key === CONFIG || key.startsWith('players/'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, e]) => ({name: key, data: enc.encode(e.text), at: e.at}));
  return zip(files);
}

// ---- and back in -------------------------------------------------------------

/* store.py's rules for a path, which an import is held to as a page is:
   letters, digits and `_ - . ~ :`, never a leading dot, eight deep, names of
   120 at most, 4 MB a file. */
const SEGMENT = /^[A-Za-z0-9_~:][A-Za-z0-9._~:-]*$/;
const MOST = 4 * 1024 * 1024;

/** What a player keeps that is the machine's own and not a game's: its
    console log and its scratch. Left out of an import: nothing here reads
    them, and a log from another machine is not this browser's. */
const NOT_A_GAME = new Set(['log', 'tmp']);

export interface Imported {
  added: string[];
  /** Here already, the same bytes. */
  same: string[];
  /** Here already and different: kept as it was, unless `replace`. */
  kept: string[];
  replaced: string[];
  /** Not taken, and why. */
  refused: Array<{name: string; why: string}>;
}

/** Where an archive's file goes, or why it goes nowhere. An archive is
    userdata/ itself (config.json, players/...), optionally inside a
    `userdata/` folder, or one player's folder zipped on its own
    (<who>/<game>/...). */
function placed(name: string, single: string | null): {key: string} | {why: string} {
  let path = name.replace(/^userdata\//, '');
  if (single) path = `players/${path}`;
  if (path === CONFIG) return {key: CONFIG};
  const parts = path.split('/');
  if (parts[0] !== 'players') return {why: 'not a player\'s and not the config'};
  const [, who, game, ...rest] = parts;
  if (!named(who) || named(who) !== who) return {why: `'${who}' is not a player's name`};
  if (!game || !rest.length) return {why: 'not a file of a game'};
  if (NOT_A_GAME.has(game)) return {why: `${game}/ is the machine's own, not a game's`};
  if (rest.length + 1 > 8 || ![game, ...rest].every((s) => SEGMENT.test(s) && s.length <= 120)) {
    return {why: 'a path the store would refuse'};
  }
  return {key: path};
}

export async function imported(drawer: Drawer, bytes: Uint8Array, o: {replace?: boolean} = {}): Promise<Imported> {
  const files = (await unzip(bytes))
    .filter((f) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(f.name));
  /* One player's folder on its own: everything under one top directory that
     is neither players/ nor userdata/, with a game under it. */
  const tops = new Set(files.map((f) => f.name.replace(/^userdata\//, '').split('/')[0]));
  const only = tops.size === 1 ? [...tops][0]! : null;
  const single = only && only !== 'players' && only !== CONFIG && named(only) === only ? only : null;
  const out: Imported = {added: [], same: [], kept: [], replaced: [], refused: []};
  const dec = new TextDecoder('utf-8', {fatal: true});
  for (const f of files) {
    const where = placed(f.name, single);
    if ('why' in where) { out.refused.push({name: f.name, why: where.why}); continue; }
    if (f.data.length > MOST) { out.refused.push({name: f.name, why: 'over 4 MB'}); continue; }
    let text: string;
    try {
      text = dec.decode(f.data);
    } catch {
      out.refused.push({name: f.name, why: 'not text'});
      continue;
    }
    const key = where.key;
    const entry: Entry = {text, type: key.endsWith('.json') ? 'application/json' : '',
                          at: f.at ?? Date.now() / 1000};
    const there = await drawer.get(key);
    if (!there) {
      await drawer.put(key, entry);
      out.added.push(key);
    } else if (there.text === text) {
      out.same.push(key);
    } else if (o.replace) {
      await drawer.put(key, entry);
      out.replaced.push(key);
    } else {
      out.kept.push(key);
    }
  }
  return out;
}
