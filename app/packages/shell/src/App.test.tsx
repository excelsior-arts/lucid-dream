import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import App from './App';
import type {Manifest} from './manifest';
import {AGAME} from './fixtures/games';

/* The starfield wants a canvas context and half the shell asks whether motion
   is wanted; jsdom has neither, and neither is what this is about. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the shelf is what "/" is', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App games={[AGAME]} />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText(/A Game/)).toHaveAttribute('href', '/a-game');
});

test('a page that does not arrive leaves the shell standing, and can be asked again', async () => {
  /* `use()` throws a rejected chunk at the nearest error boundary, and there
     was none: a rebuild mid-evening or a dropped connection unmounted the
     whole app -- rail, console and all -- with a reload the only way back. */
  let wire = false;
  const load = () => (wire
    ? Promise.resolve({default: () => <p>the open box</p>})
    : Promise.reject(new Error('the chunk did not come')));
  const flaky: Manifest = {
    slug: 'a-game', name: 'A Game', blurb: 'Something with a lid on it.',
    routes: () => [{path: '', load}],
    where: () => '',
  };
  // Awaited, because the first render suspends and React holds the retry --
  // the refusal included -- until the act it happened inside has been let go of.
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/a-game']}>
        <App games={[flaky]} />
      </MemoryRouter>,
    );
  });
  expect(await screen.findByText(/did not arrive/)).toBeInTheDocument();
  // And the shell is still standing: the rail used to go down with the root.
  expect(screen.getByLabelText(/^The console/)).toBeInTheDocument();

  wire = true;
  fireEvent.click(screen.getByText('Try again'));
  expect(await screen.findByText('the open box')).toBeInTheDocument();
});
