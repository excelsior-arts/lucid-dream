/* The typed face of room3d.js.
 *
 * The engine is hand-set JavaScript and is not converted; this is what the
 * rest of the app is allowed to see of it. Everything here is defined in
 * spec.ts, which is where the shapes are documented.
 */

import * as THREE from 'three';
import type {Ink, Hex, Mounted, RoomHandle, RoomSpec} from './spec';

export {THREE};

/* Textures are drawn here rather than shipped: the game is offline, and a
   canvas costs less than a PNG anyway. */
export function paint(
  px: number,
  draw: (g: CanvasRenderingContext2D, px: number) => void,
): THREE.CanvasTexture;

/** The diamond lattice every wall in the parlour is ruled with. */
export function lattice(ink?: Ink, ground?: string): THREE.CanvasTexture;
/** The boards, in blocks. */
export function parquet(ink?: Ink, ground?: string): THREE.CanvasTexture;
/** One bay of panelling, with whatever figure the room set into it. */
export function panelling(
  ink?: Ink, ground?: string, gem?: string, squash?: number, figure?: string,
): THREE.CanvasTexture;

/** An alpha map that gives out before it reaches an edge, for a wall. */
export function fadeAway(toward?: string, top?: number, reach?: number): THREE.CanvasTexture;
/** And the same for a floor, measured out from the middle. */
export function fadePool(cx?: number, cy?: number, hold?: number): THREE.CanvasTexture;

/* What a room gets if nobody dressed it — and the shape of the object a
   game's own room file exports. Everything in it may be overridden. */
export const DEFAULT: Required<Pick<RoomSpec,
  | 'size' | 'palette' | 'portal' | 'fitting' | 'light' | 'heart' | 'camera'
  | 'portrait' | 'page' | 'casts' | 'cast' | 'spill' | 'fog' | 'vignette'
  | 'hearth' | 'fill' | 'ceiling' | 'ground' | 'hold' | 'reach' | 'sky'
  | 'thick' | 'bay' | 'block' | 'dress' | 'tick'>>;

/** Build the room, put its canvas in `stage`, and lay the words on it. */
export function mount(spec: RoomSpec, where: Mounted): RoomHandle;

export type {Hex};
