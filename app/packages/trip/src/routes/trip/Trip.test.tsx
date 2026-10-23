/* The card turned over, and when it counts as a dose: when the trip begins
 * (the stage's Let it), once, and never for only opening the address.
 *
 * The trip is a stand-in with the stage's two named parts, the one button and
 * the wordmark; the count is stood in for where it is kept (../../doses.ts).
 */
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router';
import {afterEach, expect, test, vi} from 'vitest';
import TripPage from './Trip';

const {taken} = vi.hoisted(() => ({taken: [] as string[]}));

vi.mock('../../doses', () => ({
  takeDose: (card: string) => { taken.push(card); return Promise.resolve(taken.length); },
}));
vi.mock('../../trips', () => {
  const trip = {
    card: {id: 'dune', title: 'Dune', blurb: '', color: '1, 2, 3', figure: 'flame'},
    open: () => Promise.resolve({
      mount: (host: HTMLElement) => {
        host.innerHTML = '<a class="wordmark" href="/trip">Dune</a>'
          + '<main id="invitation"><button id="start" type="button"><span>Let it</span></button></main>';
        return {ready: new Promise(() => {}), dispose() {}};
      },
    }),
  };
  return {tripOf: (id: string) => (id === 'dune' ? trip : undefined)};
});

afterEach(() => {
  cleanup();
  taken.length = 0;
});

const open = async () => {
  render(
    <MemoryRouter initialEntries={['/trip/dune']}>
      <Routes>
        <Route path="/trip/:card" element={<TripPage />} />
        <Route path="/trip" element={<p>the box</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
};

test('turning the card over is not a dose; Let it is, once', async () => {
  await open();
  expect(taken).toEqual([]);
  // A press anywhere inside the button, as a pointer lands on its words.
  fireEvent.click(document.querySelector('#start span')!);
  expect(taken).toEqual(['dune']);
  // The invitation is still fading: a second press is the same trip.
  fireEvent.click(document.querySelector('#start')!);
  expect(taken).toEqual(['dune']);
});

test('the wordmark still goes back to the box, and counts nothing', async () => {
  await open();
  fireEvent.click(document.querySelector('a.wordmark')!);
  expect(screen.getByText('the box')).toBeInTheDocument();
  expect(taken).toEqual([]);
});
