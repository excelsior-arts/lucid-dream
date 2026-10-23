/* The voice's switch and /voice_engine, as far as what is kept: on or off and
   which engine, said to the config the page was handed and nowhere else. */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {sound, voiceOffer} from '@lucid/shell';
import {createVoice, plainly} from './voice';
import type {VoiceChoice} from './voice';
import type {EngineId} from './voice-worker';

const loads: string[] = [];
const fetches: string[] = [];
/** An engine whose load fails, and what it throws: the phone's, by default. */
let failing: {engine: string; error: string} | null = null;
/** What the browser's cache holds, as the check worker answers. */
let inCache: string[] = [];
let alive = 0;
/** The workers that loaded, newest last, and what each was asked to speak. */
const loaded: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((ev: {data: unknown}) => void) | null = null;
  private counted = false;
  spoken: string[] = [];
  postMessage(m: {type: string; engine?: string; engines?: Array<{engine: string}>; id?: string}) {
    const say = (data: unknown) => queueMicrotask(() => this.onmessage?.({data}));
    if (m.type === 'speak') this.spoken.push(m.id!);
    if (m.type === 'check') {
      say({type: 'checked', here: m.engines!.map((e) => e.engine).filter((e) => inCache.includes(e))});
    } else if (m.type === 'fetch') {
      fetches.push(m.engine!);
      say({type: 'progress', got: 0.5});
      say({type: 'fetched'});
    } else if (m.type === 'load') {
      // A worker that loads is one holding a GPU: counted until it is ended.
      this.counted = true;
      alive += 1;
      loads.push(m.engine!);
      loaded.push(this);
      if (failing?.engine === m.engine) say({type: 'failed', error: failing!.error});
      else say({type: 'ready', load_s: 0});
    }
  }
  terminate() { if (this.counted) alive -= 1; this.counted = false; }
}

beforeEach(() => {
  loaded.length = 0;
  loads.length = 0;
  fetches.length = 0;
  inCache = ['turbo', 'nano', 'sopro'];
  alive = 0;
  failing = null;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  sound.setHush(false);
  sound.setLevel(0.7);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function kept(enabled: boolean, engine: string) {
  const said: Array<[boolean, EngineId | undefined]> = [];
  const choice: VoiceChoice = {
    enabled, engine,
    choose(on, e) { this.enabled = on; if (e) this.engine = e; said.push([on, e]); },
  };
  return {choice, said};
}

test('the switch turns the kept engine on and off, and says only on or off', async () => {
  const {choice, said} = kept(false, 'sopro');
  const voice = createVoice(true, choice);
  expect(voice.chosen()).toBe('');
  expect(voiceOffer()).toMatchObject({on: false, what: 'Sopro v2 Turbo'});
  voiceOffer()!.set(true);                  // asks the cache first: Sopro is there
  await flush();
  expect(said).toEqual([[true, undefined]]);
  expect(loads).toEqual(['sopro']);
  expect(voice.chosen()).toBe('sopro');
  voiceOffer()!.set(false);
  expect(said.at(-1)).toEqual([false, undefined]);
  expect(choice.engine).toBe('sopro');
  expect(voice.chosen()).toBe('');
  expect(localStorage.length).toBe(0);
});

test('an engine named is kept with it; one not offered here is Turbo', () => {
  const {choice, said} = kept(true, 'nano');
  // No shader-f16: Nano is not offered, and Turbo stands in for it.
  const voice = createVoice(false, choice);
  expect(voice.chosen()).toBe('turbo');
  voice.choose('sopro');
  expect(said).toEqual([[true, 'sopro']]);
  expect(voice.chosen()).toBe('sopro');
  voice.choose('');
  expect(said.at(-1)).toEqual([false, undefined]);
  expect(choice).toMatchObject({enabled: false, engine: 'sopro'});
});

test('silent, a loaded voice is let go of after the grace, and loads again when the sound is back', async () => {
  vi.useFakeTimers();
  const {choice} = kept(true, 'turbo');
  const voice = createVoice(true, choice);
  voice.want(true);                         // a room, the sound on
  await Promise.resolve();
  expect([loads, alive, voice.status()]).toEqual([['turbo'], 1, 'ready']);
  voice.want(false);                        // the room gone silent
  expect(voice.grace()).toBe(90);
  vi.advanceTimersByTime(60_000);
  voice.want(true);                         // back inside the grace: nothing moved
  expect([alive, voice.grace(), loads.length]).toEqual([1, null, 1]);
  voice.want(false);
  vi.advanceTimersByTime(90_000);
  expect([alive, voice.status(), voice.chosen()]).toEqual([0, 'off', 'turbo']);
  expect(choice.enabled).toBe(true);        // let go of, still chosen
  voice.want(true);
  await Promise.resolve();
  expect([loads, alive, voice.status()]).toEqual([['turbo', 'turbo'], 1, 'ready']);
});

test('silent, a voice switched on is kept chosen and not fetched until the sound is back', async () => {
  vi.useFakeTimers();
  const {choice, said} = kept(false, 'turbo');
  const voice = createVoice(true, choice);
  sound.setLevel(0);                        // the knob at zero is silent too
  voiceOffer()!.set(true);
  await flush();
  expect(said).toEqual([[true, undefined]]);
  expect(loads).toEqual([]);
  expect(voiceOffer()).toMatchObject({on: true, silent: true, state: 'off'});
  sound.setLevel(0.5);                      // the sound back, no room: still nothing fetched
  expect(voiceOffer()).toMatchObject({on: true, silent: false});
  expect(loads).toEqual([]);
  voice.want(true);                         // a room asks
  expect(loads).toEqual(['turbo']);
});

test('a page muted with no room open lets go of the voice too', async () => {
  vi.useFakeTimers();
  const {choice} = kept(true, 'sopro');
  const voice = createVoice(true, choice);
  voice.graceMs = 1000;
  voice.want(true);
  await Promise.resolve();
  expect(alive).toBe(1);
  sound.setHush(true);
  vi.advanceTimersByTime(1000);
  expect([alive, voice.status()]).toEqual([0, 'off']);
});

test('the card brings a voice down: loaded with the sound on, only fetched while it is off', async () => {
  inCache = [];
  const {choice, said} = kept(false, 'turbo');
  const voice = createVoice(true, choice);
  expect(voice.parts().map((p) => [p.id, p.gb, p.suggested])).toEqual(
    [['turbo', 0.699, true], ['nano', 0.576, false], ['sopro', 0.362, false]]);
  sound.setHush(true);
  voice.get('sopro');
  expect(said).toEqual([[true, 'sopro']]);
  await Promise.resolve(); await Promise.resolve();
  expect([fetches, loads, alive]).toEqual([['sopro'], [], 0]);
  expect(voice.fetching()).toMatchObject({state: 'done', gb: 0.362});
  expect(voice.parts().find((p) => p.id === 'sopro')!.here).toBe(true);
  sound.setHush(false);
  voice.want(true);                         // the sound back, a room asks: from the cache
  await Promise.resolve();
  expect([loads, voice.status()]).toEqual([['sopro'], 'ready']);
});

test('switched on with nothing in the cache, the switch opens the card and starts nothing', async () => {
  inCache = [];
  const {onAskForCard} = await import('@lucid/shell');
  const asked: string[] = [];
  const off = onAskForCard((section) => asked.push(section));
  const {choice, said} = kept(false, 'turbo');
  createVoice(true, choice);
  voiceOffer()!.set(true);
  await flush();
  expect(asked).toEqual(['voice']);
  expect([said, loads, fetches]).toEqual([[], [], []]);
  expect(voiceOffer()).toMatchObject({on: false, missing: true});
  off();
});

/* The GPU letting go of the voice. Measured 10-10, the device destroyed under
   Sopro: ONNX Runtime said nothing, the sentence being made never came back,
   the reply waited on it for good, and the line after it was never answered. */
test('the GPU let go of the voice: what it was making is answered in the page\'s words, and it starts again', async () => {
  const {choice} = kept(true, 'sopro');
  const voice = createVoice(true, choice);
  voice.want(true);
  await flush();
  const sock = voice.socket('');
  const heard: Array<Record<string, unknown>> = [];
  sock.onmessage = (ev) => heard.push(JSON.parse(ev.data) as Record<string, unknown>);
  await flush();
  sock.send(JSON.stringify({text: 'Hello there.', voice: 'lucid_talk/personas/lover', id: '7'}));
  expect(loaded[0]!.spoken).toHaveLength(1);
  loaded[0]!.onmessage!({data: {type: 'lost', reason: 'unknown', message: 'reset'}});
  expect(heard).toEqual([{id: '7', told: true,
    error: 'this browser’s GPU let go of the voice — it is starting again; the words go on'}]);
  // Its worker let go of with the device, and the voice started again from the cache.
  await flush();
  expect([loads, alive, voice.status()]).toEqual([['sopro', 'sopro'], 1, 'ready']);
  // Lost again a moment later: not started a third time, and said.
  loaded[1]!.onmessage!({data: {type: 'lost', reason: 'unknown', message: 'reset'}});
  await flush();
  expect([loads.length, alive, voice.status()]).toEqual([2, 0, 'error']);
});

test('a delete is refused the engine in use, and leaves a deleted one downloadable', async () => {
  const {choice} = kept(true, 'sopro');
  const voice = createVoice(true, choice);
  await new Promise((go) => setTimeout(go, 1600));          // the cache asked
  expect(voice.inUse('sopro')).toBe(true);
  expect(voice.inUse('turbo')).toBe(false);
  voice.forgot('turbo');
  expect(voice.parts().find((p) => p.id === 'turbo')!.here).toBe(false);
  expect(voice.parts().find((p) => p.id === 'sopro')!.here).toBe(true);
});

/* The iPhone Air's, 10-10: Turbo asked for in the same press as the words,
   while they came down. */
const PHONE = 'no available backend found. ERR: [webgpu] RangeError: Out of memory';

test('a failure is said in plain words, never the engine\'s own', () => {
  expect(plainly(PHONE)).toBe('this device ran out of memory starting it');
  expect(plainly('QuotaExceededError: The quota has been exceeded.')).toBe('this browser has no room left to keep it');
  expect(plainly('Load failed')).toBe('the download broke off');
  expect(plainly('Failed to fetch https://huggingface.co/x/onnx/model.onnx: 500')).toBe('the download broke off');
  expect(plainly('no available backend found. ERR: [webgpu] Error: no adapter')).toBe('this browser’s graphics could not run it');
  expect(plainly('something else')).toBe('it would not start here');
});

test('Turbo out of memory: its row says why, the smallest is suggested instead, and choosing none clears it', async () => {
  failing = {engine: 'turbo', error: PHONE};
  const {choice} = kept(false, 'turbo');
  const voice = createVoice(true, choice);
  voice.get('turbo');
  await flush();
  expect(voice.status()).toBe('error');
  expect(voice.fetching()).toMatchObject({state: 'error', error: 'this device ran out of memory starting it'});
  const rows = voice.parts();
  expect(rows.find((p) => p.id === 'turbo')).toMatchObject({error: 'this device ran out of memory starting it',
                                                            suggested: false});
  expect(rows.find((p) => p.id === 'sopro')).toMatchObject({suggested: true});
  expect(rows.find((p) => p.id === 'sopro')!.error).toBeUndefined();
  expect(voiceOffer()).toMatchObject({state: 'error', why: 'this device ran out of memory starting it'});
  // No voice: what the failed fetch left goes with it, so a later card is not stuck on it.
  voice.get('');
  expect(voice.fetching()).toBeNull();
  // Sopro, chosen instead, comes up; Turbo's row still says why until it is tried again.
  voice.get('sopro');
  await flush();
  expect(voice.status()).toBe('ready');
  expect(voice.parts().find((p) => p.id === 'turbo')!.error).toBeDefined();
  failing = null;
  voice.get('turbo');
  await flush();
  expect(voice.parts().find((p) => p.id === 'turbo')!.error).toBeUndefined();
});

test('a voice asked for while the words load starts once they are settled, never beside them', async () => {
  let settle: (up: boolean) => void = () => {};
  let words: Promise<boolean> | null = new Promise<boolean>((go) => { settle = go; });
  const {choice} = kept(false, 'turbo');
  const voice = createVoice(true, choice, () => words);
  voice.get('turbo');
  await flush();
  // Chosen and on its way, but no session made: nothing loaded yet.
  expect([loads, voice.status(), voice.fetching()?.state]).toEqual([[], 'loading', 'fetching']);
  voice.want(true);                         // a room asking meanwhile starts nothing more
  await flush();
  expect(loads).toEqual([]);
  settle(false);                            // the words failed: the voice is still let try
  words = null;
  await flush();
  expect([loads, voice.status()]).toEqual([['turbo'], 'ready']);
});

test('gone silent while it waited on the words: not started, and started when the sound is back', async () => {
  let settle: (up: boolean) => void = () => {};
  let words: Promise<boolean> | null = new Promise<boolean>((go) => { settle = go; });
  const {choice} = kept(true, 'sopro');
  const voice = createVoice(true, choice, () => words);
  voice.want(true);
  voice.want(false);
  settle(true);
  words = null;
  await flush();
  expect([loads, voice.status()]).toEqual([[], 'off']);
  voice.want(true);
  await flush();
  expect([loads, voice.status()]).toEqual([['sopro'], 'ready']);
});

test('a voice that loaded and cannot speak is put down after two chunks with no sound, and says why', async () => {
  const {host} = await import('@lucid/shell');
  const {choice} = kept(true, 'sopro');
  const voice = createVoice(true, choice);
  voice.want(true);
  await flush();
  expect(host().voice).toBe(true);
  const sock = voice.socket('');
  const heard: Array<Record<string, unknown>> = [];
  sock.onmessage = (ev) => heard.push(JSON.parse(ev.data) as Record<string, unknown>);
  await flush();
  const said = 'no available backend found. ERR: [wasm] RangeError: Out of memory';
  for (const id of ['1', '2']) {
    sock.send(JSON.stringify({text: 'Hello there.', voice: 'lucid_talk/personas/lover', id}));
    loaded[0]!.onmessage!({data: {type: 'error', id: `s1:${id}`, error: said}});
  }
  expect(heard.map((h) => h.id)).toEqual(['1', '2']);
  expect([voice.status(), alive, host().voice]).toEqual(['error', 0, false]);
  expect(voice.parts().find((p) => p.id === 'sopro')!.error).toBe('this device ran out of memory starting it');
});
