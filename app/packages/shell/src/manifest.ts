/* What a game is, as far as the shell is concerned.
 *
 * The shell serves games and never learns what one is for: everything it needs
 * is on this object, which is why there is no word for a pill or a room
 * anywhere in this package. Who is installed is written down once, in
 * app/src/main.tsx, and handed to App as a prop.
 */
import type {ComponentType} from 'react';

/** One page of a game, which arrives with the game rather than with the shell. */
export interface GameRoute {
  /** Under the game's slug: '' is the game's own front door. */
  path: string;
  /* The chunk. Held in the manifest rather than made on the way past, because
     the shell warms a door by the identity of the function that opens it — so
     two calls to routes() have to hand back the same ones. */
  load: () => Promise<{default: ComponentType}>;
}

export interface Manifest {
  /** Which game this is: the name its files are kept under (a player's
      userdata/players/<who>/<slug>/, a browser's IndexedDB), its console row,
      its box. Never changes with the address. */
  slug: string;
  /** Where it is: /<path>, and every page of it under that. An address and
      nothing else, so it can be short and change without moving a file. */
  path: string;
  /** Where it used to be. An address in here is replaced by the same one
      under `path` -- /lucid-talk/lover becomes /talk/lover -- so an old
      bookmark or link still arrives. */
  was?: string[];
  /** What the tile says. */
  name: string;
  /** One line under it, which the tile carries as its label. */
  blurb: string;
  /** Every page, in the order the router should try them. */
  routes(): GameRoute[];
  /** Which part of this game a page is standing in, for the console to ask
      about, or '' where there is nothing to ask. */
  where(pathname: string): string;
  /** What the corner rail should say on a page, where it is not what it says
      everywhere else. Left out, the rail is the house's. */
  rail?(pathname: string): RailNotes;
}

/** A page's word to the corner rail. */
export interface RailNotes {
  /** False where the page reaches past this machine (a song from a CDN, say),
      so the promise that nothing leaves the room is not made there. */
  offline?: boolean;
  /** What the speaker is the volume of, where it is more than the interface. */
  speaker?: string;
  /** The page has bare controls of its own on the rail's line (a trip's pause
      and countdown). The rail joins that line: its knobs in a row rather than
      a column, without their glass (a soft round fill under the pointer), its
      panels opening downwards, its catch area kept to the knobs so a press on
      the page's controls reaches them, and its width published as
      --rail-span so the page's row ends a gap short of it. */
  inline?: boolean;
}
