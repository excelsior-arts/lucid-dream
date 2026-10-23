import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, useLocation, useNavigationType} from 'react-router';
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
  expect(screen.getByLabelText(/A Game/)).toHaveAttribute('href', '/game');
});

test('a game is at its address, and an address it has moved from arrives there', async () => {
  const at: string[] = [];
  function Where() {
    at.push(useLocation().pathname + useLocation().search);
    return null;
  }
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/a-game/something?session=x']}>
        <App games={[AGAME]} />
        <Where />
      </MemoryRouter>,
    );
  });
  expect(await screen.findByText('inside')).toBeInTheDocument();
  expect(at.at(-1)).toBe('/game/something?session=x');
});

test('an address nobody answers goes to the nearest door, replaced rather than pushed', async () => {
  const cases: [string, string][] = [
    ['/no/such', '/'],
    ['/no/such?user=bob', '/?user=bob'],
    ['/game/a/b', '/game'],
    ['/a-game/a/b', '/game'],
  ];
  for (const [from, to] of cases) {
    let at = '';
    let how = '';
    function Where() {
      const l = useLocation();
      at = l.pathname + l.search;
      how = useNavigationType();
      return null;
    }
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/start', from]} initialIndex={1}>
          <App games={[AGAME]} />
          <Where />
        </MemoryRouter>,
      );
    });
    expect(at, from).toBe(to);
    expect(how, from).toBe('REPLACE');
    cleanup();
  }
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
    slug: 'a-game', path: 'a-game', name: 'A Game', blurb: 'Something with a lid on it.',
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
  // Awaited for the same reason as the render: the press suspends on the new
  // fetch, and a retry that resolves after a sync act has let go is held by
  // React for an act that never comes -- the room stayed on its waiting mark
  // whenever the fetch lost that race, which a newer jsdom made one run in three.
  await act(async () => {
    fireEvent.click(screen.getByText('Try again'));
  });
  expect(await screen.findByText('the open box')).toBeInTheDocument();
});
