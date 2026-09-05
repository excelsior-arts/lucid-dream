/* What a conversation may be called.
 *
 * Ported from store.py `named_well` and `whose`, and the grammar is the same
 * one both ends check by: the moment it began, a counter if two began in the
 * same second, and the pill it belongs to.
 *
 * It is checked here as well as on the machine, and that is not belt and
 * braces. The machine's guard is about a path -- a name that would climb out
 * of the sessions directory -- and it answers a bad one with a 400. This end
 * is about a page: an address bar is typed into by hand, arrives in links, and
 * on this program comes over the wifi from a phone with nothing in front of
 * it, and a page pointed at a conversation that cannot exist should say so
 * rather than open a fresh one under a name somebody asked for.
 */

/** The names this program makes, and nothing else. */
export const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?_[a-z0-9_-]+$/;

export const namedWell = (id: string): boolean => NAME.test(String(id ?? ''));

/** Which pill a conversation belongs to, read off its name. */
export const whose = (id: string): string =>
  namedWell(id) ? String(id).slice(String(id).lastIndexOf('_') + 1) : '';

/** Whether this room may open a conversation of that name.
 *
 * Two can be opened: one that has been spoken in, and one that has only ever
 * been named -- a room somebody opened, said nothing in, and came back to.
 * From here they are the same question, because a conversation nobody has
 * spoken in has no file and the two are indistinguishable over HTTP. Since the
 * name was only ever a name, the honest answer is to let it stand: the file
 * appears when something is actually said.
 *
 * What is turned away is a name of the wrong shape and a name belonging to
 * another pill. The second is stricter than Python was -- it would switch the
 * session to whichever pill owned the transcript -- and it is right here for a
 * reason that did not exist then: the pill is in the address of the page, not
 * a thing the machine holds one of, so a room asked to draw another pill's
 * conversation would have to become a different room.
 */
export const canOpen = (id: string, slug: string): boolean =>
  namedWell(id) && whose(id) === slug;

/* The names this page has handed out, so two conversations begun inside one
   second are two conversations. Take a pill, change your mind, take it again;
   or open a room twice while the first is still settling -- both would have
   been the same file, and the second's turns would have landed in the first.
   A conversation is the one thing here with no second copy.

   Held in the page rather than checked against disk, which is where it used to
   be: a log exists from its first append, so a name handed out and not yet
   spoken in is on nobody's disk to collide with. What this remembers is what
   this page has already promised. */
const handed = new Set<string>();

/** A name for a new conversation with this pill: the moment, and whose it is.
 *
 * Local time, because it is read by whoever is sitting here -- History shows
 * the evening they had, not the evening in UTC. */
export function nameFor(slug: string): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
    + `T${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  let id = `${stamp}_${slug}`;
  for (let n = 2; handed.has(id); n++) id = `${stamp}-${n}_${slug}`;
  handed.add(id);
  return id;
}
