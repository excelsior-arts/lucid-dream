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
        <Route path="/game" element={<p>the open box</p>} />
      </Routes>
    </MemoryRouter>,
  );

test('one app installed is one box on the table', () => {
  shelf();
  const tile = screen.getByLabelText(/A Game/);
  expect(tile).toHaveAttribute('href', '/game');
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

test('with two boxes, the one taken goes to the middle and the other steps away', () => {
  const OTHER = {...AGAME, slug: 'other', name: 'Other'};
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Shelf games={[AGAME, OTHER]} />} />
        <Route path="/game" element={<p>the open box</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText(/A Game/));
  expect(screen.getByLabelText(/A Game/).className).toContain('opening');
  expect(screen.getByLabelText(/^Other/).className).toContain('away');
  // The trip to the middle comes before the lid, so the address waits for both.
  act(() => void vi.advanceTimersByTime(1000));
  expect(screen.queryByText('the open box')).not.toBeInTheDocument();
  act(() => void vi.advanceTimersByTime(200));
  expect(screen.getByText('the open box')).toBeInTheDocument();
});

test('a mouse resting on a box peeks it after a moment; passing over, or a finger, does not', () => {
  shelf();
  act(() => void vi.advanceTimersByTime(100)); // the table settles first
  const box = screen.getByLabelText(/A Game/);
  // Passing over.
  fireEvent.pointerMove(box, {pointerType: 'mouse', movementX: 12});
  act(() => void vi.advanceTimersByTime(150));
  fireEvent.pointerLeave(box, {pointerType: 'mouse'});
  act(() => void vi.advanceTimersByTime(1000));
  expect(box.className).not.toContain('peek');
  // Resting.
  fireEvent.pointerMove(box, {pointerType: 'mouse', movementX: 12});
  act(() => void vi.advanceTimersByTime(250));
  expect(box.className).not.toContain('peek');
  act(() => void vi.advanceTimersByTime(100));
  expect(box.className).toContain('peek');
  // And down again on leaving, from wherever it had got to (the stylesheet's
  // transition does that).
  fireEvent.pointerLeave(box, {pointerType: 'mouse'});
  expect(box.className).not.toContain('peek');
  // A finger never peeks.
  act(() => void vi.advanceTimersByTime(1000));
  fireEvent.pointerMove(box, {pointerType: 'touch', movementX: 12});
  act(() => void vi.advanceTimersByTime(1000));
  expect(box.className).not.toContain('peek');
  // Nor does a pointer that has not moved -- the page changed under it.
  fireEvent.pointerMove(box, {pointerType: 'mouse', movementX: 0, movementY: 0});
  act(() => void vi.advanceTimersByTime(1000));
  expect(box.className).not.toContain('peek');
});
