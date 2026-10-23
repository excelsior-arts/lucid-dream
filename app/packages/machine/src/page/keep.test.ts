/* Asking that the downloads be kept: asked where it costs nothing, never a
   prompt twice, and nothing waits on or breaks for the answer. */
import {beforeEach, expect, test} from 'vitest';
import {forgetAsking, keepDownloads} from './keep';
import type {KeepEnv} from './keep';

function env(o: {persisted?: boolean; grant?: boolean; pressed?: boolean; prompts?: boolean; safari?: boolean;
                 none?: boolean; asked?: boolean} = {}) {
  const seen = {persist: 0, said: [] as string[], asked: o.asked ?? false};
  const e: KeepEnv = {
    storage: o.none ? {} : {
      persisted: () => Promise.resolve(o.persisted ?? false),
      persist: () => { seen.persist++; return Promise.resolve(o.grant ?? false); },
    },
    pressed: () => o.pressed ?? false,
    prompts: o.prompts ?? false,
    safari: o.safari ?? false,
    askedBefore: () => seen.asked,
    noteAsked: () => { seen.asked = true; },
    say: (line) => seen.said.push(line),
  };
  return {e, seen};
}

beforeEach(() => forgetAsking());

test('already kept: nothing is asked', async () => {
  const {e, seen} = env({persisted: true});
  expect(await keepDownloads({}, e)).toBe(true);
  expect(seen.persist).toBe(0);
});

test('a browser with no such thing answers null and says nothing', async () => {
  const {e, seen} = env({none: true});
  expect(await keepDownloads({}, e)).toBe(null);
  expect(seen.said).toEqual([]);
});

test('a deciding browser (Chrome, Safari) is asked on a download, press or not, and on every one', async () => {
  const {e, seen} = env({grant: true});
  expect(await keepDownloads({}, e)).toBe(true);
  expect(await keepDownloads({}, e)).toBe(true);
  expect(seen.persist).toBe(2);
  expect(seen.said).toEqual([]);
});

test('the open asks once a load', async () => {
  const {e, seen} = env();
  await keepDownloads({open: true}, e);
  await keepDownloads({open: true}, e);
  expect(seen.persist).toBe(1);
});

test('the voice, the words and the ear asked at once are one ask', async () => {
  const {e, seen} = env({prompts: true, pressed: true});
  await Promise.all([keepDownloads({}, e), keepDownloads({}, e), keepDownloads({}, e)]);
  expect(seen.persist).toBe(1);
});

test('refused, the console says once what would keep them; the page goes on', async () => {
  const {e, seen} = env({grant: false});
  expect(await keepDownloads({}, e)).toBe(false);
  expect(await keepDownloads({}, e)).toBe(false);
  expect(seen.said).toHaveLength(1);
  expect(seen.said[0]).toMatch(/bookmarking or installing this page/);
  for (const w of seen.said) expect(w).not.toMatch(/Mac app|desktop app|\bTTS\b|\bSTT\b|\bASR\b/);
});

test('Safari is told what keeps them there', async () => {
  const {e, seen} = env({safari: true});
  await keepDownloads({}, e);
  expect(seen.said[0]).toMatch(/Dock or the Home Screen/);
});

test('Firefox, which prompts: only from a press, only once in this browser, never on an open', async () => {
  const off = env({prompts: true, pressed: false});
  expect(await keepDownloads({}, off.e)).toBe(false);
  expect(await keepDownloads({open: true}, off.e)).toBe(false);
  expect(off.seen.persist).toBe(0);
  expect(off.seen.said).toEqual([]);

  // An open never asks there, whatever the browser says of a press.
  forgetAsking();
  const opened = env({prompts: true, pressed: true});
  expect(await keepDownloads({open: true}, opened.e)).toBe(false);
  expect(opened.seen.persist).toBe(0);

  forgetAsking();
  const on = env({prompts: true, pressed: true});
  await keepDownloads({}, on.e);
  expect(on.seen.persist).toBe(1);
  expect(on.seen.asked).toBe(true);
  // A "Not now": the next press, and the next load, are not asked again.
  await keepDownloads({}, on.e);
  forgetAsking();
  await keepDownloads({}, on.e);
  expect(on.seen.persist).toBe(1);
  expect(on.seen.said).toHaveLength(1);
  expect(on.seen.said[0]).toMatch(/persistent storage/);
});

test('Firefox, allowed before: kept, and nothing asked', async () => {
  const {e, seen} = env({prompts: true, persisted: true, asked: true});
  expect(await keepDownloads({}, e)).toBe(true);
  expect(seen.persist).toBe(0);
});

test('a persist that throws is a no, never a fault', async () => {
  const {e} = env();
  e.storage = {persisted: () => Promise.reject(new Error('x')), persist: () => Promise.reject(new Error('y'))};
  expect(await keepDownloads({}, e)).toBe(false);
});
