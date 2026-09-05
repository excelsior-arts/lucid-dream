/* The room, as the rest of the game sees it.
 *
 * This was @lucid/engine, a package of its own, on the theory that a machine
 * for building rooms is framework. It is not: a lidded box with a window cut
 * into one wall, a glass the conversation is projected onto, a spiral where a
 * floor would be — that is Lucid Talk's idea of a room and nobody else's. So
 * it lives with the game whose rooms it builds. What *is* generic went the
 * other way, into @lucid/world: three.js and Rapier, and no opinion at all
 * about what a room is.
 *
 * Nothing outside this directory imports room3d.js directly. What is in here
 * is hand-set JavaScript with a typed face on it (spec.ts and the two .d.ts
 * beside it); what leaves is checked.
 *
 * The rooms themselves are not here either. A room is furniture for a
 * character, and this is a machine for building rooms that has never heard of
 * one — see ../rooms/, which is where the two of them live.
 */

export {mount, DEFAULT, THREE} from './room3d.js';
export {paint, lattice, parquet, panelling, fadeAway, fadePool} from './room3d.js';
export {glazing, shelves} from './fittings.js';
export type * from './spec';
