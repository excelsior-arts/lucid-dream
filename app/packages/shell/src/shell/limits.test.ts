import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {MACHINE, PAGE, setHost} from '../host';
import {limit, limited, limits, RUN_ON_MAC} from './limits';

afterEach(() => { setHost(MACHINE); });

test('on the machine nothing is limited, whatever was said', () => {
  const back = limit({id: 'x', name: 'X', kind: 'off', mac: 'm', here: 'h'});
  setHost(MACHINE);
  expect(limited('x')).toBeNull();
  expect(limits()).toEqual([]);
  back();
});

test('in a browser a limit holds, unless its own config says otherwise', () => {
  let on = true;
  const a = limit({id: 'a', name: 'A', kind: 'off', mac: 'm', here: 'h'});
  const b = limit({id: 'b', name: 'B', kind: 'smaller', mac: 'm', here: 'h', holds: () => on});
  setHost(PAGE);
  expect(limited('a')?.name).toBe('A');
  expect(limits().map((l) => l.id)).toEqual(['a', 'b']);
  on = false;                      // a player switched it back on in config.json
  expect(limited('b')).toBeNull();
  expect(limits().map((l) => l.id)).toEqual(['a']);
  expect(limited('nobody')).toBeNull();
  a(); b();
  expect(limited('a')).toBeNull();
});

test('the steps are the landing page’s, line for line', () => {
  /* docs/index.html is a page of its own, not built from this; the two are
     kept the same by this test. */
  let at = process.cwd();
  while (!existsSync(join(at, 'docs', 'index.html')) && dirname(at) !== at) at = dirname(at);
  const html = readFileSync(join(at, 'docs', 'index.html'), 'utf8');
  const block = /<div class="steps">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const lines = [...block.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => m[1]!.trim());
  expect(lines).toEqual([...RUN_ON_MAC.steps]);
  const note = /<code class="note-line">([\s\S]*?)<\/code>/.exec(block)?.[1]?.replace(/\s+/g, ' ') ?? '';
  expect(note).toContain('~31 GB of models come down once');
  expect(RUN_ON_MAC.after).toContain('~31 GB of models come down once');
  expect(note).toContain('localhost:6969');
  expect(RUN_ON_MAC.after).toContain('localhost:6969');
});
