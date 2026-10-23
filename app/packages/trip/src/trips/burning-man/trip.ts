/* Burning Man, as a card in the box.
 *
 * The one file of this trip the box reads: what is printed on the card, and
 * the door to the piece. Nothing of the piece is imported here -- the desert
 * arrives when somebody takes the card.
 *
 * The piece began as a spin-off of the walk this game used to be and came back
 * as the trip itself; its own repository is where the score is authored.
 */
import type {Trip} from '../trip';

export const burningMan: Trip = {
  card: {
    id: 'burning-man',
    title: 'Burning Man',
    blurb: 'A figure catches fire and walks to the sea. Slow down a bit and let it go.',
    /* Ember: the fire against the dusk the piece opens on. */
    color: '226, 118, 52',
    figure: 'flame',
  },
  open: () => import('./index'),
};
