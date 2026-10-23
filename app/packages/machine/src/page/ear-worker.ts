/* The ear's own thread, when it runs in this page.
 *
 * A turn of the microphone goes in as 16 kHz samples and its words come back,
 * and everything heavy in between -- the weights coming down, the model, the
 * arithmetic -- happens here and never on the thread that draws the room. The
 * page side (ear.ts) hands over one whole turn at a time, as the machine's
 * /machine/stt is handed one, and gets back the line.
 *
 * On the CPU (WebAssembly), not the GPU: the GPU is the language model's and
 * the voice's, and an ear that queued behind a reply being spoken would hear
 * you late. See ear-models.ts for which models and why: Moonshine through
 * transformers.js, Parakeet (the Mac's own ear) through parakeet.js; both on
 * ONNX Runtime Web's WebAssembly.
 */
import type {EarId, EarSpec} from './ear-models';
import {CACHE, EAR_SPECS, fileUrl} from './ear-models';

export type ToEar =
  /** Down into the browser's cache and no further: nothing loaded. */
  | {type: 'fetch'; id: EarId}
  | {type: 'load'; id: EarId}
  | {type: 'hear'; n: number; samples: Float32Array};

export type FromEar =
  | {type: 'progress'; got: number}
  | {type: 'fetched'}
  | {type: 'ready'; load_s: number}
  | {type: 'failed'; error: string}
  | {type: 'heard'; n: number; text: string; gen_s: number}
  | {type: 'error'; n: number; error: string};

const RATE = 16000;
const MB = 1e6;

const post = (m: FromEar) => (self as unknown as Worker).postMessage(m);
const spec = (id: EarId): EarSpec => {
  const s = EAR_SPECS.find((e) => e.id === id);
  if (!s) throw new Error(`no ear called ${id}`);
  return s;
};
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Bytes as they come down, for the bar: a file at a time, added up. */
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

/** Into the cache, where a load finds it, and nothing more. */
async function prefetch(id: EarId): Promise<void> {
  const s = spec(id);
  const seen = counter(s.mb);
  const cache = await caches.open(CACHE);
  for (const file of s.files) {
    const url = fileUrl(s, file);
    if (await cache.match(url)) continue;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) continue;     // a config the export has not got
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
}

type Hear = (samples: Float32Array) => Promise<string>;

/** Parakeet, through parakeet.js: its files into the cache first (with the
    bar), then handed to it from there, so the second load is no download. */
async function parakeet(s: EarSpec): Promise<Hear> {
  await prefetch(s.id);
  const cache = await caches.open(CACHE);
  const local = async (file: string) => {
    const res = await cache.match(fileUrl(s, file));
    if (!res) throw new Error(`${file} is not in this browser`);
    return URL.createObjectURL(await res.blob());
  };
  const [encoderUrl, decoderUrl, tokenizerUrl] = await Promise.all(
    ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt'].map(local));
  const {fromUrls} = await import('parakeet.js');
  try {
    const model = await fromUrls({encoderUrl: encoderUrl!, decoderUrl: decoderUrl!, tokenizerUrl: tokenizerUrl!,
      preprocessorBackend: 'js', backend: 'wasm'});
    return async (samples) => (await model.transcribe(samples, RATE)).utterance_text.trim();
  } finally {
    for (const u of [encoderUrl, decoderUrl, tokenizerUrl]) URL.revokeObjectURL(u!);
  }
}

async function load(id: EarId): Promise<Hear> {
  const s = spec(id);
  if (s.runtime === 'parakeet') return parakeet(s);
  const T = await import('@huggingface/transformers');
  const seen = counter(s.mb);
  const asr = await T.pipeline('automatic-speech-recognition', s.repo, {
    revision: s.rev, device: 'wasm', dtype: (s.dtype ?? 'q8') as 'q8',
    progress_callback: (p: {status?: string; file?: string; loaded?: number}) => {
      if (p.status === 'progress' && p.file) seen(p.file, p.loaded ?? 0);
    },
  });
  return async (samples) => {
    /* Moonshine's own cap is six tokens a whole second, which a short
       quick line ("You still with me? Good.") runs out of: a little more,
       and never fewer than a short sentence needs. */
    const o = s.id === 'moonshine'
      ? {max_new_tokens: Math.ceil((samples.length / RATE) * 7) + 8} : {};
    const out = await asr(samples, o);
    return ((Array.isArray(out) ? out[0] : out) as {text?: string} | undefined)?.text?.trim() ?? '';
  };
}

let hear: Promise<Hear> | null = null;
/* One turn at a time, in the order they were said. */
let queue: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<ToEar>) => {
  const m = ev.data;
  if (m.type === 'fetch') {
    prefetch(m.id).then(() => post({type: 'fetched'}), (e: unknown) => post({type: 'failed', error: said(e)}));
    return;
  }
  if (m.type === 'load') {
    const began = performance.now();
    hear = load(m.id);
    hear.then(() => post({type: 'ready', load_s: +((performance.now() - began) / 1000).toFixed(2)}),
      (e: unknown) => post({type: 'failed', error: said(e)}));
    return;
  }
  queue = queue.then(async () => {
    try {
      if (!hear) throw new Error('the ear is not loaded');
      const h = await hear;
      const began = performance.now();
      const text = await h(m.samples);
      post({type: 'heard', n: m.n, text, gen_s: +((performance.now() - began) / 1000).toFixed(2)});
    } catch (e) {
      post({type: 'error', n: m.n, error: said(e)});
    }
  });
};
