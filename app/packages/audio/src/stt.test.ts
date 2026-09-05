/* The one call between a turn heard and words: what goes up to the recognizer,
   in the encoding it wants. What the words then mean is the caller's. */
import {afterEach, expect, test, vi} from 'vitest';
import {transcribe} from './stt';

afterEach(() => { vi.unstubAllGlobals(); });

test('the whole turn goes to the recognizer as raw sixteen-bit', async () => {
  let got: {url: string; body: Int16Array} | null = null;
  vi.stubGlobal('fetch', (url: string, init: {body: Int16Array}) => {
    got = {url, body: init.body};
    return Promise.resolve({ok: true, json: () => Promise.resolve({text: 'hello'})});
  });
  const samples = Float32Array.from([0, 0.5, -0.5]);
  expect(await transcribe(samples)).toBe('hello');
  const call = got as unknown as {url: string; body: Int16Array};
  expect(call.url).toMatch(/\/machine\/stt\?rate=16000$/);
  // Two bytes a sample, little end first, and no base64 anywhere: a page has
  // the samples already and encoding them would be a third more bytes.
  expect([...new Int16Array(call.body)]).toEqual([0, 16384, -16384]);
});
