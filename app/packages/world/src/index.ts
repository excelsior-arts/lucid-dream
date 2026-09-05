/* @lucid/world — three.js and a physics engine, wired together.
 *
 * The framework's bottom layer, and it knows nothing about any game: a world
 * with a fixed step, bodies measured off meshes, a shove, a settle, a replay,
 * a character controller and a way of seeing what the simulation thinks it
 * has been given. Rapier does the arithmetic (Apache-2.0, pinned; see
 * THIRD-PARTY.md).
 *
 * What is *not* here is what a room is. That was the mistake this package was
 * split out of: a machine for building lidded boxes with a window in one wall
 * is one game's idea of a place, and it now lives with that game, in
 * app/packages/talk/src/room/. What every game with things in it that fall
 * would want back is what is below.
 *
 * The one rule the whole package is shaped by: nothing in here is random.
 * Every number that decides where something ends up is handed in by the
 * caller, keyed to a name and a count, so the same clicks give the same room
 * — which is what lets a save be a count per name and a position be nothing
 * anybody ever writes down. See replay.ts.
 */

export {createWorld, ready} from './world';
export type {Vec3, World, WorldOpts} from './world';

export {
  dynamicFromMesh, park, pose, remove, setPose, staticFromMesh, sync,
} from './bodies';
export type {Bound, DynamicOpts, Pose, Shape, StaticOpts} from './bodies';

export {shove} from './impulse';
export type {Shove} from './impulse';

export {hush, isAsleep, rouse, settle} from './settle';
export type {Settling} from './settle';

export {replay, rerun} from './replay';
export type {Event, Replaying, Shoved} from './replay';

export {createCharacter} from './character';
export type {Character, CharacterOpts} from './character';

export {createDebug} from './debug';
export type {Debug} from './debug';

export {onFrame} from './ticker';
export type {Frame} from './ticker';
