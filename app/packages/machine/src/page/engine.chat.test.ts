/* A reply that is stopped half-way, and the one after it.
 *
 * WebLLM's worker takes its model's lock when a streamed request is made and
 * lets go of it only when that stream's generator runs out; a page that stops
 * reading leaves it held, and every request after it waits for good (10-09:
 * the first reply talked over in a browser, and the pill never answered
 * again, with nothing in the console). The fake below holds its lock the same
 * way: released at the end of the stream and nowhere else. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {Gpu} from './engine';

const web = vi.hoisted(() => {
  let held = false;
  const waiting: Array<() => void> = [];
  const lock = {
    async acquire() {
      if (!held) { held = true; return; }
      await new Promise<void>((go) => waiting.push(go));
    },
    release() {
      const next = waiting.shift();
      if (next) next();
      else held = false;
    },
    reset() { held = false; waiting.length = 0; },
  };
  let interrupted = false;
  const state = {stuck: false, words: ['One ', 'two ', 'three ', 'four.'], terminated: 0, reloads: 0,
    /** How each next ask goes, in turn: as asked, or as a GPU gone under it
        does (see gpu-lost.ts) -- refused with the model disposed of, back
        empty, cut a word in, or failing on its own just before the worker's
        word that the device went. */
    modes: [] as Array<'notLoaded' | 'empty' | 'midway' | 'mapAsync' | 'hangs'>,
    worker: null as null | {onmessage: ((ev: {data: unknown}) => void) | null},
    /** The worker's word that its device went, as worker.ts posts it. */
    lose() { state.worker?.onmessage?.({data: {lucid: 'gpu-lost', reason: 'unknown', message: 'reset'}}); }};
  const engine = {
    interruptGenerate: async () => { interrupted = true; },
    setInitProgressCallback() {},
    async reload() {},
    async unload() {},
    chat: {completions: {async create() {
      if (state.stuck) await new Promise(() => {});
      const mode = state.modes.shift();
      if (mode === 'notLoaded') {
        throw new Error('ModelNotLoadedError: Model not loaded before trying to complete ChatCompletionRequest.');
      }
      if (mode === 'empty') {
        return (async function* () {
          yield {choices: [{delta: {}, finish_reason: 'stop'}]};
          yield {choices: [], usage: {prompt_tokens: 3, completion_tokens: 0}};
        })();
      }
      if (mode === 'hangs') {
        return (async function* () {
          yield {choices: [{delta: {content: 'One '}}]};
          await new Promise(() => {});        // frozen, with the device still there
        })();
      }
      if (mode === 'midway') {
        return (async function* () {
          yield {choices: [{delta: {content: 'One '}}]};
          await new Promise(() => {});        // the device goes here
        })();
      }
      if (mode === 'mapAsync') {
        return (async function* () {
          setTimeout(() => state.lose(), 50);
          throw new Error("AbortError: Failed to execute 'mapAsync' on 'GPUBuffer'");
          yield {choices: []};
        })();
      }
      await lock.acquire();
      return (async function* () {
        interrupted = false;              // as asyncGenerate does on its first step
        for (const w of state.words) {
          if (interrupted) break;
          yield {choices: [{delta: {content: w}}]};
        }
        yield {choices: [{delta: {}, finish_reason: 'stop'}]};
        yield {choices: [], usage: {prompt_tokens: 3, completion_tokens: 4}};
        lock.release();
      })();
    }}},
  };
  return {lock, state, engine};
});

vi.mock('@mlc-ai/web-llm', () => ({
  CreateWebWorkerMLCEngine: async () => { web.state.reloads += 1; return web.engine; },
  hasModelInCache: async () => true,
}));

const {createEngine, Lost, Stalled, unkept} = await import('./engine');
const {Told} = await import('../told');

const gpu: Gpu = {adapter: {} as GPUAdapter, f16: true, tier: 'ordinary'};
const body = {messages: [{role: 'user', content: 'hello'}]};

beforeEach(() => {
  web.lock.reset();
  web.state.stuck = false;
  web.state.terminated = 0;
  web.state.reloads = 0;
  web.state.modes = [];
  vi.stubGlobal('Worker', class {
    onmessage: ((ev: {data: unknown}) => void) | null = null;
    constructor() { web.state.worker = this; }
    postMessage() {}
    terminate() { web.state.terminated += 1; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function started(stallMs?: number, nextMs?: number) {
  const e = createEngine(gpu, unkept('0.8b'), {...(stallMs ? {stallMs} : {}), ...(nextMs ? {nextMs} : {})});
  expect(await e.start()).toBe('ready');
  return e;
}

async function all(words: AsyncIterable<string>): Promise<string> {
  let got = '';
  for await (const w of words) got += w;
  return got;
}

test('a reply talked over a word in: the next one is answered', async () => {
  const e = await started();
  const cut = new AbortController();
  let first = '';
  for await (const w of e.chat(body, cut.signal)) {
    first += w;
    cut.abort();
  }
  expect(first).toBe('One ');
  expect(await all(e.chat(body))).toBe('One two three four.');
});

test('a reader that walks away (the stream cancelled): the next one is answered', async () => {
  const e = await started();
  for await (const w of e.chat(body)) { expect(w).toBe('One '); break; }
  expect(await all(e.chat(body))).toBe('One two three four.');
});

test('stopped before it was asked: nothing taken, nothing held', async () => {
  const e = await started();
  const cut = new AbortController();
  cut.abort();
  expect(await all(e.chat(body, cut.signal))).toBe('');
  expect(await all(e.chat(body))).toBe('One two three four.');
});

test('a model that stops answering says so, and is put down to be started again', async () => {
  const e = await started(50);
  web.state.stuck = true;
  await expect(all(e.chat(body))).rejects.toBeInstanceOf(Stalled);
  expect(e.status()).toBe('off');
  expect(web.state.terminated).toBe(1);
  // And the next ask starts it again, and is answered.
  web.state.stuck = false;
  web.lock.reset();
  expect(await e.start()).toBe('ready');
  expect(await all(e.chat(body))).toBe('One two three four.');
});

test('once words flow, a model that stops is called stuck far sooner than before the first', async () => {
  /* Ninety seconds is the prompt's reading (stall.ts); once it is writing, a
     working model writes several words a second, and fifteen with none is a
     stall. Here 5 s before the first word against 40 ms after it. */
  const e = await started(5000, 40);
  web.state.modes = ['hangs'];
  let got = '';
  const began = Date.now();
  const reading = (async () => { for await (const w of e.chat(body)) got += w; })();
  await expect(reading).rejects.toBeInstanceOf(Stalled);
  expect(Date.now() - began).toBeLessThan(2000);
  expect(got).toBe('One ');
  // Put down, and the next line starts it afresh and is answered.
  expect(e.status()).toBe('off');
  expect(web.state.terminated).toBe(1);
  expect(await e.start()).toBe('ready');
  expect(await all(e.chat(body))).toBe('One two three four.');
});

/* The GPU letting go of the model: a driver reset, a backgrounded tab's device
   reclaimed. Measured 10-10 with the device destroyed under the 0.8B: WebLLM
   disposed of its model and said so only in its worker; every line after was
   refused (ModelNotLoadedError), the engine still read as ready, and the room
   flashed that the pill did not answer and never recovered. */

test('the GPU let go between replies: put down, and the next line starts it from the cache', async () => {
  const e = await started();
  web.state.lose();
  expect(e.status()).toBe('off');
  expect(e.lost()).toBe(true);
  expect(web.state.terminated).toBe(1);
  // What machine.ts does with a line for an engine that is not up.
  expect(await e.start()).toBe('ready');
  expect(e.lost()).toBe(false);
  expect(await all(e.chat(body))).toBe('One two three four.');
});

test('a model WebLLM disposed of, before a word: started again, and the line answered', async () => {
  const e = await started();
  web.state.modes = ['notLoaded'];
  expect(await all(e.chat(body))).toBe('One two three four.');
  expect(web.state.terminated).toBe(1);
  expect(web.state.reloads).toBe(2);
});

test('an empty reply is never an answer: started again and asked again, and said if it is empty twice', async () => {
  const e = await started();
  web.state.modes = ['empty'];
  expect(await all(e.chat(body))).toBe('One two three four.');
  web.state.modes = ['empty', 'empty'];
  const again = all(e.chat(body));
  /* In the page's words, and not quietly: a GPU that let go twice is not
     woken by the next line (a banner, not the room's quiet label). */
  await expect(again).rejects.toBeInstanceOf(Told);
  await expect(again).rejects.not.toBeInstanceOf(Lost);
  await expect(again).rejects.toThrow(/again/);
});

test('lost mid-reply: said in the page\'s words, and the model put down to start afresh', async () => {
  const e = await started();
  web.state.modes = ['midway'];
  let got = '';
  const reading = (async () => { for await (const w of e.chat(body)) { got += w; web.state.lose(); } })();
  await expect(reading).rejects.toBeInstanceOf(Told);
  await expect(reading).rejects.toThrow(/mid-reply/);
  expect(got).toBe('One ');
  expect(e.status()).toBe('off');
  // And the queue is not held by a read-out of a worker that is gone.
  expect(await e.start()).toBe('ready');
  expect(await all(e.chat(body))).toBe('One two three four.');
});

test('a reply\'s own failure with the device\'s word just behind it is the loss', async () => {
  const e = await started();
  web.state.modes = ['mapAsync'];
  expect(await all(e.chat(body))).toBe('One two three four.');
  expect(web.state.terminated).toBe(1);
});

test('our own stop is not a loss', async () => {
  const e = await started();
  await e.stop();
  web.state.lose();
  expect(e.lost()).toBe(false);
  expect(web.state.terminated).toBe(0);
});
