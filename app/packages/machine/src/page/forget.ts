/* A model taken back off this browser's disk.
 *
 * What the models panel brings down sits in the origin's Cache Storage, each
 * library in caches of its own: WebLLM's words in webllm/model, webllm/config
 * and webllm/wasm; transformers.js's in transformers-cache (Chatterbox, the
 * ears, and ONNX Runtime's WebAssembly, which it caches beside them); Sopro's
 * in sopro-onnx-manifest-v1 and sopro-onnx-assets-<revision>, with the voices
 * it has read kept in an IndexedDB of its own. Every entry is keyed by the
 * address it came from, pinned to a commit, so which model an entry belongs to
 * is a question about its address, and each model answers it (`Holding`).
 *
 * A delete takes exactly that model's entries and nothing else. An entry two
 * models read -- ONNX Runtime's WebAssembly, which Chatterbox and Moonshine
 * both run on -- goes only with the last model still here that reads it: a
 * model is here while it holds an entry that is its alone. Entries are
 * deleted one by one, never a cache whole: a library keeps a cache open, and
 * one deleted under it would take what it writes next somewhere no load looks.
 *
 * The size is what the cache holds, not what the panel's list says a model
 * weighs: each entry's Content-Length, or its body's size where a library
 * stored it without one.
 *
 * Asked by the panel through the stand-in's route (machine.ts), which refuses
 * the model in use: see forget-model.ts. Nothing here reaches for the shell,
 * so the voice's worker can read `ortRuntime` (voice-models.ts) without it.
 */
/** One model's claim on the browser's storage: which cache entries are its,
    by cache and address, and any database that is its alone. */
export interface Holding {
  /** `llm:0.8b`, `voice:turbo`, `ear:moonshine`. */
  key: string;
  claims(cache: string, url: string): boolean;
  dbs?: readonly string[];
}

export interface Entry {
  cache: string;
  url: string;
  bytes: number;
}

/** The caches a model of this page is kept in, by name. */
export const ours = (name: string): boolean =>
  name.startsWith('webllm/') || name === 'transformers-cache' || name.startsWith('sopro-onnx');

/** ONNX Runtime's WebAssembly, as transformers.js caches it: the build it was
    made against, from jsDelivr. Read by every model transformers.js runs. */
export const ortRuntime = (cache: string, url: string): boolean =>
  cache === 'transformers-cache' && /\/onnxruntime-web@[^/]+\/dist\//.test(url);

/** What a cache holds that is any model's, with what each entry weighs. */
export async function entries(store: CacheStorage = caches): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const name of await store.keys()) {
    if (!ours(name)) continue;
    const cache = await store.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const said = Number(res.headers.get('content-length') ?? '');
      const bytes = Number.isFinite(said) && said > 0 ? said : (await res.blob()).size;
      out.push({cache: name, url: req.url, bytes});
    }
  }
  return out;
}

/** Which entries go with `key`: its own, and a shared one only where no other
    model that is still here reads it. And whether it is here at all. */
export function share(all: readonly Holding[], have: readonly Entry[], key: string):
  {mine: Entry[]; here: boolean} {
  const it = all.find((h) => h.key === key);
  if (!it) return {mine: [], here: false};
  const owners = (e: Entry) => all.filter((h) => h.claims(e.cache, e.url));
  /** Here: holding an entry nobody else claims. */
  const held = (h: Holding) => have.some((e) => {
    const o = owners(e);
    return o.length === 1 && o[0] === h;
  });
  const others = all.filter((h) => h !== it && held(h));
  const mine = have.filter((e) => it.claims(e.cache, e.url)
    && !others.some((h) => h.claims(e.cache, e.url)));
  return {mine, here: held(it)};
}

export interface Forgot {
  /** What was (or, asked dry, would be) freed. */
  bytes: number;
  files: number;
}

/** Take a model's entries out of the caches, or (dry) say what that frees. */
export async function forget(all: readonly Holding[], key: string, o: {dry?: boolean} = {},
                             store: CacheStorage = caches,
                             idb: IDBFactory | undefined = globalThis.indexedDB): Promise<Forgot> {
  const {mine} = share(all, await entries(store), key);
  const bytes = mine.reduce((n, e) => n + e.bytes, 0);
  if (o.dry) return {bytes, files: mine.length};
  for (const e of mine) await (await store.open(e.cache)).delete(e.url);
  for (const db of all.find((h) => h.key === key)?.dbs ?? []) await dropDb(idb, db);
  return {bytes, files: mine.length};
}

/** A database deleted, or left be after a few seconds if something holds it
    open: what it holds is small, and nothing waits on it. */
function dropDb(idb: IDBFactory | undefined, name: string): Promise<void> {
  if (!idb) return Promise.resolve();
  return new Promise<void>((done) => {
    const t = setTimeout(done, 3000);
    const end = () => { clearTimeout(t); done(); };
    try {
      const req = idb.deleteDatabase(name);
      req.onsuccess = end;
      req.onerror = end;
    } catch {
      end();
    }
  });
}
