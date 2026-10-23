/* What the machine is doing, and the three ways of telling it what to do with
   itself. All of it is `GET /machine` and four posts -- see machine/machine.py.

   None of this is a conversation. It is the lamps at the top of the console,
   the meter beside them, and the watchdog being told somebody is still here. */
import {host, setHost} from '@lucid/shell';
import {call} from './address';
import type {Stats} from './tts';

/** `absent` is a language model with nothing on disk (or in this browser) to
    start: a machine that has never had one chosen. See `Offer`. */
export type ModelStatus = 'ready' | 'loading' | 'starting' | 'error' | 'off' | 'absent';

/** One size of language model a page can choose, as the machine offers it:
    the manifest's three on a Mac, the in-browser builds on a page with no
    machine. `suggested` is the one for this device; `here` is one that needs
    no download. */
export interface Offer {
  size: string;
  /** Where it comes from: a repository on the Hugging Face hub. */
  repo: string;
  /** What it weighs to download, in GB. */
  gb: number;
  here: boolean;
  suggested: boolean;
  /** The browser's storage did not say in time whether it is here: `here`
      is then false, and the panel says it could not tell. */
  unknown?: boolean;
}

/** The voice or the ear, as the first-open card offers it beside the sizes:
    on a Mac the manifest's one of each (id `tts`, `stt`), in a browser the
    voice engines this GPU can run (id `turbo`, `nano`, `sopro`) and the ears
    it can (EARS in page/ear.ts). */
export interface Part {
  id: string;
  name: string;
  /** What it weighs to download, in GB. */
  gb: number;
  here: boolean;
  suggested: boolean;
  /** The one in use: in a browser, the engine chosen there. A Mac has one of
      each, in use whenever it is here, and does not say. */
  using?: boolean;
  /** Why it would not come down or start in this browser, in plain words,
      since it last tried; absent once it is up, or tried again. */
  error?: string;
}

/** How a fetch of the voice or the ear is going: the whole of what was
    asked for, in GB. */
export interface PartsFetching {
  state: 'fetching' | 'done' | 'error';
  got_gb?: number;
  gb?: number;
  error?: string;
}

/** One generation, measured: tokens read and written, seconds to the first
    word and in all, and WebLLM's own rates. A prompt read from the cache
    shows as few prompt tokens and a first word in a fraction of a second. */
export interface Generation {
  prompt_tokens: number;
  completion_tokens: number;
  first_s: number | null;
  total_s: number;
  prefill_tps: number;
  decode_tps: number;
}

/** How a fetch asked for from the first-open card is going: bytes down, then
    the model starting on them, then done -- or why not. */
export interface Fetching {
  size: string;
  state: 'fetching' | 'starting' | 'done' | 'error';
  got_gb?: number;
  gb?: number;
  /** A line from the downloader, where it says more than the bytes do. */
  text?: string;
  error?: string;
}

/** What this app is costing, in GB. Measured on a thread; a few seconds old. */
export interface MemoryUse {
  llm_gb: number;
  app_gb: number;
  voice_gb: number;
  total_gb: number;
}

/** The two the page has a say over: the ear and the voice. The language model
    is everybody's and is nobody's to let go of. */
export type Model = 'stt' | 'tts';

/** Everything `GET /machine` carries. `vad` is the numbers a page listens by;
    they are written down on the machine so the console can reach them and so
    they outlive a reload. */
export interface Facts {
  status: Partial<Record<'llm' | 'stt' | 'tts', ModelStatus>>;
  /** How long each of the two has before it is put away, in seconds, or null
      for one that is staying. Armed by `models.want(model, false)` and
      cancelled by anything that asks for the model. See machine/machine.py. */
  grace?: Partial<Record<Model, number | null>>;
  vad?: Record<string, number | string | boolean>;
  /** The microphone's two standing orders, which are the machine's for the
      same reason the thresholds are: whether talking over a reply stops it,
      and what the mic does when the window goes away. The listening is the
      page's; where the orders are written down is not. */
  mic_barge?: 'auto' | 'on' | 'off';
  mic_follow?: 'focus' | 'hidden' | 'never';
  memory_mb?: number;
  memory: MemoryUse;
  /** What the first-open card offers beside the language model: the voices
      and the ears there are to fetch, and how a fetch of them is going. */
  shelf?: {voice: Part[]; ear: Part[]; fetch: PartsFetching | null};
  tts: Stats;
  llm?: {port?: number; server?: string; model?: string;
         /** Which size is in use, and which sizes are on this Mac. */
         size?: string; sizes?: Record<string, boolean>;
         /** Whether the model in use is on disk at all, what could be fetched
             instead, this Mac's memory, and a fetch under way. What the
             first-open card in a room is drawn from. */
         here?: boolean; offer?: Offer[]; ram_gb?: number; fetch?: Fetching | null;
         /** A model in this browser: its last generation, in counts and seconds. */
         last?: Generation | null;
         /** Whether the model in use is one that sometimes answers as the
             model rather than as the character: models.json's `censored` on
             a Mac, the build's in a browser (page/engine.ts). Absent is
             false. Kept as host().censored -- see `status`. */
         censored?: boolean;
         /** Why nothing is offered, where nothing can be: `webgpu`, a page
             whose browser has no GPU to run a model on; `limits`, one whose
             GPU fell short of a limit the model asked it for when it tried
             (Firefox's nine storage buffers a shader, where WebLLM asks for
             ten), and `said`, that in the page's words. */
         why?: string; said?: string};
}

/* Who answered: the machine, or -- with nothing behind the page -- this
   browser's stand-in for it (see page/machine.ts). */
const answered = (res: Response, path: string): Error =>
  new Error(`${host().machine ? 'the machine' : 'this browser'} answered ${res.status} to ${path}`);

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await call(path, init);
  if (!res.ok) throw answered(res, path);
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) => json<T>(path, {
  method: 'POST',
  ...(body === undefined ? {} : {
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }),
});

/** What is loaded, what it costs, and what the voice last managed.
 *
 * And, on the way past, whether the model in use is a censored one, kept as
 * host().censored for a game to read without asking: every read of this --
 * the room's poll, the wait for a model to come up after a size is chosen,
 * the models panel -- says it, so it follows the model. A machine that does
 * not say is a model nobody has said it of. */
export async function status(): Promise<Facts> {
  const facts = await json<Facts>('/machine');
  const censored = facts.llm?.censored === true;
  if (host().censored !== censored) setHost({censored});
  return facts;
}

/** The voices this machine can speak in, by name.
 *
 * A voice is a model asset like any other -- a clip under models/voices/,
 * fetched with the weights -- so what can be spoken in is a fact about the
 * machine and not about any game. A game asks so it can say, before a word is
 * generated, that the character somebody just took has no voice here. */
export const voices = (): Promise<string[]> => shelf().then((r) => r.voices);

/** The voices, and the delivery tags the voice performs -- "[laugh]",
 * "[sigh]" -- read off its tokenizer by the machine whether it is loaded or
 * not. Empty for a voice that performs none: the machine strips every tag
 * before such a voice, so a game asks for them only when there are some. */
export const shelf = (): Promise<{voices: string[]; tags: string[]}> =>
  json<{voices?: string[]; tags?: string[]}>('/machine/voices')
    .then((r) => ({voices: r.voices ?? [], tags: r.tags ?? []}));

/** What is on one of the machine's asset shelves, by name -- the sounds, the
    figures -- and one of them as bytes for the page to decode. Files somebody
    made, not synthesis: what is there is what was put on the shelf, and a
    name that is not is null and not an error, because a game without an
    asset is the same game with the asset off. */
export type AssetKind = 'sounds' | 'figures';

export const assets = (kind: AssetKind): Promise<string[]> =>
  json<{assets: string[]}>(`/machine/assets/${kind}`).then((r) => r.assets ?? []);

export const asset = (kind: AssetKind, name: string): Promise<ArrayBuffer | null> =>
  bytes(`/machine/assets/${kind}/${encodeURIComponent(name)}`);

export async function bytes(path: string): Promise<ArrayBuffer | null> {
  const res = await call(path);
  if (res.status === 404) return null;
  if (!res.ok) throw answered(res, path);
  return res.arrayBuffer();
}

/** Somebody is still there. Feeds the idle watchdog and nothing else -- a page
    in the middle of a long reply is using the machine whether or not it has
    called anything for a minute. */
export const ping = (): Promise<{status: Facts['status']}> =>
  post<{status: Facts['status']}>('/machine/ping');

export interface WarmBody {
  /** `voice` warms the kernels and the speaker conditioning; anything else is
      one prompt sent through with nothing to say, so its prefill is in the
      server's cache before the first real turn needs it. */
  kind?: string;
  /** Which voice, for `kind: 'voice'`. The conditioning is per clip, so a warm
      that names nobody has nothing to warm and warms nothing. */
  voice?: string;
  messages?: Array<{role: string; content: string}>;
  system?: string;
}

export const models = {
  /** The language model, which every page wants and no page holds. */
  start: (): Promise<Facts['status']> => post<Facts['status']>('/machine/models/start'),
  stop: (): Promise<Facts['status']> => post<Facts['status']>('/machine/models/stop'),
  warm: (body: WarmBody = {}): Promise<{warmed: string[]}> =>
    post<{warmed: string[]}>('/machine/models/warm', body),
  /** Say that this page is using the ear or the voice, or has stopped.
   *
   * What it is not is a load and an unload wearing softer words. Wanted, the
   * model is started and this comes straight back — a model is fifteen seconds
   * and the press that asked for it has to answer now, so `awaitReady` below
   * is what waits. Not wanted, nothing is unloaded: the machine starts a grace
   * of its own, because a microphone goes off between two sentences. The
   * policy is the machine's and this only says what the page is doing. */
  want: (model: Model, wanted: boolean): Promise<Wanted> =>
    /* Two addresses written out, rather than one assembled from the name. A
       path built out of a variable is a path nothing can check: the wiring
       test reads every address this file asks for and holds it against the
       routes the machine hangs, and a concatenation reads as neither of
       them. See tests/machine/test_wiring.py. */
    (model === 'stt' ? post<Wanted>('/machine/models/stt', {wanted})
                     : post<Wanted>('/machine/models/tts', {wanted})),
  /** Run another size of the language model. The choice is the machine's to
      write down and the load takes what a load takes; `awaitReady('llm')`
      is what waits. The dial's `llm.size` and `llm.sizes` say what is up and
      what is on this Mac to choose from. */
  size: (size: string): Promise<{status: string; size: string}> =>
    post<{status: string; size: string}>('/machine/models/llm', {size}),
  /** Bring a size onto this machine and run it -- the first-open card's
      download. Answers at once; `status().llm.fetch` says how it is going. */
  fetch: (size: string): Promise<Fetching> => post<Fetching>('/machine/models/fetch', {size}),
  /** The card's whole download: a size (or none, to leave the language model
      as it is), and the voice and the ear beside it -- `voice` the row's id,
      '' for none; `ear` true to bring it down on a Mac, and in a browser
      the ear's id, '' for none. One request, the same route. */
  fetchAll: (o: {size?: string; voice?: string; ear?: boolean | string}): Promise<unknown> =>
    post<unknown>('/machine/models/fetch', o),
};

/** What the machine says to a `want`: where that model is now, and how long it
    has left if it is on its way out. */
export interface Wanted {
  status: ModelStatus;
  grace: number | null;
}

/** How often to ask whether it is up yet, and how long to go on asking. Half a
    second is well under the time anybody notices; two minutes is longer than a
    cold recognizer has ever taken and short enough that a page which is never
    going to hear anything says so rather than waiting all evening. */
export const READY_EVERY_MS = 500;
export const READY_TIMEOUT_MS = 120000;

/** Wait for a model to come up. False if it will not, rather than a throw:
 *  a key that cannot arm is a thing to say in the console, not an exception to
 *  carry up through a press.
 *
 * Polled rather than pushed, because that is what `GET /machine` is: the same
 * read the lamps at the top of every console are already doing. */
export async function awaitReady(model: Model | 'llm', o: {
  every?: number; timeout?: number;
} = {}): Promise<boolean> {
  const every = o.every ?? READY_EVERY_MS;
  const until = Date.now() + (o.timeout ?? READY_TIMEOUT_MS);
  for (;;) {
    let now: ModelStatus | undefined;
    try {
      now = (await status()).status[model];
    } catch {
      now = undefined;                 // the machine missed one; ask again
    }
    if (now === 'ready') return true;
    // `off` counts as gone rather than as not-yet, and so does `absent`: the load either never
    // started or has been given up on, and either way nothing is coming.
    if (now === 'error' || now === 'off' || now === 'absent') return false;
    if (Date.now() >= until) return false;
    await new Promise((go) => setTimeout(go, every));
  }
}
