/* The deck with two keys on it, which is the point: how many there are, what
 * they say and what pressing one does are all the game's, and none of it is
 * in here.
 */
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import type {Key} from './Deck';
import Deck from './Deck';
import {hearing} from './meter';

afterEach(cleanup);

const go = vi.fn();
const two = (over: Partial<Key> = {}): Key[] => [
  {id: 'go', icon: 'play', label: 'Go', title: 'start it', onPress: go},
  {id: 'off', icon: 'stop', label: 'Off', disabled: true, onPress: () => {}, ...over},
];

test('a key is a face, a word and an id of its own', () => {
  render(<Deck keys={two()} />);
  const go = document.getElementById('t-go')!;
  expect(go.querySelector('i')).toHaveAttribute('data-icon', 'play');
  expect(go).toHaveTextContent('Go');
  expect(go.title).toBe('start it');
  expect(document.getElementById('t-off')).toBeDisabled();
  expect(document.querySelectorAll('#deck .key')).toHaveLength(2);
});

test('pressing one says which one it was', () => {
  render(<Deck keys={two()} />);
  fireEvent.click(screen.getByRole('button', {name: /go/i}));
  expect(go).toHaveBeenCalled();
});

test('the counter and whatever else stands in the row go where they were put', () => {
  render(<Deck keys={two()} counter={<span id="counter">007</span>}><input id="say" /></Deck>);
  const row = [...document.getElementById('deck')!.children].map((el) => el.id);
  expect(row).toEqual(['t-go', 't-off', 'say', 'counter']);
});

test('a key that is the meter wears the level it is hearing', () => {
  const keys = two();
  keys[0]!.meter = {level: 0.09, floor: 0.004, live: true};
  render(<Deck keys={keys} />);
  const key = document.getElementById('t-go')!;
  expect(parseFloat(key.style.getPropertyValue('--lvl'))).toBeGreaterThan(50);
  expect(key.style.getPropertyValue('--beat')).toBe('.45s');
  // And the threshold it is drawn against, said out loud so the words a game
  // puts on the key cannot disagree with the bar.
  expect(hearing({level: 0.09, floor: 0.004, live: true})).toBe(true);
  expect(hearing({level: 0.002, floor: 0.004, live: true})).toBe(false);
  expect(hearing({level: 0.09, floor: 0.004, live: false})).toBe(false);
});

test('a key can be working on something without being taken away', () => {
  /* Pressed, and the thing it started has not arrived yet — a model coming up
     under it. It says so and stays pressable, because the press that takes it
     back is the one that still has to work. */
  const keys = two();
  keys[0]!.busy = true;
  render(<Deck keys={keys} />);
  const key = document.getElementById('t-go')!;
  expect(key.className).toContain('busy');
  expect(key).not.toBeDisabled();
});
