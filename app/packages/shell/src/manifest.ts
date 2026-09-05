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
  /** The route: /<slug>. */
  slug: string;
  /** What the tile says. */
  name: string;
  /** One line under it, which the tile carries as its label. */
  blurb: string;
  /** Every page, in the order the router should try them. */
  routes(): GameRoute[];
  /** Which part of this game a page is standing in, for the console to ask
      about, or '' where there is nothing to ask. */
  where(pathname: string): string;
}
