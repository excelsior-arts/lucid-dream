/* Finding playwright, wherever somebody put it.
 *
 * The scripts here that open a real browser — the two that take pictures —
 * want the same module, and each looked for it on its own once, in three
 * places, one of which was wrong in the same way three times: `import()` of a
 * *directory* fails in ESM, and a directory is exactly what LUCID_PLAYWRIGHT
 * gets pointed at, because `npm root -g` prints one and the package is the
 * obvious thing to name. The variable was set correctly and the check still
 * said "no playwright", which is the worst way for a tool to be wrong: it
 * blamed the person who had already done the work.
 *
 * So: a directory or a file, the copy that comes with the page under app/, or
 * a global install found by asking npm where it keeps them — which means
 * neither `cd app && npm ci` nor `npm install -g playwright` needs a variable.
 *
 * The browser tier does not come through here. Those are playwright's own
 * specs, run by its own runner out of app/, which finds itself.
 */
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Every way a path might name the package, in the order worth trying. */
function shapes(at) {
  if (!at) return [];
  return [at, join(at, 'index.mjs'), join(at, 'index.js'),
          join(at, 'playwright', 'index.mjs'),
          join(at, 'node_modules', 'playwright', 'index.mjs')];
}

/** Where npm keeps globally installed packages, if npm will say. */
function globally() {
  try {
    return execFileSync('npm', ['root', '-g'], {encoding: 'utf8', timeout: 5000,
                                                stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return '';
  }
}

/**
 * The playwright module, or null. Never throws: a missing browser driver is a
 * thing to say plainly, not a stack trace in the middle of a test run.
 */
export async function playwright() {
  const here = new URL('../node_modules/playwright', import.meta.url).pathname;
  const page = new URL('../app/node_modules/playwright', import.meta.url).pathname;
  const tries = [...shapes(process.env.LUCID_PLAYWRIGHT),
                 'playwright',
                 ...shapes(page),
                 ...shapes(here),
                 ...shapes(globally())];
  for (const at of tries) {
    if (!at) continue;
    try {
      const url = at === 'playwright' || at.startsWith('file:')
        ? at
        : (existsSync(at) ? pathToFileURL(at).href : null);
      if (!url) continue;
      return await import(url);
    } catch {
      /* the next one */
    }
  }
  return null;
}

/** What the scripts actually want, with the message they should print. */
export const MISSING =
  '  (no playwright — `cd app && npm ci && npx playwright install chromium`,\n'
  + '   or a global `npm install -g playwright`. LUCID_PLAYWRIGHT points at one\n'
  + '   kept somewhere else, and may name the directory or the file inside it.)';
