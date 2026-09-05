/* Wait for the machine before the first spec, not during it.
 *
 * The first `GET /machine` on a cold instance builds the stack, and the first
 * spec to run is the one that opens the box and counts the ledger — two cards,
 * two lines, a total — against the ordinary five-second expect timeout. So the
 * suite's first assertion was racing the machine's first breath, and lost
 * whenever the machine had just been started.
 *
 * Waiting here rather than lengthening that timeout, because the timeout is
 * the thing worth keeping: five seconds is how long the box is allowed to take
 * once the machine is up, and a spec that waits a minute for a ledger is a spec
 * that no longer says anything about the box.
 *
 * A machine that never answers is not a failure here. The specs say what they
 * need in their own words, and "the backend is not up" is a better sentence
 * from the spec that wanted it than from a setup step nobody was looking at.
 */
import type {FullConfig} from '@playwright/test';

const UP_TO = 60_000;
const EVERY = 500;

export default async function awake(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use?.baseURL;
  if (!base) return;
  const until = Date.now() + UP_TO;
  for (;;) {
    try {
      const res = await fetch(new URL('/machine', base), {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
    } catch {
      /* not up yet, or not answering yet */
    }
    if (Date.now() > until) {
      console.warn(`the machine at ${base} did not answer /machine in `
        + `${UP_TO / 1000}s — running anyway`);
      return;
    }
    await new Promise((go) => setTimeout(go, EVERY));
  }
}
