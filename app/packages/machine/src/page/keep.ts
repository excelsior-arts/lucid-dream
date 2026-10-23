/* What this browser downloaded, kept.
 *
 * Every model a page with no machine runs -- the words (WebLLM's caches), the
 * voice (transformers-cache, Sopro's sopro-onnx-*), the ear (transformers-cache)
 * -- and the player's own files (IndexedDB) sit in the origin's storage, which
 * is "best effort" until the page is granted persistence: a browser short of
 * disk may clear it whole, and Safari clears a site's script-written storage
 * after seven days of use without a visit. A gigabyte cleared is a gigabyte
 * downloaded twice (Eugene, 10-09: "I have been redownloading a lot").
 *
 * So persistence is asked for wherever this page brings a model down or loads
 * one (engine.ts, voice.ts, ear.ts, from inside the press where there is one),
 * and once on a later open when a model is already in the cache and the
 * storage is not yet persisted (settle, host.ts). One helper, used by all.
 *
 * What each browser does when asked (navigator.storage.persist):
 *
 *   Chrome, Edge   never a prompt: granted or not by its own heuristics --
 *                  the site's engagement, bookmarked or installed, allowed to
 *                  notify -- and weighed again on every ask, so asking on each
 *                  open is how a site that is visited more comes to be kept.
 *   Safari         never a prompt: granted mostly to a page added to the Home
 *                  Screen or the Dock (WebKit's storage policy, Safari 17).
 *   Firefox        a prompt ("store data in persistent storage"), which it
 *                  remembers when allowed or blocked. So asked only from a
 *                  press (transient user activation), at most once in this
 *                  browser -- a "Not now" is not asked again -- and never on
 *                  an open.
 *
 * The answer is the browser's and nothing waits on it: refused, everything
 * works as before, and the console says once what would keep the models.
 * The storage is per origin, so a page served from another address (each
 * review port) keeps, and downloads, a copy of its own.
 */
import {hatch} from '@lucid/shell';

/** What the helper reads of the browser: given in a test. */
export interface KeepEnv {
  storage?: {persist?(): Promise<boolean>; persisted?(): Promise<boolean>};
  /** Inside a press, as navigator.userActivation.isActive says. */
  pressed(): boolean;
  /** A browser that asks the person rather than deciding itself: Firefox. */
  prompts: boolean;
  /** Safari, for what the console says when refused. */
  safari: boolean;
  /** Whether a prompting browser was asked here before (localStorage), and
      noting that it was. */
  askedBefore(): boolean;
  noteAsked(): void;
  say(line: string): void;
}

const ASKED = 'lucid:keep-asked';

function browserEnv(): KeepEnv {
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as
    (Navigator & {userActivation?: {isActive: boolean}}) | undefined;
  const ua = nav?.userAgent ?? '';
  return {
    storage: nav?.storage,
    pressed: () => nav?.userActivation?.isActive === true,
    prompts: /Firefox\/|FxiOS/.test(ua),
    safari: /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua),
    askedBefore() {
      try { return localStorage.getItem(ASKED) !== null; } catch { return false; }
    },
    noteAsked() {
      try { localStorage.setItem(ASKED, new Date().toISOString()); } catch { /* not kept: asked once a load */ }
    },
    say: (line) => hatch.say(line, 'info'),
  };
}

let asking: Promise<boolean | null> | null = null;
/** Asked once on this load without a press (the open), and said once. */
let openAsked = false;
let told = false;

/** Ask that this origin's storage be kept. Resolves with the answer -- true
 * kept, false not (or not asked, where asking would nag), null where the
 * browser has no such thing. Never throws. `open` is the ask of a later open,
 * made once per load; every other ask is a download's or a load's. */
export function keepDownloads(o: {open?: boolean} = {}, env: KeepEnv = browserEnv()): Promise<boolean | null> {
  // Read first, before anything is awaited: the press is the page's for a few seconds.
  const pressed = env.pressed();
  const s = env.storage;
  if (!s?.persist) return Promise.resolve(null);
  if (asking) return asking;
  if (o.open && openAsked) return Promise.resolve(false);
  if (o.open) openAsked = true;
  asking = (async () => {
    if (await s.persisted?.().catch(() => false)) return true;
    if (env.prompts && (o.open || !pressed || env.askedBefore())) return false;
    if (env.prompts) env.noteAsked();
    const kept = await s.persist!().catch(() => false);
    if (!kept && !told) {
      told = true;
      env.say(env.prompts
        ? 'this browser may clear the downloaded models when it runs short of space — allowing this site persistent storage keeps them'
        : env.safari
          ? 'Safari clears the downloaded models after a week without a visit — added to the Dock or the Home Screen, this page keeps them'
          : 'this browser may clear the downloaded models when it runs short of space — bookmarking or installing this page helps it keep them');
    }
    return kept;
  })().finally(() => { asking = null; });
  return asking;
}

/** Whether any model this page runs is in the browser's cache: the open's
    test for asking at all. The caches by name, so nothing is loaded to find
    out: WebLLM's weights, transformers.js's (the voice, the ear), Sopro's. */
export async function anyModelKept(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    for (const name of await caches.keys()) {
      if (name !== 'webllm/model' && name !== 'transformers-cache' && !name.startsWith('sopro-onnx-assets')) continue;
      if ((await (await caches.open(name)).keys()).length) return true;
    }
  } catch { /* a browser with its storage off: nothing kept */ }
  return false;
}

/** For a test: as a fresh load. */
export function forgetAsking(): void {
  asking = null;
  openAsked = false;
  told = false;
}
