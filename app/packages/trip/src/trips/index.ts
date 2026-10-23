/* Every trip in the box, in the order the cards lie in the tray.
 *
 * One, for now. A second is a directory beside burning-man/ with a trip.ts
 * in it, and a line here -- the box draws its card and the route opens it
 * without either learning anything else about it.
 */
import {burningMan} from './burning-man/trip';
import type {Trip} from './trip';

export type {Mount, Piece, Trip, TripCard} from './trip';

export const TRIPS: readonly Trip[] = [burningMan];

/** The trip by its card's id, or nothing: a card that is not in the box is
    no trip. */
export function tripOf(id: string | null | undefined): Trip | undefined {
  return TRIPS.find((t) => t.card.id === id);
}
