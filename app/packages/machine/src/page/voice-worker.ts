/* The voice's own thread, when it runs in this page.
 *
 * Everything heavy about a voice -- the weights coming down, the GPU, a
 * sentence being made -- happens here and not on the thread that draws the
 * room and takes the typing. The page side (voice.ts) hands over one chunk of
 * a reply at a time and gets back what the machine's socket would have sent:
 * frames of signed 16-bit PCM in base64, then a done with the chunk's cost.
 *
 * A chunk is cut into its sentences here and each is made and sent on its own,
 * so the first one plays while the second is made. Never cut inside a
 * sentence: a sentence is the unit the voice is asked for on the machine too,
 * and one split in two is two intonations where there was one. Each is
 * brought to the Mac's Turbo's loudness before it goes (level.ts), whatever
 * the engine.
 *
 * Three engines, every one cloning from the pill's own clip, chosen by the
 * page (see ENGINES in voice.ts for what each weighs and how it measured):
 *
 *   turbo   Chatterbox Turbo, Resemble's own ONNX export, through
 *           transformers.js -- the machine's voice, cloned from the same clip,
 *           with the same delivery tags performed. The precisions are the ones
 *           measured to hold: the decoder at q4 (fp16 and q4f16 there came out
 *           as mumble -- Parakeet heard 86% of the words wrong), the speech
 *           encoder at q4 as well, the rest at q4f16 where the GPU has
 *           shader-f16, q4 where it has not. The encoder at half precision
 *           (fp16 or q4f16) rushed: the clip it reads the voice's pace from
 *           came out of it as a faster speaker, and the lover spoke 21% faster
 *           than the machine's Turbo does from the same clip (5.08 syllables a
 *           second of speech against 4.21). Its weights at 4 bits and its
 *           arithmetic at full precision (q4) speak at the machine's pace,
 *           the lover 4.30 against its 4.21, for 52 MB more.
 *   nano    Chatterbox Nano, a community export of the 110M model, the same
 *           code; smaller, the same tags.
 *   sopro   Sopro v2 Turbo, its own runtime: clones from the same clip, no
 *           tags.
 *
 * Not Kokoro, which was measured beside them (clips only): it cannot clone,
 * and kokoro-js speaks through phonemizer, which carries eSpeak NG compiled
 * in -- GPL-3.0, the one kind of licence THIRD-PARTY.md keeps out of the
 * bundle.
 */
import type {
  ChatterboxModel as ChatterboxModelT, PreTrainedTokenizer, Tensor,
} from '@huggingface/transformers';
import type {SoproReference} from '@soprotts/onnx-web';
import {SENTENCE_END, hasWords} from '../speech';
import {leveller} from './level';
import {watchDevices} from './gpu-lost';
import {NANO, SOPRO, TURBO} from './voice-models';

/** What the page asks for a voice by: the clip to clone it from. */
export interface VoiceSpec {
  clip: string;
}

export type EngineId = 'turbo' | 'nano' | 'sopro';

export type ToWorker =
  | {type: 'load'; engine: EngineId; f16: boolean; mb: number}
  /** Down into the browser's cache and no further: no session, nothing on
      the GPU. For a voice chosen while nothing can be heard. */
  | {type: 'fetch'; engine: EngineId; f16: boolean; mb: number}
  /** Which of these are whole in the cache already. */
  | {type: 'check'; engines: Array<{engine: EngineId; mb: number}>; f16: boolean}
  | {type: 'warm'; voice: VoiceSpec}
  | {type: 'speak'; id: string; text: string; voice: VoiceSpec; paragraph: boolean; tags: string[]}
  | {type: 'drop'; ids: string[]}
  /** For a browser test: the GPU device destroyed, as a driver reset would
      lose it (gpu-lost.ts). */
  | {type: 'lose'};

export interface ChunkStats {
  gen_s: number;
  audio_s: number;
  rtf: number | null;
  words: number;
}

export type FromWorker =
  | {type: 'progress'; got: number}
  | {type: 'ready'; load_s: number}
  | {type: 'failed'; error: string}
  | {type: 'fetched'}
  | {type: 'checked'; here: EngineId[]}
  | {type: 'frame'; id: string; pcm: string; rate: number}
  | {type: 'done'; id: string; stats: ChunkStats}
  | {type: 'error'; id: string; error: string}
  /** The GPU device under the voice was lost: nothing being made will come
      back, and nothing more can be made in this worker. */
  | {type: 'lost'; reason: string; message: string};

const RATE = 24000;
/** What one MB is, for the bar: the engines' sizes are given in these. */
const MB = 1e6;

const post = (m: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

/* The device ONNX Runtime asks for, watched from before any engine loads:
   lost, it says nothing, and the sentence being made never comes back (10-10,
   the device destroyed under Sopro: the reply waited on it for good, and the
   line after was never answered). So the page is told, and lets go of this
   worker (voice.ts). */
let lost = false;
let heardLost: () => void = () => {};
const lostOnce = new Promise<void>((go) => { heardLost = go; });
const watch = watchDevices((info) => {
  lost = true;
  heardLost();
  post({type: 'lost', ...info});
});
/** How long a sentence's failure waits for word that the device went: ONNX
    Runtime's own error reaches here first (measured 10-10), and a failure
    the loss explains is the page's to say, as the loss. */
const LOST_GRACE_MS = 400;

// ---- the sound itself --------------------------------------------------------

/** Dead air off both ends, and a short fade on each, as the machine does
    (machine/models.py, trim_silence): the model leaves silence after a
    sentence, and a cloned voice carries the clip's room tone, which a hard cut
    switches off and on between sentences. */
export function trimmed(a: Float32Array, rate = RATE): Float32Array {
  const frame = Math.max(1, Math.round(0.01 * rate));
  const n = Math.floor(a.length / frame);
  if (n < 2) return a;
  const rms = new Float32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * frame; j < (i + 1) * frame; j++) s += a[j]! * a[j]!;
    rms[i] = Math.sqrt(s / frame);
    top = Math.max(top, rms[i]!);
  }
  const bar = Math.max(1e-4, 0.02 * top);
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (rms[i]! > bar) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return a;
  const start = Math.max(0, first * frame - Math.round(0.06 * rate));
  const end = Math.min(a.length, (last + 1) * frame + Math.round(0.12 * rate));
  const out = a.slice(start, end);
  const fade = Math.min(Math.round(0.025 * rate), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = Math.sqrt(i / fade);
    out[i]! *= g;
    out[out.length - 1 - i]! *= g;
  }
  return out;
}

/** Float samples as the machine sends them: signed 16-bit, little-endian,
    in base64. */
export function pcm16(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) {
    const v = Math.max(-1, Math.min(1, a[i]!));
    view.setInt16(i * 2, Math.round(v * 32767), true);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** A chunk's sentences, each whole. The reply's splitter already cut at
    sentence ends; this cuts a merged chunk back into them, at the same kind of
    place and nowhere else -- its SENTENCE_END, so an ellipsis is a pause
    inside a sentence here too ("Stay... just like that."), where this once
    cut it into two clips the Mac never made. */
export function sentences(text: string): string[] {
  /* A tag with no words of its own goes with the sentence after it, as the
     reply's splitter carries it, or with the one before it at the end -- a
     tag alone is noise from the voice, not a sound (hasWords, speech.ts). */
  const out: string[] = [];
  let carry = '';
  for (const s of text.split(SENTENCE_END).map((t) => t.trim()).filter(Boolean)) {
    if (!hasWords(s)) carry = `${carry} ${s}`.trim();
    else {
      out.push(carry ? `${carry} ${s}` : s);
      carry = '';
    }
  }
  if (carry && out.length) out[out.length - 1] = `${out[out.length - 1]} ${carry}`;
  return out;
}

/** What the engine is handed: the tags it performs, lower-cased to the
    token's spelling, and every other bracket and asterisk gone (the machine's
    voice_text). */
export function voiceText(text: string, tags: readonly string[]): string {
  if (!hasWords(text)) return '';      // a tag alone is nothing to say
  const keep = new Set(tags);
  return text
    .replace(/\[([A-Za-z][A-Za-z -]*)\]/g, (_m, name: string) => {
      const tag = `[${name.toLowerCase().split(/\s+/).join(' ')}]`;
      return keep.has(tag) ? tag : ' ';
    })
    .replace(/\*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---- the engines -------------------------------------------------------------

interface Speaker {
  /** The voice's conditioning, made once per clip and kept. */
  warm(voice: VoiceSpec): Promise<void>;
  /** One sentence. `stop` is asked between the model's steps where the engine
      has any, so a chunk let go of stops being made. */
  say(text: string, voice: VoiceSpec, stop: () => boolean): Promise<Float32Array>;
}

/** Bytes as they come down, for the bar: transformers.js reports a file at a
    time, so this keeps the last count of each and adds them up. */
function counter(mb: number) {
  const got = new Map<string, number>();
  let told = 0;
  return (file: string, loaded: number) => {
    got.set(file, loaded);
    let sum = 0;
    for (const v of got.values()) sum += v;
    const now = Math.min(0.99, sum / (mb * MB));
    if (now - told >= 0.01) {
      told = now;
      post({type: 'progress', got: now});
    }
  };
}

/** A WAV's samples, mono, at the model's rate. A worker has no AudioContext
    to decode with -- transformers.js's read_audio needs one -- and a clip on
    the shelf is plain PCM by its own rule (tools/VOICES.md: 24 kHz, mono,
    16-bit), so this reads that and the float kind, mixes any channels down,
    and resamples by straight lines if the rate is another. */
export function wavSamples(buf: ArrayBuffer, rate = RATE): Float32Array {
  const v = new DataView(buf);
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1),
    v.getUint8(at + 2), v.getUint8(at + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('the clip is not a WAV');
  let at = 12;
  let format = 0;
  let channels = 1;
  let from = rate;
  let bits = 16;
  while (at + 8 <= v.byteLength) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      from = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      const width = bits / 8;
      const frames = Math.floor(Math.min(size, v.byteLength - body) / (width * channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const o = body + (i * channels + c) * width;
          sum += format === 3 ? v.getFloat32(o, true)
            : bits === 16 ? v.getInt16(o, true) / 32768
              : bits === 32 ? v.getInt32(o, true) / 2147483648 : (v.getUint8(o) - 128) / 128;
        }
        mono[i] = sum / channels;
      }
      if (from === rate) return mono;
      const out = new Float32Array(Math.round(frames * rate / from));
      for (let i = 0; i < out.length; i++) {
        const x = i * from / rate;
        const k = Math.floor(x);
        const a = mono[Math.min(k, frames - 1)]!;
        const b = mono[Math.min(k + 1, frames - 1)]!;
        out[i] = a + (b - a) * (x - k);
      }
      return out;
    }
    at = body + size + (size % 2);
  }
  throw new Error('the clip has no sound in it');
}

async function clip(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the clip would not come: ${res.status}`);
  return wavSamples(await res.arrayBuffer());
}

/** Which precision each of Chatterbox's four graphs is read at, by engine
    and GPU (see the header for why). Turbo's speech encoder is q4 on every
    GPU: run once per clip, it is where the voice's pace is read, and at half
    precision it reads it fast. Nano's export has it at q4f16 only. */
function dtypes(which: 'turbo' | 'nano', f16: boolean): Record<string, 'fp16' | 'q4f16' | 'q4'> {
  return which === 'nano'
    ? {embed_tokens: 'fp16', speech_encoder: 'q4f16', language_model: 'q4f16', conditional_decoder: 'q4'}
    : f16
      ? {embed_tokens: 'q4f16', speech_encoder: 'q4', language_model: 'q4f16', conditional_decoder: 'q4'}
      : {embed_tokens: 'q4', speech_encoder: 'q4', language_model: 'q4', conditional_decoder: 'q4'};
}

/** Chatterbox's files, as transformers.js asks for them at the pinned
    commit: its configs, the tokenizer, and each of the four graphs at its
    precision with the weights beside it. Written out, because the library's
    own ModelRegistry.get_files does not know the model (it falls back to a
    single model.onnx); the list is what a load leaves in the cache. */
function chatterboxFiles(which: 'turbo' | 'nano', f16: boolean) {
  const {repo, rev} = which === 'turbo' ? TURBO : NANO;
  const graphs = Object.entries(dtypes(which, f16))
    .flatMap(([g, d]) => [`onnx/${g}_${d}.onnx`, `onnx/${g}_${d}.onnx_data`]);
  const files = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json',
    'preprocessor_config.json', ...graphs];
  // The key transformers.js reads by: the remote URL at the revision.
  const url = (file: string) => `https://huggingface.co/${repo}/resolve/${encodeURIComponent(rev)}/${file}`;
  return {files, url};
}

/** What this page once read and no longer does: Turbo's speech encoder at
    half precision, from before it was q4 (341b237). Named, not inferred:
    whatever is not in this GPU's list was once taken for stale and swept,
    and a browser whose adapter came up once without shader-f16 would have
    thrown away the f16 graphs it had downloaded and would read again. */
const STALE: Record<'turbo' | 'nano', readonly string[]> = {
  turbo: ['onnx/speech_encoder_q4f16.onnx', 'onnx/speech_encoder_q4f16.onnx_data'],
  nano: [],
};

/** The graphs named in STALE out of the cache, where they would sit as
    weight nobody loads. */
async function sweep(which: 'turbo' | 'nano'): Promise<void> {
  const {url} = chatterboxFiles(which, true);
  const cache = await caches.open('transformers-cache');
  for (const file of STALE[which]) await cache.delete(url(file));
}

/** Whether every file the engine loads is in the browser's cache. */
async function cached(engine: EngineId, f16: boolean, mb: number): Promise<boolean> {
  if (engine === 'sopro') {
    /* Sopro keeps a cache of its own and lists its files only in a manifest
       on the hub; what is in the cache at this revision, by weight, against
       what the engine weighs is the answer without asking the network. The
       cache's name is the library's and moves with it: 0.3 keeps its files
       in `sopro-onnx-assets-<hash>`, at /resolve/<rev>/ with ?v=<hash>, where
       an earlier one kept `sopro-onnx-v1` with v=<rev> -- and a check that
       looked only there said a Sopro the browser held was not downloaded.
       Every Sopro cache but the manifest's, then, and the revision anywhere
       in the address. */
    let bytes = 0;
    for (const name of await caches.keys()) {
      if (!name.startsWith('sopro-onnx') || name.includes('manifest')) continue;
      const cache = await caches.open(name);
      for (const r of await cache.keys()) {
        if (!r.url.includes(SOPRO.rev)) continue;
        bytes += Number((await cache.match(r))?.headers.get('content-length') ?? 0);
      }
    }
    return bytes >= 0.9 * mb * MB;
  }
  const {files, url} = chatterboxFiles(engine, f16);
  const cache = await caches.open('transformers-cache');
  // The weights and what names them; a small config missing is a load's
  // second or two, not a download.
  const needed = files.filter((f) => f.startsWith('onnx/') || f === 'config.json' || f === 'tokenizer.json');
  for (const file of needed) if (!(await cache.match(url(file)))) return false;
  return true;
}

/** Into the cache, where a load will find it, and nothing more. */
async function prefetch(engine: EngineId, f16: boolean, mb: number): Promise<void> {
  const seen = counter(mb);
  if (engine === 'sopro') {
    const {SoproTTS} = await import('@soprotts/onnx-web');
    const tts = await SoproTTS.create({model: SOPRO.repo, revision: SOPRO.rev, backend: 'auto',
      onProgress: (p) => seen(p.file ?? p.url ?? 'all', p.loaded ?? 0)});
    await tts.preload();            // the weights into its cache; no session made
    return;
  }
  const {files, url: at} = chatterboxFiles(engine, f16);
  const cache = await caches.open('transformers-cache');
  for (const file of files) {
    const url = at(file);
    if (await cache.match(url)) continue;
    const res = await fetch(url);
    if (!res.ok) {
      // A small config the export has not got is one the load does without;
      // anything else is a fault.
      if (res.status === 404) continue;
      throw new Error(`${file} would not come: ${res.status}`);
    }
    const parts: Uint8Array[] = [];
    let got = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
      seen(file, got);
    }
    const headers = new Headers(res.headers);
    headers.set('content-length', String(got));
    await cache.put(url, new Response(new Blob(parts as BlobPart[]), {headers}));
  }
  await sweep(engine).catch(() => {});
}

async function chatterbox(which: 'turbo' | 'nano', f16: boolean, mb: number): Promise<Speaker> {
  const T = await import('@huggingface/transformers');
  const {repo, rev} = which === 'turbo' ? TURBO : NANO;
  const dtype = dtypes(which, f16);
  const seen = counter(mb);
  const progress = (p: {status?: string; file?: string; loaded?: number}) => {
    if (p.status === 'progress' && p.file) seen(p.file, p.loaded ?? 0);
  };
  const tokenizer = await T.AutoTokenizer.from_pretrained(repo, {revision: rev, progress_callback: progress});
  const model = await T.ChatterboxModel.from_pretrained(repo, {
    revision: rev, device: 'webgpu', progress_callback: progress,
    dtype: dtype as Record<string, 'fp16' | 'q4f16' | 'q4'>,
  }) as ChatterboxModelT;
  const extract = await T.AutoFeatureExtractor.from_pretrained(repo, {revision: rev});
  void sweep(which).catch(() => {});
  const conds = new Map<string, Record<string, Tensor>>();
  const cond = async (voice: VoiceSpec) => {
    let got = conds.get(voice.clip);
    if (!got) {
      const {input_values} = await extract(await clip(voice.clip)) as {input_values: Tensor};
      got = await (model as unknown as {encode_speech(t: Tensor): Promise<Record<string, Tensor>>})
        .encode_speech(input_values);
      conds.set(voice.clip, got);
    }
    return got;
  };
  return {
    async warm(voice) { await cond(voice); },
    async say(text, voice, stop) {
      const c = await cond(voice);
      const ids = (tokenizer as PreTrainedTokenizer)(text);
      const halt = new T.InterruptableStoppingCriteria();
      const watch = new (class extends T.StoppingCriteria {
        override _call(inputIds: number[][]) {
          if (stop()) halt.interrupt();
          return inputIds.map(() => stop());
        }
      })();
      /* Sampled, as the machine's Turbo samples (temperature 0.8, top-k 1000,
         top-p 0.95, repetition 1.2): greedy, as the export's own example
         decodes, was measured further from the clip (speaker similarity 0.79
         against 0.89 for the lover). Room for 3.5 speech tokens a character
         at 25 a second, which no line said at a person's pace reaches. */
      const wave = await (model as unknown as {generate(o: unknown): Promise<Tensor>}).generate({
        ...ids, ...c,
        do_sample: true, temperature: 0.8, top_k: 1000, top_p: 0.95, repetition_penalty: 1.2,
        max_new_tokens: Math.min(1000, Math.ceil(text.length * 3.5) + 40),
        stopping_criteria: [watch],
      });
      return wave.data as Float32Array;
    },
  };
}

async function sopro(mb: number): Promise<Speaker> {
  const {SoproTTS} = await import('@soprotts/onnx-web');
  const seen = counter(mb);
  const tts = await SoproTTS.create({
    model: SOPRO.repo, revision: SOPRO.rev, backend: 'auto',
    onProgress: (p) => seen(p.file ?? p.url ?? 'all', p.loaded ?? 0),
  });
  /* Its weights come down on the first sentence unless asked for: asked for
     here, so the switch's bar is the download and the first sentence is not. */
  await tts.preload();
  const refs = new Map<string, SoproReference>();
  const ref = async (voice: VoiceSpec) => {
    let got = refs.get(voice.clip);
    if (!got) {
      got = await tts.prepareReference(await clip(voice.clip), {sampleRate: RATE});
      refs.set(voice.clip, got);
    }
    return got;
  };
  return {
    async warm(voice) { await ref(voice); },
    async say(text, voice) {
      return tts.synthesize(text, await ref(voice), {language: 'en'});
    },
  };
}

// ---- the queue -----------------------------------------------------------------

let speaker: Speaker | null = null;
let loading: Promise<Speaker> | null = null;
/** Each sentence to the Mac's loudness (level.ts), a figure per voice, new
    with each engine loaded. */
let level = leveller();
const dropped = new Set<string>();
let queue: Promise<void> = Promise.resolve();

async function speak(m: Extract<ToWorker, {type: 'speak'}>): Promise<void> {
  const gone = () => dropped.has(m.id);
  try {
    const s = speaker ?? await loading;
    if (!s) throw new Error('the voice is not loaded');
    let gen = 0;
    let audio = 0;
    let words = 0;
    for (const sentence of sentences(m.text)) {
      if (gone()) break;
      const said = voiceText(sentence, m.tags);
      if (!said) continue;
      const began = performance.now();
      let wave = trimmed(await s.say(said, m.voice, gone));
      gen += (performance.now() - began) / 1000;
      if (gone()) break;
      wave = level(wave, RATE, m.voice.clip, said);
      words += said.split(/\s+/).length;
      audio += wave.length / RATE;
      /* A beat where a thought ended, as the machine leaves one: its
         paragraph pause, 0.45 s, after the last sentence of a paragraph. */
      if (m.paragraph && sentence === sentences(m.text).at(-1)) {
        const longer = new Float32Array(wave.length + Math.round(0.45 * RATE));
        longer.set(wave);
        wave = longer;
      }
      post({type: 'frame', id: m.id, pcm: pcm16(wave), rate: RATE});
    }
    post({type: 'done', id: m.id, stats: {
      gen_s: +gen.toFixed(2), audio_s: +audio.toFixed(2),
      rtf: audio > 0.05 ? +(gen / audio).toFixed(2) : null, words,
    }});
  } catch (e) {
    await Promise.race([lostOnce, new Promise((go) => setTimeout(go, LOST_GRACE_MS))]);
    if (!lost) post({type: 'error', id: m.id, error: e instanceof Error ? e.message : String(e)});
  } finally {
    dropped.delete(m.id);
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'check') {
    void Promise.all(m.engines.map((e) => cached(e.engine, m.f16, e.mb).catch(() => false)))
      .then((got) => post({type: 'checked', here: m.engines.filter((_, i) => got[i]).map((e) => e.engine)}));
    return;
  }
  if (m.type === 'fetch') {
    prefetch(m.engine, m.f16, m.mb).then(() => post({type: 'fetched'}),
      (e: unknown) => post({type: 'failed', error: e instanceof Error ? e.message : String(e)}));
    return;
  }
  if (m.type === 'load') {
    const began = performance.now();
    const {mb} = m;
    level = leveller();
    loading = (m.engine === 'turbo' || m.engine === 'nano' ? chatterbox(m.engine, m.f16, mb)
          : sopro(mb));
    loading.then((s) => {
      speaker = s;
      post({type: 'ready', load_s: +((performance.now() - began) / 1000).toFixed(2)});
    }, (e: unknown) => {
      post({type: 'failed', error: e instanceof Error ? e.message : String(e)});
    });
    return;
  }
  if (m.type === 'drop') {
    for (const id of m.ids) dropped.add(id);
    return;
  }
  if (m.type === 'lose') {
    watch.lose();
    return;
  }
  if (m.type === 'warm') {
    queue = queue.then(async () => {
      const s = speaker ?? await loading?.catch(() => null);
      await s?.warm(m.voice).catch(() => {});
    });
    return;
  }
  // One sentence at a time on the one GPU queue, in the order asked.
  queue = queue.then(() => speak(m));
};
