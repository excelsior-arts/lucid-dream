/* The sheet, and the one thing it has to keep doing: follow its own tail.
 *
 * The scrollback is a ring of 1200. Once it is full, every new line pushes an
 * old one out and the *count* stops changing — so an effect keyed on the count
 * stops running, and the console quietly lets go of the bottom at exactly the
 * point in an evening where there is most going past. Nothing about that is
 * visible until somebody is watching a model load and the log has already been
 * busy for an hour.
 */
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import Console from './Console';
import {hatch} from '../../shell/console';

/* The same throwaway socket the console's own tests use: rows only reach the
   scrollback down the wire, and this is the wire. */
class Wire {
  static made: Wire[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: {data: string}) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) { this.url = url; Wire.made.push(this); }
  send(text: string) { this.sent.push(text); }
  arrive() { this.readyState = 1; this.onopen?.(); }
  says(msg: unknown) { this.onmessage?.({data: JSON.stringify(msg)}); }
}

/* One dial for the file. `hatch` is the page's single console and it dials
   once ever (`if (this.dialed) return`), so the socket is opened by whichever
   test runs first and every test after that talks down the same one. */
let wire: Wire | null = null;

/** One line down the wire, as the server sends them. */
const lines = (n: number, from = 0) =>
  Array.from({length: n}, (_, i) => ({
    at: 1 + (from + i) / 1000, source: 'machine', level: 'info',
    text: 'line ' + (from + i),
  }));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', Wire);
  if (!wire) {
    hatch.start('');
    wire = Wire.made[0]!;
    wire.arrive();
    wire.says({type: 'backlog', lines: []});
  }
  wire.says({type: 'cleared'});
});

afterEach(() => {
  act(() => hatch.show(false));
  cleanup();
  vi.unstubAllGlobals();
});

/* jsdom has no layout, so the scrollback is given one: a box 200 tall over a
   thousand of content, and a scrollTop that remembers what was written to it.
   What is being measured is whether anything writes to it at all. */
function measured(el: Element) {
  let top = 0;
  const wrote: number[] = [];
  Object.defineProperty(el, 'clientHeight', {value: 200, configurable: true});
  Object.defineProperty(el, 'scrollHeight', {value: 9000, configurable: true});
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { wrote.push(v); top = v; },
  });
  return wrote;
}

test('it follows the tail after the ring is full, when the count stops moving', () => {
  const {container} = render(<Console />);
  act(() => hatch.show(true));
  const log = container.querySelector('[role=log]')!;

  // Fill it past the cap, so every further line pushes one out and
  // hatch.rows.length is pinned at 1200 for the rest of the evening.
  act(() => wire!.says({type: 'log', lines: lines(1200)}));
  expect(hatch.rows).toHaveLength(1200);

  const wrote = measured(log);
  act(() => wire!.says({type: 'log', lines: lines(1, 1200)}));

  expect(hatch.rows).toHaveLength(1200);              // still full: nothing counted
  expect(hatch.rows.at(-1)).toMatchObject({text: 'line 1200'});
  expect(wrote).toEqual([9000]);                       // and it still went to the end
});

test('and lets go of it while somebody is reading back through', () => {
  const {container} = render(<Console />);
  act(() => hatch.show(true));
  const log = container.querySelector('[role=log]')!;
  act(() => wire!.says({type: 'log', lines: lines(1200)}));

  const wrote = measured(log);
  // Scrolled up: the handler reads the box and stops following.
  Object.defineProperty(log, 'scrollTop', {
    configurable: true, get: () => 0, set: () => { wrote.push(-1); },
  });
  act(() => log.dispatchEvent(new Event('scroll', {bubbles: true})));
  wrote.length = 0;

  act(() => wire!.says({type: 'log', lines: lines(1, 1200)}));
  expect(wrote).toEqual([]);
});
