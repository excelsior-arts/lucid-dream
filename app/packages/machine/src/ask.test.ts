/* A decision asked of a model, and what is done with what it says back: the
   JSON found in it, checked, and the one retry. What is under test is the
   reader's patience -- fences, preambles, a stray comma -- and that a bad
   answer is refused rather than guessed at. */
import {afterEach, expect, test, vi} from 'vitest';
import {ask, colour, findJson, line, list, num, word} from './ask';

afterEach(() => { vi.unstubAllGlobals(); });

const frame = (text: string) =>
  'data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\n\n';

/** A machine that answers each call with the next of these, whole. */
function answers(replies: string[]) {
  const enc = new TextEncoder();
  const bodies: string[][] = [];
  const fetch = vi.fn(() => {
    const text = replies[bodies.length] ?? '';
    bodies.push([]);
    const lumps = [frame(text), 'data: [DONE]\n\n'];
    let i = 0;
    return Promise.resolve({
      ok: true,
      body: {getReader: () => ({
        read: () => Promise.resolve(
          i < lumps.length ? {done: false, value: enc.encode(lumps[i++]!)} : {done: true}),
        cancel: () => Promise.resolve(),
      })},
    });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const sent = (fetch: ReturnType<typeof vi.fn>, n: number) =>
  JSON.parse((fetch.mock.calls[n] as unknown as [string, {body: string}])[1].body) as
    {messages: Array<{role: string; content: string}>};

test('the object is found under a fence and a preamble', () => {
  expect(findJson('Sure! Here it is:\n```json\n{"a": 1}\n```\nAnything else?'))
    .toBe('{"a": 1}');
});

test('a brace inside a string does not close the object', () => {
  expect(findJson('{"name": "the {Salt} Flats", "n": 2}'))
    .toBe('{"name": "the {Salt} Flats", "n": 2}');
});

test('a trailing comma is forgiven, and nothing else is', () => {
  expect(JSON.parse(findJson('{"a": [1, 2,], "b": 3,}')!)).toEqual({a: [1, 2], b: 3});
  expect(findJson('no object here')).toBeNull();
  expect(findJson('{"unclosed": 1')).toBeNull();
});

test('a thinking block that reached the page is not read as the answer', () => {
  expect(findJson('<think>{"draft": 0}</think>{"final": 1}')).toBe('{"final": 1}');
});

test('a good answer comes back on the first try, read by the caller', async () => {
  const fetch = answers(['{"name": "the Salt Flats", "amplitude": "3"}']);
  const got = await ask({
    system: 'You name places.',
    user: 'Name this one.',
    read: (j) => {
      const o = j as {name: unknown; amplitude: unknown};
      return {name: line(o.name, 'name', 40), amplitude: num(o.amplitude, 'amplitude', 0, 12)};
    },
  });
  expect(got).toMatchObject({ok: true, tries: 1, value: {name: 'the Salt Flats', amplitude: 3}});
  // And the model was told the one thing about the shape of an answer.
  expect(sent(fetch, 0).messages[1]!.content).toMatch(/one JSON object and nothing else/);
});

test('a refused answer is shown back with the reason, once', async () => {
  const fetch = answers(['{"amplitude": "tall"}', '{"amplitude": 4}']);
  const got = await ask({
    system: '', user: 'How tall?',
    read: (j) => num((j as {amplitude: unknown}).amplitude, 'amplitude', 0, 12),
  });
  expect(got).toMatchObject({ok: true, tries: 2, value: 4});
  const second = sent(fetch, 1).messages;
  expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(second[2]!.content).toBe('{"amplitude": "tall"}');
  expect(second[3]!.content).toMatch(/amplitude must be a number between 0 and 12/);
});

test('twice wrong is not ok, and says why, and never throws', async () => {
  answers(['I would rather not.', 'Still no.']);
  const got = await ask({system: '', user: '?', read: () => 1});
  expect(got).toMatchObject({ok: false, tries: 2, why: 'no JSON object in the answer', raw: 'Still no.'});
});

test('a caller with a fallback in hand may ask only once', async () => {
  const fetch = answers(['nope', '{"a": 1}']);
  const got = await ask({system: '', user: '?', read: () => 1, retry: false});
  expect(got.ok).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('the small readers: bounds are clamped, words matched loosely, colours normalised', () => {
  expect(num(15, 'x', 0, 12)).toBe(12);
  expect(() => num(15, 'x', 0, 12, false)).toThrow('between 0 and 12');
  expect(word('Dunes', 'base', ['flat', 'dune', 'ridge'] as const)).toBe('dune');
  expect(word('dry-bed', 'kind', ['dry bed', 'scarp'] as const)).toBe('dry bed');
  expect(() => word('ocean', 'base', ['flat'] as const)).toThrow('one of: flat');
  expect(colour('C0FFEE', 'c')).toBe('#c0ffee');
  expect(colour('#abc', 'c')).toBe('#aabbcc');
  expect(line('  the   long   name of a place that goes on and on  ', 'name', 20))
    .toBe('the long name of a…');
  const got = list([{k: 1}, 'bad', {k: 3}, {k: 4}], 'parts', 2,
    (it) => { if (typeof it !== 'object') throw new Error('not a part'); return it; });
  expect(got.kept).toEqual([{k: 1}, {k: 3}]);
  expect(got.dropped).toEqual(['parts[1]: not a part', 'parts[3]: more than 2']);
});
