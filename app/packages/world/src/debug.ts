/* What the simulation thinks the room is, drawn over the room.
 *
 * Every collider as a line, straight out of Rapier's own debug buffer. It is
 * off unless something turns it on, and it is the only way to answer the
 * question that actually comes up: not "why did the book fall through the
 * floor" but "where does this room think its floor is". A collider measured
 * off a mesh is right until somebody re-composes the mesh, and the first
 * symptom of it being wrong is a thing that jitters where it stands.
 */
import * as THREE from 'three';
import type {World} from './world';

export interface Debug {
  /** Add this to the scene. Empty until `on` and a frame have both happened. */
  lines: THREE.LineSegments;
  /** Drawn or not. Off costs one comparison a frame. */
  on: boolean;
  /** Re-read the world. Call it on the frames it is being watched on. */
  update(): void;
  dispose(): void;
}

export function createDebug(w: World, {on = false} = {}): Debug {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 4));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({vertexColors: true, depthTest: false, fog: false}),
  );
  lines.frustumCulled = false;
  lines.visible = on;
  const it: Debug = {
    lines,
    on,
    update() {
      lines.visible = it.on;
      if (!it.on) return;
      const {vertices, colors} = w.world.debugRender();
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.color!.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
  };
  return it;
}
