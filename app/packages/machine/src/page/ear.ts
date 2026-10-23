/* The ear, run in this page.
 *
 * On a Mac the microphone's turns go up to the machine, whose Parakeet makes
 * them into words (/machine/stt). A page with nothing behind it has its own:
 * a speech model in a worker (ear-worker.ts), handed a whole turn and giving
 * back the line, put in front of `transcribe` (@lucid/audio's stt.ts) by
 * `settle` the way the voice is put in front of the voice's socket. Everything
 * on this side of it -- the microphone, the echo cancelling, the detector that
 * says where a turn ends, the junk filter, the Talk key's states -- is the
 * page's already, and does not know the difference.
 *
 * It is a download, so it is chosen, never given: the models panel's
 * microphone section brings it into the browser's cache (`get`), and the
 * choice is kept in this browser's userdata/ config.json beside the voice's,
 * `stt.enabled` and `stt.engine` (see userdata.ts). Nothing is loaded until
 * the microphone is turned on -- the room's POST /machine/models/stt, as on a
 * Mac -- and one the microphone has stopped wanting is let go of after the
 * machine's 90 s grace, its worker ended with it. The weights stay in the
 * cache: the next press is a load, never a download.
 *
 * On the CPU (WebAssembly): see ear-models.ts. Which is also why this is
 * offered wherever WebAssembly runs, Firefox among them.
 */
import {hatch} from '@lucid/shell';
import type {ModelStatus, Part, PartsFetching} from '../status';
import type {EarId, EarSpec} from './ear-models';
import {cached, EAR_SPECS} from './ear-models';
import type {FromEar, ToEar} from './ear-worker';
import {keepDownloads} from './keep';

export interface EarCard extends EarSpec {
  /** The one the panel recommends. What each is, in a line, is the panel's
      (PARTS in ModelCard.tsx). */
  suggested: boolean;
}

/* What each weighs and how it measured, in headless Chromium 156 on 10-09,
   on the CPU with one thread (a page on a static host is not cross-origin
   isolated, so WebAssembly gets one): words heard wrong over 48 turns -- the
   six lines of both pills in three voices, and the machine's voice again with
   a room and pink noise 10 dB under it -- and the time a turn takes over its
   length. Firefox 157 measured the same words and 0.10 / 0.33.

                    MB    clean  noisy  time
     Moonshine Base  67    2.5%   27%   0.07
     Parakeet       661    1.8%    3%   0.32   (the Mac's ear, v2)
     Whisper Base    81    2.3%   19%   0.53
     Whisper Small  253    2.7%    2%   1.98   (too slow on one thread)

   Moonshine by default: a reply's wait is the turn's words, and a short
   turn is a third of a second where Parakeet takes one and a half; a room
   that is quiet, or a browser that suppresses its noise, hears as well with
   it. Parakeet for a noisy room, and for the Mac's own ear. */
export const EARS: readonly EarCard[] = EAR_SPECS.map((s) => ({...s, suggested: s.id === 'moonshine'}));

/** What this browser's config.json says of its ear, and how to say it
    again: held here, written there (host.ts makes it). */
export interface EarChoice {
  enabled: boolean;
  /** An ear's id; one not offered here is as if none were named. */
  engine: string;
  choose(enabled: boolean, engine?: EarId): void;
}

/** How long an ear nobody is speaking into is kept: the machine's GRACE_S. */
export const GRACE_MS = 90_000;

/** Whether this browser can run an ear at all: WebAssembly in a worker. */
export function canHear(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function'
    && typeof caches === 'object';
}

export interface PageEar {
  status(): ModelStatus;
  /** The microphone is on (load the chosen ear from the cache) or off (arm
      the grace). The machine's models.want('stt', ...). */
  want(on: boolean): void;
  grace(): number | null;
  /** A browser test shortens it through the debug door; the product never. */
  graceMs: number;
  chosen(): EarId | '';
  card(): EarCard | null;
  /** The panel's rows: every ear, what it weighs, whether it is in the
      cache, which is in use. */
  parts(): Part[];
  /** The panel's choice: chosen and brought into the cache (loaded too, if
      the microphone is on). '' is none: typing only. */
  get(id: EarId | ''): void;
  fetching(): PartsFetching | null;
  /** Once the cache has been asked what it holds: `parts` is true then. */
  known(): Promise<void>;
  /** A whole turn into its words. Loads the chosen ear if it is not up. */
  transcribe(samples: Float32Array): Promise<string>;
  /** Whether an ear is the one in use -- switched on, loaded, or coming
      down -- which the models panel does not delete. */
  inUse(id: EarId): boolean;
  /** Its files were taken out of the cache (forget.ts): downloadable again. */
  forgot(id: EarId): void;
  onChange(fn: () => void): () => void;
}

export function createEar(kept: EarChoice): PageEar {
  let state: ModelStatus = 'off';
  let loaded: EarId | '' = '';
  let worker: Worker | null = null;
  let up: Promise<boolean> | null = null;
  let wanted = false;
  let letGo: ReturnType<typeof setTimeout> | null = null;
  let letGoAt = 0;
  const watchers = new Set<() => void>();
  const here = new Set<EarId>();
  let checked: Promise<void> | null = null;
  let getting: {id: EarId; state: PartsFetching} | null = null;
  let getter: Worker | null = null;
  let turns = 0;
  const asked = new Map<number, {done: (text: string) => void; fail: (e: Error) => void}>();

  const card = (id: string) => EARS.find((e) => e.id === id) ?? null;
  const chosen = (): EarId | '' => (kept.enabled ? card(kept.engine)?.id ?? '' : '');
  const make = () => new Worker(new URL('./ear-worker.ts', import.meta.url), {type: 'module'});

  function changed() {
    for (const fn of watchers) fn();
  }

  /** Ask, once, which ears the cache already holds. */
  function check(): Promise<void> {
    checked ??= Promise.all(EARS.map((e) => cached(e).catch(() => false))).then((got) => {
      EARS.forEach((e, i) => { if (got[i]) here.add(e.id); });
      changed();
    });
    return checked;
  }

  function progressed(share: number, ended?: 'done' | 'error', error?: string) {
    if (!getting) return;
    const gb = getting.state.gb ?? 0;
    getting.state = {...getting.state, got_gb: +(share * gb).toFixed(3),
      ...(ended ? {state: ended} : {}), ...(error ? {error} : {})};
  }

  function onWorker(ev: MessageEvent<FromEar>) {
    const m = ev.data;
    if (m.type === 'progress') {
      if (getting?.id === loaded) progressed(m.got);
      changed();
    } else if (m.type === 'ready') {
      state = 'ready';
      if (loaded) here.add(loaded);
      if (getting?.id === loaded) progressed(1, 'done');
      hatch.say(`ear: ${card(loaded)?.name} up in ${m.load_s} s, in this browser`, 'info');
      changed();
    } else if (m.type === 'failed') {
      state = 'error';
      if (getting?.id === loaded) progressed(0, 'error', m.error);
      hatch.say(`ear: ${card(loaded)?.name} would not load — ${m.error}`, 'error');
      changed();
    } else if (m.type === 'heard' || m.type === 'error') {
      const turn = asked.get(m.n);
      asked.delete(m.n);
      if (m.type === 'heard') {
        hatch.say(`ear: a turn in ${m.gen_s} s`, 'debug');
        turn?.done(m.text);
      } else {
        turn?.fail(new Error(m.error));
      }
    }
  }

  /** The chosen ear, from the cache (or the network, the first time). */
  function load(id: EarId): Promise<boolean> {
    if (worker && loaded === id && state !== 'error' && up) return up;
    unload();
    worker = make();
    worker.onmessage = onWorker;
    /* A worker that dies -- out of memory, a WebAssembly trap -- answers
       nothing ever again, and a turn waiting on it waited for good: heard,
       handed over, and never a word in the console. Said, every turn in it
       failed (each says so), and the next turn loads it afresh. */
    const mine = worker;
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      if (worker !== mine) return;
      const why = ev.message || 'its worker stopped';
      hatch.say(`ear: ${card(id)?.name} stopped — ${why}`, 'error');
      for (const [, turn] of asked) turn.fail(new Error(`the ear stopped: ${why}`));
      asked.clear();
      state = 'error';
      changed();
    };
    loaded = id;
    state = 'loading';
    up = new Promise<boolean>((done) => {
      /* Up, failed, or let go of before it was either: a turn waiting on
         it is answered whichever. */
      const off = api.onChange(() => {
        if (loaded === id && state === 'loading') return;
        off();
        done(loaded === id && state === 'ready');
      });
    });
    changed();
    worker.postMessage({type: 'load', id} satisfies ToEar);
    void keepDownloads();
    return up;
  }

  function unload() {
    disarm();
    worker?.terminate();
    worker = null;
    for (const [, turn] of asked) turn.fail(new Error('the ear was let go of'));
    asked.clear();
    const was = loaded;
    loaded = '';
    up = null;
    if (state !== 'off') {
      state = 'off';
      changed();
    }
    return was;
  }

  function arm() {
    if (letGo || !worker) return;
    letGoAt = Date.now() + api.graceMs;
    letGo = setTimeout(() => {
      letGo = null;
      if (wanted || !worker) return;
      const name = card(loaded)?.name;
      unload();
      hatch.say(`ear: ${name} let go of — the microphone is off; it comes back from this browser's cache`,
        'info');
    }, api.graceMs);
  }

  function disarm() {
    if (letGo) clearTimeout(letGo);
    letGo = null;
  }

  /** Brought into the cache and no further: the panel's bar is this. */
  function fetchOnly(id: EarId) {
    getter?.terminate();
    const w = make();
    getter = w;
    w.onmessage = (ev: MessageEvent<FromEar>) => {
      const m = ev.data;
      if (m.type === 'progress') progressed(m.got);
      else if (m.type === 'fetched') {
        here.add(id);
        progressed(1, 'done');
        hatch.say(`ear: ${card(id)?.name} is in this browser — the microphone can hear you`, 'info');
      } else if (m.type === 'failed') {
        progressed(0, 'error', m.error);
        hatch.say(`ear: ${card(id)?.name} did not come down — ${m.error}`, 'error');
      } else return;
      if (m.type !== 'progress') { w.terminate(); if (getter === w) getter = null; }
      changed();
    };
    w.postMessage({type: 'fetch', id} satisfies ToEar);
    void keepDownloads();
  }

  const api: PageEar = {
    status: () => state,
    want(on) {
      wanted = on;
      if (on) {
        disarm();
        const id = chosen();
        if (id) void load(id);
      } else {
        arm();
      }
      changed();
    },
    grace: () => (letGo ? Math.max(0, Math.round((letGoAt - Date.now()) / 1000)) : null),
    graceMs: GRACE_MS,
    chosen,
    card: () => card(loaded || chosen()),
    parts: () => EARS.map((e) => ({id: e.id, name: e.name, gb: e.mb / 1000, here: here.has(e.id),
      suggested: e.suggested, using: e.id === chosen()})),
    get(id) {
      if (!id) {
        kept.choose(false);
        unload();
        changed();
        return;
      }
      const c = card(id);
      if (!c) return;
      getting = {id, state: {state: here.has(id) ? 'done' : 'fetching',
        got_gb: here.has(id) ? c.mb / 1000 : 0, gb: c.mb / 1000}};
      kept.choose(true, id);
      if (loaded && loaded !== id) unload();
      if (wanted) void load(id);
      else if (!here.has(id)) fetchOnly(id);
      changed();
    },
    fetching: () => (getting ? {...getting.state} : null),
    known: () => check(),
    async transcribe(samples) {
      const id = chosen();
      if (!id) throw new Error('no ear is chosen in this browser — the models panel brings one down');
      if (!(await load(id)) || !worker) throw new Error(`${card(id)?.name} would not load`);
      const n = ++turns;
      return new Promise<string>((done, fail) => {
        asked.set(n, {done, fail});
        /* A copy, handed over whole: the loop's turn is its own. */
        const copy = samples.slice();
        worker!.postMessage({type: 'hear', n, samples: copy} satisfies ToEar, [copy.buffer]);
      });
    },
    inUse: (id) => id === chosen() || id === loaded
      || (getting?.id === id && getting.state.state === 'fetching'),
    forgot(id) {
      here.delete(id);
      if (getting?.id === id) getting = null;
      changed();
    },
    onChange(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };

  /* What the cache holds, asked a moment after the page has settled. */
  setTimeout(() => void check(), 1500);
  return api;
}
