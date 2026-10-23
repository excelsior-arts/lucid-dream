/* The box: one card in the tray, and inside the lid a sentence and a line per
 * card with how many times it has been taken -- and what pressing the card
 * does. The count is stood in for where it is read (../../doses.ts); how it
 * is kept is that file's test.
 */
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {hatch} from '@lucid/shell';
import Box from './Box';

const {count} = vi.hoisted(() => ({
  count: {now: Promise.resolve({}) as Promise<Record<string, number>>},
}));
vi.mock('../../doses', async (real) => ({
  ...(await real<typeof import('../../doses')>()),
  doses: () => count.now,
}));

beforeEach(() => {
  count.now = Promise.resolve({});
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: true, addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // The card flight is a WAAPI animation, which jsdom has never had.
  Element.prototype.animate = () => ({}) as Animation;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const box = async () => {
  const shown = render(
    <MemoryRouter initialEntries={['/trip']}>
      <Routes>
        <Route path="/trip" element={<Box />} />
        <Route path="/trip/:card" element={<p>the piece</p>} />
        <Route path="/" element={<p>the shelf</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return shown;
};

test('one card in the tray: Burning Man, backed with a flame', async () => {
  const {container} = await box();
  const cards = [...container.querySelectorAll('.card')];
  expect(cards).toHaveLength(1);
  expect(cards[0]).toHaveAttribute('data-figure', 'flame');
  expect(cards[0]).toHaveAttribute('href', '/trip/burning-man');
  expect(cards[0]?.getAttribute('aria-label')).toMatch(/^Burning Man — /);
  expect(container.querySelector('.plaque span')).toHaveTextContent('Lucid Trip');
  // No note on the tray's floor: the one card is all there is to say there.
  expect(container.querySelector('.soon')).toBeNull();
});

test('the lid says what a pill is, of every pill, and nothing of this one', async () => {
  await box();
  const copy = document.querySelector('#lidcopy')!.textContent!;
  expect(copy).toBe('Take one. Each pill is a trip of its own: a place, a stretch of music, and '
    + 'wherever it takes you. Only the doses are counted.');
  // Nothing of Burning Man, and not the line that was untrue once a count was kept.
  expect(copy).not.toMatch(/fire|dune|sea|Burning/);
  expect(document.body).not.toHaveTextContent(/Nothing is kept/);
});

test('a line per card: its swatch, its name, and only its count', async () => {
  count.now = Promise.resolve({'burning-man': 3});
  await box();
  const lines = [...document.querySelectorAll('#lines .line')];
  expect(lines).toHaveLength(1);
  const line = lines[0] as HTMLElement;
  expect(line.style.getPropertyValue('--card')).toBe('226, 118, 52');
  expect(line.querySelector('.tag i')).not.toBeNull();
  expect(line.querySelector('.tag')).toHaveTextContent('Burning Man');
  expect(line.querySelector('.doses')).toHaveTextContent(/^3 doses$/);
  // No way in, no memory, no standing, no strength, no total: a count is all.
  expect(line.querySelectorAll('button, a')).toHaveLength(0);
  expect(document.querySelector('.totals')).toBeNull();
  expect(document.querySelector('.dosebox')).toBeNull();
  expect(document.querySelector('.gear')).toBeNull();
});

test('never taken, one dose, and the empty state before anything is', async () => {
  await box();
  expect(document.querySelector('.leaf')).toHaveClass('ready');
  expect(document.querySelector('#lines .doses')).toHaveTextContent(/^never taken$/);
  cleanup();
  count.now = Promise.resolve({'burning-man': 1});
  await box();
  expect(document.querySelector('#lines .doses')).toHaveTextContent(/^1 dose$/);
});

test('until the count is in the table is laid out but says nothing', async () => {
  count.now = new Promise(() => {});
  await box();
  expect(document.querySelector('.leaf')).not.toHaveClass('ready');
  expect(document.querySelectorAll('#lines .line')).toHaveLength(1);
  expect(document.querySelector('#lines .doses')).toBeEmptyDOMElement();
});

test('a count that cannot be read is said, and no row guesses', async () => {
  const said = vi.spyOn(hatch, 'say').mockImplementation(() => {});
  count.now = Promise.reject(new Error('the doses answered 500'));
  await box();
  expect(said).toHaveBeenCalledWith('could not read the doses: the doses answered 500', 'warn');
  expect(document.querySelector('.leaf')).not.toHaveClass('ready');
  expect(document.querySelector('#lines .doses')).toBeEmptyDOMElement();
});

test('taking the card opens its address; reduced motion goes straight there', async () => {
  const {container} = await box();
  fireEvent.click(container.querySelector('.card')!);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('the piece')).toBeInTheDocument();
});
