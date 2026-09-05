/* The typed face of aim.js. */
import type * as THREE from 'three';

/** What a raycaster hands back, as much of it as this asks about. */
export interface Hit {
  distance: number;
  object: THREE.Object3D & {
    /** A box's own measure, or any geometry with a bounding box. */
    geometry: {parameters?: Partial<{width: number; height: number; depth: number}>;
               boundingBox?: THREE.Box3 | null; computeBoundingBox?(): void};
  };
}

/** How far behind the nearest hit a box may still be the one meant, in meters. */
export const REACH: number;

/** The box a press means: the smallest within `reach` of the nearest, ties
    going to the nearest. Null if there were no hits. */
export function smallest(hits: readonly Hit[], reach?: number): THREE.Object3D | null;
export function volume(object: Hit['object']): number;
