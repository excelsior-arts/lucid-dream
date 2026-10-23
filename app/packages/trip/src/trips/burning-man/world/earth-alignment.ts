import {Vector3} from 'three/webgpu';
import {BLACK_ROCK_PEAKS, MAP, mountainHeight} from '../landscape';

// Where the walk actually ends: a viewer who takes him east and skips every
// scripted stop runs out of ground a few metres short of the monument, and the
// alignment is built for that spot so it can be stood in rather than admired
// from a place nobody reaches. The construction is pure perspective, and the
// monument's size follows the gap, so standing nearer makes it smaller.
export const EARTH_ALIGNMENT_EYE = new Vector3(155, MAP.floor + 1.15, 0);
export function projectOntoEarthAltar(point: Vector3) {
  const scale = (MAP.altars.earth[0] - EARTH_ALIGNMENT_EYE.x) / (point.x - EARTH_ALIGNMENT_EYE.x);
  return point.clone().sub(EARTH_ALIGNMENT_EYE).multiplyScalar(scale).add(EARTH_ALIGNMENT_EYE);
}

export function earthTriangles() {
  return BLACK_ROCK_PEAKS.map((peak) => {
    // Use the same 8 m vertices the distant terrain actually renders, including erosion.
    const summit = new Vector3();
    let elevation = -Infinity;
    for (let x = Math.ceil((peak.x - 16) / 8) * 8; x <= peak.x + 16; x += 8)
      for (let z = Math.ceil((peak.z - 16) / 8) * 8; z <= peak.z + 16; z += 8) {
        const y = MAP.floor + mountainHeight(x, z);
        const angle = (y - EARTH_ALIGNMENT_EYE.y) / Math.hypot(x - EARTH_ALIGNMENT_EYE.x, z);
        if (angle > elevation) {
          elevation = angle;
          summit.set(x, y, z);
        }
      }
    const span = peak.radiusZ * 0.72;
    const foot = (z: number) => new Vector3(peak.x, MAP.floor, z);
    const horizon = [foot(peak.z - span), summit, foot(peak.z + span)] as const;
    return {horizon, frame: horizon.map(projectOntoEarthAltar)};
  });
}

const frameZ = earthTriangles().flatMap((triangle) => triangle.frame.map((point) => point.z));
export const EARTH_ALTAR_WIDTH = Math.max(...frameZ) - Math.min(...frameZ) + 0.12;
