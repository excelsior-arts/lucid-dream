import * as THREE from 'three';

/** Snap in the light's image plane so moving the player doesn't crawl over texels. */
export function shadowAnchor() {
  const right = new THREE.Vector3(),
    up = new THREE.Vector3();
  return (at: THREE.Vector3, direction: THREE.Vector3, texel: number, result: THREE.Vector3) => {
    right.set(0, 1, 0).cross(direction).normalize();
    up.crossVectors(direction, right).normalize();
    const x = at.dot(right),
      y = at.dot(up);
    result
      .copy(at)
      .addScaledVector(right, Math.round(x / texel) * texel - x)
      .addScaledVector(up, Math.round(y / texel) * texel - y);
    return result;
  };
}
