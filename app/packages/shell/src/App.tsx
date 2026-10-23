import {Suspense, useEffect, useMemo} from 'react';
import {Navigate, Route, Routes, useLocation} from 'react-router';
import type {Manifest} from './manifest';
import {Doorway, Waiting} from './routes/Doorway';
import {lazyPage} from './routes/lazy';
import {came} from './shell/came';
import Shelf from './routes/shelf/Shelf';
import Console from './ui/Console/Console';
import Rail from './ui/Rail/Rail';

/* The corner rail and the console are on every page; which page decides what
   the console is told it is looking at. Only the game standing on that address
   knows whether there is anything there to ask about, so it is asked. */
function Chrome({games}: {games: Manifest[]}) {
  const {pathname, search} = useLocation();
  const first = pathname.split('/')[1] ?? '';
  const game = games.find((g) => g.path === first);
  const where = game?.where(pathname) ?? '';
  const notes = game?.rail?.(pathname);
  // Written after the page has rendered, so the next one can ask where it came from.
  useEffect(() => { came.at = pathname; }, [pathname]);
  /* And the address itself, which the rail puts in the code for a phone. It
     used to be keyed on `where` and read the address once, when it mounted: a
     game that says the same word about two of its pages -- which is most of
     them -- left the code pointing at wherever the tab had been first. */
  return (
    <>
      <Rail where={where} app={game?.slug ?? ''} at={pathname + search} notes={notes} />
      <Console />
    </>
  );
}

/* An address a game has moved from, replaced by the same one where it is now:
   /lucid-talk/lover?session=x becomes /talk/lover?session=x, in place, so the
   old one is not left in the history to come back to. */
function Moved({from, to}: {from: string; to: string}) {
  const {pathname, search, hash} = useLocation();
  return <Navigate replace to={`/${to}${pathname.slice(from.length + 1)}${search}${hash}`} />;
}

/* An address nobody answers -- /no/such, or /talk/a/b, deeper than any of a
   game's pages -- replaced by the nearest door that is there: the game's own
   front where the first part names one, the shelf otherwise, keeping the
   query (?user= says whose files these are). Without it the router drew
   nothing and the page was the corner rail on an empty sky. A game's own
   unknown thing (/talk/nobody, /trip/nowhere) is the game's to answer, and
   both send it to their box the same way. */
function Nowhere({games}: {games: Manifest[]}) {
  const {pathname, search} = useLocation();
  const game = games.find((g) => g.path === pathname.split('/')[1]);
  return <Navigate replace to={`/${game?.path ?? ''}${search}`} />;
}

// The shelf, and every installed game's pages under its own slug. Navigation
// between them stops being a document load, which is what the lid animation and
// the card flight have been working around by hand.
export default function App({games}: {games: Manifest[]}) {
  const pages = useMemo(
    () =>
      games.flatMap((g) =>
        g.routes().map((r) => ({
          path: r.path ? `/${g.path}/${r.path}` : `/${g.path}`,
          ...lazyPage(r.load),
        })),
      ),
    [games],
  );
  return (
    <>
      {/* A chunk on the wire is a frame at most for somebody coming off the
          shelf, which has it in hand before the lid finishes opening -- and a
          second of an empty stage for somebody who arrived at a game's address
          directly. So there is a mark. And one for a chunk that never comes:
          without a boundary here, a failed fetch threw past the router and
          took the whole app down with it. */}
      <Doorway>
        <Suspense fallback={<Waiting />}>
          <Routes>
            <Route path="/" element={<Shelf games={games} />} />
            {pages.map(({path, Page}) => (
              <Route key={path} path={path} element={<Page />} />
            ))}
            {games.flatMap((g) => (g.was ?? []).map((old) => (
              <Route key={old} path={`/${old}/*`} element={<Moved from={old} to={g.path} />} />
            )))}
            <Route path="*" element={<Nowhere games={games} />} />
          </Routes>
        </Suspense>
      </Doorway>
      <Chrome games={games} />
    </>
  );
}
