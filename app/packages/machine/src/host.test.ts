/* What is behind the page, found out by asking rather than by the address. */
import {afterEach, expect, test, vi} from 'vitest';
import {host, MACHINE, setHost} from '@lucid/shell';
import {answeredBy, call} from './address';
import {settle} from './host';

afterEach(() => {
  vi.unstubAllGlobals();
  answeredBy(null);
  setHost(MACHINE);
  globalThis.__LUCID_HOST__ = undefined;
});

const answering = (status: number, body: string) => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
  Promise.resolve(new Response(body, {status, headers: {'Content-Type': 'application/json'}})));

test('a machine that answers in its own words is the machine, and nothing stands in', async () => {
  const fetch = answering(200, JSON.stringify({status: {llm: 'off'}}));
  vi.stubGlobal('fetch', fetch);
  expect(await settle()).toEqual(MACHINE);
  await call('/machine/ping', {method: 'POST'});
  expect(String(fetch.mock.calls.at(-1)?.[0])).toMatch(/\/machine\/ping$/);
});

test('a static host\'s 404 page is no machine: this page answers, and keeps the files', async () => {
  vi.stubGlobal('fetch', answering(404, '<!doctype html><title>not here</title>'));
  const got = await settle();
  expect(got.machine).toBe(false);
  expect(got.store).toBe('page');
  expect(got.voice || got.ear || got.log).toBe(false);
  // jsdom has no WebGPU: no model, and the card says so.
  expect(got.llm).toBe('none');
  const facts = await (await call('/machine')).json() as {llm: {why: string}; status: {tts: string}};
  expect(facts.llm.why).toBe('webgpu');
  expect(facts.status.tts).toBe('off');
  await call('/store/g/data/a.json', {method: 'PUT', body: '{"x":1}'});
  expect(await (await call('/store/g/data/a.json')).text()).toBe('{"x":1}');
});

test('nothing answering at all is no machine either', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  expect((await settle()).machine).toBe(false);
});

test('a wrapper that says so is not asked', async () => {
  const fetch = answering(200, '{}');
  vi.stubGlobal('fetch', fetch);
  globalThis.__LUCID_HOST__ = {machine: true, voice: false};
  const got = await settle();
  expect(fetch).not.toHaveBeenCalled();
  expect(got.machine).toBe(true);
  expect(host().voice).toBe(false);
});

test('a machine without its voice on the shelf speaks nothing and offers the card on the switch', async () => {
  const {voiceOffer, onAskForCard} = await import('@lucid/shell');
  vi.stubGlobal('fetch', answering(200, JSON.stringify({status: {llm: 'ready'},
    shelf: {voice: [{id: 'tts', name: 'Chatterbox Turbo', gb: 3, here: false, suggested: true}],
            ear: [{id: 'stt', name: 'Parakeet', gb: 2.5, here: true, suggested: true}], fetch: null}})));
  const got = await settle();
  expect(got.machine).toBe(true);
  expect(got.voice).toBe(false);
  expect(voiceOffer()).toMatchObject({on: false, missing: true, what: 'Chatterbox Turbo', mb: 3000});
  const asked: string[] = [];
  const off = onAskForCard((s) => asked.push(s));
  voiceOffer()!.set(true);
  expect(asked).toEqual(['voice']);
  off();
  // And with it there: nothing offered, the voice spoken.
  vi.stubGlobal('fetch', answering(200, JSON.stringify({status: {llm: 'ready'},
    shelf: {voice: [{id: 'tts', name: 'Chatterbox Turbo', gb: 3, here: true, suggested: true}], ear: [], fetch: null}})));
  expect((await settle()).voice).toBe(true);
  expect(voiceOffer()).toBeNull();
});
