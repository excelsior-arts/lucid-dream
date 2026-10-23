/* Which size the first-open card suggests, from what a browser lets a page
   see. The four devices are the ones the rule was written for; the numbers
   are what each reports (the Mac's measured in headless Chromium 151, 10-08). */
import {expect, test} from 'vitest';
import {contextFor, createEngine, outgrown, outgrownSaid, suggestedFor, tierOf, unable, unableSaid} from './engine';
import type {Gpu, Signals} from './engine';

const GiB = 2 ** 30;

const MAC: Signals = {mobile: false, deviceMemory: 32, maxBufferSize: 4 * GiB - 4,
  maxStorageBufferBindingSize: 4 * GiB - 4, vendor: 'apple', architecture: 'metal-3'};
const LAPTOP: Signals = {mobile: false, deviceMemory: 8, maxBufferSize: 2 * GiB,
  maxStorageBufferBindingSize: 2 * GiB - 4, vendor: 'intel', architecture: 'gen-12lp'};
const PHONE: Signals = {mobile: true, deviceMemory: 8, maxBufferSize: 2 * GiB,
  maxStorageBufferBindingSize: GiB, vendor: 'qualcomm', architecture: 'adreno-7xx'};

const suggests = (s: Signals) => suggestedFor(tierOf(s));

test('a strong Mac: the 4B, offered and suggested', () => {
  expect(tierOf(MAC)).toBe('strong');
  expect(suggests(MAC)).toBe('4b');
  // A discrete card is as strong.
  expect(suggests({...MAC, vendor: 'nvidia', architecture: 'ampere'})).toBe('4b');
});

test('an ordinary laptop: the 2B, and no 4B on the card', () => {
  expect(tierOf(LAPTOP)).toBe('ordinary');
  expect(suggests(LAPTOP)).toBe('2b');
  // One sign short of strong is ordinary: a Mac whose browser says 4 GB, a
  // Mac with small bindings, an Apple GPU before Metal 3.
  expect(suggests({...MAC, deviceMemory: 4})).toBe('2b');
  expect(suggests({...MAC, maxStorageBufferBindingSize: GiB})).toBe('2b');
  expect(suggests({...MAC, architecture: 'metal-2'})).toBe('2b');
});

test('a phone: the 0.8B', () => {
  expect(tierOf(PHONE)).toBe('weak');
  expect(suggests(PHONE)).toBe('0.8b');
  // And a desktop browser that will not give out a 1 GiB buffer, or says 2 GB.
  expect(suggests({...LAPTOP, maxBufferSize: GiB / 2})).toBe('0.8b');
  expect(suggests({...LAPTOP, deviceMemory: 2})).toBe('0.8b');
});

test('Safari or Firefox, which say nothing about memory: the adapter decides alone', () => {
  const {deviceMemory: _, ...safari} = MAC;
  void _;
  expect(suggests(safari)).toBe('4b');
  const {deviceMemory: __, ...firefox} = LAPTOP;
  void __;
  expect(suggests(firefox)).toBe('2b');
  // A browser that names no vendor is never strong: big buffers alone are
  // what a software adapter can claim too.
  expect(suggests({...safari, vendor: '', architecture: ''})).toBe('2b');
});

/* Whether a browser may try at all: any GPU that is not a software one. What
   its limits are enough for is WebLLM's to say on the load (engine.load.test). */
const gpu = (o: Partial<Gpu>): Gpu => ({adapter: {} as GPUAdapter, f16: true, tier: 'ordinary', ...o});

test('any WebGPU tries the words: nothing counted here, every size its tier allows offered', async () => {
  expect(unable(gpu({}))).toBe('');
  const offer = await createEngine(gpu({})).offer();
  expect(offer.map((o) => o.size)).toEqual(['0.8b', '2b']);
  expect(offer.find((o) => o.suggested)?.size).toBe('2b');
  expect((await createEngine(gpu({tier: 'strong'})).offer()).map((o) => o.size)).toEqual(['0.8b', '2b', '4b']);
  // No adapter is still no WebGPU.
  expect(unable(gpu({adapter: null}))).toBe('webgpu');
  expect(unableSaid()).toBe('this browser has no WebGPU to run a model on');
});

test('WebLLM\'s refusal for a limit is read, whichever limit; anything else is not', () => {
  const firefox = new Error('Cannot initialize runtime because of requested maxStorageBuffersPerShaderStage '
    + 'exceeds limit. requested=10, limit=9. ');
  expect(outgrown(firefox)).toEqual({limit: 'maxStorageBuffersPerShaderStage', requested: '10', given: '9'});
  // As a worker hands it over: a string.
  expect(outgrown(String(firefox))).toEqual({limit: 'maxStorageBuffersPerShaderStage', requested: '10', given: '9'});
  expect(outgrown(new Error('Cannot initialize runtime because of requested maxBufferSize exceeds limit. '
    + 'requested=256MB, limit=128MB. Consider upgrading your browser.')))
    .toEqual({limit: 'maxBufferSize', requested: '256MB', given: '128MB'});
  expect(outgrown(new Error('Cannot initialize runtime because of requested maxComputeWorkgroupStorageSize '
    + 'exceeds limit. requested=32768, limit=16384. '))?.given).toBe('16384');
  expect(outgrown(new Error('The WebGPU device was lost while loading the model.'))).toBeNull();
  expect(outgrown(new TypeError('Failed to fetch'))).toBeNull();
});

test('said in the page\'s words: what it cannot do yet, that an update may lift it, what runs it', () => {
  const said = outgrownSaid({limit: 'maxStorageBuffersPerShaderStage', requested: '10', given: '9'});
  expect(said).toBe('This browser’s graphics can’t run the pill yet: the model asks its WebGPU for '
    + '10 storage buffers a shader, and it gives 9. A browser update may lift that. Chrome, Edge and '
    + 'Safari run it, or run it on your Mac.');
  expect(said).not.toMatch(/Mac app|desktop app/);
  // A limit nobody named here is said by its own name.
  expect(outgrownSaid({limit: 'maxFoo', requested: '2', given: '1'})).toMatch(/for 2 maxFoo, and it gives 1\./);
});

test('the long context on every device but a weak one', () => {
  expect(contextFor('strong')).toBe(8192);
  expect(contextFor('ordinary')).toBe(8192);
  // A phone's tab past its memory is killed, not failed: it never tries 8192.
  expect(contextFor('weak')).toBe(4096);
  // Asked for before a load, so the game's window is the right one from the first room.
  expect(createEngine(gpu({tier: 'strong'})).context()).toBe(8192);
  expect(createEngine(gpu({tier: 'ordinary'})).context()).toBe(8192);
  expect(createEngine(gpu({tier: 'weak'})).context()).toBe(4096);
});
