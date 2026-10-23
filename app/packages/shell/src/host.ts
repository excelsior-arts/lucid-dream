/* What this page is standing on, asked as separate questions.
 *
 * The page has been served by one thing so far: the machine, a Python on this
 * Mac, which runs the language model, keeps the files, hears and speaks. It
 * need not be. The same build can sit on a static host with nothing behind it
 * -- the words then come from a model running in this browser and the files
 * are kept in it -- or inside a desktop wrapper, which may bring the machine
 * along as a sidecar, bring nothing, or answer the same routes over its own
 * bridge. The address the page was loaded from says nothing about which:
 * file://, app://, a random local port and a public domain are all possible
 * for any of them. So the page asks what is there, once, before it draws
 * anything (see `settle` in @lucid/machine), and every part that cares reads
 * the answer here, each to the one question it has:
 *
 *   llm    where words come from: the machine's model, one running in this
 *          page, or nowhere (a page with no machine and no WebGPU)
 *   store  where a game's files are kept: on the machine, or in this browser
 *   voice  whether anything can speak a reply
 *   ear    whether anything can hear one: a recognizer behind a microphone
 *   log    whether there is a machine's console to dial
 *   censored  whether the language model in use is one that sometimes
 *          answers as the model rather than as the character ("I can't
 *          continue this roleplay. I am an AI..."): the industry's word for
 *          a model trained to refuse. Not where it runs -- a fact about the
 *          weights, said by whoever serves them on `GET /machine`
 *          (`llm.censored`), false for a model nobody has said it of
 *   context  how many tokens the words in this page are loaded with, which
 *          is how much conversation a reply can be sent (config.ts in
 *          @lucid/talk); 0 where the machine runs them, at its own
 *
 * Until something says otherwise it is the machine, every answer of it, which
 * is the page as it always was and what every test already assumes.
 */

export type Words = 'machine' | 'page' | 'none';
export type Files = 'machine' | 'page';

export interface Host {
  /** Whether a machine answered at all: the Python, or one a wrapper runs. */
  machine: boolean;
  llm: Words;
  store: Files;
  voice: boolean;
  ear: boolean;
  log: boolean;
  /** Whether the model in use refuses as itself: see above. It moves when the
      model does -- a size chosen on the models panel -- and is kept here off
      every read of `GET /machine` (status.ts in @lucid/machine). */
  censored: boolean;
  context: number;
}

/** The page as it always was: everything is the machine's. */
export const MACHINE: Host = {
  machine: true, llm: 'machine', store: 'machine', voice: true, ear: true, log: true,
  censored: false, context: 0,
};

/** A page with nothing behind it: the words and the files are this browser's,
    and nothing hears or speaks. `llm` is settled by whether there is WebGPU. */
export const PAGE: Host = {
  machine: false, llm: 'page', store: 'page', voice: false, ear: false, log: false,
  censored: false, context: 4096,
};

let now: Host = MACHINE;
const watchers = new Set<() => void>();

/** What this page is standing on. */
export const host = (): Host => now;

/** Said once, before the first draw, by whoever found out. A wrapper that
    knows better says so the same way, with only the answers it changes. */
export function setHost(next: Partial<Host>): Host {
  now = {...now, ...next};
  for (const fn of watchers) fn();
  return now;
}

export function onHost(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
