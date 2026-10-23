/* What this browser cannot do that the Mac can, in one list.
 *
 * The same build runs on two things (see host.ts): the machine on somebody's
 * own Mac, and a page with nothing behind it, whose words come from a small
 * model in the browser and which has no ear. Some parts of a game are off
 * there and some are smaller. They are not taken away: the control stays
 * where it is, usable as far as it works, wears a mark, and a press on the
 * mark (or on the control, where it does nothing else here) says the one
 * line -- what it is on your Mac, what it is in this browser -- and how to
 * run it on a Mac.
 *
 * One list, so a mark on a key and a sheet in a room read the same words (the
 * eye's panel names none of them: it is on every page of the app, and says
 * only that the AI is smaller here). Where a part simply does not work here
 * and is only a reading -- the lid's standing column -- it is not drawn at
 * all rather than marked.
 *
 * A game says what is limited in it (`limit`), with a `holds` that reads its
 * own config at the moment: a player who switched where they stand back on in
 * their config.json is not told it is off. On the machine
 * nothing here is ever limited, whatever was registered: `limited` answers
 * null, and nothing draws.
 */
import {host, onHost} from '../host';

export interface Limit {
  /** Its own name, which a mark and a sheet are asked for by. */
  id: string;
  /** What it is, to a person, in a word or three. */
  name: string;
  /** What it does on your Mac, as a sentence. */
  mac: string;
  /** And what it is in this browser. */
  here: string;
  /** Not there at all here, or there and smaller. */
  kind: 'off' | 'smaller';
  /** Whether it is limited right now. Read at the moment, so a player's own
      config is heard; left out, it always is in a browser. */
  holds?: () => boolean;
}

const all = new Map<string, Limit>();
const watchers = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const fn of [...watchers]) fn();
}

/** Say that something is limited in a browser. A second word under the same
    id replaces the first; the return takes it back. */
export function limit(l: Limit): () => void {
  all.set(l.id, l);
  changed();
  return () => { if (all.get(l.id) === l) { all.delete(l.id); changed(); } };
}

/** Whether this page is the browser's own, with no Mac behind it. */
export const inBrowser = (): boolean => !host().machine;

/** The limit, if it holds here and now; null on the machine, always. */
export function limited(id: string): Limit | null {
  if (!inBrowser()) return null;
  const l = all.get(id);
  if (!l) return null;
  try { return !l.holds || l.holds() ? l : null; } catch { return l; }
}

/** Every limit that holds here and now, in the order they were said. */
export function limits(): Limit[] {
  if (!inBrowser()) return [];
  return [...all.keys()].map(limited).filter((l): l is Limit => !!l);
}

/** Something a `holds` reads has moved (a config read): ask again. */
export const limitsMoved = (): void => changed();

/* The host settling (a page finding it has no machine) moves every answer. */
onHost(changed);

export function onLimits(fn: () => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

export const limitsVersion = (): number => version;

/* ---- how to run it on a Mac ---------------------------------------------
 *
 * The landing page's steps (docs/index.html, `.steps`), the same lines in the
 * same order: a test reads that page and fails when the two part
 * (limits.test.ts). The numbers under them are the README's. */
export const RUN_ON_MAC = {
  title: 'Run it on your Mac',
  lede: 'The whole of it runs on your own Mac, started from the terminal and played in your browser.',
  steps: [
    'git clone https://github.com/excelsior-arts/lucid-dream',
    'cd lucid-dream',
    './setup.sh',
    './run.sh',
  ],
  after: '~31 GB of models come down once. Then open localhost:6969 in your browser.',
  needs: 'Apple Silicon Mac · macOS 14+ · 16 GB memory, 32 for the large model · 40 GB free disk · Python 3.14 and Node 24',
  source: 'https://github.com/excelsior-arts/lucid-dream',
} as const;
