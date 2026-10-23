/// <reference types="vitest/config" />
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import {staticHost} from './static-host.ts';

// Every address the Python server owns. The page is served by Vite and the
// backend by uvicorn, so anything that is not the bundle is forwarded rather
// than duplicated -- which keeps the browser on one origin, and the socket's
// own origin check (machine/server.py from_this_page) with one thing to compare.
//
// LUCID_PROXY names another one, which is how a second instance is talked to:
// the machine on 6969 is somebody's evening, and a page under test should not
// be transcribing into it.
const BACKEND = process.env.LUCID_PROXY || 'http://127.0.0.1:6969';

/* One setup file for every package: it teaches expect about the DOM, and
   there is one DOM. Kept at the root rather than copied per package so a
   matcher added for one test is there for every test. */
const SETUP = fileURLToPath(new URL('./test/setup.ts', import.meta.url));

/* Each package's own tests, run from its own directory so a relative import in
   a test means the same thing it means in the code beside it. `extends` hands
   each of them this file's plugins and resolution, which is where @lucid/* is
   worked out -- by the workspace symlinks and each package's `exports`, so
   there is no alias anywhere for the five of them to disagree about. */
const suite = (name: string, environment = 'jsdom') => ({
  extends: true as const,
  test: {
    name,
    root: `packages/${name}`,
    environment,
    setupFiles: [SETUP],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

/* Where the build is served from. The machine serves it at the root of its
   own origin, and that is the build with nothing set. A static host may put
   it under a path of its own -- GitHub Pages serves this repository's at
   /lucid-dream/ -- and LUCID_BASE says so; setting it at all (even to "/")
   is what makes it a build for a static host, which writes the pages such a
   host needs (static-host.ts) and does not ask for a machine that is not
   there. LUCID_SITE is the origin it will be seen at, for the absolute
   addresses a link preview wants:

     LUCID_BASE=/lucid-dream/ LUCID_SITE=https://excelsior-arts.github.io npm run build
*/
const STATIC = process.env.LUCID_BASE !== undefined;
const BASE = (process.env.LUCID_BASE || '/').replace(/\/?$/, '/');
const SITE = (process.env.LUCID_SITE || '').replace(/\/$/, '');

export default defineConfig({
  base: BASE,
  plugins: [react(), ...(STATIC ? [staticHost({base: BASE, site: SITE})] : [])],
  /* Whether this is a build for a static host, which the page reads to skip
     asking for a machine: see host.ts in @lucid/machine. */
  define: {'import.meta.env.LUCID_STATIC': JSON.stringify(STATIC)},
  /* Burning Man, Lucid Trip's card, draws with three's WebGPU build and
     writes its materials in TSL, which are two more entry points into the
     same package; the talk rooms draw with the classic one. One copy of three, whichever door it is
     reached by, or two copies disagree about what a Vector3 is. */
  resolve: {dedupe: ['three']},
  optimizeDeps: {include: ['three', 'three/webgpu', 'three/tsl']},
  server: {
    // Bound to the number rather than the name: "localhost" resolves to ::1
    // first on this machine, so a dev server left on the default answers the
    // browser tests and nothing else.
    host: '127.0.0.1',
    port: 5173,
    // A dev server that silently moves to 5174 is a dev server the browser
    // tests are no longer pointed at.
    strictPort: true,
    // changeOrigin stays off, and this is the reason: the socket guard in
    // machine/server.py compares the browser's Origin to the Host it was asked
    // on. Left alone both read 127.0.0.1:5173 and the socket is let through;
    // rewriting Host to the target makes them differ and it closes with 1008.
    proxy: {
      '/shared/log/ws': {target: BACKEND, ws: true},
      '/shared/where': {target: BACKEND},
      // The machine's own surface: what a turn is transcribed by, what speaks,
      // and the numbers the page listens by. See machine/machine.py.
      //
      // The voice is a socket and is named first, because these are matched in
      // the order they are written: under the plain '/machine' rule the upgrade
      // is answered as an ordinary request and the handshake times out, which
      // reads from the room as a reply that arrives in writing and is never
      // said out loud.
      '/machine/tts': {target: BACKEND, ws: true},
      '/machine': {target: BACKEND},
      // And everything a game keeps on disk, which is values by path and logs
      // by path under a slug. Without this the dev server answers them with
      // index.html and a 200, which is a page whose conversation quietly has
      // no memory and no file to write to. See machine/store.py.
      '/store': {target: BACKEND},
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        /* A lazy chunk is named after the module that opens it, and for an
           index.ts that is the directory above -- which for a package entry is
           `src`, three times over. These names are read in a network panel, so
           the package's own name is put back. */
        chunkFileNames: (chunk: {name: string; moduleIds?: string[]}) => {
          const from = chunk.moduleIds?.at(-1) ?? '';
          const pkg = /packages\/([^/]+)\/src\/index\.ts$/.exec(from)?.[1];
          return `assets/${pkg && chunk.name === 'src' ? pkg : chunk.name}-[hash].js`;
        },
      },
    },
  },
  test: {
    /* The world's own is the one that is not a page: Rapier is wasm, it
       loads in node, and none of what it does has a DOM in it. Run under
       jsdom it is the same arithmetic with a browser bolted to it. */
    projects: [suite('audio'), suite('machine'), suite('shell'), suite('talk'),
               suite('trip'), suite('ui'), suite('world', 'node'),
               /* The build's own: what a static host is handed (static-host.ts). */
               {extends: true as const,
                test: {name: 'host', root: '.', environment: 'node', include: ['static-host.test.ts']}}],
  },
});
