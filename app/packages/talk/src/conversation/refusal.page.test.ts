/* The refusal guard in a browser, end to end: talk's `chat` through the
 * machine's one seam to the page's stand-in and its engine, with WebLLM
 * stood in for by a fake whose lock goes only at the end of a stream, as the
 * real worker's does (see engine.chat.test.ts in @lucid/machine). A refusal
 * cut a sentence in has to let go of that lock -- the engine reads the cut
 * stream out -- or the second ask, and every turn after it, waits for good. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';

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
  };
  let interrupted = false;
  const state = {script: [] as string[], asked: 0, interrupts: 0};
  const engine = {
    interruptGenerate: async () => { interrupted = true; state.interrupts += 1; },
    setInitProgressCallback() {},
    async reload() {},
    async unload() {},
    chat: {completions: {async create() {
      const reply = state.script[state.asked] ?? '';
      state.asked += 1;
      await lock.acquire();
      return (async function* () {
        interrupted = false;              // as asyncGenerate does on its first step
        for (const w of reply.split(/(?<= )/)) {
          if (interrupted) break;
          yield {choices: [{delta: {content: w}}]};
        }
        yield {choices: [{delta: {}, finish_reason: 'stop'}]};
        yield {choices: [], usage: {prompt_tokens: 3, completion_tokens: 4}};
        lock.release();
      })();
    }}},
  };
  return {state, engine};
});

vi.mock('@mlc-ai/web-llm', () => ({
  CreateWebWorkerMLCEngine: async () => web.engine,
  hasModelInCache: async () => true,
}));

const {answeredBy} = await import('@lucid/machine');
const {createEngine, unkept} = await import('@lucid/machine/page/engine.js');
const {pageMachine} = await import('@lucid/machine/page/machine.js');
const {memoryDrawer} = await import('@lucid/machine/page/store.js');
const {PAGE, MACHINE, setHost} = await import('@lucid/shell');
const {chat} = await import('./refusal');

const REFUSAL = "I can't continue this roleplay. I am an AI assistant, and I cannot do that. Can I help with something else?";
const HERS = 'You came back. Come here, closer, I missed you all day.';
const NEXT = 'Mm. Stay a while, the rain is not stopping.';

beforeEach(async () => {
  web.state.script = [];
  web.state.asked = 0;
  web.state.interrupts = 0;
  vi.stubGlobal('Worker', class { terminate() {} });
  const engine = createEngine({adapter: {} as GPUAdapter, f16: true, tier: 'strong'}, unkept('4b'));
  expect(await engine.start()).toBe('ready');
  answeredBy(pageMachine(engine, memoryDrawer()));
  setHost({...PAGE, censored: engine.censored()});
});
afterEach(() => {
  answeredBy(null);
  setHost(MACHINE);
  vi.unstubAllGlobals();
});

const said = async (): Promise<string> => {
  let out = '';
  for await (const d of chat({messages: [{role: 'user', content: 'hello'}]})) out += d;
  return out;
};

test('a refusal cut in a browser lets go of the model: the retry is answered, and the next turn too', async () => {
  web.state.script = [REFUSAL, HERS, NEXT];
  expect(await said()).toBe(HERS);
  expect(web.state.interrupts).toBeGreaterThan(0);
  // The next turn is not left waiting on the cut one's lock.
  expect(await said()).toBe(NEXT);
  expect(web.state.asked).toBe(3);
});
