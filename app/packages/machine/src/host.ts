/* What is behind this page, found out once, before anything is drawn.
 *
 * Asked of the machine rather than read off the address. The address says
 * nothing: a static host, a wrapper's file:// or app://, a sidecar on a
 * random port and the Python on 6969 are all possible for every shape this
 * ships in. So the page asks its one cheap question -- `GET /machine`, what is
 * loaded -- and a machine that answers it in its own words is a machine.
 * Anything else (the static host's 404 page, a refused connection, a file://
 * that cannot fetch at all, no answer within the wait) is no machine, and
 * this page becomes its own: the stand-in in page/ is put in front of the
 * routes, the words come from a model in this browser if it has a GPU to run
 * one, the files go into IndexedDB, and a voice and an ear are offered, each
 * a download somebody chooses in the models panel.
 *
 * A wrapper that knows better says so before this runs, on
 * `globalThis.__LUCID_HOST__` (a preload script's to set): `{machine: false}`
 * to skip the question, or any of the separate answers in @lucid/shell's Host
 * -- and `answer`, its own function for the routes, where it would rather
 * answer them itself (a native backend over its bridge). See AGENTS.md.
 */
import {askForCard, expose, hatch, host as hostNow, offerVoice, PAGE, setHost} from '@lucid/shell';
import type {Host} from '@lucid/shell';
import {heardBy} from '@lucid/audio';
import {answeredBy, call, machine} from './address';
import type {Answer} from './address';
import {voiceAnsweredBy} from './tts';
import {status} from './status';

/** How long the first question waits. Long enough for a machine busy loading a
    model, which still answers this from a thread; a static host's 404 comes
    back in a few milliseconds and never waits this out. */
export const ASK_MS = 6000;

interface Told extends Partial<Host> {
  answer?: Answer;
}

declare global {
  // A wrapper's word, set before the bundle runs.
  var __LUCID_HOST__: Told | undefined;
}

/** Whether a machine answers here, in its own words. */
export async function machineAnswers(wait = ASK_MS): Promise<boolean> {
  const quit = new AbortController();
  const timer = setTimeout(() => quit.abort(), wait);
  try {
    const res = await fetch(`${machine()}/machine`, {signal: quit.signal});
    if (!res.ok) return false;
    const got = (await res.json()) as {status?: unknown};
    return !!got && typeof got.status === 'object';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Find out, say so, and set the page up for it. Resolves with the answer. */
export async function settle(): Promise<Host> {
  const told = globalThis.__LUCID_HOST__ ?? {};
  if (told.answer) answeredBy(told.answer);
  /* A build made for a static host knows there is nothing behind it, and
     does not ask: the question would be a 404 in its own console on every
     load. */
  const there = told.machine ?? (told.answer ? true
    // As a string: Vitest hands a defined env value over as one.
    : String(import.meta.env.LUCID_STATIC) === 'true' ? false : await machineAnswers());
  if (there) {
    const said = setHost({...told, machine: true});
    // Asked of a machine found here; a wrapper that said what it is is taken at its word.
    if (told.machine === undefined && !told.answer && told.voice === undefined) {
      await heedShelf();
      return hostNow();
    }
    return said;
  }

  /* No machine: this page is the machine. The GPU first, because whether
     there is a model at all depends on it; then the files, which are kept
     whatever happens to the model. */
  const [{probeGpu, createEngine, unable, unableSaid}, {pageMachine}, {idbDrawer, memoryDrawer}, U, {createVoice},
    {canHear, createEar}, {anyModelKept, keepDownloads}] = await Promise.all([
    import('./page/engine'), import('./page/machine'), import('./page/store'), import('./page/userdata'),
    import('./page/voice'), import('./page/ear'), import('./page/keep'),
  ]);
  let drawer;
  try {
    drawer = typeof indexedDB === 'undefined' ? memoryDrawer() : idbDrawer();
  } catch {
    drawer = memoryDrawer();
  }
  /* userdata/, as the machine keeps it: who is playing (the browser's
     --user), what the first preview kept folded under them once, and the
     settings the model is chosen in. See page/userdata.ts. */
  const who = U.whoIsHere((line, level) => hatch.say(line, level));
  const moved = await U.settle(drawer).catch(() => 0);
  if (moved) hatch.say(`${moved} file(s) from before there were players moved under players/${U.FIRST}`);
  const cfg = U.settings(drawer);
  const config = await cfg.load();
  const chosen = {
    size: String(config.llm?.size ?? ''),
    choose(size: string) {
      this.size = size;
      void cfg.noteIn('llm', {size});
    },
  };
  /* The voice, beside it: whether it is on and which engine, the same file. */
  const spoken = {
    enabled: config.tts?.enabled === true,
    engine: String(config.tts?.engine ?? ''),
    choose(enabled: boolean, engine?: string) {
      this.enabled = enabled;
      if (engine) this.engine = engine;
      void cfg.noteIn('tts', engine ? {enabled, engine} : {enabled});
    },
  };
  /* And the ear, the same file again: whether the microphone has one in
     this browser and which. */
  const heard = {
    enabled: config.stt?.enabled === true,
    engine: String(config.stt?.engine ?? ''),
    choose(enabled: boolean, engine?: string) {
      this.enabled = enabled;
      if (engine) this.engine = engine;
      void cfg.noteIn('stt', engine ? {enabled, engine} : {enabled});
    },
  };
  /* Any GPU that is not a software one is let try: whether its limits are
     enough is WebLLM's to say, on the load, before any weight comes down
     (page/engine.ts `outgrown`). */
  const gpu = await probeGpu();
  const why = unable(gpu);
  const engine = why ? null : createEngine(gpu, chosen);
  /* And a voice, where there are words for it to speak: the same GPU, and a
     download of its own that nobody gets unless they ask (see page/voice.ts). */
  const voice = engine ? createVoice(gpu.f16, spoken, () => engine.settled()) : null;
  if (voice) voiceAnsweredBy(voice.socket);
  /* And an ear wherever WebAssembly runs: on the CPU, so not only where the
     words can run -- Firefox's ear works where its GPU will not run the
     words, and the room says it is the pill that cannot run there (see
     page/ear.ts). Offered, never fetched: the microphone's first press
     opens the models panel at it. */
  const ear = canHear() ? createEar(heard) : null;
  heardBy(ear ? ear.transcribe : null);
  answeredBy(pageMachine(engine, drawer, who, voice, unableSaid(), ear));
  // For a browser test, which asks the stand-in what it is doing the way a
  // page would. See debug.ts in @lucid/shell.
  expose('machine', {call});
  // And the words, whose GPU a browser test loses (Engine.loseGpu).
  if (engine) expose('engine', engine);
  // And the voice, whose grace a browser test shortens rather than waits out.
  if (voice) expose('voice', voice);
  if (ear) expose('ear', ear);
  expose('hatch', hatch);
  /* Whether the size in use or chosen here is a censored build -- all of them
     are, today (page/engine.ts) -- said as soon as it is known and again
     whenever the engine moves, a first size brought down among them. */
  const censored = () => engine?.censored() ?? false;
  /* And the context the words have, which the game's window follows
     (config.ts in @lucid/talk): the one asked for until a load says what it
     got. And a load that found this GPU short of a limit WebLLM asks for is
     a browser with no words, from then on in this page, the way one with no
     WebGPU is: the pill's mark, the dark Talk key, the card saying why. The
     next visit tries again -- a browser update may have lifted it. */
  engine?.onChange(() => {
    const now = hostNow();
    const llm = engine.outgrown() ? 'none' : now.llm;
    if (now.censored !== censored() || now.context !== engine.context() || now.llm !== llm) {
      setHost({censored: censored(), context: engine.context(), llm});
    }
  });
  const host = setHost({...PAGE, llm: engine ? 'page' : 'none', censored: censored(),
    context: engine?.context() ?? PAGE.context, ...told, machine: false,
    voice: voice?.status() === 'ready', ear: !!ear});
  hatch.say(`no machine behind this page — the words are this browser's, and ${who} is playing`
    + (engine ? '' : ` — but ${unableSaid()}`), 'info');
  /* What was downloaded on an earlier visit, kept: asked once an open where a
     model is in the cache and the storage is not yet persisted (keep.ts). */
  void anyModelKept().then((any) => (any ? keepDownloads({open: true}) : null));
  return host;
}

/** A machine without its voice on the shelf -- one set up text-only, or not
    finished -- speaks nothing (host().voice false: the words at a reading
    pace) and says so on the rail's voice switch, which opens the first-open
    card at its voice section. Asked again once the card has brought it down.
    A machine with everything on disk is told nothing and offered nothing. */
export async function heedShelf(): Promise<void> {
  let part;
  try {
    part = (await status()).shelf?.voice?.[0];
  } catch {
    return;
  }
  if (!part || part.here) {
    offerVoice(null);
    setHost({voice: true});
    return;
  }
  setHost({voice: false});
  offerVoice({
    on: false, missing: true, what: part.name, mb: Math.round(part.gb * 1000), state: 'off',
    set: () => {
      if (!askForCard('voice')) {
        hatch.say('the voice is not on this Mac — open a pill, and its card brings it down', 'warn');
      }
    },
  });
}
