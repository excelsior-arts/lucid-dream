/* The ear in a browser: chosen and kept in config.json, brought into the cache
   by the panel without loading, loaded by the microphone, let go of after the
   grace, and a turn answered by the worker. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {createEar} from './ear';
import type {EarChoice} from './ear';
import type {EarId} from './ear-models';
import {together} from './machine';

const loads: string[] = [];
const fetches: string[] = [];
let inCache: string[] = [];
let alive = 0;
/** What the worker says a turn was. */
const words = 'hello there';
/** Whether the next turn kills the worker instead of being heard. */
let dies = false;
class FakeWorker {
  onmessage: ((ev: {data: unknown}) => void) | null = null;
  onerror: ((ev: {message: string; preventDefault(): void}) => void) | null = null;
  private counted = false;
  postMessage(m: {type: string; id?: string; ids?: string[]; n?: number; samples?: Float32Array}) {
    const say = (data: unknown) => queueMicrotask(() => this.onmessage?.({data}));
    if (m.type === 'fetch') {
      fetches.push(m.id!);
      say({type: 'progress', got: 0.5});
      say({type: 'fetched'});
    } else if (m.type === 'load') {
      this.counted = true;
      alive += 1;
      loads.push(m.id!);
      say({type: 'ready', load_s: 0});
    } else if (m.type === 'hear' && dies) {
      queueMicrotask(() => this.onerror?.({message: 'out of memory', preventDefault: () => {}}));
    } else if (m.type === 'hear') {
      say({type: 'heard', n: m.n, text: `${words} (${m.samples!.length})`, gen_s: 0.1});
    }
  }
  terminate() { if (this.counted) alive -= 1; this.counted = false; }
}

beforeEach(() => {
  // The page asks the Cache API itself: what is in it, by URL.
  vi.stubGlobal('caches', {open: async () => ({
    match: async (url: string) => (inCache.some((id) => url.includes(id === 'moonshine' ? 'moonshine' : 'parakeet'))
      ? new Response('') : undefined),
  })});
  loads.length = 0;
  fetches.length = 0;
  inCache = [];
  alive = 0;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function kept(enabled: boolean, engine: string) {
  const said: Array<[boolean, EarId | undefined]> = [];
  const choice: EarChoice = {
    enabled, engine,
    choose(on, e) { this.enabled = on; if (e) this.engine = e; said.push([on, e]); },
  };
  return {choice, said};
}

test('the panel brings an ear into the cache and loads nothing; the choice is kept', async () => {
  vi.useFakeTimers();
  const {choice, said} = kept(false, 'moonshine');
  const ear = createEar(choice);
  expect(ear.chosen()).toBe('');
  expect(ear.parts().map((p) => [p.id, p.here, p.using])).toEqual([['moonshine', false, false],
    ['parakeet', false, false]]);
  ear.get('moonshine');
  expect(ear.fetching()).toMatchObject({state: 'fetching', got_gb: 0});
  await flush();
  expect(said).toEqual([[true, 'moonshine']]);
  expect([fetches, loads, alive]).toEqual([['moonshine'], [], 0]);
  expect(ear.fetching()).toMatchObject({state: 'done'});
  expect(ear.parts()[0]).toMatchObject({here: true, using: true});
  expect(ear.status()).toBe('off');
  // None: typing only, the engine kept.
  ear.get('');
  expect(said.at(-1)).toEqual([false, undefined]);
  expect(choice.engine).toBe('moonshine');
  expect(ear.chosen()).toBe('');
});

test('the microphone loads the chosen ear; off, it is let go of after the grace', async () => {
  vi.useFakeTimers();
  inCache = ['moonshine'];
  const {choice} = kept(true, 'moonshine');
  const ear = createEar(choice);
  ear.want(true);
  await flush();
  expect([loads, alive, ear.status()]).toEqual([['moonshine'], 1, 'ready']);
  ear.want(false);
  expect(ear.grace()).toBe(90);
  vi.advanceTimersByTime(60_000);
  ear.want(true);                           // back inside the grace: nothing moved
  expect([alive, ear.grace(), loads.length]).toEqual([1, null, 1]);
  ear.want(false);
  vi.advanceTimersByTime(90_000);
  expect([alive, ear.status(), ear.chosen()]).toEqual([0, 'off', 'moonshine']);
});

test('a turn goes to the worker and its words come back; nothing chosen is said', async () => {
  inCache = ['moonshine'];
  const ear = createEar(kept(true, 'moonshine').choice);
  // Not loaded yet: the turn waits for the load rather than failing.
  expect(await ear.transcribe(new Float32Array(16000))).toBe('hello there (16000)');
  expect(loads).toEqual(['moonshine']);
  const none = createEar(kept(false, 'moonshine').choice);
  await expect(none.transcribe(new Float32Array(10))).rejects.toThrow(/models panel/);
});

test('a worker that dies fails the turn in it, says so, and the next turn loads afresh', async () => {
  /* A turn handed to a worker that died was a promise nobody would ever
     settle: heard, and never a word about it anywhere. */
  const {hatch} = await import('@lucid/shell');
  const said: string[] = [];
  const console = vi.spyOn(hatch, 'say').mockImplementation((text) => { said.push(text); });
  inCache = ['moonshine'];
  const ear = createEar(kept(true, 'moonshine').choice);
  try {
    dies = true;
    await expect(ear.transcribe(new Float32Array(16000))).rejects.toThrow(/the ear stopped: out of memory/);
    expect(ear.status()).toBe('error');
    expect(said).toContain('ear: Moonshine Base stopped — out of memory');
    dies = false;
    expect(await ear.transcribe(new Float32Array(160))).toBe('hello there (160)');
    expect(loads).toEqual(['moonshine', 'moonshine']);
  } finally {
    dies = false;
    console.mockRestore();
  }
});

test('the voice and the ear coming down together are one bar', () => {
  expect(together(null, {state: 'done', got_gb: 0.067, gb: 0.067})).toEqual({state: 'done', got_gb: 0.067, gb: 0.067});
  expect(together({state: 'fetching', got_gb: 0.3, gb: 0.7}, {state: 'done', got_gb: 0.067, gb: 0.067}))
    .toEqual({state: 'fetching', got_gb: 0.367, gb: 0.767});
  expect(together({state: 'done', gb: 1}, {state: 'error', error: 'no'})).toMatchObject({state: 'error', error: 'no'});
});
