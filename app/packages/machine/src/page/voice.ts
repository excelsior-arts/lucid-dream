/* The voice, run in this page.
 *
 * A page with no machine behind it answers its words from a model in the
 * browser (engine.ts) and, until this, let them out at a reading pace. This is
 * the other half: a speech model in a worker (voice-worker.ts), behind the same
 * socket the machine's voice answers on -- `{text, voice, ends_paragraph, id}`
 * in, `{pcm, rate, chars}` frames and a `{done, stats}` out, every one named by
 * its chunk, a `{stop}` that lets go of what is being made. The room, the reply
 * and the speaker are the machine's and do not know the difference.
 *
 * It is a download, hundreds of megabytes, so it is chosen rather than given:
 * the switch beside the mute (@lucid/shell's offer), or /voice_engine in the
 * console, which also picks among the engines for judging. The
 * choice is this browser's, kept beside the language model's in its
 * userdata/ config.json: `tts.enabled` and `tts.engine` (see userdata.ts),
 * so switching it off keeps which engine it was. Until it is up
 * the room goes on at a reading pace; once it is, `host().voice` says so and
 * the next reply is spoken.
 *
 * Nothing heard is nothing spoken. While the page is silent (muted, or the
 * knob at zero: sound.silent) the voice is never fetched or loaded -- a switch
 * turned on then is kept and waits for the sound -- and one that is loaded is
 * let go of after a grace, the machine's 90 s, its worker ended so the GPU
 * buffers and the ONNX sessions go with it. The weights stay in the browser's
 * cache: coming back is a load, not a download. A room says so through the
 * machine's own seam, POST /machine/models/tts {wanted} (models.want), and
 * the silence itself is heard here too, for a page with no room open.
 *
 * Where the voices come from: the pack the machine's setup fetches
 * (excelsior-arts/lucid-voices on the Hugging Face hub, CC-BY-NC-4.0, both
 * clips synthesized by AI from written prompts), read by the browser at a
 * pinned commit -- the shelf of a page with no machine. Nothing of the clips
 * is in this repository or in the build.
 */
import {askForCard, hatch, offerVoice, setHost, sound} from '@lucid/shell';
import type {MakeSocket, Socketish, Stats} from '../tts';
import type {ModelStatus, Part, PartsFetching} from '../status';
import {keepDownloads} from './keep';
import {tagEntry, voiceTags} from '../voice-tags';
import type {EngineId, FromWorker, ToWorker, VoiceSpec} from './voice-worker';

/** The pack, at the commit the machine's setup fetches it at. */
const PACK = 'https://huggingface.co/datasets/excelsior-arts/lucid-voices/resolve/'
  + 'def88d4ccd5fec4b18bb72b0304b781152a62aba/';
/** What is on that shelf, by the names a persona gives (machine/voices.py). */
export const SHELF = ['lucid_talk/personas/lover', 'lucid_talk/personas/thinker'];

/** Chatterbox's delivery tags, as its tokenizer carries them (the machine
    reads the same list off added_tokens.json). Which of them a voice keeps
    and the prompt offers is the map's (voice-tags.json): Turbo here is the
    Mac's model and has its entry; Nano has none yet, and keeps them all. */
const CHATTERBOX_TAGS = ['[advertisement]', '[angry]', '[chuckle]', '[clear throat]', '[cough]',
  '[crying]', '[dramatic]', '[fear]', '[gasp]', '[groan]', '[happy]', '[laugh]', '[narration]',
  '[sarcastic]', '[shush]', '[sigh]', '[sniff]', '[surprised]', '[whispering]'];

/** A browser voice's name in the map. */
const mapped = (id: EngineId) => `browser:${id}`;

export interface EngineCard {
  id: EngineId;
  name: string;
  /** To download, in MB, as measured in headless Chromium on 10-08: f16 and
      without (only Turbo differs). */
  mb: {f16: number; f32: number};
  tags: readonly string[];
  /** What a person is told about it in the console. */
  about: string;
}

/* Measured on 10-08 (Chromium 151, M5 Pro, WebGPU), the same six lines a
   pill against its own clip: speaker similarity by Chatterbox's own voice
   encoder, words heard right by Parakeet, generation time over audio time
   after the first line. The machine's Turbo on MLX: 0.85 / 0.88, 2% wrong.
   Turbo measured again on 10-09, three takes of each line, once its speech
   encoder was read at q4: it had rushed, 5.16 syllables a second of speech
   where the machine's says 4.66 (the lover 5.08 against 4.21), and says
   4.44 (the lover 4.30). Sopro says 4.30; Nano, whose export has its encoder
   at half precision only, 5.22. */
export const ENGINES: readonly EngineCard[] = [
  {id: 'turbo', name: 'Chatterbox Turbo', mb: {f16: 699, f32: 718}, tags: voiceTags(mapped('turbo'), CHATTERBOX_TAGS).tags,
   about: 'the Mac\'s own voice, cloned from the pill\'s clip, tags performed — 0.89/0.92 like the clip, 3% words wrong, 0.27× real time'},
  {id: 'nano', name: 'Chatterbox Nano', mb: {f16: 576, f32: 576}, tags: voiceTags(mapped('nano'), CHATTERBOX_TAGS).tags,
   about: 'the 110M Chatterbox, community export, clones, tags — 0.87/0.89, 2% wrong, 0.33× real time'},
  {id: 'sopro', name: 'Sopro v2 Turbo', mb: {f16: 362, f32: 362}, tags: [],
   about: 'another small cloning model, no tags — 0.90/0.93, 2% wrong, 0.40× real time'},
];

/** What this browser's config.json says of its voice, and how to say it
    again: held here, written there (host.ts makes it). */
export interface VoiceChoice {
  enabled: boolean;
  /** An engine's id; one not offered here is as if none were named. */
  engine: string;
  /** On or off, and the engine only where one was named: the switch says
      only on or off, and leaves the file's engine (or its default) be. */
  choose(enabled: boolean, engine?: EngineId): void;
}

/** Why a voice would not come down or start, in a person's words, from what
 * the engine threw. The engine's own words go to the console as they are.
 *
 * The one seen on a phone (Eugene, 10-10, iPhone Air, Safari, Turbo asked for
 * beside the words while they came down): "no available backend found. ERR:
 * [webgpu] RangeError: Out of memory" -- onnxruntime-web's, when the runtime
 * itself (its WebAssembly, before any weight) could not get the memory it
 * asked for, WebKit's words for a refused allocation. */
export function plainly(raw: string): string {
  if (/out of memory|allocation fail|memory access out of bounds|RangeError/i.test(raw)) {
    return 'this device ran out of memory starting it';
  }
  if (/quota/i.test(raw)) return 'this browser has no room left to keep it';
  if (/fetch|load failed|network|would not come|connection|\b[45]\d\d\b/i.test(raw)) {
    return 'the download broke off';
  }
  if (/webgpu|gpu|adapter|backend/i.test(raw)) return 'this browser’s graphics could not run it';
  return 'it would not start here';
}

/** How long a voice nobody can hear is kept, in case the silence was a
    flinch: the machine's GRACE_S. */
export const GRACE_MS = 90_000;

export interface PageVoice {
  status(): ModelStatus;
  /** Wanted (the sound is on, a room asks) or not (silent): the machine's
      models.want('tts', ...). Not wanted arms the grace; wanted cancels it
      and loads the chosen engine. */
  want(on: boolean): void;
  /** Seconds until a voice nobody wants is let go of, or null. */
  grace(): number | null;
  /** The grace, in ms. GRACE_MS; a browser test shortens it through the
      debug door (window.__lucid.voice), the product never does. */
  graceMs: number;
  /** The engine chosen in this browser, or '' for none. */
  chosen(): EngineId | '';
  card(): EngineCard | null;
  /** The names this voice can speak in: the pack's. */
  voices(): string[];
  /** The tags it performs, for the prompt. */
  tags(): readonly string[];
  stats(): Stats;
  /** Choose an engine (fetching it if need be) or none. */
  choose(engine: EngineId | ''): void;
  /** The first-open card's rows: every engine this GPU runs, what it
      weighs, whether it is in the browser's cache, Turbo suggested. */
  parts(): Part[];
  /** The card's choice: chosen, and brought down -- loaded as well when the
      sound is on, only fetched into the cache while it is off. '' is none. */
  get(engine: EngineId | ''): void;
  /** How the card's fetch is going. */
  fetching(): PartsFetching | null;
  /** Load the chosen engine, if there is one and it is not up. */
  start(): void;
  warm(name: string): void;
  /** The socket a room's voice speaks through. */
  socket: MakeSocket;
  /** Whether an engine is the one in use -- switched on, loaded, or coming
      down -- which the models panel does not delete. */
  inUse(engine: EngineId): boolean;
  /** Its files were taken out of the cache (forget.ts): downloadable again. */
  forgot(engine: EngineId): void;
  /** For a browser test: the GPU device under the voice destroyed, as a
      driver reset would lose it (gpu-lost.ts). The product never calls it. */
  loseGpu(): void;
  onChange(fn: () => void): () => void;
}

/** How soon after one loss of the GPU another is taken for a GPU that will
    not hold the voice, rather than one more reset to start again after. */
const LOST_AGAIN_MS = 30_000;

export function createVoice(f16: boolean, kept: VoiceChoice,
                            /* What a voice's start waits for: the words' load
                               under way (engine.ts `settled`). Two models asking
                               a phone for their memory at once is how the voice
                               ran out of it (see `plainly`); the words are the
                               required part, so they go first. */
                            wait: () => Promise<unknown> | null = () => null): PageVoice {
  let state: ModelStatus = 'off';
  let loaded: EngineId | '' = '';
  let got = 0;
  let why = '';
  let last: Stats = {};
  let worker: Worker | null = null;
  const watchers = new Set<() => void>();
  /* Every socket's chunks, by the name sent to the worker: which socket and
     which of its chunks, and what the chunk said as written, for `chars`. */
  const chunks = new Map<string, {sock: Fake; id: string; chars: number; first: boolean}>();
  let sockets = 0;
  /** Nothing can be heard, so nothing is loaded. */
  let quiet = sound.silent;
  let letGo: ReturnType<typeof setTimeout> | null = null;
  let letGoAt = 0;
  /** Which engines are whole in the browser's cache, once asked. */
  const here = new Set<EngineId>();
  let checked: Promise<void> | null = null;
  let known = false;
  /** The card's fetch: the engine, and how it is going. */
  let getting: {engine: EngineId; state: PartsFetching} | null = null;
  let getter: Worker | null = null;
  /** When the GPU last let go of the voice. */
  let lostAt = 0;
  /** Why each engine last failed here, in plain words, until it is up or
      tried again: its row in the models panel says so. */
  const failed = new Map<EngineId, string>();
  /** Each load, numbered: one waiting on the words that was overtaken by
      another, or let go of, does not start. */
  let loads = 0;
  /** Chunks that failed in a row, with no sound between: see onWorker. */
  let misses = 0;

  /* Nano's export comes in half precision only: a GPU without shader-f16
     is not offered it. */
  const offered = ENGINES.filter((e) => e.id !== 'nano' || f16);
  const card = (id: string) => offered.find((e) => e.id === id) ?? null;
  /** The engine to switch on: the one named if it is offered here, Turbo
      otherwise. */
  const named = (): EngineId => card(kept.engine)?.id ?? 'turbo';
  const chosen = (): EngineId | '' => (kept.enabled ? named() : '');
  const mb = (c: EngineCard) => (f16 ? c.mb.f16 : c.mb.f32);

  let speaking: boolean | null = null;
  function changed() {
    /* The page can speak once the voice is up, and not before: a reply that
       waited on frames from a download still coming would be a room gone
       quiet for minutes. Until then, the reading pace. Said only when it
       moves: a host change is heard by every room. */
    if (speaking !== (state === 'ready')) {
      speaking = state === 'ready';
      setHost({voice: speaking});
    }
    const c = card(named())!;
    offerVoice({
      on: !!chosen(), what: c.name, mb: mb(c), silent: quiet,
      missing: !chosen() && known && !here.has(named()) && getting?.state.state !== 'fetching',
      state: state === 'ready' ? 'ready' : state === 'error' ? 'error'
        : state === 'loading' ? 'fetching' : 'off',
      got, why,
      set: turn,
    });
    for (const fn of watchers) fn();
  }

  /** Ask, once, which engines the cache already holds: a worker of its own
      for the question, let go of with the answer. */
  function check(): Promise<void> {
    checked ??= new Promise<void>((done) => {
      const w = new Worker(new URL('./voice-worker.ts', import.meta.url), {type: 'module'});
      w.onmessage = (ev: MessageEvent<FromWorker>) => {
        if (ev.data.type !== 'checked') return;
        for (const e of ev.data.here) here.add(e);
        known = true;
        w.terminate();
        changed();
        done();
      };
      w.onerror = () => { w.terminate(); known = true; done(); };
      w.postMessage({type: 'check', f16,
        engines: offered.map((c) => ({engine: c.id, mb: mb(c)}))} satisfies ToWorker);
    });
    return checked;
  }

  /** Where the card's fetch stands, from what the loading worker says. */
  function progressed(share: number, ended?: 'done' | 'error', error?: string) {
    if (!getting) return;
    const gb = getting.state.gb ?? 0;
    getting.state = {...getting.state, got_gb: +(share * gb).toFixed(3),
      ...(ended ? {state: ended} : {}), ...(error ? {error} : {})};
  }

  function onWorker(ev: MessageEvent<FromWorker>) {
    const m = ev.data;
    if (m.type === 'progress') {
      got = m.got;
      if (getting?.engine === loaded) progressed(m.got);
      changed();
      return;
    }
    if (m.type === 'checked' || m.type === 'fetched') return;
    if (m.type === 'lost') {
      /* The GPU let go of the voice (gpu-lost.ts): what was being made never
         comes back, so every chunk waiting on it is answered now, in the
         page's words -- the reply goes on, its words at a reading pace until
         the voice is up again -- and the worker is let go of with the device.
         Started again from the cache at once, unless the GPU let go of it a
         moment ago too. */
      const engine = loaded;
      const name = card(engine)?.name;
      const again = Date.now() - lostAt < LOST_AGAIN_MS;
      lostAt = Date.now();
      for (const [, chunk] of chunks) {
        chunk.sock.tell({id: chunk.id, told: true, error: again
          ? 'this browser’s GPU let go of the voice again — the words go on without it'
          : 'this browser’s GPU let go of the voice — it is starting again; the words go on'});
      }
      chunks.clear();
      worker?.terminate();
      worker = null;
      loaded = '';
      state = again ? 'error' : 'off';
      why = again ? 'the GPU let go of the voice twice in a row' : '';
      got = 0;
      hatch.say(`voice: the GPU let go of ${name} (${m.reason})`
        + (again ? ' twice in a row — no voice until it is switched on again' : ' — starting it again from the cache'),
      'warn');
      if (!again && engine && engine === chosen()) load(engine);
      changed();
      return;
    }
    if (m.type === 'ready') {
      state = 'ready';
      got = 1;
      if (loaded) { here.add(loaded); failed.delete(loaded); }
      if (getting?.engine === loaded) progressed(1, 'done');
      changed();
      hatch.say(`voice: ${card(loaded)?.name} up in ${m.load_s} s, in this browser`, 'info');
      if (loaded && card(loaded)?.tags.length && !tagEntry(mapped(loaded))) {
        hatch.say(`voice: ${card(loaded)?.name} has no entry in voice-tags.json — it keeps all `
          + `${card(loaded)?.tags.length} tags its tokenizer knows, to be pruned by ear`, 'info');
      }
      /* Both pills' conditioning, made now rather than on a first sentence:
         a room opened before the voice was up never asked for its warm. */
      for (const name of SHELF) api.warm(name);
      return;
    }
    if (m.type === 'failed') {
      state = 'error';
      why = plainly(m.error);
      if (loaded) failed.set(loaded, why);
      if (getting?.engine === loaded) progressed(0, 'error', why);
      changed();
      hatch.say(`voice: ${card(loaded)?.name} would not load — ${m.error}`, 'error');
      return;
    }
    const chunk = chunks.get(m.id);
    if (!chunk) return;                       // let go of: see Fake.stop
    if (m.type === 'frame') {
      misses = 0;
      chunk.sock.tell({id: chunk.id, pcm: m.pcm, rate: m.rate, chars: chunk.first ? chunk.chars : 0});
      chunk.first = false;
      return;
    }
    chunks.delete(m.id);
    if (m.type === 'done') {
      last = m.stats;
      chunk.sock.tell({id: chunk.id, done: true, stats: m.stats});
    } else {
      chunk.sock.tell({id: chunk.id, error: m.error});
      /* Two chunks in a row with no sound: a voice that loaded and cannot
         speak -- its runtime would not start, memory it was refused -- is
         put down as failed, so the replies after go at the reading pace
         rather than each asking it again, and its row says why. */
      if (++misses >= 2 && loaded) {
        const name = card(loaded)?.name;
        why = plainly(m.error);
        failed.set(loaded, why);
        worker?.terminate();
        worker = null;
        for (const [, c] of chunks) c.sock.tell({id: c.id, error: m.error});
        chunks.clear();
        state = 'error';
        misses = 0;
        hatch.say(`voice: ${name} could not speak twice in a row — ${m.error}; the words go on without it`, 'error');
        changed();
      }
    }
  }

  /** Let go of after the grace, if it is still not wanted by then. */
  function arm() {
    if (letGo || !worker) return;
    letGoAt = Date.now() + api.graceMs;
    letGo = setTimeout(() => {
      letGo = null;
      if (!quiet || !worker) return;
      const name = card(loaded)?.name;
      unload();
      hatch.say(`voice: ${name} let go of — the sound is off; it comes back from the cache when the sound does`,
        'info');
    }, api.graceMs);
  }

  function disarm() {
    if (letGo) clearTimeout(letGo);
    letGo = null;
  }

  function hearSilence(silent: boolean) {
    quiet = silent;
    if (silent) arm();
    else disarm();
    changed();
  }

  function load(engine: EngineId) {
    if (quiet) return;          // kept chosen, and fetched when the sound is back
    if (loaded === engine && state !== 'error' && (worker || state === 'loading')) return;
    worker?.terminate();
    worker = null;
    for (const [, chunk] of chunks) chunk.sock.tell({id: chunk.id, error: 'the voice changed'});
    chunks.clear();
    loaded = engine;
    state = 'loading';
    got = 0;
    why = '';
    misses = 0;
    failed.delete(engine);
    changed();
    const mine = ++loads;
    const start = () => {
      if (mine !== loads) return;
      if (quiet) {                // gone silent while it waited: kept chosen, not started
        loaded = '';
        state = 'off';
        changed();
        return;
      }
      /* A worker of its own per engine: letting go of one is letting go of
         its GPU buffers with it, which no engine here offers to do itself. */
      worker = new Worker(new URL('./voice-worker.ts', import.meta.url), {type: 'module'});
      worker.onmessage = onWorker;
      const c = card(engine)!;
      worker.postMessage({type: 'load', engine, f16, mb: mb(c)} satisfies ToWorker);
      /* Asked on the press, as the language model's download asks: hundreds of
         megabytes the browser may throw away under pressure are hundreds of
         megabytes fetched twice (keep.ts). */
      void keepDownloads();
    };
    /* After the words' load under way, if one is: see `wait`. A voice
       asked for in the same press as the words starts when they are up, or
       when they have failed -- it is never what keeps them from loading. */
    const words = wait();
    if (!words) {
      start();
      return;
    }
    hatch.say(`voice: ${card(engine)?.name} starts once the words are up`, 'info');
    void words.catch(() => {}).then(() => {
      if (mine === loads && !quiet) hatch.say(`voice: the words are settled — starting ${card(engine)?.name}`, 'info');
      start();
    });
  }

  /** Brought into the cache and no further, for a choice made while nothing
      can be heard: the card's bar is this, and the load waits for the sound. */
  function fetchOnly(engine: EngineId) {
    getter?.terminate();
    const w = new Worker(new URL('./voice-worker.ts', import.meta.url), {type: 'module'});
    getter = w;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'progress') progressed(m.got);
      else if (m.type === 'fetched') {
        here.add(engine);
        progressed(1, 'done');
        hatch.say(`voice: ${card(engine)?.name} is in this browser — it loads when the sound is back`, 'info');
      } else if (m.type === 'failed') {
        failed.set(engine, plainly(m.error));
        progressed(0, 'error', plainly(m.error));
        hatch.say(`voice: ${card(engine)?.name} did not come down — ${m.error}`, 'error');
      } else return;
      if (m.type !== 'progress') { w.terminate(); if (getter === w) getter = null; }
      changed();
    };
    w.postMessage({type: 'fetch', engine, f16, mb: mb(card(engine)!)} satisfies ToWorker);
    void keepDownloads();
  }

  /** Switched on or off, kept in config.json, and loaded (unless nothing
      can be heard) or let go of. On with nothing in the cache is the card's
      to bring down, beside the language model: it is opened at its voice
      section and nothing starts here. */
  function turn(on: boolean, engine?: EngineId) {
    if (on && !engine && !here.has(named())) {
      void check().then(() => {
        if (here.has(named())) { turn(true); return; }
        if (!askForCard('voice')) {
          hatch.say('the voice is brought down on the card a pill opens with — open a pill, then press it again', 'warn');
        }
      });
      return;
    }
    kept.choose(on, engine);
    if (on) load(named());
    else unload();
    changed();
  }

  function unload() {
    disarm();
    loads += 1;
    worker?.terminate();
    worker = null;
    for (const [, chunk] of chunks) chunk.sock.tell({id: chunk.id, done: true, stats: last});
    chunks.clear();
    loaded = '';
    state = 'off';
    got = 0;
    changed();
  }

  /** What a voice name is to the engine: the pack's clip, or null for a
      name not on the pack -- a voice of the player's own (`@...`) among
      them, which lives in a machine's store and not on the hub. */
  const spec = (name: string): VoiceSpec | null =>
    (SHELF.includes(name) ? {clip: `${PACK}${name}/voice.ref.wav`} : null);

  /** One room's socket: the machine's messages, answered by the worker. */
  class Fake implements Socketish {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: {data: string}) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private n = ++sockets;
    private mine = new Set<string>();

    constructor() {
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen?.();
      });
    }

    tell(o: unknown) {
      if (this.readyState === 1) this.onmessage?.({data: JSON.stringify(o)});
    }

    send(data: string) {
      let msg: {text?: string; voice?: string; ends_paragraph?: boolean; id?: string; stop?: boolean};
      try {
        msg = JSON.parse(data) as typeof msg;
      } catch {
        return;
      }
      if (msg.stop) {
        this.stop();
        return;
      }
      const id = String(msg.id ?? '');
      const text = String(msg.text ?? '');
      const name = String(msg.voice ?? '');
      if (!worker || state === 'error') {
        queueMicrotask(() => this.tell({id, error: 'the voice in this browser is not loaded'}));
        return;
      }
      const voice = spec(name);
      if (!voice) {
        queueMicrotask(() => this.tell({id, refused: 'voice',
          error: `no voice named '${name}' — this browser's shelf has ${SHELF.join(', ')}`}));
        return;
      }
      const key = `s${this.n}:${id}`;
      this.mine.add(key);
      chunks.set(key, {sock: this, id, chars: text.length + 1, first: true});
      worker.postMessage({type: 'speak', id: key, text, voice, paragraph: !!msg.ends_paragraph,
        tags: [...(card(loaded)?.tags ?? [])]} satisfies ToWorker);
    }

    /** As the machine does: what is being made is finished and dropped, what
        is queued behind it is answered done and never spoken. */
    stop() {
      const ids = [...this.mine].filter((k) => chunks.has(k));
      this.mine.clear();
      if (!ids.length) return;
      worker?.postMessage({type: 'drop', ids} satisfies ToWorker);
    }

    close() {
      if (this.readyState >= 2) return;
      this.stop();
      for (const k of [...chunks.keys()]) if (chunks.get(k)?.sock === this) chunks.delete(k);
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.());
    }
  }

  const api: PageVoice = {
    status: () => state,
    want(on) {
      if (on) {
        quiet = false;
        disarm();
        api.start();
      } else {
        quiet = true;
        arm();
      }
      changed();
    },
    grace: () => (letGo ? Math.max(0, Math.round((letGoAt - Date.now()) / 1000)) : null),
    graceMs: GRACE_MS,
    chosen,
    card: () => card(loaded || chosen()),
    voices: () => (state === 'ready' ? [...SHELF] : []),
    tags: () => (chosen() ? card(chosen())?.tags ?? [] : []),
    stats: () => last,
    choose: (engine) => (engine ? turn(true, engine) : turn(false)),
    parts: () => {
      /* Turbo suggested -- until it failed here; then the smallest that has
         not, which on a phone is Sopro, whose runtime is built for one. */
      const suggested = !failed.has('turbo') ? 'turbo'
        : [...offered].filter((c) => !failed.has(c.id)).sort((a, b) => mb(a) - mb(b))[0]?.id;
      return offered.map((c) => ({id: c.id, name: c.name, gb: mb(c) / 1000,
        here: here.has(c.id), suggested: c.id === suggested, using: c.id === chosen(),
        ...(failed.has(c.id) ? {error: failed.get(c.id)} : {})}));
    },
    get(engine) {
      if (!engine) {
        // None: what an earlier fetch left -- a failure among it -- goes too.
        getting = null;
        turn(false);
        return;
      }
      const c = card(engine);
      if (!c) return;
      failed.delete(engine);
      getting = {engine, state: {state: here.has(engine) ? 'done' : 'fetching',
        got_gb: here.has(engine) ? mb(c) / 1000 : 0, gb: mb(c) / 1000}};
      kept.choose(true, engine);
      if (here.has(engine)) {
        if (!quiet) load(engine);
      } else if (quiet) {
        fetchOnly(engine);
      } else {
        load(engine);
      }
      changed();
    },
    fetching: () => (getting ? {...getting.state} : null),
    start() {
      const engine = chosen();
      if (engine && (!worker || loaded !== engine)) load(engine);
    },
    warm(name) {
      const voice = spec(name);
      if (worker && voice) worker.postMessage({type: 'warm', voice} satisfies ToWorker);
    },
    socket: () => new Fake(),
    inUse: (engine) => engine === chosen() || engine === loaded
      || (getting?.engine === engine && getting.state.state === 'fetching'),
    forgot(engine) {
      here.delete(engine);
      if (getting?.engine === engine) getting = null;
      changed();
    },
    loseGpu() { worker?.postMessage({type: 'lose'} satisfies ToWorker); },
    onChange(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };

  hatch.command('voice_engine',
    'the voice in this browser: off, or which engine — turbo, nano, sopro',
    (rest) => {
      const what = rest.trim().split(/\s+/)[0] ?? '';
      if (!what) {
        const now = chosen();
        return [`now: ${now ? `${card(now)!.name} (${state})` : 'off'}`,
          ...offered.map((e) => `  ${e.id.padEnd(6)} ${e.name}, ${mb(e)} MB — ${e.about}`),
          '  off    no voice: the words at a reading pace'].join('\n');
      }
      if (what === 'off') {
        api.choose('');
        return 'voice off — the words at a reading pace';
      }
      const c = card(what);
      if (!c) return `no engine called ${what} — /voice_engine lists them`;
      api.choose(c.id);
      if (quiet) return `${c.name}: chosen — fetched when the sound is back on, not while it is off`;
      return `${c.name}: ${state === 'ready' && loaded === c.id ? 'up' : `loading, ${mb(c)} MB the first time`}`
        + ' — the next sentence is spoken in it';
    }, {args: '[off|turbo|nano|sopro]'});

  /* The silence, heard here as well as through a room's want: a page muted
     on the shelf, with a voice still up from the room before, lets go of it
     too. */
  document.addEventListener('lucid:silent', (e) => hearSilence(!!(e as CustomEvent<boolean>).detail));
  /* What the cache holds, asked a moment after the page has settled: the
     switch and the card both need it, and neither should wait on it. */
  setTimeout(() => void check(), 1500);

  changed();
  return api;
}
