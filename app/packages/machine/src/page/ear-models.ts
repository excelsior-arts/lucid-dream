/* The ears this page can run, as data: where each one's files are, at which
 * commit, which precision is read, and what it weighs. Shared by the page
 * side (ear.ts), which offers them, and the worker (ear-worker.ts), which
 * fetches and runs them -- a module of its own so the worker does not pull
 * the shell in with the list.
 *
 * Every one runs on the CPU (WebAssembly), on purpose: the GPU is the
 * language model's and the voice's, and Firefox, whose WebGPU cannot run the
 * words, runs these. Chosen by measurement (see EARS for the numbers).
 */

import type {Holding} from './forget';
import {ortRuntime} from './forget';

export type EarId = 'moonshine' | 'parakeet';

export interface EarSpec {
  id: EarId;
  /** What it is, to a person. */
  name: string;
  /** Its repository on the Hugging Face hub, and the commit it is read at:
      pinned, as the voice and the words are, so the ear does not change
      under a page overnight. */
  repo: string;
  rev: string;
  /** What runs it: transformers.js, or parakeet.js for Parakeet's TDT
      decoder, which transformers.js does not have. */
  runtime: 'transformers' | 'parakeet';
  /** The precision transformers.js reads each graph at. */
  dtype?: string;
  /** The files a load asks for, as transformers.js names them at that
      precision: what a check finds in the cache, and what a fetch brings. */
  files: readonly string[];
  /** To download, in MB. */
  mb: number;
}

const CONFIGS = ['config.json', 'generation_config.json', 'preprocessor_config.json',
  'tokenizer.json', 'tokenizer_config.json'];

export const EAR_SPECS: readonly EarSpec[] = [
  {id: 'moonshine', name: 'Moonshine Base', repo: 'onnx-community/moonshine-base-ONNX',
   rev: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', runtime: 'transformers', dtype: 'q8',
   files: [...CONFIGS, 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'],
   mb: 67},
  /* The Mac's own ear, Parakeet TDT 0.6B v2, NVIDIA's (CC-BY-4.0), as an
     8-bit ONNX export. */
  {id: 'parakeet', name: 'Parakeet', repo: 'ysdede/parakeet-tdt-0.6b-v2-onnx',
   rev: 'db4a768f5795e0f508187a34241fbeeef6ebb0d3', runtime: 'parakeet',
   files: ['config.json', 'vocab.txt', 'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx'],
   mb: 661},
];

/** The key transformers.js reads a file by in its cache: the remote URL at
    the revision. */
export const fileUrl = (s: EarSpec, file: string): string =>
  `https://huggingface.co/${s.repo}/resolve/${encodeURIComponent(s.rev)}/${file}`;

/** The cache they are kept in: transformers.js's own, where a load of
    Moonshine looks; Parakeet's files sit beside it under their own URLs. */
export const CACHE = 'transformers-cache';

/** Whether every file an ear loads is in the browser's cache. Asked on the
    page's own thread: the Cache API is there too, and a worker started only
    to ask would fetch the ear's whole runtime for every visitor. */
export async function cached(s: EarSpec): Promise<boolean> {
  const cache = await caches.open(CACHE);
  // The weights and what names them; a small config missing is a load's
  // second, not a download.
  const needed = s.files.filter((f) => /\.onnx$|^config\.json$|^tokenizer\.json$|^vocab\.txt$/.test(f));
  for (const file of needed) if (!(await cache.match(fileUrl(s, file)))) return false;
  return true;
}

/** What each ear keeps in this browser, for a delete from the models panel
    (forget.ts): its repository's files, at any revision, and -- for the one
    transformers.js runs -- ONNX Runtime's WebAssembly, shared with the voice.
    parakeet.js is handed Parakeet's files from the cache and keeps none of
    its own. */
export const EAR_HOLDINGS: readonly Holding[] = EAR_SPECS.map((s) => ({
  key: `ear:${s.id}`,
  claims: (cache: string, url: string) => (s.runtime === 'transformers' && ortRuntime(cache, url))
    || (cache === CACHE && url.startsWith(`https://huggingface.co/${s.repo}/`)),
}));
