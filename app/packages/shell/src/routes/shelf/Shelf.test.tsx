import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {AGAME} from '../../fixtures/games';
import Shelf from './Shelf';

/* The starfield asks a canvas for a context and everything here asks whether
   motion is wanted; jsdom has neither, and neither is what this is about. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shelf = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Shelf games={[AGAME]} />} />
        <Route path="/a-game" element={<p>the open box</p>} />
      </Routes>
    </MemoryRouter>,
  );

test('one app installed is one box on the table', () => {
  shelf();
  const tile = screen.getByLabelText(/A Game/);
  expect(tile).toHaveAttribute('href', '/a-game');
  expect(screen.getByText('A Game')).toBeInTheDocument(); // engraved on the lid
  expect(document.documentElement.dataset.page).toBe('shelf');
});

test('the lid opens first, and the address changes after it', () => {
  shelf();
  fireEvent.click(screen.getByLabelText(/A Game/));
  // Still the shelf, with the box opening on it.
  expect(screen.getByLabelText(/A Game/).className).toContain('opening');
  act(() => void vi.advanceTimersByTime(700));
  expect(screen.queryByText('the open box')).not.toBeInTheDocument();
  act(() => void vi.advanceTimersByTime(120));
  expect(screen.getByText('the open box')).toBeInTheDocument();
});

test('a modifier is the browser‘s business, not ours', () => {
  shelf();
  fireEvent.click(screen.getByLabelText(/A Game/), {metaKey: true});
  act(() => void vi.advanceTimersByTime(2000));
  expect(screen.queryByText('the open box')).not.toBeInTheDocument();
});
