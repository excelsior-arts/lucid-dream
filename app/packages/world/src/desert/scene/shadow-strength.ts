import {MathUtils} from 'three/webgpu';

/** Fade weak secondary shadows; retain both only while their light is meaningful. */
export function shadowStrength(intensity: number, otherIntensity: number) {
  const share = intensity / Math.max(0.0001, intensity + otherIntensity);
  return MathUtils.smoothstep(intensity, 0.005, 0.025) * MathUtils.smoothstep(share, 0.25, 0.45);
}
