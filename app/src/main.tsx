import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {App, BASE, installErrorHandlers, listenForPresses, sound} from '@lucid/shell';
import type {Manifest} from '@lucid/shell';
import {asset, assets, settle} from '@lucid/machine';
import {talk} from '@lucid/talk';
import {trip} from '@lucid/trip';
import '@lucid/shell/styles/base.css';

/* What is installed, and where it lives.
 *
 * One entry per game. The shell is this bundle, so a game is a manifest
 * rather than anything mounted on the server, and adding a second one is a
 * line here and a package beside packages/talk. This file is the whole
 * registry: neither the shell nor a game knows who else is installed, and this
 * is the only place both are named.
 */
const INSTALLED: Manifest[] = [talk, trip];

const host = document.getElementById('app');
if (!host) throw new Error('index.html has no #app to mount into');

/* Once for the document, not per page: a press sounds the same on every page,
   and an error thrown while a route is still mounting has to reach the console
   whether or not that route ever finishes. */
installErrorHandlers();
listenForPresses(document);
/* The recordings a game plays -- a footstep, wind -- are on the machine's
   shelf, and the shell's instrument is what plays them. The shell cannot ask
   the machine itself (the machine package is built on the shell), so the two
   are introduced here, once, like the games are. */
sound.stock({names: () => assets('sounds'), clip: (name) => asset('sounds', name)});

/* What is behind this page -- the machine, or nothing and this browser in
   its place -- asked once and before the first draw, so that nothing drawn has
   to change its mind about what it can offer. See host.ts in @lucid/machine. */
await settle();

createRoot(host).render(
  <StrictMode>
    {/* Under the build's base, where a static host serves it below a path of
        its own (/lucid-dream/ on GitHub Pages); at the root on the machine. */}
    <BrowserRouter basename={BASE || undefined}>
      <App games={INSTALLED} />
    </BrowserRouter>
  </StrictMode>,
);
