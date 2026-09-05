import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {App, installErrorHandlers, listenForPresses} from '@lucid/shell';
import type {Manifest} from '@lucid/shell';
import {talk} from '@lucid/talk';
import '@lucid/shell/styles/base.css';

/* What is installed, and where it lives.
 *
 * One entry per game. The shell is this bundle, so a game is a manifest
 * rather than anything mounted on the server, and adding a second one is a
 * line here and a package beside packages/talk. This file is the whole
 * registry: neither the shell nor a game knows who else is installed, and this
 * is the only place both are named.
 */
const INSTALLED: Manifest[] = [talk];

const host = document.getElementById('app');
if (!host) throw new Error('index.html has no #app to mount into');

/* Once for the document, not per page: a press sounds the same on every page,
   and an error thrown while a route is still mounting has to reach the console
   whether or not that route ever finishes. */
installErrorHandlers();
listenForPresses(document);

createRoot(host).render(
  <StrictMode>
    <BrowserRouter>
      <App games={INSTALLED} />
    </BrowserRouter>
  </StrictMode>,
);
