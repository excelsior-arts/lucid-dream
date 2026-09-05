import {Suspense, useMemo} from 'react';
import {Route, Routes, useLocation} from 'react-router';
import type {Manifest} from './manifest';
import {Doorway, Waiting} from './routes/Doorway';
import {lazyPage} from './routes/lazy';
import Shelf from './routes/shelf/Shelf';
import Console from './ui/Console/Console';
import Rail from './ui/Rail/Rail';

/* The corner rail and the console are on every page; which page decides what
   the console is told it is looking at. Only the game standing on that address
   knows whether there is anything there to ask about, so it is asked. */
function Chrome({games}: {games: Manifest[]}) {
  const {pathname, search} = useLocation();
  const first = pathname.split('/')[1] ?? '';
  const where = games.find((g) => g.slug === first)?.where(pathname) ?? '';
  /* And the address itself, which the rail puts in the code for a phone. It
     used to be keyed on `where` and read the address once, when it mounted: a
     game that says the same word about two of its pages -- which is most of
     them -- left the code pointing at wherever the tab had been first. */
  return (
    <>
      <Rail where={where} at={pathname + search} />
      <Console />
    </>
  );
}

// The shelf, and every installed game's pages under its own slug. Navigation
// between them stops being a document load, which is what the lid animation and
// the card flight have been working around by hand.
export default function App({games}: {games: Manifest[]}) {
  const pages = useMemo(
    () =>
      games.flatMap((g) =>
        g.routes().map((r) => ({
          path: r.path ? `/${g.slug}/${r.path}` : `/${g.slug}`,
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
          </Routes>
        </Suspense>
      </Doorway>
      <Chrome games={games} />
    </>
  );
}
