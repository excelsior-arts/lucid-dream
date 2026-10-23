/* A load: the context it asks for, the short one it falls back to, and a GPU
 * that falls short of a limit WebLLM asks it for.
 *
 * The fake stands in for WebLLM's worker engine at the one place a load
 * happens -- CreateWebWorkerMLCEngine, with the context as its chat options --
 * and fails the way the library does: tvmjs's own words for a limit
 * (detectGPUDevice, before any weight), or a device lost for memory. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {Gpu} from './engine';

const web = vi.hoisted(() => {
  const state = {
    /** The longest context this fake GPU can hold; past it the device is lost. */
    holds: 1e9,
    /** Thrown on every load, before the context is looked at: a limit, or a fetch. */
    fails: null as Error | null,
    /** The load never answers and says nothing: a worker the browser stopped. */
    hangs: false,
    /** The cache never says whether a model is in it: a storage that stopped. */
    cacheHangs: false,
    loads: [] as number[],
    terminated: 0,
  };
  const engine = {
    setInitProgressCallback() {},
    async reload() {},
    async unload() {},
    interruptGenerate: async () => {},
  };
  return {state, engine};
});

vi.mock('@mlc-ai/web-llm', () => ({
  CreateWebWorkerMLCEngine: async (_w: unknown, _id: string,
    cfg: {initProgressCallback?: (r: {progress: number; text: string}) => void},
    opts: {context_window_size: number}) => {
    web.state.loads.push(opts.context_window_size);
    if (web.state.hangs) return new Promise(() => {});
    if (web.state.fails) throw web.state.fails;
    cfg.initProgressCallback?.({progress: 0.1, text: 'Fetching param cache[1/10]: 0MB fetched.'});
    if (opts.context_window_size > web.state.holds) {
      throw new Error('The WebGPU device was lost while loading the model. This issue often occurs due to '
        + 'running out of memory (OOM).');
    }
    return web.engine;
  },
  hasModelInCache: () => (web.state.cacheHangs ? new Promise(() => {}) : Promise.resolve(true)),
}));

const {createEngine, LoadStuck, outgrownSaid, unkept} = await import('./engine');
const {pageMachine} = await import('./machine');
const {memoryDrawer} = await import('./store');

const gpu = (tier: Gpu['tier']): Gpu => ({adapter: {} as GPUAdapter, f16: true, tier});
const FIREFOX = 'Cannot initialize runtime because of requested maxStorageBuffersPerShaderStage exceeds limit. '
  + 'requested=10, limit=9. ';

beforeEach(() => {
  web.state.holds = 1e9;
  web.state.fails = null;
  web.state.hangs = false;
  web.state.cacheHangs = false;
  web.state.loads = [];
  web.state.terminated = 0;
  vi.stubGlobal('Worker', class { terminate() { web.state.terminated += 1; } });
});
afterEach(() => { vi.unstubAllGlobals(); });

const settled = async (e: ReturnType<typeof createEngine>) => {
  for (let i = 0; i < 50 && ['fetching', 'starting'].includes(e.fetching()?.state ?? ''); i++) {
    await new Promise((go) => setTimeout(go, 0));
  }
  return e.fetching();
};

test('a strong device loads the long context, and says so', async () => {
  const e = createEngine(gpu('strong'), unkept('2b'));
  expect(await e.start()).toBe('ready');
  expect(web.state.loads).toEqual([8192]);
  expect(e.context()).toBe(8192);
});

test('an ordinary device loads the long one too', async () => {
  const e = createEngine(gpu('ordinary'), unkept('2b'));
  expect(await e.start()).toBe('ready');
  expect(web.state.loads).toEqual([8192]);
  expect(e.context()).toBe(8192);
});

test('a weak device loads the short one and never tries the long', async () => {
  const e = createEngine(gpu('weak'), unkept('0.8b'));
  expect(await e.start()).toBe('ready');
  expect(web.state.loads).toEqual([4096]);
  expect(e.context()).toBe(4096);
});

test('an ordinary device whose long load fails comes up short from the cache', async () => {
  web.state.holds = 4096;
  const e = createEngine(gpu('ordinary'), unkept('2b'));
  expect(await e.start()).toBe('ready');
  expect(web.state.loads).toEqual([8192, 4096]);
  expect(e.context()).toBe(4096);
});

test('a long context that will not load comes up short, in a worker of its own', async () => {
  web.state.holds = 4096;
  const e = createEngine(gpu('strong'), unkept('4b'));
  const told: number[] = [];
  e.onChange(() => told.push(e.context()));
  expect(await e.start()).toBe('ready');
  expect(web.state.loads).toEqual([8192, 4096]);
  // The failed worker ended, device and all, before the second load.
  expect(web.state.terminated).toBe(1);
  expect(e.context()).toBe(4096);
  // What the game's window follows ends at the short one.
  expect(told.at(-1)).toBe(4096);
  expect(e.outgrown()).toBeNull();
  // Started again (after a stall, say): short from the first ask, in this page.
  await e.stop();
  web.state.loads = [];
  expect(e.context()).toBe(4096);
});

test('a GPU short of a limit: said in the page\'s words, not tried again short, no voice', async () => {
  web.state.fails = new Error(FIREFOX);
  const e = createEngine(gpu('strong'), unkept());
  e.fetch('0.8b');
  const f = await settled(e);
  expect(f?.state).toBe('error');
  expect(f?.error).toBe(outgrownSaid({limit: 'maxStorageBuffersPerShaderStage', requested: '10', given: '9'}));
  expect(web.state.loads).toEqual([8192]);
  expect(e.outgrown()).toEqual({limit: 'maxStorageBuffersPerShaderStage', requested: '10', given: '9'});
  expect(await e.past()).toBe(false);
});

test('any other failure is reported as it is, and the voice beside it still comes', async () => {
  web.state.fails = new TypeError('Failed to fetch');
  const e = createEngine(gpu('ordinary'), unkept());
  e.fetch('2b');
  const f = await settled(e);
  expect(f).toMatchObject({state: 'error', error: 'Failed to fetch'});
  expect(e.outgrown()).toBeNull();
  expect(await e.past()).toBe(true);
});

test('the stand-in: the card asked for words and a voice, on a GPU short of a limit', async () => {
  web.state.fails = new Error(FIREFOX);
  const e = createEngine(gpu('ordinary'), unkept());
  const voice = {get: vi.fn(), onChange: () => () => {}, status: () => 'off', grace: () => null,
                 parts: () => [], fetching: () => null, stats: () => ({}), chosen: () => '', card: () => null};
  const answer = pageMachine(e, memoryDrawer(), undefined, voice as never);
  await answer('/machine/models/fetch', {method: 'POST', body: JSON.stringify({size: '2b', voice: 'turbo'})});
  await settled(e);
  await e.past();
  await new Promise((go) => setTimeout(go, 0));
  expect(voice.get).not.toHaveBeenCalled();
  // The card is told why, in the same words, and offered nothing.
  const facts = await (await answer('/machine')).json() as {llm: Record<string, unknown>};
  expect(facts.llm).toMatchObject({why: 'limits', offer: [], said: expect.stringMatching(/can’t run the pill yet/)});

  // And where the words get past the check, the voice is fetched with them.
  web.state.fails = null;
  const ok = createEngine(gpu('ordinary'), unkept());
  const answer2 = pageMachine(ok, memoryDrawer(), undefined, voice as never);
  await answer2('/machine/models/fetch', {method: 'POST', body: JSON.stringify({size: '2b', voice: 'turbo'})});
  await settled(ok);
  await new Promise((go) => setTimeout(go, 0));
  expect(voice.get).toHaveBeenCalledWith('turbo');
});

test('a cache that never says what it holds: the offer answers in time, marked not known', async () => {
  // The library imported once already, as it is by the time anybody opens the panel.
  await createEngine(gpu('weak'), unkept('0.8b')).offer();
  web.state.cacheHangs = true;
  // And the Cache API under it, for whatever reads it directly.
  vi.stubGlobal('caches', {open: () => new Promise(() => {}), keys: () => new Promise(() => {})});
  const e = createEngine(gpu('weak'), unkept('0.8b'), {checkMs: 20});
  const began = Date.now();
  const offer = await e.offer();
  expect(Date.now() - began).toBeLessThan(1000);
  expect(offer.map((o) => [o.size, o.here, o.unknown])).toEqual([['0.8b', false, true], ['2b', false, true]]);
  expect(await e.here()).toBe(false);
  // Once it has answered, a later hang is answered with what it last said.
  web.state.cacheHangs = false;
  const known = createEngine(gpu('weak'), unkept('0.8b'), {checkMs: 20});
  expect(await known.here()).toBe(true);
  web.state.cacheHangs = true;
  expect(await known.here()).toBe(true);
  expect((await known.offer())[0]).toMatchObject({size: '0.8b', here: true});
  expect((await known.offer())[0]?.unknown).toBeUndefined();
});

test('the stand-in answers GET /machine in one wait when the cache and the ear both stop answering', async () => {
  web.state.cacheHangs = true;
  vi.stubGlobal('caches', {open: () => new Promise(() => {}), keys: () => new Promise(() => {})});
  const e = createEngine(gpu('weak'), unkept('0.8b'), {checkMs: 20});
  const ear = {known: () => new Promise<void>(() => {}), status: () => 'off', grace: () => null, parts: () => [],
               fetching: () => null, onChange: () => () => {}, chosen: () => '', card: () => null};
  const answer = pageMachine(e, memoryDrawer(), undefined, null, undefined, ear as never);
  const began = Date.now();
  const res = await Promise.race([answer('/machine'), new Promise<null>((go) => setTimeout(() => go(null), 6000))]);
  expect(res).not.toBeNull();
  // The ear's bound and the words' side by side: one wait (CHECK_MS, 4 s), not one after another.
  expect(Date.now() - began).toBeLessThan(5000);
  const facts = await res!.json() as {llm: {offer: Array<{unknown?: boolean}>}};
  expect(facts.llm.offer.every((o) => o.unknown)).toBe(true);
}, 10_000);

test('a load that says nothing for its quiet time is put down, and said why', async () => {
  web.state.hangs = true;
  const e = createEngine(gpu('weak'), unkept(), {loadQuietMs: 30});
  e.fetch('0.8b');
  expect(e.settled()).not.toBeNull();
  const up = await e.settled();
  expect(up).toBe(false);
  const f = await settled(e);
  expect(f).toMatchObject({state: 'error', error: new LoadStuck(30).message});
  expect(web.state.terminated).toBe(1);
  expect(e.status()).toBe('error');
  // A line asked then is told why, not left waiting.
  const answer = pageMachine(e, memoryDrawer());
  const body = await (await answer('/machine/chat', {method: 'POST', body: JSON.stringify({messages: []})})).text();
  expect(body).toMatch(/did not come up in this browser: the words stopped coming down/);
  expect(body).toMatch(/"told":true/);
});

test('settled: nothing under way is null; a load under way ends with the words up', async () => {
  const e = createEngine(gpu('weak'), unkept('0.8b'));
  expect(e.settled()).toBeNull();
  e.fetch('0.8b');
  expect(await e.settled()).toBe(true);
  expect(e.settled()).toBeNull();
});
