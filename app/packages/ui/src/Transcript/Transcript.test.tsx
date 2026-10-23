/* The scroll policy, and the cost of a tick.
 *
 * jsdom has no layout, so the box is given one by hand: a viewport 200 tall
 * over a thousand of conversation, and a scrollTop that remembers every value
 * written to it. What is being measured is not where the view ends up — that
 * is the browser's arithmetic — but whether anything moved it at all.
 */
import {act, cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import Transcript from './Transcript';
import type {Line} from './Transcript';

const said = (n: number): Line[] =>
  Array.from({length: n}, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user', text: 'line ' + i,
  }));

/** A scrolling box, and a note of everything that moved it. */
function measured(el: Element) {
  let top = 0;
  const wrote: number[] = [];
  Object.defineProperty(el, 'clientHeight', {value: 200, configurable: true});
  Object.defineProperty(el, 'scrollHeight', {value: 1000, configurable: true});
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { wrote.push(v); top = v; },
  });
  return wrote;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('a focus that is not the typing line leaves the view where it was', () => {
  const {container} = render(<Transcript turns={said(20)} name="Purple" />);
  const chat = container.querySelector('#chat')!;
  const wrote = measured(chat);
  chat.scrollTop = 300;                       // reading back through the evening
  wrote.length = 0;

  /* Everything on the page raises `focusin`: the replay and bin on an old
     line, the console's own field, a Tab from anywhere. All of them used to
     take the view to the end a quarter of a second later — with `force`, so
     the reader's own scroll went with it. */
  const button = document.createElement('button');
  document.body.append(button);
  act(() => { fireEvent.focusIn(button); vi.advanceTimersByTime(500); });

  expect(wrote).toEqual([]);
  expect(chat.scrollTop).toBe(300);
});

test('and the typing line still keeps the newest line above the keyboard', () => {
  const {container} = render(<Transcript turns={said(20)} name="Purple" />);
  const chat = container.querySelector('#chat')!;
  const wrote = measured(chat);
  wrote.length = 0;

  const field = document.createElement('input');
  document.body.append(field);
  act(() => { fireEvent.focusIn(field); vi.advanceTimersByTime(500); });

  expect(wrote).toEqual([1000]);
});

test('a pacer tick redraws the line being written, and no other', () => {
  /* The pacer releases words against the voice about fourteen times a second.
     Every one of those used to re-render every bubble in the conversation and
     re-parse its markup: three hundred lines late in an evening is four
     thousand of those a second, for one line of new words.

     `tools` is the counter because the corner is built inside a bubble as it
     draws, which is exactly what a memoised one does not do. */
  const turns: Line[] = [...said(60), {role: 'assistant', text: '', streaming: true}];
  const corner = vi.fn<(turn: Line, at: number) => null>(() => null);
  const view = render(<Transcript turns={turns} name="Purple" tools={corner}
                                  visible="a" pacing />);
  expect(corner).toHaveBeenCalledTimes(turns.length);

  corner.mockClear();
  view.rerender(<Transcript turns={turns} name="Purple" tools={corner}
                            visible="a wo" pacing />);
  expect(corner).toHaveBeenCalledTimes(1);
  expect(corner.mock.calls[0]![1]).toBe(turns.length - 1);

  // And a line actually arriving still redraws what it has to: a new array,
  // one longer, is a different conversation to draw.
  corner.mockClear();
  const more: Line[] = [...turns, {role: 'user', text: 'and then'}];
  view.rerender(<Transcript turns={more} name="Purple" tools={corner}
                            visible={null} />);
  expect(corner.mock.calls.map(([, at]) => at)).toContain(more.length - 1);
});

test('a line that broke off fades out where it broke, with no label and no caret', () => {
  const {container} = render(<Transcript name="Purple" turns={[
    {role: 'user', text: 'Tell me.'},
    {role: 'assistant', text: 'I am here. I was thinking about the ', cut: true},
    {role: 'user', text: 'Go on.'},
    {role: 'assistant', text: 'It had\n ended. ', cut: true},
    {role: 'assistant', text: 'And', cut: true},
    {role: 'assistant', text: 'Said whole.'},
  ]} />);
  const [mid, ended, one, whole] = [...container.querySelectorAll('.msg.them')];
  const steps = (el: Element) => [...el.querySelectorAll('.fade')].map((f) => [f.className, f.textContent]);
  // The last four words step down, the last ending in a dash where it broke.
  expect(steps(mid!)).toEqual([
    ['fade f1', 'was'], ['fade f2', 'thinking'], ['fade f3', 'about'], ['fade f4 end', 'the\u2014']]);
  // The words are all there, and a reader that cannot see the fade is told.
  expect(mid!.querySelector('.body')!.textContent).toBe('I am here. I was thinking about the\u2014 cut off');
  expect(mid!.querySelector('.cut-said')!.textContent).toBe(' cut off');
  expect(mid!.classList.contains('streaming')).toBe(false);
  // No dash after a sentence that had ended, and a line break kept between the steps.
  expect(steps(ended!)).toEqual([['fade f2', 'It'], ['fade f3', 'had'], ['fade f4 end', 'ended.']]);
  expect(ended!.querySelector('.body')!.textContent).toBe('It had\nended. cut off');
  // One word is the faintest step alone.
  expect(steps(one!)).toEqual([['fade f4 end', 'And\u2014']]);
  // Anything else does not fade and says nothing.
  expect(whole!.querySelectorAll('.fade, .cut-said')).toHaveLength(0);
  // No label anywhere: the old CUT OFF mark is gone.
  expect(container.querySelectorAll('.broke-off')).toHaveLength(0);
});
