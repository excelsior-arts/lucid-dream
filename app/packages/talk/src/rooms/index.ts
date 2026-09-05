/* The rooms, by slug.
 *
 * A room is furniture answering the engine's spec — game code, kept with the
 * game whose personas stand in it. The engine builds whatever it is handed and
 * has never heard of a lover or a thinker.
 */

/* Both rooms' dressing, always. It is a few hundred bytes of CSS each, every
   rule is under `html[data-room="<slug>"]`, and only the room being stood in
   can paint — which is cheaper and far less to go wrong than loading a
   stylesheet per room and taking the old one back out again. The room's own
   code is still lazy; see `rooms` below. */
import './lover.css';
import './thinker.css';

import {ready} from '@lucid/world';

import type {Mounted, RoomHandle, RoomSpec} from '../room';

/* Every room in the bundle, by slug, and none of them loaded until somebody
   walks into one: a room is a few hundred lines of furniture and the shelf
   page has no use for any of it. */
const modules = import.meta.glob<{default: RoomSpec}>('./*.js');

export const rooms: Record<string, () => Promise<{default: RoomSpec}>> = Object.fromEntries(
  Object.entries(modules).map(([path, load]) => [path.slice('./'.length, -'.js'.length), load]),
);

/* A room that is not in the bundle is not an error: the engine's own defaults
   are a room, and the conversation is the app. */
export async function roomOf(slug: string): Promise<RoomSpec> {
  const load = rooms[slug];
  if (!load) return {};
  return (await load()).default;
}

/* And the machine that builds one, fetched at the same moment.
 *
 * The stage asks for this — it is the `mount` it is handed, see
 * ui/Stage/Stage.tsx — and only after its own probe has said this browser can
 * draw at all. So the import is here rather than at the top of the file: a
 * machine with no WebGL in it downloads none of ../room, which is most of
 * what a room weighs.
 *
 * And the physics with it. Rapier is wasm and arrives asynchronously; a room
 * is built in one synchronous pass, and a hand can be put to something in it
 * the moment it is drawn. So it is waited for here, where there is already an
 * await to hide it behind, rather than by anything downstream having to ask
 * whether the world is ready yet. It is loaded once for the life of the page,
 * which is what `ready` means. */
export async function build(spec: RoomSpec, into: Mounted): Promise<RoomHandle> {
  const [{mount}] = await Promise.all([import('../room'), ready()]);
  return mount(spec, into);
}
