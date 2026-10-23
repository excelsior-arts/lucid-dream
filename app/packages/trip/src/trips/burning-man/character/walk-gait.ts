import type {Footfalls} from '@lucid/world/desert';

/** Metres per complete cycle, measured from the planted soles in man.glb's Walk clip. */
export const WALK_STRIDE = 1.74;

// Sole centers and toe-out angles in character space at full-foot contact.
// Keep these calibrated to the shipped clip; walk-gait.test.ts samples the actual rig.
export const WALK_CONTACTS = [
  {foot: 'left', phase: 0.325, x: 0.06571, z: 0.39159, yaw: 0.16068},
  {foot: 'right', phase: 0.825, x: -0.0489, z: 0.36221, yaw: -0.20251},
] as const;

/** Absolute phase prevents cadence drift and preserves left/right parity after scrubbing. */
export function walkStepCount(distance: number) {
  return Math.max(0, Math.floor((distance / WALK_STRIDE - WALK_CONTACTS[0].phase) * 2 + 1 + 1e-8));
}

export function walkStepDistance(step: number) {
  return (Math.floor(step / 2) + WALK_CONTACTS[step % 2]!.phase) * WALK_STRIDE;
}

/** The same, as the desert takes a figure's footfalls: for the sand to print
    and the sound to pan. */
export const WALK_FOOTFALLS: Footfalls = {
  contacts: WALK_CONTACTS,
  stepCount: walkStepCount,
  stepDistance: walkStepDistance,
};
