/// <reference types="node" />
/* A box with nothing of Lucid Talk in it.
 *
 * Three cards that are not pills, a lid with nothing on it that is a ledger,
 * and a title that is not a game — because that is the whole claim this
 * package makes, and a test that used the real ones would not check it.
 */
import {readFileSync} from 'node:fs';
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

test("a card's title is centred on it, line by line when it wraps", () => {
  // Off the disk: the suite loads no CSS, not even as ?raw, and where a title
  // sits on a card is a rule in it.
  const style = document.createElement('style');
  style.textContent = readFileSync(`${import.meta.dirname}/Box.css`, 'utf8');
  document.head.append(style);
  try {
    const {container} = show({cards: [{id: 'long', color: '1, 2, 3', title: 'A Name Long Enough To Wrap',
                                       blurb: 'two lines of title'}]});
    const title = container.querySelector('.card .caption b')!;
    expect(title).toHaveTextContent('A Name Long Enough To Wrap');
    expect(getComputedStyle(title).textAlign).toBe('center');
    // And the blurb under it, as it always was.
    expect(getComputedStyle(container.querySelector('.card .caption em')!).textAlign).toBe('center');
  } finally {
    style.remove();
  }
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

/* Where it is drawn, by hand: jsdom lays nothing out. A lid 300 px wide on the
   glass and in its own pixels, a control at the end of a line on it, and the
   rail's knobs from x 335. */
const drawn = (gearRight: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const r = (left: number, top: number, right: number, bottom: number) =>
      ({left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {}}) as DOMRect;
    if (this.id === 'lid') return r(40, 60, 340, 400);
    if (this.hasAttribute('data-own-press')) return r(gearRight - 30, 90, gearRight, 115);
    if (this.hasAttribute('data-rail')) return r(335, 18, 370, 140);
    return r(0, 0, 0, 0);
  });

test("the lid's own controls are kept a knuckle clear of the rail's knobs", () => {
  const rail = document.createElement('div');
  rail.setAttribute('data-rail', '');
  document.body.append(rail);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  try {
    drawn(330);
    const {container} = show({lid: <button type="button" data-own-press>gear</button>});
    const lid = container.querySelector<HTMLElement>('#lid')!;
    // 330 + 14 reaches 9 px past the knobs' edge at 335: the line ends 9 in.
    expect(lid.style.getPropertyValue('--rail-clear')).toBe('9px');
    cleanup();
    // With room to spare it ends where it always did.
    drawn(300);
    const again = show({lid: <button type="button" data-own-press>gear</button>});
    expect(again.container.querySelector<HTMLElement>('#lid')!.style.getPropertyValue('--rail-clear')).toBe('0px');
  } finally {
    rail.remove();
  }
});
