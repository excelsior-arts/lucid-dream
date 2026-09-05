/* A game, made up on the spot.
 *
 * The shell's own tests may not import a real one — that is the boundary this
 * package exists to keep — and they have no need to. What they are checking is
 * that a manifest becomes a tile and a route, whatever the manifest is for,
 * and a shell that can only be tested against Lucid Talk is a shell that knows
 * about Lucid Talk.
 */
import type {Manifest} from '../manifest';

const front = () => Promise.resolve({default: () => <p>the open box</p>});
const inside = () => Promise.resolve({default: () => <p>inside</p>});

export const AGAME: Manifest = {
  slug: 'a-game',
  name: 'A Game',
  blurb: 'Something with a lid on it.',
  routes: () => [
    {path: '', load: front},
    {path: ':thing', load: inside},
  ],
  where: (pathname) => (pathname.split('/')[2] ? 'inside' : ''),
};
