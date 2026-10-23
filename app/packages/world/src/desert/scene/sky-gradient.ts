import {Color as ThreeColor, MathUtils, type Color, type Vector3} from 'three/webgpu';

// Shared by the visible TSL atmosphere and its small CPU reflection probe.
export const HORIZON_BLEND = [-0.03, 0.4] as const;
export const SOLAR_BLEND = [-0.1, 0.85] as const;
/** The narrow line of coral right at the skyline, under the warm band above it. */
export const SKYLINE_BLEND = [-0.01, 0.075] as const;
/** How far up the solar sector keeps its pink-violet before it is simply blue. */
export const VEIL_BLEND = [0.16, 0.62] as const;
// Scratch for the probe, which walks two thousand texels whenever the hour moves.
const warm = /*@__PURE__*/ new ThreeColor();
const veil = /*@__PURE__*/ new ThreeColor();
const low = /*@__PURE__*/ new ThreeColor();
const high = /*@__PURE__*/ new ThreeColor();
export interface SkyGradient {
  sunDirection: readonly number[];
  horizon: Color;
  sunSkyline: Color;
  sunHorizon: Color;
  sunZenith: Color;
  zenith: Color;
}

/** Direction is a unit ray; the solar sector follows azimuth, including at sunrise.
 * The warm side is stacked rather than flat: coral at the skyline, the gold band
 * above it, and a pink-violet lift into the blue so the two never meet as brown. */
export function sampleSkyGradient(sky: SkyGradient, direction: Vector3, out: Color) {
  const [x = 0, , z = 0] = sky.sunDirection;
  const bearing = (direction.x * x + direction.z * z) / Math.max(0.0001, Math.hypot(x, z));
  const sector = MathUtils.smoothstep(bearing, ...SOLAR_BLEND);
  warm.copy(sky.sunSkyline).lerp(sky.sunHorizon, MathUtils.smoothstep(direction.y, ...SKYLINE_BLEND));
  veil.copy(sky.sunZenith).lerp(sky.zenith, MathUtils.smoothstep(direction.y, ...VEIL_BLEND));
  low.copy(sky.horizon).lerp(warm, sector);
  high.copy(sky.zenith).lerp(veil, sector);
  return out.copy(low).lerp(high, MathUtils.smoothstep(direction.y, ...HORIZON_BLEND));
}
