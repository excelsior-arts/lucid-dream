/* The lamps, the meter and the watchdog. Four calls with nothing in them but
   an address and a shape, and the one thing worth a test is that they are the
   addresses machine/machine.py actually hangs. */
import {afterEach, expect, test, vi} from 'vitest';
import {awaitReady, models, ping, status} from './status';

afterEach(() => { vi.unstubAllGlobals(); });

function answers(payload: unknown, ok = true) {
  const calls: Array<{url: string; method?: string; body?: string}> = [];
  vi.stubGlobal('fetch', (url: string, init?: {method?: string; body?: string}) => {
    calls.push({url, method: init?.method, body: init?.body});
    return Promise.resolve({ok, status: ok ? 200 : 503, json: () => Promise.resolve(payload)});
  });
  return calls;
}

test('what is loaded, what it costs, and what the voice last managed', async () => {
  const calls = answers({status: {llm: 'ready'}, memory: {total_gb: 21.4}, tts: {rtf: 0.6}});
  const facts = await status();
  expect(calls[0]?.url).toMatch(/\/machine$/);
  expect(facts.status.llm).toBe('ready');
  expect(facts.memory.total_gb).toBe(21.4);
});

test('somebody is still there', async () => {
  const calls = answers({status: {llm: 'ready'}});
  await ping();
  expect(calls[0]?.url).toMatch(/\/machine\/ping$/);
  expect(calls[0]?.method).toBe('POST');
});

test('the three lifecycle keys', async () => {
  const calls = answers({warmed: ['voice']});
  await models.start();
  await models.stop();
  await models.warm({kind: 'voice'});
  expect(calls.map((c) => c.url.replace(/^.*\/machine/, '/machine'))).toEqual([
    '/machine/models/start', '/machine/models/stop', '/machine/models/warm',
  ]);
  expect(JSON.parse(calls[2]!.body!)).toEqual({kind: 'voice'});
  // A warm with no body warms the voice, so there is nothing to send.
  expect(calls[0]?.body).toBeUndefined();
});

test('a machine that would not answer says so rather than coming back empty', async () => {
  answers({}, false);
  await expect(status()).rejects.toThrow('503');
});

test('a page saying it is using the ear, and saying it has stopped', async () => {
  const calls = answers({status: 'loading', grace: null});
  await models.want('stt', true);
  await models.want('tts', false);
  expect(calls.map((c) => c.url.replace(/^.*\/machine/, '/machine'))).toEqual([
    '/machine/models/stt', '/machine/models/tts',
  ]);
  expect(JSON.parse(calls[0]!.body!)).toEqual({wanted: true});
  expect(JSON.parse(calls[1]!.body!)).toEqual({wanted: false});
});

test('waiting for one to come up, and giving up on one that will not', async () => {
  /* Two ways this ends and both of them are answers: the lamp goes green, or
     the machine says the model is not coming — which is what a key that goes
     back to off is drawn from. Neither is a throw. */
  let lamp = 'loading';
  vi.stubGlobal('fetch', () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({status: {stt: lamp}}),
  }));
  const coming = awaitReady('stt', {every: 1});
  lamp = 'ready';
  expect(await coming).toBe(true);

  lamp = 'error';
  expect(await awaitReady('stt', {every: 1})).toBe(false);

  // And one nobody ever started is not one to wait two minutes for.
  lamp = 'off';
  expect(await awaitReady('stt', {every: 1})).toBe(false);
});

test('and a machine that says nothing at all is waited out rather than thrown', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('gone')));
  expect(await awaitReady('tts', {every: 1, timeout: 5})).toBe(false);
});

test('and asking for another size of the language model', async () => {
  const calls = answers({status: 'loading', size: 'md'});
  expect(await models.size('md')).toEqual({status: 'loading', size: 'md'});
  expect(calls[0]!.url.replace(/^.*\/machine/, '/machine')).toBe('/machine/models/llm');
  expect(JSON.parse(calls[0]!.body!)).toEqual({size: 'md'});
});
