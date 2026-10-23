/* The language model, run in this page.
 *
 * A page with no machine behind it -- a static host, or a wrapper with no
 * Python in it -- still has a pill to talk to, if the browser has a GPU it
 * will lend: a small Qwen through WebLLM, in a worker, on WebGPU. The research
 * of 10-08 chose it and measured it (Qwen3.5-2B: 1.06 GB, a cold load of
 * 13.5 s on this Mac's connection and 1.2-1.9 s from cache, the first word in
 * 1.3-1.7 s, 36-64 words-ish a second); the smaller 0.8B is the one for a
 * weaker device, and the 4B is offered -- and suggested -- only where every
 * sign says the device is strong enough to hold it, about 3.9 GB of the GPU
 * (see tierOf).
 *
 * The weights come from the Hugging Face hub, pinned to a commit each, and the
 * compiled kernels from WebLLM's own library repository, pinned the same way:
 * a revision that moves under a page is a page that changes overnight. Both
 * are cached by the browser (Cache API) and asked for once.
 *
 * What is chosen is this browser's, kept beside its other settings: there is
 * no machine to write it into. What the page hears back is the machine's own
 * shapes -- see machine.ts beside this, which answers the routes.
 */
import type {
  AppConfig, ChatCompletionChunk, ChatCompletionRequestStreaming, InitProgressReport,
  WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import {hatch} from '@lucid/shell';
import type {Fetching, Generation, ModelStatus, Offer} from '../status';
import {FIRST_WORD_MS, NEXT_WORD_MS, NotAnswering, Stalled, within} from '../stall';
import {Told} from '../told';
import {cleaner, keyOf} from './clean';
import type {Holding} from './forget';
import {keepDownloads} from './keep';

/* Where the kernels come from: WebLLM 0.2.85's library build, at the commit
   it was published from, rather than whatever `main` is today. */
const LIBS = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/'
  + '025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/';

/* What a GPU has to give the kernels is WebLLM's to say, not ours: it reads
   the adapter's limits against what it will ask the device for (tvmjs's
   detectGPUDevice) and refuses with "Cannot initialize runtime because of
   requested <limit> exceeds limit. requested=<n>, limit=<m>." That comes
   after the model's config and its kernel library (about 6 MB) and before a
   byte of the weights, so a browser is let try, every time, and told in the
   page's words when this is why it could not (see `outgrown`). Firefox 157
   gives a shader nine storage buffers where WebLLM 0.2.85 asks for ten
   (10-10, headless: the 0.8B and the 2B alike). A count kept here went stale
   with the next browser or library; the library's own check does not. */

interface Build {
  /** The name a page offers it under, and the one written down when chosen. */
  size: string;
  /** What it is called to a person. */
  name: string;
  /** The WebLLM build and the commit of its repository, half precision and
      full: a GPU without `shader-f16` runs the second, which weighs the same
      on the wire and a little more on the card. */
  f16: {id: string; rev: string; vram: number};
  f32: {id: string; rev: string; vram: number};
  /** To download, in GB, measured off the hub. */
  gb: number;
  /** It sometimes answers as the model rather than as the character -- "I
      can't continue this roleplay. I am an AI..." -- where the same weights
      packed another way do not: the research of 10-09 had the Mac's 4-bit
      of Qwen3.5-4B not doing it and this build of it doing it on explicit
      lines, and put it down to the MLC packing. Said on `GET /machine`
      (`llm.censored`) and kept as host().censored; what a game does about
      it is the game's (see talk's conversation/refusal.ts). */
  censored: boolean;
}

const BUILDS: Build[] = [
  {size: '0.8b', name: 'Qwen3.5 0.8B', gb: 0.45, censored: true,
   f16: {id: 'Qwen3.5-0.8B-q4f16_1-MLC', rev: '0ec138972555613c1d7812a821778ad0398c8790', vram: 1629},
   f32: {id: 'Qwen3.5-0.8B-q4f32_1-MLC', rev: '4ed017713f04c91ffe55a9dca8c7ac853c41314d', vram: 1894}},
  {size: '2b', name: 'Qwen3.5 2B', gb: 1.08, censored: true,
   f16: {id: 'Qwen3.5-2B-q4f16_1-MLC', rev: 'dd74e9c8a20c4546df85c844103bff87b6dcacad', vram: 2245},
   f32: {id: 'Qwen3.5-2B-q4f32_1-MLC', rev: 'd835e5c41aa56174d915e8a3940cde599d3f5a30', vram: 2592}},
  {size: '4b', name: 'Qwen3.5 4B', gb: 2.39, censored: true,
   f16: {id: 'Qwen3.5-4B-q4f16_1-MLC', rev: '44b42469f9e192814bfd90440e3b377d89ba7a13', vram: 3868},
   f32: {id: 'Qwen3.5-4B-q4f32_1-MLC', rev: 'ce39652c7b493d59331e40ef9c7a87de5a47abe3', vram: 4680}},
];

/** The one offered first, and the one most devices get. */
export const DEFAULT_SIZE = '2b';

/** The kernels' file for a build, in WebLLM's library repository. */
const libOf = (id: string) => `${id.replace(/-MLC$/, '')}_cs1k-webgpu.wasm`;

/** What each size keeps in this browser, for a delete from the models panel
    (forget.ts): both precisions' weights, tokenizer and chat config, at any
    revision, in WebLLM's caches, and their kernels. Nothing is shared between
    sizes: each has a repository and a library of its own. */
export const WORDS_HOLDINGS: readonly Holding[] = BUILDS.map((b) => ({
  key: `llm:${b.size}`,
  claims: (cache: string, url: string) => cache.startsWith('webllm/') && [b.f16, b.f32].some((v) =>
    url.startsWith(`https://huggingface.co/mlc-ai/${v.id}/`) || url.endsWith(`/${libOf(v.id)}`)),
}));

/* What a small model needs that the 27B does not. Measured in the spike: the
   4B fell into "You're asking if they can change." four times over without a
   presence penalty, and 0.6 with a repetition penalty of 1.1 stopped it. */
const PENALTIES = {presence_penalty: 0.6, repetition_penalty: 1.1};

/* A reply cannot have what the prompt already took: this keeps one long
   reply from being the thing that overruns the context (`contextFor`). */
const MOST_TOKENS = 600;

/** The context a build is loaded with, in tokens: `LONG` on every device but
 * a weak one, `SHORT` there and wherever a long load fails.
 *
 * WebLLM's builds ship at 4096, which is why the page's window was four
 * exchanges and 400 words (config.ts in @lucid/talk) where the machine's is
 * six and 600: the lover's front is about 1,550 tokens, six exchanges at
 * their loosest (windowCut's slack, 900 words) take her prompt to about
 * 2,500, and a reply can be 600 more. 8192 holds that with room.
 *
 * Measured on this Mac (M5 Pro, headless Chromium, q4f16, 10-10; the lover's
 * prompt; GPU bytes counted at createBuffer):
 *
 *            loaded MB    the game's window: first word, decode   full window
 *            4k    8k     4k (4/400)        8k (6/600)            8k: 7,488 tokens
 *   0.8B     483   531    1.8 s, 45/s       2.0 s, 45/s           6.8 s, 24/s
 *   2B      1089  1137    2.9 s, 39/s       2.7 s, 39/s           9.8 s, 21/s
 *   4B      2458  2586    5.1 s, 27/s       5.7 s, 25/s          18.2 s, 15/s
 *
 * and the next turn, read from the cache, 0.04-0.1 s to the first word at
 * either. The long context costs 48-128 MB at the load and nothing a turn
 * the game sends; only a prompt that really fills it is slow, and the
 * game's window never comes near. So every device loads it (Eugene, 10-10)
 * but a weak one (`tierOf`: a phone, a browser saying under 4 GB, a GPU
 * without a 1 GiB buffer), which keeps 4096: on iOS a tab past its memory is
 * killed rather than failing a load, so the fall back to `SHORT` below could
 * never catch it there. On an ordinary device that fallback is the net: a
 * long load that fails is put down and loaded short from the cache. */
export const LONG = 8192;
export const SHORT = 4096;
export const contextFor = (tier: Tier): number => (tier === 'weak' ? SHORT : LONG);

/** What the browser says about its GPU, asked once. */
export interface Gpu {
  /** Null: no WebGPU at all, or only a software one, which the research
      measured at 54 s to a first word -- not a conversation. */
  adapter: GPUAdapter | null;
  f16: boolean;
  /** How much this device looks able to run: see `tierOf`. */
  tier: Tier;
}

export type Tier = 'weak' | 'ordinary' | 'strong';

/** What a page can see of the device it runs on, and nothing it cannot. */
export interface Signals {
  /** A phone or a tablet, by the browser's own word or its user agent. */
  mobile: boolean;
  /** navigator.deviceMemory, in GB, rounded and capped by the browser (8 in
      older Chrome, 32 in Chrome 151 on this Mac); Safari and Firefox expose
      none, which is undefined here. */
  deviceMemory?: number;
  /** The adapter's own limits, in bytes. */
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  /** adapter.info: 'apple', 'nvidia', 'amd', 'intel', 'qualcomm', 'arm'...,
      and the architecture within it ('metal-3'). Empty where a browser keeps
      them to itself. */
  vendor: string;
  architecture: string;
}

const GiB = 2 ** 30;

/** Which of the three sizes this device should be offered first.
 *
 *   weak      a phone, a browser saying under 4 GB, or a GPU that will not
 *             hand out a 1 GiB buffer: the 0.8B is suggested, the 4B not
 *             offered. iOS keeps a tab near 500 MB, and the 2B wants 2.2 GB
 *             of the GPU.
 *   strong    every sign agrees: a desktop browser; memory, where the browser
 *             says, of 8 GB or more; buffers and storage bindings of 2 GiB or
 *             more (the 4B's largest weight array is about 1.2 GB and its
 *             cache rides beside it -- most integrated GPUs stop at 1-2 GiB);
 *             and a GPU of a kind known to carry it: Apple silicon on Metal 3
 *             (M1 and later, whose GPU shares the machine's memory) or a
 *             discrete NVIDIA or AMD card. The 4B is offered and suggested.
 *   ordinary  anything between, an Intel or unnamed integrated GPU among
 *             them: the 2B is suggested, the 4B not offered.
 *
 * Safari and Firefox say nothing about memory, so there the adapter decides
 * alone: the same limits and the same kinds of GPU. A Mac in Safari 26 is
 * then as strong as it is in Chrome -- the adapter is the same Metal device
 * -- and a browser that names no vendor is never strong, because "big
 * buffers" alone is also what a software adapter can claim.
 */
export function tierOf(s: Signals): Tier {
  if (s.mobile) return 'weak';
  if (s.deviceMemory !== undefined && s.deviceMemory < 4) return 'weak';
  if (s.maxBufferSize < GiB) return 'weak';
  const roomy = s.maxBufferSize >= 2 * GiB && s.maxStorageBufferBindingSize >= 2 * GiB;
  const enough = s.deviceMemory === undefined || s.deviceMemory >= 8;
  const apple = s.vendor === 'apple' && /^metal-([3-9]|\d\d)/.test(s.architecture);
  const discrete = s.vendor === 'nvidia' || s.vendor === 'amd';
  return roomy && enough && (apple || discrete) ? 'strong' : 'ordinary';
}

/** The size suggested for a tier. */
export const suggestedFor = (tier: Tier): string =>
  (tier === 'weak' ? '0.8b' : tier === 'strong' ? '4b' : DEFAULT_SIZE);

/** Why no size of the words can run in this browser, or '' where one may:
    `webgpu` for no GPU to lend, or only a software one. Anything else is
    found out by trying (see `outgrown`). */
export type Unable = '' | 'webgpu';

export const unable = (gpu: Gpu): Unable => (gpu.adapter ? '' : 'webgpu');

/** The same, as the console says it. */
export const unableSaid = (): string => 'this browser has no WebGPU to run a model on';

/** A limit of this browser's GPU that WebLLM asked more of than it gives. */
export interface Outgrown {
  /** The WebGPU limit, as WebLLM names it: maxStorageBuffersPerShaderStage. */
  limit: string;
  requested: string;
  given: string;
}

/* tvmjs's words for it (detectGPUDevice), the same for every limit it checks:
   maxBufferSize, maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize,
   maxStorageBuffersPerShaderStage. */
const OUTGROWN = /requested (\w+) exceeds limit\.?\s*requested=([^,\s]+),\s*limit=([^.,\s]+)/i;

/** The limit a failed load ran into, or null for any other failure. */
export function outgrown(e: unknown): Outgrown | null {
  const m = OUTGROWN.exec(e instanceof Error ? e.message : String(e));
  return m ? {limit: m[1]!, requested: m[2]!, given: m[3]!} : null;
}

/* What each limit is to a person who never set one. */
const PLAIN: Record<string, string> = {
  maxStorageBuffersPerShaderStage: 'storage buffers a shader',
  maxBufferSize: 'for its largest buffer',
  maxStorageBufferBindingSize: 'for its largest storage binding',
  maxComputeWorkgroupStorageSize: 'bytes of workgroup memory',
};

/** Said on the page where the model could not start for a limit of this
    browser's GPU: what it cannot do yet, that an update may lift it, and
    what does run it. */
export function outgrownSaid(o: Outgrown): string {
  return `This browser’s graphics can’t run the pill yet: the model asks its WebGPU for `
    + `${o.requested} ${PLAIN[o.limit] ?? o.limit}, `
    + `and it gives ${o.given}. A browser update may lift that. Chrome, Edge and Safari run it, `
    + 'or run it on your Mac.';
}

export async function probeGpu(): Promise<Gpu> {
  const none: Gpu = {adapter: null, f16: false, tier: 'weak'};
  const gpu = (navigator as Navigator & {gpu?: GPU}).gpu;
  if (!gpu) return none;
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await gpu.requestAdapter({powerPreference: 'high-performance'});
  } catch {
    return none;
  }
  if (!adapter) return none;
  const info = (adapter as GPUAdapter & {info?: {isFallbackAdapter?: boolean; vendor?: string;
                                                 architecture?: string}}).info;
  if (info?.isFallbackAdapter) return none;
  const nav = navigator as Navigator & {userAgentData?: {mobile?: boolean}; deviceMemory?: number};
  const tier = tierOf({
    mobile: nav.userAgentData?.mobile === true || /Mobi|Android|iPhone|iPad/i.test(nav.userAgent),
    ...(typeof nav.deviceMemory === 'number' ? {deviceMemory: nav.deviceMemory} : {}),
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    vendor: (info?.vendor ?? '').toLowerCase(),
    architecture: (info?.architecture ?? '').toLowerCase(),
  });
  return {adapter, f16: adapter.features.has('shader-f16'), tier};
}

// ---- what is chosen, and kept --------------------------------------------

/** Where the choice of model is written down: the browser's own
    userdata/config.json, `llm.size` in it, as the machine keeps its own (see
    userdata.ts). Read once when the page starts, so asking is not a wait. */
export interface Chosen {
  size: string;
  choose(size: string): void;
}

/** For a page that keeps nothing -- a test. */
export const unkept = (size = ''): Chosen => ({size, choose(s) { this.size = s; }});

// ---- the engine ------------------------------------------------------------

export interface Engine {
  status(): ModelStatus;
  /** The size in use or chosen, '' for none. */
  size(): string;
  /** Whether the chosen size is in this browser, so a start needs no download. */
  here(): Promise<boolean>;
  offer(): Promise<Offer[]>;
  fetching(): Fetching | null;
  /** Bring a size into this browser and start it. */
  fetch(size: string): Fetching;
  /** Start the chosen size, if it is here. */
  start(): Promise<ModelStatus>;
  stop(): Promise<void>;
  /** Whether a size is the one in use -- running, chosen, or coming down --
      which the models panel does not delete (see machine.ts). */
  inUse(size: string): boolean;
  /** Whether the size in use or chosen is one of the `censored` builds; false
      for none. */
  censored(): boolean;
  /** The context in tokens: what the running build was loaded with, or what
      the next load will ask for (`contextFor`). */
  context(): number;
  /** The GPU limit the last load ran into, or null: see `outgrown`. */
  outgrown(): Outgrown | null;
  /** Whether the load under way got past the GPU's check to the weights:
      true there (or on any other failure, or with no load), false where
      the GPU fell short of a limit. What a voice asked for in the same
      press waits on, so a browser that cannot run the words downloads no
      voice for them. */
  past(): Promise<boolean>;
  /** Whether the load under way ended with the words up, false where it
      failed; null where none is under way. What a voice's own start waits
      on, so the two never ask a phone for their memory at once (voice.ts). */
  settled(): Promise<boolean> | null;
  /** One chat call, as raw deltas with the empty thought and stage
      directions taken out. */
  chat(body: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<string>;
  /** The last generation, in counts and seconds. */
  last(): Generation | null;
  /** What it is holding on the GPU, in MB, while it is up. */
  vram(): number;
  label(): string;
  /** Whether the GPU let go of the model since it last started: the next
      ask starts it again (machine.ts), and says so if it will not. */
  lost(): boolean;
  /** For a browser test: the GPU device under the model destroyed, as a
      driver reset would lose it (gpu-lost.ts). The product never calls it. */
  loseGpu(): void;
  /** Told whenever any of the above moves. */
  onChange(fn: () => void): () => void;
  gpu: Gpu;
}

/* How long one step of a reply -- the request taken, the next words, the
   end of one let go of -- may take before the model is called stuck: the
   rule both machines keep (stall.ts). Before the first word a prompt's whole
   reading is one step, so that one is long: the 4B reads 4096 tokens in
   about ten seconds on this Mac, and a weak GPU several times that. Once
   words are flowing, a working model writes several a second, and fifteen
   seconds with none is a stall. */
export const STALL_MS = FIRST_WORD_MS;

/** Why a reply stopped with nothing more to come: the shared one, said in
    this browser's words. */
export {Stalled};
const stalledHere = () =>
  new Stalled('the model in this browser stopped answering — it starts afresh for the next line');

/** The GPU let go of the model: a driver reset, a backgrounded tab's device
    reclaimed, memory pressure. Said on the page when it cost a reply that had
    begun; one that had not begun is asked again of the model started afresh,
    and nobody is told but the console. */
export class Lost extends NotAnswering {
  constructor(message = 'this browser’s GPU let go of the pill mid-reply — say that again and it starts afresh') {
    super(message);
    this.name = 'Lost';
  }
}

/** What WebLLM throws at a request once its device is gone, and what it
    throws at one in flight when it goes: measured 10-10 with the device
    destroyed under the 0.8B, between replies (ModelNotLoadedError on every
    request after) and in one ("Object has already been disposed"). And the
    load's own, for a device lost while the weights went up. */
export const lostShape = (e: unknown): boolean => e instanceof Lost
  || /ModelNotLoaded|already been disposed|DeviceLost|device (was|is) lost/i
    .test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/** Read a stream nobody wants any more to its end, telling it to stop first.
 *
 * WebLLM's worker takes its model's lock when a streamed request is made and
 * lets go of it only when that stream's generator runs out. A stream the page
 * stops reading -- a reply talked over, Skip, a line typed over it, a room
 * left -- leaves the generator in the worker parked at its last chunk, still
 * holding the lock, and every request after it waits on that lock for good:
 * the next reply never starts and nothing anywhere says so (10-09: the first
 * reply talked over, and the pill never answered again). So the stream is
 * told to stop and read out, which is two or three chunks: the one being
 * made, the empty last one, the counts. Told again before each, because a
 * stop that reaches the worker before the generator has begun is undone by
 * its first step (asyncGenerate sets interruptSignal back to false). A device
 * lost on the way (`gone`) ends it: there is no worker left to read. */
export async function finish(
  it: AsyncIterator<unknown>, interrupt: () => Promise<void> | void, ms = STALL_MS,
  gone: Promise<never> = new Promise<never>(() => {}),
): Promise<void> {
  for (;;) {
    await interrupt();
    if ((await within(Promise.race([it.next(), gone]), ms, stalledHere)).done) return;
  }
}

/** How long the browser's storage may take to say whether a size is in it
    before the answer is the last one it gave, or unknown: the models panel
    and the room's lamps are read off this, and neither may wait on it. */
export const CHECK_MS = 4000;

/** How long a load may go with no word from WebLLM -- no file come down, no
    weight read, no kernel compiled -- before it is called stuck: its worker
    put down and the reason said. WebLLM reports each of those as it goes,
    and on a phone's slowest connection one shard is well under a minute. */
export const LOAD_QUIET_MS = 180_000;

/** A load that stopped saying anything. */
export class LoadStuck extends Error {
  constructor(ms: number) {
    super(`the words stopped coming down — nothing arrived for ${Math.round(ms / 1000)} s`);
    this.name = 'LoadStuck';
  }
}

export function createEngine(gpu: Gpu, chosen: Chosen = unkept(),
                             o: {stallMs?: number; nextMs?: number; checkMs?: number;
                                 loadQuietMs?: number} = {}): Engine {
  const stallMs = o.stallMs ?? STALL_MS;
  const checkMs = o.checkMs ?? CHECK_MS;
  const loadQuietMs = o.loadQuietMs ?? LOAD_QUIET_MS;
  /** Once words are flowing. Never longer than the first: a test that
      shortens one shortens both. */
  const nextMs = Math.min(o.nextMs ?? NEXT_WORD_MS, stallMs);
  let state: ModelStatus = 'off';
  let running = '';
  let fetch: Fetching | null = null;
  let engine: WebWorkerMLCEngine | null = null;
  let worker: Worker | null = null;
  let loading: Promise<void> | null = null;
  /** The GPU let go of the model since it last started. */
  let lostIt = false;
  /** Rejected with Lost when the device goes: every step of a reply races
      it, since a worker put down answers nothing more. New with each worker. */
  let gone = never();
  /** Our own stop under way: a device WebLLM gives up then is not a loss. */
  let stopping = false;
  const watchers = new Set<() => void>();
  const changed = () => { for (const fn of watchers) fn(); };

  const build = (size: string) => BUILDS.find((b) => b.size === size);
  const variant = (b: Build) => (gpu.f16 ? b.f16 : b.f32);
  /** What may be offered here: the 4B only where it looks strong enough. */
  const offered = () => BUILDS.filter((b) => b.size !== '4b' || gpu.tier === 'strong');
  /** The context asked for, and the one the running build has. */
  const wanted = contextFor(gpu.tier);
  /** The sizes whose long load failed in this page: loaded short from then on. */
  const fellShort = new Set<string>();
  const planned = (size: string) => (fellShort.has(size) ? SHORT : wanted);
  let context = 0;
  let short: Outgrown | null = null;
  /** The load's way past the GPU's check: see `past`. */
  let passed: Promise<boolean> = Promise.resolve(true);
  let pass: (ok: boolean) => void = () => {};
  /** The load under way, ended: see `settled`. Null with none. */
  let ending: Promise<boolean> | null = null;

  const appConfig = (): AppConfig => ({
    model_list: BUILDS.map((b) => {
      const v = variant(b);
      return {
        model: `https://huggingface.co/mlc-ai/${v.id}/resolve/${v.rev}/`,
        model_id: v.id,
        model_lib: `${LIBS}${libOf(v.id)}`,
        vram_required_MB: v.vram,
        low_resource_required: b.size === '0.8b',
        overrides: {context_window_size: SHORT, max_history_size: 1},
      };
    }),
  });

  const web = () => import('@mlc-ai/web-llm');

  async function cached(size: string): Promise<boolean> {
    const b = build(size);
    if (!b) return false;
    try {
      return await (await web()).hasModelInCache(variant(b).id, appConfig());
    } catch {
      return false;
    }
  }

  /* The same question, bounded and shared. Each read of `GET /machine` asks
     it of every size, and the panel reads every 0.7 s: in WebKit one ask is
     0.6 s on this Mac (10-10, headless, the 0.8B's cache), more on a phone,
     and asks that overlap only queue more behind them. One ask per size at a
     time, then; and one that takes longer than `checkMs` is answered with
     the last answer, or null -- not known -- so nothing that reads this
     waits on a storage that has stopped answering. */
  const asking = new Map<string, Promise<boolean>>();
  const knew = new Map<string, boolean>();
  const slowSaid = new Set<string>();
  function checked(size: string): Promise<boolean | null> {
    let ask = asking.get(size);
    if (!ask) {
      ask = cached(size).then((v) => { knew.set(size, v); return v; })
        .finally(() => asking.delete(size));
      asking.set(size, ask);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean | null>((go) => {
      timer = setTimeout(() => {
        if (!slowSaid.has(size)) {
          slowSaid.add(size);
          hatch.say(`llm: this browser's storage did not say within ${checkMs / 1000} s whether the ${size} `
            + 'model is in it — answered with what it last said', 'warn');
        }
        go(knew.get(size) ?? null);
      }, checkMs);
    });
    return Promise.race([ask, late]).finally(() => clearTimeout(timer));
  }

  /* The device under the model, lost (gpu-lost.ts, from the worker): the
     model is put down where it stands -- WebLLM has disposed of it already --
     and a reply in flight is ended with Lost rather than left waiting on a
     worker that will answer nothing more. The next ask starts it again from
     the cache (machine.ts). A device given up while the model is not up, or
     by our own stop, is not this. */
  function heardLost(info: {reason?: string; message?: string}): void {
    if (state !== 'ready' || stopping) return;
    hatch.say(`llm: the GPU let go of the model in this browser (${info.reason ?? '?'}`
      + `${info.message ? `: ${info.message}` : ''}) — it starts again from the cache on the next line`, 'warn');
    lose();
  }

  function lose(): void {
    lostIt = true;
    gone.fail(new Lost());
    putDown();
  }

  async function load(size: string, report?: (r: InitProgressReport) => void): Promise<void> {
    const b = build(size);
    if (!b) throw new Error(`no in-browser model called ${size}`);
    // Before anything is awaited, so a voice asked for in the same press waits on this load.
    passed = new Promise<boolean>((go) => { pass = go; });
    let end: (up: boolean) => void = () => {};
    ending = new Promise<boolean>((go) => { end = go; });
    short = null;
    /* A load that says nothing for `loadQuietMs` is stuck -- a worker the
       browser stopped, a fetch that never ends -- and is put down, its
       reason said, rather than left for a line to wait on for good. */
    let fail: (e: Error) => void = () => {};
    const stuck = new Promise<never>((_, no) => { fail = no; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new LoadStuck(loadQuietMs)), loadQuietMs);
    };
    heard();
    try {
      await Promise.race([loadIn(b, (r) => { heard(); report?.(r); }), stuck]);
      pass(true);
      end(true);
    } catch (e) {
      if (e instanceof LoadStuck) {
        hatch.say(`llm: ${e.message} — the load is put down`, 'warn');
        putDown();
      }
      short = outgrown(e);
      pass(!short);
      end(false);
      throw e;
    } finally {
      clearTimeout(timer);
      ending = null;
    }
  }

  async function loadIn(b: Build, report?: (r: InitProgressReport) => void): Promise<void> {
    const webllm = await web();
    if (engine && running === b.size) return;
    if (engine) {
      await engine.unload().catch(() => {});
    }
    state = 'loading';
    changed();
    /* Past the GPU's check once the weights are being read: WebLLM asks the
       device for its limits before it asks for a single weight. */
    const progress = (r: InitProgressReport) => {
      if (/param|cache\[/i.test(r.text)) pass(true);
      report?.(r);
    };
    const up = async (ctx: number) => {
      const opts = {context_window_size: ctx};
      if (!engine) {
        const w = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
        worker = w;
        gone = never();
        const made = await webllm.CreateWebWorkerMLCEngine(w, variant(b).id, {
          appConfig: appConfig(), initProgressCallback: progress, logLevel: 'WARN',
        }, opts);
        // Put down while it loaded (a load called stuck): not ours any more.
        if (worker !== w) throw new LoadStuck(loadQuietMs);
        /* The worker's own word that the device went, taken off before
           WebLLM's client, which knows no such message and throws at it. */
        const theirs = w.onmessage;
        w.onmessage = function (this: Worker, ev: MessageEvent) {
          const m = ev.data as {lucid?: string; reason?: string; message?: string} | null;
          if (m?.lucid === 'gpu-lost') {
            if (worker === w) heardLost(m);
            return;
          }
          theirs?.call(this, ev);
        };
        engine = made;
      } else {
        engine.setInitProgressCallback(progress);
        await engine.reload(variant(b).id, opts);
      }
      context = ctx;
    };
    try {
      await up(planned(b.size));
    } catch (e) {
      /* A long context that would not load -- the device lost for memory,
         most often -- is loaded short, in a worker of its own so nothing of
         the failed device is kept. What came down is in the cache, so this
         reads it rather than downloading it again (measured: no request for
         a weight the second time). A limit the GPU falls short of is the
         same at any context and is not asked again. */
      if (planned(b.size) <= SHORT || outgrown(e) || e instanceof LoadStuck) throw e;
      fellShort.add(b.size);
      putDown();
      state = 'loading';
      changed();
      await up(SHORT);
    }
    running = b.size;
    state = 'ready';
    lostIt = false;
    changed();
  }

  /* One generation at a time. WebLLM's engine holds one conversation and
     its cache; two requests at once would each throw the other's away. */
  let queue: Promise<unknown> = Promise.resolve();

  /* A model that stopped answering, or whose GPU let go of it, is put down
     whole: its worker ended, which takes its GPU device, its lock and
     whatever it was stuck in with it, and the next chat starts it again from
     the cache (machine.ts asks `start` of an engine that is not ready). Only
     on a stall, a loss, and a long context that would not load -- nothing a
     working model does comes here. */
  function putDown(): void {
    worker?.terminate();
    worker = null;
    engine = null;
    running = '';
    state = 'off';
    changed();
  }

  /* The replies as the model wrote them, by what was shown of them. WebLLM
     goes on from its cache only when a request is the last one plus its
     answer plus one new line -- every message the same bytes. What comes
     back to it in the next request is what the page kept, which is the
     shown reply; this puts the written one back in its place, so a turn
     reads only what is new rather than the whole conversation again. */
  const written = new Map<string, string>();
  let last: Generation | null = null;

  const api: Engine = {
    gpu,
    status: () => state,
    size: () => running || chosen.size,
    here: async () => (await checked(running || chosen.size)) ?? false,
    vram: () => (state === 'ready' && build(running) ? variant(build(running)!).vram : 0),
    label: () => build(running || chosen.size)?.name ?? '',
    censored: () => build(running || chosen.size)?.censored ?? false,
    context: () => (state === 'ready' && context ? context : planned(running || chosen.size)),
    outgrown: () => short,
    past: () => passed,
    settled: () => ending,
    lost: () => lostIt,
    loseGpu() { worker?.postMessage({lucid: 'lose-gpu'}); },
    inUse: (size) => size === running || size === chosen.size
      || (fetch?.size === size && (fetch.state === 'fetching' || fetch.state === 'starting')),
    onChange(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    async offer() {
      const can = offered();
      const tier = suggestedFor(gpu.tier);
      const good = can.some((b) => b.size === tier) ? tier : can[0]?.size;
      return Promise.all(can.map(async (b) => {
        const here = await checked(b.size);
        return {size: b.size, repo: `mlc-ai/${variant(b).id}`, gb: b.gb,
                here: here ?? false, suggested: b.size === good, ...(here === null ? {unknown: true} : {})};
      }));
    },
    fetching: () => (fetch ? {...fetch} : null),
    last: () => last,
    fetch(size) {
      const b = build(size);
      if (!b || !offered().includes(b)) {
        return {size, state: 'error', error: `no in-browser model called ${size}`};
      }
      if (fetch && (fetch.state === 'fetching' || fetch.state === 'starting')) return {...fetch};
      fetch = {size, state: 'fetching', got_gb: 0, gb: b.gb};
      changed();
      /* Asked here, on the press that started a download: a gigabyte that the
         browser may throw away under storage pressure is a gigabyte somebody
         downloads twice. The answer is the browser's; nothing waits on it
         (keep.ts). */
      void keepDownloads();
      loading = load(size, (r) => {
        const loadingNow = /loading|shader|compil/i.test(r.text) && !/fetch/i.test(r.text);
        fetch = {size, state: loadingNow ? 'starting' : 'fetching',
                 got_gb: Math.round(b.gb * r.progress * 100) / 100, gb: b.gb, text: r.text};
        changed();
      }).then(() => {
        chosen.choose(size);
        knew.set(size, true);
        fetch = {size, state: 'done', got_gb: b.gb, gb: b.gb};
        changed();
      }, (e: unknown) => {
        state = 'error';
        const o = outgrown(e);
        fetch = {size, state: 'error', gb: b.gb,
                 error: o ? outgrownSaid(o) : e instanceof Error ? e.message : String(e)};
        changed();
      }).finally(() => { loading = null; });
      return {...fetch};
    },
    async start() {
      if (state === 'ready') return state;
      if (loading) {
        await loading.catch(() => {});
        return state;
      }
      const size = chosen.size;
      /* Not known -- a storage slow to answer -- is let try: the load reads
         the cache itself, and one that is stuck is called so. */
      if (!size || !offered().includes(build(size)!) || (await checked(size)) === false) {
        state = 'absent';
        changed();
        return state;
      }
      void keepDownloads();
      loading = load(size).catch((e: unknown) => {
        state = 'error';
        changed();
        throw e;
      }).finally(() => { loading = null; });
      await loading.catch(() => {});
      return state;
    },
    async stop() {
      if (!engine) return;
      stopping = true;
      try {
        await engine.unload().catch(() => {});
      } finally {
        stopping = false;
      }
      running = '';
      state = 'off';
      changed();
    },
    chat(body, signal) {
      return (async function* () {
        let free: () => void = () => {};
        const mine = new Promise<void>((go) => { free = go; });
        const before = queue;
        queue = before.then(() => mine);
        await before;
        /* Said to the page while the GPU is this reply's: a room drawing its
           3D at the screen's rate on the same GPU starves the browser's own
           paint, and a key typed while a reply streams took two to three
           frames to appear. The room eases off on this (see Room.tsx). */
        const busy = (on: boolean) => {
          if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('lucid:generating', {detail: on}));
          }
        };
        busy(true);
        /* A stream left unread, being read out: the next request waits for
           it to end rather than for this one's finally. See `finish`. */
        let after = null as Promise<void> | null;
        try {
          /* Asked once more of the model started afresh where the GPU let go
             of it before a word of this reply was out: the cache makes the
             start a few seconds, and the person is spared a failure that was
             nothing they did. Once: a GPU that loses it again is said. */
          /** Whether any of this reply has gone out to the reader. */
          let said = false;
          for (let attempt = 0; ; attempt++) {
            try {
              yield* once();
              return;
            } catch (e) {
              if (!lostShape(e) || signal?.aborted) throw e;
              if (engine) {
                /* Gone without the worker's word reaching us first: WebLLM
                   refusing a model it has disposed of, or a reply come back
                   empty. The same thing, and the same remedy. */
                hatch.say(`llm: the model in this browser is gone (${e instanceof Error ? e.message.slice(0, 120) : e})`
                  + ' — it starts again from the cache', 'warn');
                lose();
              }
              if (said) throw e instanceof Lost ? e : new Lost();
              if (attempt > 0) {
                /* Not a stall the next line wakes it from: said as a banner
                   (a Told), not quietly (NotAnswering). */
                throw new Told('this browser’s GPU let go of the pill again — reload the page to start it afresh');
              }
              const began = performance.now();
              if ((await api.start()) !== 'ready') {
                throw new Told('this browser’s GPU let go of the pill, and it would not start again — reload the page');
              }
              hatch.say(`llm: started again from the cache in ${((performance.now() - began) / 1000).toFixed(1)} s`
                + ' — that line is asked of it again', 'info');
            }
          }

          /** One ask of the model as it stands. */
          async function* once(): AsyncGenerator<string> {
            if (state !== 'ready' || !engine) throw new Error('no language model is running in this page');
            // Gone before it was asked: nothing to start, nothing to let go of.
            if (signal?.aborted) return;
            const asked = (body.messages as Array<{role: string; content: string}>).map((m) =>
              (m.role === 'assistant' && written.has(keyOf(m.content))
                ? {...m, content: written.get(keyOf(m.content))!} : m));
            const max = typeof body.max_tokens === 'number' ? Math.min(body.max_tokens, MOST_TOKENS) : MOST_TOKENS;
            const request = {
              messages: asked,
              stream: true,
              temperature: body.temperature as number | undefined,
              top_p: body.top_p as number | undefined,
              max_tokens: max,
              ...PENALTIES,
              /* Qwen is told not to think, which costs it nothing it needs for a
                 reply and saves the hundreds of tokens a thought would spend
                 before the first word. */
              extra_body: {enable_thinking: false},
              stream_options: {include_usage: true},
            } as ChatCompletionRequestStreaming;
            const began = performance.now();
            let first = 0;
            let usage: ChatCompletionChunk['usage'] | undefined;
            const live = engine;
            const dropped = gone.promise;
            /** A step of this reply: its words, a stall, or the device gone.
                Long until the first words, short once they flow (stall.ts). */
            let flowing = false;
            const step = <T>(p: Promise<T>) =>
              within(Promise.race([p, dropped]), flowing ? nextMs : stallMs, stalledHere);
            let stream: AsyncIterable<ChatCompletionChunk>;
            try {
              stream = (await step(live.chat.completions.create(request))) as AsyncIterable<ChatCompletionChunk>;
            } catch (e) {
              if (e instanceof Stalled) putDown();
              throw e;
            }
            const it = stream[Symbol.asyncIterator]();
            /* An abort -- Stop, a room left, or talk's refusal guard cutting a
               reply that opened as the model (conversation/refusal.ts there) --
               stops the worker, and the stream is read out below (`finish`):
               the next ask waits for that, not for the lock. */
            const stop = () => { void live.interruptGenerate(); };
            signal?.addEventListener('abort', stop);
            const clean = cleaner();
            /* Whether the stream ran out on its own. Anything else -- an
               abort, the reader gone, a throw -- leaves it to be read out. */
            let ended = false;
            try {
              while (!signal?.aborted) {
                const next = await step(it.next());
                if (next.done) { ended = true; break; }
                const chunk = next.value;
                if (chunk.usage) usage = chunk.usage;
                const delta = chunk.choices?.[0]?.delta?.content;
                if (!delta) continue;
                if (!first) first = performance.now();
                flowing = true;
                const out = clean.take(delta);
                if (out) { said = true; yield out; }
              }
              /* Run out with not one token written: no model that is working
                 answers that, and shown, it is a reply that is not there --
                 the pending dots gone and nothing in their place. What a
                 device going under a reply can leave. */
              if (ended && !clean.raw() && !usage?.completion_tokens) {
                throw new Lost('this browser’s GPU gave back an empty reply — say that again and it starts afresh');
              }
              if (ended) {
                const tail = clean.end();
                if (tail) { said = true; yield tail; }
              }
            } catch (e) {
              if (e instanceof Stalled) { ended = true; putDown(); }
              /* The device going can reach the page first as the reply's own
                 failure -- "Failed to execute 'mapAsync' on 'GPUBuffer'",
                 measured 10-10 -- with the worker's word a moment behind it:
                 a failure followed that closely by the loss is the loss. */
              const err = !(e instanceof Stalled) && !lostShape(e) && await lostWithin(dropped, LOST_GRACE_MS)
                ? new Lost() : e;
              /* Gone with the device: no worker is left to read out. */
              if (lostShape(err)) ended = true;
              throw err;
            } finally {
              signal?.removeEventListener('abort', stop);
              /* Not awaited here: a reader that let go is not kept waiting for
                 the read-out, only the next request is. A read-out that itself
                 sticks is a stall like any other. */
              if (!ended) {
                after = finish(it, () => live.interruptGenerate(), stallMs, dropped)
                  .catch(() => { if (engine === live) putDown(); });
              }
              /* Counts and seconds, never words: what the machine's llm.log
                 keeps, kept here for the console and for whoever measures. */
              const extra = (usage as {extra?: {prefill_tokens_per_s?: number;
                                                 decode_tokens_per_s?: number}} | undefined)?.extra;
              last = {
                prompt_tokens: usage?.prompt_tokens ?? 0,
                completion_tokens: usage?.completion_tokens ?? 0,
                first_s: first ? Math.round(first - began) / 1000 : null,
                total_s: Math.round(performance.now() - began) / 1000,
                prefill_tps: Math.round(extra?.prefill_tokens_per_s ?? 0),
                decode_tps: Math.round(extra?.decode_tokens_per_s ?? 0),
              };
              changed();
              const said = shownOf(clean);
              if (said) written.set(keyOf(said), clean.raw());
              if (written.size > 64) written.delete(written.keys().next().value!);
            }
          }
        } finally {
          busy(false);
          if (after) void after.then(free);
          else free();
        }
      })();
    },
  };
  return api;
}

/** How long after a reply's own failure the worker's word that the device
    went may come and still be its cause. */
const LOST_GRACE_MS = 400;

/** Whether `gone` fails within `ms`. */
function lostWithin(gone: Promise<never>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    gone.then(() => false, () => true),
    new Promise<boolean>((go) => { timer = setTimeout(() => go(false), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** A promise that only ever fails, when told to: a device's going, raced
    against every step of a reply. Never failing unseen. */
function never(): {promise: Promise<never>; fail: (e: Error) => void} {
  let fail: (e: Error) => void = () => {};
  const promise = new Promise<never>((_, no) => { fail = no; });
  promise.catch(() => {});
  return {promise, fail};
}

/** What a cleaner showed in all, which is what the page will keep. */
function shownOf(c: ReturnType<typeof cleaner>): string {
  const again = cleaner();
  return again.take(c.raw()) + again.end();
}
