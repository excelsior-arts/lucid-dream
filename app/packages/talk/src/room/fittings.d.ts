/* The typed face of fittings.js: the library of things a portal can be made
   of. A room names one, or brings a function of the same shape. */

import type {Fitting} from './spec';

/** A window: leaded, with a fanlight, shutters and weather. A hole in a wall. */
export const glazing: Fitting;
/** A case of books. It stands against the wall, so nothing is cut through. */
export const shelves: Fitting;

declare const FITTINGS: {glazing: Fitting; shelves: Fitting};
export default FITTINGS;
