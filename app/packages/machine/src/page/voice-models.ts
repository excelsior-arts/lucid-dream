/* Where the voice engines come from, as data: the repository on the Hugging
 * Face hub and the commit each is read at. Shared by the worker that runs them
 * (voice-worker.ts) and the page side that keeps track of what is in the
 * browser's cache (voice.ts, and a delete from the models panel, forget.ts) --
 * a module of its own, so the page does not load the worker to read three
 * names. Pinned, as the language model's builds are: a revision that moves
 * under a page is a page that sounds different overnight. */
import type {Holding} from './forget';
import {ortRuntime} from './forget';

export const TURBO = {repo: 'ResembleAI/chatterbox-turbo-ONNX', rev: 'd21799bd0354adb85e348b8a0442a8405110a2cf'};
export const NANO = {repo: 'owensong/chatterbox-nano-ONNX', rev: '4a66d7dab72a9e98f24b515d49a1d7a81632df2e'};
export const SOPRO = {repo: 'samuel-vitorino/sopro-v2-turbo-onnx', rev: '9fe97bddf52ed785af3634db86a032bb7e07bf18'};

/** What each engine keeps in this browser. Chatterbox, through
    transformers.js: its repository's files, at any revision and precision,
    and ONNX Runtime's WebAssembly, which it shares with the ear. Sopro: its
    manifest and its assets, in caches named for the library, and the voices
    it has read, in a database of its own. */
export const VOICE_HOLDINGS: readonly Holding[] = [
  ...([['turbo', TURBO.repo], ['nano', NANO.repo]] as const).map(([id, repo]): Holding => ({
    key: `voice:${id}`,
    claims: (cache, url) => ortRuntime(cache, url)
      || (cache === 'transformers-cache' && url.startsWith(`https://huggingface.co/${repo}/`)),
  })),
  {key: 'voice:sopro', dbs: ['sopro-reference-v1'],
   claims: (cache, url) => cache.startsWith('sopro-onnx') && url.startsWith(`https://huggingface.co/${SOPRO.repo}/`)},
];
