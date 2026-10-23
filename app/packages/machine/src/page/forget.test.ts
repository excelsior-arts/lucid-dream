/* A model taken back off this browser's disk: exactly its files, its size as
   the cache holds it, and a file another model still reads left where it is. */
import {expect, test} from 'vitest';
import {WORDS_HOLDINGS} from './engine';
import {EAR_HOLDINGS} from './ear-models';
import {entries, forget, share} from './forget';
import {VOICE_HOLDINGS} from './voice-models';

const ALL = [...WORDS_HOLDINGS, ...VOICE_HOLDINGS, ...EAR_HOLDINGS];
const HF = 'https://huggingface.co';
const LIB = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.wasm';
const W08 = `${HF}/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC/resolve/0ec138972555613c1d7812a821778ad0398c8790`;
const W2 = `${HF}/mlc-ai/Qwen3.5-2B-q4f16_1-MLC/resolve/dd74e9c8a20c4546df85c844103bff87b6dcacad`;
const TURBO = `${HF}/ResembleAI/chatterbox-turbo-ONNX/resolve/d21799bd0354adb85e348b8a0442a8405110a2cf`;
const MOON = `${HF}/onnx-community/moonshine-base-ONNX/resolve/b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad`;
const PARA = `${HF}/ysdede/parakeet-tdt-0.6b-v2-onnx/resolve/db4a768f5795e0f508187a34241fbeeef6ebb0d3`;
const SOPRO = `${HF}/samuel-vitorino/sopro-v2-turbo-onnx/resolve/9fe97bddf52ed785af3634db86a032bb7e07bf18`;

/** A Cache Storage as a page sees one: caches by name, entries by address,
    some stored with a Content-Length and some (WebLLM's add) without. */
function storage(held: Record<string, Array<[string, number, boolean?]>>) {
  const caches = new Map<string, Map<string, {bytes: number; said: boolean}>>();
  for (const [name, list] of Object.entries(held)) {
    caches.set(name, new Map(list.map(([url, bytes, said = true]) => [url, {bytes, said}])));
  }
  const store = {
    keys: async () => [...caches.keys()],
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new Map());
      const c = caches.get(name)!;
      return {
        keys: async () => [...c.keys()].map((url) => ({url})),
        match: async (r: {url: string} | string) => {
          const e = c.get(typeof r === 'string' ? r : r.url);
          return e && {
            headers: new Headers(e.said ? {'content-length': String(e.bytes)} : {}),
            blob: async () => ({size: e.bytes}),
          };
        },
        delete: async (url: string) => c.delete(url),
      };
    },
  };
  const left = () => Object.fromEntries([...caches].map(([n, c]) => [n, [...c.keys()]]));
  return {store: store as unknown as CacheStorage, left};
}

const browser = () => storage({
  'webllm/model': [[`${W08}/tensor-cache.json`, 170_000], [`${W08}/params_shard_0.bin`, 30_000_000, false],
                   [`${W08}/tokenizer.json`, 12_800_000], [`${W2}/tensor-cache.json`, 180_000],
                   [`${W2}/params_shard_0.bin`, 32_000_000, false]],
  'webllm/config': [[`${W08}/mlc-chat-config.json`, 2_000], [`${W2}/mlc-chat-config.json`, 2_000]],
  'webllm/wasm': [[`${LIB}/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`, 6_200_000],
                  [`${LIB}/Qwen3.5-2B-q4f16_1_cs1k-webgpu.wasm`, 6_400_000]],
  'transformers-cache': [[ORT, 21_000_000], [`${TURBO}/onnx/language_model_q4f16.onnx_data`, 300_000_000],
                         [`${TURBO}/tokenizer.json`, 3_000_000], [`${MOON}/onnx/encoder_model_quantized.onnx`, 20_000_000],
                         [`${PARA}/encoder-model.int8.onnx`, 652_000_000]],
  'sopro-onnx-manifest-v1': [[`${SOPRO}/manifest.json`, 20_000]],
  'sopro-onnx-assets-7a645ef2aaecfea9': [[`${SOPRO}/common/weights-reference.bin?v=7a645ef2aaecfea9`, 94_000_000]],
  // Somebody else's cache on the same origin: never read, never touched.
  'other-app': [[`${W08}/tensor-cache.json`, 1]],
});

test('a size of the words: its weights, tokenizer, config and kernels, and not the other size', async () => {
  const {store, left} = browser();
  const dry = await forget(ALL, 'llm:0.8b', {dry: true}, store);
  // Sized off the cache: the stored length, or the body where none was kept.
  expect(dry).toEqual({bytes: 170_000 + 30_000_000 + 12_800_000 + 2_000 + 6_200_000, files: 5});
  expect(left()['webllm/model']).toHaveLength(5);            // dry deletes nothing
  expect(await forget(ALL, 'llm:0.8b', {}, store)).toEqual(dry);
  expect(left()['webllm/model']).toEqual([`${W2}/tensor-cache.json`, `${W2}/params_shard_0.bin`]);
  expect(left()['webllm/wasm']).toEqual([`${LIB}/Qwen3.5-2B-q4f16_1_cs1k-webgpu.wasm`]);
  expect(left()['other-app']).toHaveLength(1);
});

test('the runtime two models read goes only with the last of them', async () => {
  const {store, left} = browser();
  // Turbo and Moonshine both run on ONNX Runtime's WebAssembly: Turbo goes,
  // the runtime stays for Moonshine.
  expect(await forget(ALL, 'voice:turbo', {}, store)).toEqual({bytes: 303_000_000, files: 2});
  expect(left()['transformers-cache']).toContain(ORT);
  // Then Moonshine, the last that reads it: the runtime with it.
  expect(await forget(ALL, 'ear:moonshine', {dry: true}, store)).toEqual({bytes: 41_000_000, files: 2});
  await forget(ALL, 'ear:moonshine', {}, store);
  expect(left()['transformers-cache']).toEqual([`${PARA}/encoder-model.int8.onnx`]);
});

test('Parakeet reads no runtime from the cache, and Sopro keeps its own caches', async () => {
  const {store, left} = browser();
  expect(await forget(ALL, 'ear:parakeet', {dry: true}, store)).toEqual({bytes: 652_000_000, files: 1});
  const deleted: string[] = [];
  const idb = {deleteDatabase: (name: string) => {
    deleted.push(name);
    const req = {onsuccess: null as null | (() => void), onerror: null};
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }} as unknown as IDBFactory;
  expect(await forget(ALL, 'voice:sopro', {}, store, idb)).toEqual({bytes: 94_020_000, files: 2});
  expect(left()['sopro-onnx-manifest-v1']).toEqual([]);
  expect(left()['sopro-onnx-assets-7a645ef2aaecfea9']).toEqual([]);
  // The voices it read, kept in a database of its own, go with it.
  expect(deleted).toEqual(['sopro-reference-v1']);
});

test('here is holding a file of its own; the shared runtime alone is nobody', async () => {
  const {store} = storage({'transformers-cache': [[ORT, 21_000_000], [`${MOON}/onnx/encoder_model_quantized.onnx`, 1]]});
  const have = await entries(store);
  expect(share(ALL, have, 'ear:moonshine').here).toBe(true);
  expect(share(ALL, have, 'voice:turbo')).toEqual({mine: [], here: false});
  // Moonshine is the only model here that reads the runtime, so it is Moonshine's to free.
  expect(share(ALL, have, 'ear:moonshine').mine.map((e) => e.url)).toContain(ORT);
});
