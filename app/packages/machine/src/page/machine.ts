/* A machine that is this page.
 *
 * With nothing behind the page there is still everything a page asks the
 * machine for, and this answers it: the same routes, the same shapes, out of
 * this browser. `GET /machine` says what is loaded -- the language model, and
 * the voice and the ear when somebody has chosen them (voice.ts, ear.ts); a
 * room with no voice takes the path it already has and lets its words out at
 * a reading pace.
 * `/machine/chat` streams the model running in a worker (engine.ts) in the
 * frames mlx_lm sends. `/store/...` is store.ts, in IndexedDB. The lifecycle
 * routes do what they can: start loads the chosen model if it is here, stop
 * lets it go, and the ear and the voice are wanted and let go of as on a Mac.
 *
 * Put in front of the machine by `settle` (host.ts) when nothing answered the
 * page's first question, through the one seam every route goes through
 * (address.ts `call`). Nothing that asks knows it is not the Python.
 */
import {hatch} from '@lucid/shell';
import type {Answer} from '../address';
import type {Facts, PartsFetching} from '../status';
import {NotAnswering} from '../stall';
import {Told} from '../told';
import type {Engine} from './engine';
import {CHECK_MS, outgrownSaid, WORDS_HOLDINGS} from './engine';
import type {Holding} from './forget';
import {forget} from './forget';
import type {Drawer} from './store';
import {storeAnswer} from './store';
import {exported, FIRST, imported} from './userdata';
import type {PageEar} from './ear';
import type {EarId} from './ear-models';
import {EAR_HOLDINGS} from './ear-models';
import type {PageVoice} from './voice';
import {VOICE_HOLDINGS} from './voice-models';
import type {EngineId} from './voice-worker';

/** Every model this page can keep, and what of the caches is each one's. */
const HOLDINGS: readonly Holding[] = [...WORDS_HOLDINGS, ...VOICE_HOLDINGS, ...EAR_HOLDINGS];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

async function asked(init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    const b = init?.body;
    const got = JSON.parse(typeof b === 'string' ? b : b ? await new Response(b).text() : '{}') as unknown;
    return got && typeof got === 'object' ? got as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function pageMachine(engine: Engine | null, drawer: Drawer, who = FIRST,
                            voice: PageVoice | null = null,
                            /* With no engine, why not, in a line. */
                            none = 'this browser has no WebGPU to run a model on',
                            ear: PageEar | null = null): Answer {
  const store = storeAnswer(drawer, () => who);
  commands(engine, drawer, who, none);

  const facts = async (): Promise<Facts> => {
    const llm = engine?.status() ?? 'absent';
    /* A load that found the GPU short of a limit: nothing more is offered,
       and the card says why in the engine's words (engine.ts `outgrown`). */
    const short = engine?.outgrown() ?? null;
    const mb = engine?.vram() ?? 0;
    /* What the cache holds of the ears, asked once: a microphone pressed in
       the first second is not sent to the panel for an ear already here.
       Waited on no longer than the words' own check (engine.ts `checked`):
       nothing this answers may hang on a storage that stopped answering --
       the models panel and the room's lamps are read off it. */
    /* Asked side by side, each bounded: a storage that stopped answering
       costs one wait, not one per question. */
    const words = engine && !short;
    const [here, offer] = await Promise.all([
      words && engine.size() ? engine.here() : Promise.resolve(false),
      words ? engine.offer() : Promise.resolve([]),
      ear ? upTo(ear.known(), CHECK_MS) : null,
    ]);
    return {
      status: {llm, stt: ear?.status() ?? 'off', tts: voice?.status() ?? 'off'},
      grace: {stt: ear?.grace() ?? null, tts: voice?.grace() ?? null},
      /* The panel's other sections: the voices this GPU can run, the ears
         this browser can, and how what was chosen there is coming down. */
      shelf: {voice: voice?.parts() ?? [], ear: ear?.parts() ?? [],
              fetch: together(voice?.fetching() ?? null, ear?.fetching() ?? null)},
      vad: {},
      memory: {llm_gb: mb / 1024, app_gb: 0, voice_gb: 0, total_gb: mb / 1024},
      tts: voice?.stats() ?? {},
      llm: engine && !short ? {
        server: 'webllm',
        model: engine.label(),
        size: engine.size(),
        sizes: {},
        here,
        offer,
        fetch: engine.fetching(),
        last: engine.last(),
        censored: engine.censored(),
      } : short ? {here: false, offer: [], fetch: null, why: 'limits', said: outgrownSaid(short)}
        : {here: false, offer: [], fetch: null, why: 'webgpu'},
    };
  };

  /* The one row of lamps a page with no machine has: the model in this
     browser. Said to the console here, on every change, the way the machine
     says its own over the log socket. */
  const lamp = {ready: 'on', loading: 'busy', starting: 'busy', error: 'bad'} as Record<string, string>;
  const report = () => hatch.report({
    app: 'machine', name: 'This browser',
    parts: [{name: 'LLM', state: lamp[engine?.status() ?? ''] ?? 'off',
             title: engine ? `llm: ${engine.status()}` : none},
            {name: 'STT', state: lamp[ear?.status() ?? ''] ?? 'off',
             title: !ear ? 'this browser cannot run an ear'
               : ear.chosen() ? `stt: ${ear.card()?.name}, ${ear.status()}`
                 : 'no ear chosen in this browser — the microphone\'s section of the models panel'},
            {name: 'TTS', state: lamp[voice?.status() ?? ''] ?? 'off',
             title: voice?.chosen() ? `tts: ${voice.card()?.name}, ${voice.status()}`
               : 'no voice chosen in this browser — the switch beside the mute, or /voice_engine'}],
    facts: [engine?.outgrown() ? 'WebGPU too limited'
      : engine?.label() || (engine ? 'no model yet' : 'no WebGPU')],
  });
  engine?.onChange(report);
  voice?.onChange(report);
  ear?.onChange(report);
  /* And each generation, in counts and seconds, the way the machine's
     llm.log keeps them: the one thing anybody asks about a small model in a
     browser is how long the first word took and why. */
  let told: unknown = null;
  /* And a load that found this GPU short of a limit, once, in WebLLM's
     names: what a person reporting it can paste. */
  let short: unknown = null;
  engine?.onChange(() => {
    const o = engine.outgrown();
    if (o && o !== short) {
      short = o;
      hatch.say(`llm: WebLLM asked this browser's WebGPU for ${o.limit} ${o.requested}, and it gives `
        + `${o.given} — nothing past the model's kernels was downloaded`, 'warn');
    }
  });
  engine?.onChange(() => {
    const g = engine.last();
    if (!g || g === told) return;
    told = g;
    hatch.say(`llm: ${g.prompt_tokens} prompt tokens, first word ${g.first_s ?? '—'} s, `
      + `${g.completion_tokens} tokens in ${g.total_s} s (prefill ${g.prefill_tps}/s, `
      + `decode ${g.decode_tps}/s)`, 'debug');
  });
  report();

  return async (path, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = path.split('?')[0] ?? '';
    if (route.startsWith('/store/')) return store(path, init);

    switch (`${method} ${route}`) {
      case 'GET /machine':
        return json(await facts());
      case 'POST /machine/ping':
        return json({status: (await facts()).status});
      case 'POST /machine/models/start':
        await engine?.start();
        return json((await facts()).status);
      case 'POST /machine/models/stop':
        await engine?.stop();
        return json((await facts()).status);
      case 'POST /machine/models/stt': {
        /* The microphone turned on: the ear chosen in this browser is loaded
           from its cache. Off: kept for the machine's grace, a microphone
           going off between two sentences, then let go of (see ear.ts). */
        const {wanted} = await asked(init);
        if (ear && typeof wanted === 'boolean') ear.want(wanted);
        return json({status: ear?.status() ?? 'off', grace: ear?.grace() ?? null});
      }
      case 'POST /machine/models/tts': {
        /* A room wanting its voice is the moment to load the one chosen in
           this browser, from its cache; one that never chose has none. Not
           wanted -- the room gone silent -- is kept for the machine's grace,
           a mute being often a flinch, and then let go of (see voice.ts). */
        const {wanted} = await asked(init);
        if (voice && typeof wanted === 'boolean') voice.want(wanted);
        return json({status: voice?.status() ?? 'off', grace: voice?.grace() ?? null});
      }
      case 'POST /machine/models/warm': {
        /* The voice's conditioning for a clip, made while somebody is still
           looking at the room rather than on the first sentence. */
        const body = await asked(init);
        if (body.kind === 'voice' && voice && typeof body.voice === 'string') {
          voice.warm(body.voice);
          return json({warmed: ['voice']});
        }
        /* Nothing else is warmed. A warm is a prompt sent for its cache, and
           this engine keeps one conversation: the warm would be the
           conversation the next turn finds, and then not the one it is. */
        return json({warmed: []});
      }
      case 'POST /machine/models/llm':
      case 'POST /machine/models/fetch': {
        if (!engine) return json({error: none}, 409);
        /* The card's whole download, as the machine takes it: a size, the
           voice beside it (an engine, or '' for none), the ear (an ear, or
           '' for none), or any of them alone. */
        const {size, voice: engineId, ear: earId} = await asked(init);
        const named = typeof engineId === 'string';
        const heard = typeof earId === 'string';
        if (heard && ear) ear.get(earId as EarId | '');
        if (typeof size === 'string') {
          const got = engine.fetch(size);
          /* The voice for these words once the words are past the GPU's
             check: a browser whose GPU falls short of the model's limits
             downloads no voice for words it cannot run. */
          if (named && voice) {
            void engine.past().then((ok) => { if (ok) voice.get(engineId as EngineId | ''); });
          }
          return json(got);
        }
        if (named && voice) voice.get(engineId as EngineId | '');
        if (named || heard) {
          return json(together(named ? voice?.fetching() ?? null : null, heard ? ear?.fetching() ?? null : null)
            ?? {state: 'done'});
        }
        return json({error: 'say which size'}, 400);
      }
      case 'POST /machine/models/forget': {
        /* The models panel's delete: what it frees (dry), or the model's
           files out of this browser's caches (forget.ts). Never the one in
           use -- the words running or chosen, the voice or the ear switched
           on, anything coming down: the panel offers it no delete, and to
           free it another is chosen first, as the panel already lets a
           person do. Then the voice and the ear are told, so their rows
           say downloadable again; the words' are asked of WebLLM each read. */
        const {part, id, dry} = await asked(init);
        if (typeof id !== 'string' || (part !== 'llm' && part !== 'voice' && part !== 'ear')) {
          return json({error: 'say which model'}, 400);
        }
        const using = part === 'llm' ? engine?.inUse(id) ?? false
          : part === 'voice' ? voice?.inUse(id as EngineId) ?? false : ear?.inUse(id as EarId) ?? false;
        if (using) return json({error: 'that one is in use — choose another first'}, 409);
        const key = `${part}:${id}`;
        if (!HOLDINGS.some((h) => h.key === key)) return json({error: `no model called ${id}`}, 404);
        try {
          const got = await forget(HOLDINGS, key, {dry: dry === true});
          if (dry !== true) {
            if (part === 'voice') voice?.forgot(id as EngineId);
            if (part === 'ear') ear?.forgot(id as EarId);
            hatch.say(`deleted ${id} from this browser: ${got.files} files, ${(got.bytes / 1e6).toFixed(0)} MB`, 'info');
          }
          return json(got);
        } catch (e) {
          return json({error: e instanceof Error ? e.message : String(e)}, 500);
        }
      }
      case 'GET /machine/voices':
        return json({voices: voice?.voices() ?? [], tags: voice ? [...voice.tags()] : []});
      case 'POST /machine/chat':
        return chat(engine, init);
    }
    if (method === 'GET' && route === '/machine/assets/sounds') return json({assets: []});
    if (method === 'GET' && route === '/machine/assets/figures') return json({assets: []});
    if (route.startsWith('/machine/assets/')) return json({error: 'no shelf in a browser'}, 404);
    return json({error: `${method} ${route} — there is no machine behind this page`}, 404);
  };
}

/** A chat turn, in the frames mlx_lm sends: `data: {choices:[{delta}]}`
    lines, then `data: [DONE]`. A failure mid-stream is a frame carrying
    `error`, which is what the machine sends too. */
async function chat(engine: Engine | null, init?: RequestInit): Promise<Response> {
  if (!engine || engine.status() !== 'ready') {
    const lost = engine?.lost() ?? false;
    const began = performance.now();
    if (engine && (await engine.start()) === 'ready') {
      if (lost) {
        hatch.say(`llm: started again from the cache in ${((performance.now() - began) / 1000).toFixed(1)} s, `
          + 'after the GPU let go of it', 'info');
      }
      return chat(engine, init);
    }
    /* Put down when the GPU let go of it, and not started again: said as
       the reply, in the page's words, not as a model nobody chose. */
    if (engine?.lost()) {
      return said(new Told('this browser’s GPU let go of the pill, and it would not start again — reload the page'));
    }
    /* A download or a load that failed: why, rather than a model nobody chose. */
    const f = engine?.fetching();
    if (f?.state === 'error' && f.error) {
      return said(new Told(`the pill did not come up in this browser: ${f.error} — the models panel tries again`));
    }
    return json({error: 'no language model is running in this browser — choose one first'}, 503);
  }
  const body = await asked(init);
  const signal = init?.signal ?? undefined;
  const words = engine.chat(body, signal);
  const encode = new TextEncoder();
  const frame = (o: unknown) => encode.encode(`data: ${JSON.stringify(o)}\n\n`);
  let it: AsyncIterator<string> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async pull(out) {
      it ??= words[Symbol.asyncIterator]();
      try {
        const next = await it.next();
        if (next.done) {
          out.enqueue(encode.encode('data: [DONE]\n\n'));
          out.close();
          return;
        }
        out.enqueue(frame({choices: [{delta: {content: next.value}}]}));
      } catch (e) {
        /* The page's own words carry `told`, for the room to show them
           (see told.ts); anything else is the console's. A model that
           stopped answering -- stalled, or the GPU let go of it -- says so
           as well, for the room to say quietly while it is woken (stall.ts). */
        out.enqueue(frame({error: e instanceof Error ? e.message : String(e),
                           ...(e instanceof Told ? {told: true} : {}),
                           ...(e instanceof NotAnswering ? {not_answering: true} : {})}));
        out.enqueue(encode.encode('data: [DONE]\n\n'));
        out.close();
      }
    },
    async cancel() {
      /* The reader went away: somebody pressed stop, or the room was left.
         Ending the iterator ends the generation -- see engine.ts. */
      await it?.return?.(undefined);
    },
  });
  return new Response(stream, {status: 200, headers: {'Content-Type': 'text/event-stream'}});
}

/** A reply that is only a failure, in the page's own words: the frames a
    stream that failed at once would send. */
function said(e: Told): Response {
  const body = `data: ${JSON.stringify({error: e.message, told: true})}\n\ndata: [DONE]\n\n`;
  return new Response(body, {status: 200, headers: {'Content-Type': 'text/event-stream'}});
}

/** A wait, given up after `ms`: what it was waiting for is left to finish. */
function upTo(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.then(() => {}, () => {}), new Promise<void>((go) => { timer = setTimeout(go, ms); })])
    .finally(() => clearTimeout(timer));
}

/** The voice's fetch and the ear's, as the one bar the panel draws: the
    bytes of both, fetching while either is, an error if either failed. */
export function together(a: PartsFetching | null, b: PartsFetching | null): PartsFetching | null {
  if (!a || !b) return a ?? b;
  const state = a.state === 'error' || b.state === 'error' ? 'error'
    : a.state === 'fetching' || b.state === 'fetching' ? 'fetching' : 'done';
  const error = a.error ?? b.error;
  return {state, got_gb: +((a.got_gb ?? 0) + (b.got_gb ?? 0)).toFixed(3), gb: +((a.gb ?? 0) + (b.gb ?? 0)).toFixed(3),
    ...(error ? {error} : {})};
}

// ---- the console ------------------------------------------------------------

/* What the machine's console offers that means something here, by the same
   names (machine.py, store.py), and the two that only a browser needs: its
   userdata/ out as a zip and back in. Not the microphone's two orders
   (/mic_barge, /mic_follow): they are the machine's console's, and a page with
   none listens by their defaults -- talking over a reply stops it where the
   browser cancels its echo, and the microphone rests while the page is hidden. */
function commands(engine: Engine | null, drawer: Drawer, who: string, none: string): void {
  hatch.command('ai_model_size', 'which size of language model to run', async (rest) => {
    if (!engine) return none;
    const offer = await engine.offer();
    const want = rest.trim();
    const have = offer.filter((o) => o.here).map((o) => o.size).join(', ') || 'none';
    if (!want) return `running ${engine.status() === 'ready' ? engine.size() : 'nothing'}; in this browser: ${have}`;
    const it = offer.find((o) => o.size === want);
    if (!it) return `no size called '${want}' — ${offer.map((o) => o.size).join(', ')}`;
    if (!it.here) return `the ${want} model is not in this browser — /model_choose in a room downloads it`;
    engine.fetch(want);
    return `switching to ${want}…`;
  }, {args: '0.8b|2b|4b'});
  hatch.command('ai_models_start', 'load the language model', async () => {
    if (!engine) return none;
    return `the language model is ${await engine.start()}`;
  });
  hatch.command('ai_models_stop', 'unload it and give the memory back', async () => {
    if (!engine || engine.status() !== 'ready') return 'nothing is running';
    await engine.stop();
    return 'stopped';
  });
  hatch.command('files_where', 'where a game keeps what you have done with it', () =>
    `in this browser (IndexedDB), as userdata/ is on a Mac: players/${who}/<game>/… and `
    + 'config.json — /files_export writes it out as a zip, ?user=<name> in the address '
    + 'changes who is playing');
  hatch.command('files_export', 'everything this browser keeps, as a zip of userdata/', async () => {
    const zip = await exported(drawer);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip], {type: 'application/zip'}));
    a.download = `lucid-userdata-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return `${a.download}, ${Math.round(zip.length / 1024)} KB`;
  });
  hatch.command('files_import', 'a zip of userdata/, or of one player\'s folder, into this browser',
    (rest) => {
      const replace = rest.trim() === 'replace';
      const pick = document.createElement('input');
      pick.type = 'file';
      pick.accept = '.zip,application/zip';
      pick.onchange = () => {
        const file = pick.files?.[0];
        if (!file) return;
        void file.arrayBuffer().then((buf) => imported(drawer, new Uint8Array(buf), {replace}))
          .then((got) => {
            hatch.say(`${file.name}: ${got.added.length} added, ${got.same.length} already here, `
              + `${got.replaced.length} replaced, ${got.kept.length} kept as they were`
              + (got.kept.length ? ' (they differ — /files_import replace takes the zip\'s)' : '')
              + `, ${got.refused.length} refused`);
            for (const k of got.kept) hatch.say(`kept this browser's ${k}`, 'warn');
            for (const r of got.refused) hatch.say(`refused ${r.name}: ${r.why}`, 'warn');
          }, (e: unknown) => hatch.say(`could not read ${file.name}: ${e instanceof Error ? e.message : e}`,
                                       'error'));
      };
      document.body.append(pick);
      pick.hidden = true;
      pick.click();
      setTimeout(() => pick.remove(), 60_000);
      return replace ? 'choose a zip — what differs is taken from it' : 'choose a zip';
    }, {args: '[replace]'});
}
