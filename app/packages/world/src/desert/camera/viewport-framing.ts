import {MathUtils} from 'three';

/** Pull back in narrow viewports and retain room for the body during touch zoom. */
export function viewportFraming(width: number, height: number, verticalFov: number) {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const compact = 1 - MathUtils.smoothstep(Math.min(width, height), 600, 900);
  const distanceScale = Math.max(1, Math.sqrt(0.9 / aspect)) + compact * 0.12;
  const vertical = MathUtils.degToRad(verticalFov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  // A 1.1 m envelope around the torso includes the head, feet and outstretched arms.
  const bodyDistance = 1.1 / (Math.sin(Math.min(vertical, horizontal)) * 0.82);
  return {
    distanceScale,
    minDistance: MathUtils.lerp(0.45, bodyDistance, compact),
  };
}
