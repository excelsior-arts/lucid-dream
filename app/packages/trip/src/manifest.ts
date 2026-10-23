/* Lucid Trip, as the shell sees it: a name, a line on a tile, and two doors --
 * the box it comes in, and a card turned over.
 *
 * Nothing in here reaches into a trip. The shell mounts this object without
 * loading a byte of any piece, and a piece arrives when somebody takes its
 * card.
 */
import type {Manifest} from '@lucid/shell';

// Named once, because the shelf warms a door by this function's identity.
const box = () => import('./routes/box/Box');
const trip = () => import('./routes/trip/Trip');

export const trips: Manifest = {
  slug: 'lucid-trip',
  /* The address, which is not the name; /lucid-trip was it until
     2026-10-08, and still arrives here. */
  path: 'trip',
  was: ['lucid-trip'],
  name: 'Lucid Trip',
  blurb: 'A figure catches fire and walks to the sea.',
  /* The box, and a card: /trip/burning-man -- the way a room in Talk
     is /talk/lover. A card's address is its deep link: opened
     directly, the shell hands back the document and the route opens the
     piece with nothing in between. */
  routes: () => [
    {path: '', load: box},
    {path: ':card', load: trip},
  ],
  /* In front of the box there is nothing to ask about; on a card, the card. */
  where: (pathname) => pathname.split('/')[2] ?? '',
  /* On a card the rail is the trip's: the speaker is its volume, the song
     comes from a CDN so the promise of a room nothing leaves is not made, and
     the rail joins the piece's masthead in one bare row. The box itself is
     the house's. */
  rail: (pathname) =>
    pathname.split('/')[2]
      ? {offline: false, speaker: 'How loud the trip is.', inline: true}
      : {},
};

export {trips as trip};
