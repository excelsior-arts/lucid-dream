/* A box with nothing of Lucid Talk in it.
 *
 * Three cards that are not pills, a lid with nothing on it that is a ledger,
 * and a title that is not a game — because that is the whole claim this
 * package makes, and a test that used the real ones would not check it.
 */
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {Card} from './Box';
import Box from './Box';

const CARDS: Card[] = [
  {id: 'ace', color: '200, 40, 40', figure: 'diamond', title: 'Ace', blurb: 'the first one'},
  {id: 'king', color: '40, 40, 200', figure: 'spiral', title: 'King', blurb: 'the second'},
  {id: 'joker', color: '40, 200, 40', title: 'Joker', blurb: 'and one with no figure'},
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  // The card flight is a WAAPI animation, which jsdom has never had.
  Element.prototype.animate = () => ({}) as Animation;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const show = (more: Partial<Parameters<typeof Box>[0]> = {}) =>
  render(<Box title="A Case" cards={CARDS} onTake={() => {}} onShut={() => {}} {...more} />);

test('the tray holds the cards it was given, each backed with its own figure', () => {
  const {container} = show({game: 'solitaire', note: 'more soon'});
  const cards = [...container.querySelectorAll('.card')];
  expect(cards).toHaveLength(3);
  expect(cards[0]).toHaveAttribute('data-figure', 'diamond');
  // A card whose game names no figure gets a plain one, which is a card and
  // not a fault.
  expect(cards[2]).toHaveAttribute('data-figure', '');
  expect(cards[1]).toHaveAttribute('aria-label', 'King — the second');
  expect(container.querySelector('.plaque span')).toHaveTextContent('A Case');
  expect(container.querySelector('.soon')).toHaveTextContent('more soon');
  // The one hook a game recolours through, without any new markup.
  expect(container.querySelector('#room')).toHaveAttribute('data-game', 'solitaire');
});

test('what is written inside the lid is whatever it was handed', () => {
  show({lid: <p className="leaf">nothing is written here</p>});
  expect(screen.getByText('nothing is written here')).toBeInTheDocument();
});

test('a card is pressed, flies, and lands on the game', () => {
  const pressed: string[] = [];
  const taken: string[] = [];
  const {container} = show({onPress: (c) => pressed.push(c.id), onTake: (c) => taken.push(c.id)});
  fireEvent.click(container.querySelectorAll('.card')[1]!);
  // Pressed now, so a game can start whatever is worth starting; landed
  // later, because the card is still in the air.
  expect(pressed).toEqual(['king']);
  expect(taken).toEqual([]);
  expect(container.querySelector('#cards')?.className).toContain('taken');
  act(() => void vi.advanceTimersByTime(1000));
  expect(taken).toEqual(['king']);
});

test('the lid comes down before whatever is behind it is asked for', () => {
  const shut = vi.fn();
  const {container} = show({onShut: shut});
  fireEvent.click(screen.getAllByLabelText('shut the box')[0]!);
  expect(container.querySelector('#case')?.className).toContain('shutting');
  expect(shut).not.toHaveBeenCalled();
  act(() => void vi.advanceTimersByTime(700));
  expect(shut).toHaveBeenCalled();
});
