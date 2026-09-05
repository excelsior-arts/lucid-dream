/* What the machine is doing, and the three ways of telling it what to do with
   itself. All of it is `GET /machine` and four posts -- see machine/machine.py.

   None of this is a conversation. It is the lamps at the top of the console,
   the meter beside them, and the watchdog being told somebody is still here. */
import {machine as at} from './address';
import type {Stats} from './tts';

export type ModelStatus = 'ready' | 'loading' | 'starting' | 'error' | 'off';

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
  tts: Stats;
  llm?: {port?: number; server?: string; model?: string;
         /** Which size is in use, and which sizes are on this Mac. */
         size?: string; sizes?: Record<string, boolean>};
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(at() + path, init);
  if (!res.ok) throw new Error('the machine answered ' + res.status + ' to ' + path);
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) => json<T>(path, {
  method: 'POST',
  ...(body === undefined ? {} : {
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }),
});

/** What is loaded, what it costs, and what the voice last managed. */
export const status = (): Promise<Facts> => json<Facts>('/machine');

/** The voices this machine can speak in, by name.
 *
 * A voice is a model asset like any other -- a clip under models/voices/,
 * fetched with the weights -- so what can be spoken in is a fact about the
 * machine and not about any game. A game asks so it can say, before a word is
 * generated, that the character somebody just took has no voice here. */
export const voices = (): Promise<string[]> =>
  json<{voices: string[]}>('/machine/voices').then((r) => r.voices ?? []);

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
    // `off` counts as gone rather than as not-yet: the load either never
    // started or has been given up on, and either way nothing is coming.
    if (now === 'error' || now === 'off') return false;
    if (Date.now() >= until) return false;
    await new Promise((go) => setTimeout(go, every));
  }
}
