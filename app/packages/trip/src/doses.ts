/* How many times each trip has been taken: the one thing Lucid Trip keeps.
 *
 * Kept where Lucid Talk keeps its evenings, in the machine's store -- storage
 * with no vocabulary, values and append-only logs by path (machine/store.py),
 * answered by the machine on your Mac and by the stand-in in this browser
 * (page/store.ts in @lucid/machine) with nothing behind the page. Nothing here
 * knows which. On a Mac it lands in the player's own directory:
 *
 *   userdata/players/<who>/lucid-trip/doses/<card>.jsonl
 *
 * One log per card, one line per dose. A count is the number of lines, which
 * is what the store's listing already says of every log -- so the lid's
 * table is one request, whatever is in the box. A log rather than a number
 * rewritten in a file: an append is checked against the count it follows, so
 * two tabs taking the same trip are two doses and not one written over the
 * other. The moment is on each line and nothing reads it; a line has to say
 * something, and when is the one true thing there is to say.
 */
import {call} from '@lucid/machine';
import {counted} from '@lucid/ui';

export const GAME = 'lucid-trip';

const DOSES = `/store/${GAME}/logs/doses/`;

/** Every card's count, by card id. A card never taken has no log and is not
    in it. */
export async function doses(): Promise<Record<string, number>> {
  const res = await call(DOSES);
  if (!res.ok) throw new Error(`the doses answered ${res.status}`);
  const got = ((await res.json()) as {items?: Array<{id: string; lines: number}>}).items ?? [];
  return Object.fromEntries(got.map((x) => [x.id.replace(/\.jsonl$/, ''), x.lines]));
}

/** One more dose of a card. Answers the count it is now at.
 *
 * Asked without a version first, which the store answers with the count it
 * is at and writes nothing; then appended at that count. Refused again only
 * if another page took the same trip in between, and then it follows that
 * one's count -- a dose is a dose whichever lands first. */
export async function takeDose(card: string): Promise<number> {
  let version: number | null = null;
  for (let tries = 0; tries < 5; tries += 1) {
    const res = await call(`${DOSES}${card}.jsonl`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({line: {kind: 'dose', ts: Date.now() / 1000}, version}),
    });
    const said = (await res.json().catch(() => ({}))) as {version?: number};
    if (res.status === 409 && typeof said.version === 'number') {
      version = said.version;
      continue;
    }
    if (!res.ok) throw new Error(`counting a dose answered ${res.status}`);
    return said.version ?? (version ?? 0) + 1;
  }
  throw new Error('counting a dose: the count kept moving');
}

/** What the lid says of a count. The Talk box's words: "never taken" for
    none, and the doses counted for any, by the one rule both lids use. */
export const doseWords = (n: number): string => (n ? counted(n, 'dose') : 'never taken');
