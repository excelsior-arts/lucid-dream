import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {DRAFT, UNSENT} from './draft';
import TypeLine from './TypeLine';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const show = (more: Partial<Parameters<typeof TypeLine>[0]> = {}) =>
  render(<TypeLine open disabled={false} onSubmit={() => true}
                   onEscape={() => {}} onRestored={() => {}} {...more} />);

const line = () => document.getElementById('text') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(line(), {target: {value: text}});
const enter = () => fireEvent.keyDown(line(), {key: 'Enter'});

test('return sends what is in the box', () => {
  const said: string[] = [];
  show({onSubmit: (t) => { said.push(t); return true; }});
  type('  the window  ');
  enter();
  expect(said).toEqual(['the window']);
  expect(line().value).toBe('');
  // Kept until the server echoes it back: the window in which a message could
  // be lost in transit.
  expect(localStorage.getItem(UNSENT)).toBe('the window');
});

test('shift-return is a new line, and an empty box sends nothing', () => {
  const onSubmit = vi.fn(() => true);
  show({onSubmit});
  type('half a thought');
  fireEvent.keyDown(line(), {key: 'Enter', shiftKey: true});
  type('   ');
  enter();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('words that did not go stay in the box', () => {
  show({onSubmit: () => false});
  type('the socket is down');
  enter();
  expect(line().value).toBe('the socket is down');
  expect(localStorage.getItem(UNSENT)).toBeNull();
});

test('what you were typing survives the page going away', () => {
  show();
  type('a sentence in progress');
  expect(localStorage.getItem(DRAFT)).toBe('a sentence in progress');
  cleanup();
  const told: string[] = [];
  show({onRestored: (t) => told.push(t)});
  expect(line().value).toBe('a sentence in progress');
  expect(told).toEqual(['a sentence in progress']);
});

test('and anything sent that was never acknowledged comes back with it', () => {
  localStorage.setItem(UNSENT, 'said but not seen');
  localStorage.setItem(DRAFT, 'and half of another');
  show();
  expect(line().value).toBe('said but not seen and half of another');
  // It comes back into the box rather than being re-sent, so you decide.
  expect(localStorage.getItem(UNSENT)).toBeNull();
});

test('escape puts the line away', () => {
  const away = vi.fn();
  show({onEscape: away});
  fireEvent.keyDown(line(), {key: 'Escape'});
  expect(away).toHaveBeenCalled();
});

test('shut, and dark when this page cannot say anything', () => {
  const shown = show({open: false});
  expect(document.getElementById('say')).toHaveAttribute('hidden');
  shown.unmount();
  show({disabled: true});
  expect(line()).toBeDisabled();
});
