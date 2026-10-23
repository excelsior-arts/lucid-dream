/* The keys that walk a figure, and what they mean relative to the camera.
 *
 * W A S D and the arrows walk; a direction is worked out against the way the
 * camera faces, so forward is away from the viewer whatever the orbit. P and
 * Space are the pause, handed to whoever owns the transport. Nothing is taken
 * from a field somebody is typing into, from a chord with a modifier down, or
 * from Space on a focused button, which is the button's.
 *
 * This is the keyboard half of Burning Man's main.ts, as a thing a trip can
 * take: it knows a camera and a set of keys, and nothing of a score.
 */
import * as THREE from 'three';

const WALKING = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];

export interface Walking {
  x: number;
  z: number;
  /** Whether any walking key is down at all. */
  engaged: boolean;
}

export class WalkKeys {
  private readonly keys = new Set<string>();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  /** Listen on `target` until `signal` aborts. `onPause` answers P and Space. */
  constructor(target: Window, signal: AbortSignal, onPause?: () => void) {
    target.addEventListener(
      'keydown',
      (e) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLSelectElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          (e.code === 'Space' && e.target instanceof Element && !!e.target.closest('button, a'))
        )
          return;
        if (WALKING.includes(e.code) || e.code === 'Space') e.preventDefault();
        this.keys.add(e.code);
        if (!e.repeat && (e.code === 'KeyP' || e.code === 'Space')) onPause?.();
      },
      {signal},
    );
    target.addEventListener('keyup', (e) => this.keys.delete(e.code), {signal});
  }

  has(code: string): boolean {
    return this.keys.has(code);
  }

  /** Let go of every key: the window lost focus, the tab was hidden, a seek. */
  clear(): void {
    this.keys.clear();
  }

  /** Where the keys say to walk, in the ground plane, relative to the camera. */
  direction(camera: THREE.Camera): Walking {
    const keys = this.keys;
    const x =
      Number(keys.has('KeyD') || keys.has('ArrowRight')) -
      Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const y =
      Number(keys.has('KeyW') || keys.has('ArrowUp')) -
      Number(keys.has('KeyS') || keys.has('ArrowDown'));
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, camera.up);
    const engaged = WALKING.some((k) => keys.has(k));
    return {x: this.forward.x * y + this.right.x * x, z: this.forward.z * y + this.right.z * x, engaged};
  }
}
