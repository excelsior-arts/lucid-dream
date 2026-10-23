/* The machine's store, kept in this browser.
 *
 * machine/store.py is storage with no vocabulary: values by path, and
 * append-only logs by path, each with a version that is its count of lines.
 * A page with no machine behind it still has a game that keeps an evening, so
 * this answers the same routes -- `/store/<game>/{data,logs}/<path>`, the same
 * methods, the same bodies, the same 404, 409 and 400 -- out of IndexedDB. A
 * game's files.ts cannot tell, which is the whole requirement: the formats on
 * disk and here are the same text, a log's lines are JSON lines, and an
 * evening kept here could be written out as the file the machine would have
 * kept.
 *
 * The keys are userdata/'s own paths: `players/<who>/<game>/<path>` for what
 * a game keeps, and `config.json` at the root for the machine's settings --
 * see userdata.ts, which also writes the whole of it out as a zip of that
 * directory and reads one back.
 *
 * Under the routes is a `Drawer`: text by key, with the one move a version
 * check needs -- read and write as one -- and nothing else. IndexedDB is one;
 * a wrapper that would rather keep real files beside its app is another, and
 * hands its own to `storeAnswer`. The tests use the one in memory.
 *
 * Nothing here is sent anywhere. It lives and dies with this browser's site
 * data for this address, which is why the first-open card asks for storage
 * that is not evicted under pressure.
 */

/** One file: what was written, how it was declared, and when (seconds). */
export interface Entry {
  text: string;
  type: string;
  at: number;
}

export interface Drawer {
  get(key: string): Promise<Entry | undefined>;
  put(key: string, entry: Entry): Promise<void>;
  /** Whether there was anything to take. */
  delete(key: string): Promise<boolean>;
  /** Every key under a prefix, with what is there. */
  list(prefix: string): Promise<Array<[string, Entry]>>;
  /** Read and write as one move, so a version checked is a version written
      against: `change` sees what is there and says what goes there instead
      (undefined leaves it). It must not wait on anything. */
  update<T>(key: string, change: (was: Entry | undefined) => {put?: Entry; answer: T}): Promise<T>;
}

// ---- the rules store.py keeps ----------------------------------------------

/* What a segment may be, how deep a path, how long a name, how much a request
   may carry -- store.py's numbers, so a game that works here works there. */
const SEGMENT = /^[A-Za-z0-9_~:][A-Za-z0-9._~:-]*$/;
const DEEP = 8;
const LONG = 120;
const MOST = 4 * 1024 * 1024;
const MOST_LINE = 1024 * 1024;

const KINDS: Record<string, string> = {
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.jsonl': 'application/x-ndjson',
};

const wellNamed = (name: string): boolean => SEGMENT.test(name) && name.length <= LONG;

/** A path's segments, or null where store.py would have refused it. */
function segments(path: string): string[] | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length > DEEP || !parts.every(wellNamed)) return null;
  return parts;
}

const now = (): number => Date.now() / 1000;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

const refused = (error: string, status = 400): Response => json({error}, status);

/** A log's lines as store.py counts them: separated by newlines and nothing
    else, a run of whitespace is not a line, and a line that will not parse is
    a null holding its place. */
function readLog(text: string): {lines: unknown[]; version: number} {
  const lines: unknown[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      lines.push(null);
    }
  }
  return {lines, version: lines.length};
}

const counted = (text: string): number =>
  text.split('\n').reduce((n, raw) => n + (raw.trim() ? 1 : 0), 0);

function headOf(text: string): unknown {
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function bodyText(init?: RequestInit): Promise<string> {
  const b = init?.body;
  if (b == null) return '';
  if (typeof b === 'string') return b;
  if (b instanceof Blob) return b.text();
  return new Response(b).text();
}

/** A request's body as a bag of keys, or the 400 store.py answers. */
async function bag(init?: RequestInit): Promise<Record<string, unknown> | Response> {
  const text = await bodyText(init);
  if (text.length > MOST_LINE) return refused('too much in one request', 413);
  try {
    const got = JSON.parse(text) as unknown;
    if (got && typeof got === 'object' && !Array.isArray(got)) return got as Record<string, unknown>;
  } catch { /* answered below */ }
  return refused('a body is a bag of keys');
}

// ---- the routes ------------------------------------------------------------

/** Where a game's path is kept: `players/<who>/<game>/<path>`, the layout of
    userdata/ on a Mac. `data` and `logs` are which shape a path is read as
    and not directories, there as here. The player is the run's (userdata.ts)
    and never in an address. */
export const keyOf = (who: string, game: string, parts: readonly string[]): string =>
  ['players', who, game, ...parts].join('/');

/** Answer `/store/...` the way machine/store.py does, out of a drawer, for
    the player `who` says. */
export function storeAnswer(drawer: Drawer, who: () => string = () => 'player1') {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const m = /^\/store\/([^/]+)\/(data|logs)\/?(.*)$/.exec(path.split('?')[0] ?? '');
    if (!m) return refused(`${path} is not a path`, 404);
    const [, game = '', kind, rest = ''] = m;
    const parts = segments(rest);
    if (!wellNamed(game) || parts === null) return refused(`${rest} is not a path`);
    const key = keyOf(who(), game, parts);
    const dir = !rest || rest.endsWith('/');

    if (kind === 'data') {
      if (method === 'GET') {
        if (dir) {
          const items = (await children(drawer, key))
            .map(([name, e]) => ({name, size: new Blob([e.text]).size, at: e.at}))
            .sort((a, b) => a.name.localeCompare(b.name));
          return json({items});
        }
        const got = await drawer.get(key);
        const ext = /\.[^./]+$/.exec(rest)?.[0] ?? '';
        return new Response(got?.text ?? '', {
          status: 200, headers: {'Content-Type': KINDS[ext] ?? 'application/octet-stream'},
        });
      }
      if (dir) return refused(`${rest} is not a path`);
      if (method === 'PUT') {
        const text = await bodyText(init);
        if (text.length > MOST) return refused('too much in one request', 413);
        const type = new Headers(init?.headers).get('Content-Type') ?? '';
        await drawer.put(key, {text, type, at: now()});
        return json({bytes: new Blob([text]).size});
      }
      if (method === 'DELETE') return json({removed: await drawer.delete(key)});
      return refused('no such method', 405);
    }

    // ---- logs ----
    if (method === 'GET') {
      if (dir) {
        const items = (await children(drawer, key))
          .sort((a, b) => b[1].at - a[1].at)
          .map(([id, e]) => ({id, lines: counted(e.text), at: e.at, head: headOf(e.text)}));
        return json({items});
      }
      const got = await drawer.get(key);
      return json(readLog(got?.text ?? ''));
    }
    if (dir) return refused(`${rest} is not a path`);
    const body = await bag(init);
    if (body instanceof Response) return body;
    if (method === 'POST') {
      const line = body.line;
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        return refused('a line is a bag of keys');
      }
      let want: number | null = null;
      if (body.version != null) {
        want = Number(body.version);
        if (!Number.isInteger(want)) return refused('a version is a number of lines');
      }
      const written = JSON.stringify(line) + '\n';
      return drawer.update(key, (was) => {
        const text = was?.text ?? '';
        const current = counted(text);
        if (want === null || want !== current) return {answer: json({version: current}, 409)};
        // A torn last line stays torn and costs that line; this one starts on
        // a line of its own, as store.py's does.
        const glue = text && !text.endsWith('\n') ? '\n' : '';
        return {put: {text: text + glue + written, type: 'application/x-ndjson', at: now()},
                answer: json({version: current + 1}, 201)};
      });
    }
    if (method === 'DELETE') {
      const index = Number(body.index);
      const want = Number(body.version);
      if (!Number.isInteger(index)) return refused('an index is a number');
      if (body.version == null || !Number.isInteger(want)) {
        return refused('a version is a number of lines');
      }
      return drawer.update(key, (was) => {
        const lines = (was?.text ?? '').split('\n').filter((x) => x.trim());
        if (want !== lines.length) return {answer: json({version: lines.length}, 409)};
        if (index < 0 || index >= lines.length) {
          return {answer: json({removed: false, version: lines.length})};
        }
        lines.splice(index, 1);
        return {put: {text: lines.length ? lines.join('\n') + '\n' : '', type: was?.type ?? '',
                      at: now()},
                answer: json({removed: true, version: lines.length})};
      });
    }
    return refused('no such method', 405);
  };
}

/** What is directly in a directory, by name. A log's listing in store.py is
    the files in it; anything a level further down is somebody else's. */
async function children(drawer: Drawer, key: string): Promise<Array<[string, Entry]>> {
  const prefix = key ? key + '/' : '';
  return (await drawer.list(prefix))
    .map(([k, e]) => [k.slice(prefix.length), e] as [string, Entry])
    .filter(([name, e]) => name && !name.includes('/') && !name.startsWith('.') && e.text !== undefined);
}

// ---- the two drawers -------------------------------------------------------

/** In memory, for a test, and for a browser that will not keep anything. */
export function memoryDrawer(): Drawer {
  const all = new Map<string, Entry>();
  return {
    get: (k) => Promise.resolve(all.get(k)),
    put: (k, e) => { all.set(k, e); return Promise.resolve(); },
    delete: (k) => Promise.resolve(all.delete(k)),
    list: (p) => Promise.resolve([...all].filter(([k]) => k.startsWith(p))),
    update: (k, change) => {
      const {put, answer} = change(all.get(k));
      if (put) all.set(k, put);
      return Promise.resolve(answer);
    },
  };
}

/** IndexedDB: one database, one object store, a file per key. Opened once and
    kept, so a write asked for in a page's last moment opens its transaction in
    that same moment rather than after a round trip to open the database. */
export function idbDrawer(name = 'lucid', table = 'files'): Drawer {
  let db: IDBDatabase | null = null;
  const opening = new Promise<IDBDatabase>((done, fail) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(table);
    req.onsuccess = () => { db = req.result; done(req.result); };
    req.onerror = () => fail(req.error ?? new Error('IndexedDB would not open'));
  });
  const ready = (): Promise<IDBDatabase> => (db ? Promise.resolve(db) : opening);
  const done = <T>(req: IDBRequest<T>): Promise<T> => new Promise((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error ?? new Error('IndexedDB refused'));
  });
  const store = (d: IDBDatabase, mode: IDBTransactionMode) =>
    d.transaction(table, mode).objectStore(table);
  return {
    get: async (k) => (await done(store(await ready(), 'readonly').get(k))) as Entry | undefined,
    put: async (k, e) => { await done(store(await ready(), 'readwrite').put(e, k)); },
    delete: async (k) => {
      const s = store(await ready(), 'readwrite');
      const had = (await done(s.count(k))) > 0;
      if (had) await done(s.delete(k));
      return had;
    },
    list: async (p) => {
      const s = store(await ready(), 'readonly');
      const range = IDBKeyRange.bound(p, p + '￿');
      const [keys, values] = await Promise.all([done(s.getAllKeys(range)), done(s.getAll(range))]);
      return keys.map((k, i) => [String(k), values[i] as Entry]);
    },
    update: async (k, change) => {
      const s = store(await ready(), 'readwrite');
      const was = (await done(s.get(k))) as Entry | undefined;
      const {put, answer} = change(was);
      if (put) await done(s.put(put, k));
      return answer;
    },
  };
}
