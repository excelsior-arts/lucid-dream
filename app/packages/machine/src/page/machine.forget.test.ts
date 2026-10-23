/* The models panel's delete, as the stand-in answers it: what it frees, the
   files out of the cache, and never the model in use. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {Engine} from './engine';
import type {PageEar} from './ear';
import {pageMachine} from './machine';
import {memoryDrawer} from './store';
import type {PageVoice} from './voice';

const TURBO = 'https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX/resolve/d21799bd0354adb85e348b8a0442a8405110a2cf';
const SOPRO = 'https://huggingface.co/samuel-vitorino/sopro-v2-turbo-onnx/resolve/9fe97bddf52ed785af3634db86a032bb7e07bf18';
let held: Map<string, number>;

beforeEach(() => {
  held = new Map([[`${TURBO}/onnx/language_model_q4f16.onnx_data`, 300_000_000], [`${TURBO}/tokenizer.json`, 3_000_000],
                  [`${SOPRO}/manifest.json`, 20_000]]);
  vi.stubGlobal('caches', {
    keys: async () => ['transformers-cache', 'sopro-onnx-manifest-v1'],
    open: async (name: string) => ({
      keys: async () => [...held.keys()].filter((u) => (name === 'transformers-cache') === u.startsWith(TURBO))
        .map((url) => ({url})),
      match: async (r: {url: string} | string) => {
        const n = held.get(typeof r === 'string' ? r : r.url);
        return n === undefined ? undefined : {headers: new Headers({'content-length': String(n)})};
      },
      delete: async (url: string) => held.delete(url),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

const quiet = {onChange: () => () => {}, status: () => 'off', chosen: () => '', card: () => null};
function machine() {
  const forgot: string[] = [];
  const engine = {...quiet, label: () => 'Qwen3.5 0.8B', inUse: (s: string) => s === '0.8b', lost: () => false, outgrown: () => null, past: () => false,
    last: () => null} as unknown as Engine;
  const voice = {...quiet, inUse: (e: string) => e === 'sopro', forgot: (e: string) => forgot.push(e)} as unknown as PageVoice;
  const ear = {...quiet, inUse: () => false, forgot: (e: string) => forgot.push(e)} as unknown as PageEar;
  const answer = pageMachine(engine, memoryDrawer(), 'me', voice, undefined, ear);
  const ask = async (body: unknown) => {
    const res = await answer('/machine/models/forget', {method: 'POST', body: JSON.stringify(body)});
    return {status: res.status, body: await res.json() as Record<string, unknown>};
  };
  return {ask, forgot};
}

test('asked dry: what it would free, off the cache, and nothing deleted', async () => {
  const {ask, forgot} = machine();
  expect(await ask({part: 'voice', id: 'turbo', dry: true})).toEqual({status: 200, body: {bytes: 303_000_000, files: 2}});
  expect(held.size).toBe(3);
  expect(forgot).toEqual([]);
});

test('deleted: its files out of the cache, and the voice told it is downloadable again', async () => {
  const {ask, forgot} = machine();
  expect(await ask({part: 'voice', id: 'turbo'})).toEqual({status: 200, body: {bytes: 303_000_000, files: 2}});
  expect([...held.keys()]).toEqual([`${SOPRO}/manifest.json`]);
  expect(forgot).toEqual(['turbo']);
});

test('the one in use is refused, words or voice, and nothing is touched', async () => {
  const {ask} = machine();
  expect((await ask({part: 'voice', id: 'sopro'})).status).toBe(409);
  expect((await ask({part: 'llm', id: '0.8b', dry: true})).status).toBe(409);
  expect((await ask({part: 'tts', id: 'x'})).status).toBe(400);
  expect(held.size).toBe(3);
});
