import type {Score} from './score';
import profiles from '../character/locomotion-data.json';
import {motionAt} from '../character/manual-gait';

/** Before the first knee fall he stops and looks about, exactly the way a viewer
 * would swing him with A or D: a quarter turn, a long look that way, and again,
 * until he is back on his heading for the sea. He is burning and tiring, so the
 * script turns him at its own slow rate rather than the walk's brisk one. */
const QUARTERS = 4;
/** Seconds the slow pivot needs to settle a quarter turn, and seconds he holds
 * each heading. These are the defaults; the score's lookPivot and lookHold
 * fields set them for a take. */
export const LOOK_PIVOT = 2;
export const LOOK_HOLD = 5;
export const LOOK_SECONDS = QUARTERS * (LOOK_PIVOT + LOOK_HOLD);
export const lookPivot = (score: Score) => score.stage_04_look_pivot ?? LOOK_PIVOT;
export const lookHold = (score: Score) => score.stage_04_look_hold ?? LOOK_HOLD;
export const lookSeconds = (score: Score) => QUARTERS * (lookPivot(score) + lookHold(score));
/** The camera swings on its own slower curve, so the horizon turns rather than
 * snaps, and it starts moving while he is still slowing to a stop. */
const SWING = 2.8;
const LEAD = 2.5;
/** Degrees off his facing while he looks: over his shoulder, never at his face,
 * so the viewer is given what he is looking at. */
export const LOOK_BEHIND = 165;
/** A lower eye than the walking flank, close behind his back. */
export const LOOK_ELEVATION = 6;

const ease = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** He stops when the score says he stops, and the beat runs forward from there.
 * Anchoring it to the fall instead made the two durations move the stop: shorten
 * a pivot and he set off later, which is no way to pace anything. */
export function lookStart(score: Score) {
  return score.stage_04_look;
}

/** As long as its four turns and four breaths need, trimmed if the fall is close. */
export function lookSpan(score: Score) {
  const room = score.stage_05_fall - score.stage_04_look;
  const span = Math.min(lookSeconds(score), room);
  // Below a turn and a breath on every heading there is no beat worth playing.
  return span >= QUARTERS * (lookPivot(score) + 1) ? span : 0;
}

/** Quarter turns away from his walking heading, or null while he is walking. */
export function lookQuarters(time: number, score: Score) {
  const span = lookSpan(score);
  if (span <= 0) return null;
  if (time < lookStart(score) || time >= score.stage_05_fall) return null;
  const t = time - lookStart(score);
  return Math.min(QUARTERS, Math.floor((t * QUARTERS) / span + 1e-9) + 1);
}

/** The heading the walker should pivot onto, or null while he is walking. */
export function lookHeading(time: number, score: Score, walking: readonly [number, number]) {
  const quarters = lookQuarters(time, score);
  if (quarters === null || Math.hypot(walking[0], walking[1]) === 0) return null;
  return Math.atan2(walking[0], walking[1]) + (quarters * Math.PI) / 2;
}

/** Sample both the captured footwork and its removed root yaw on the score
 * clock. The four turns keep their authored slots, including holds and seeks. */
export function sampleLook(time: number, score: Score, walking: readonly [number, number]) {
  const target = lookHeading(time, score, walking);
  if (target === null) return null;
  const quarter = lookQuarters(time, score)! - 1;
  const within = Math.max(0, time - lookStart(score) - quarter * lookSpan(score) / QUARTERS);
  const pivot = lookPivot(score);
  const clipTime = Math.min(1, within / pivot) * profiles.turnleft90.duration;
  return {
    facing: target - Math.PI / 2 + motionAt('turnleft90', clipTime) * Math.PI / 2,
    intent: target,
    gesture: within < pivot
      ? {clip: 'turnleft90', time: clipTime}
      : {clip: 'stand', time: within - pivot},
  };
}

/** The same staircase, eased and lagging, for the camera to ride round with him.
 * A full circle leaves it a turn ahead of where it started, which trigonometry
 * ignores. The lag never reaches the quarter of a turn that would show his face. */
export function lookCameraYaw(time: number, score: Score) {
  const span = lookSpan(score);
  if (span <= 0) return 0;
  const t = time - lookStart(score);
  if (t <= 0) return 0;
  const slot = span / QUARTERS;
  let yaw = 0;
  for (let i = 0; i < QUARTERS; i++) yaw += ease((t - i * slot) / SWING) * (Math.PI / 2);
  return yaw;
}

/** How far the camera has left the flank for the view over his shoulder, 0 to 1. */
export function lookLean(time: number, score: Score) {
  const span = lookSpan(score);
  if (span <= 0) return 0;
  const t = time - lookStart(score);
  // Behind him before he stops, behind him for the whole circle, and back on the
  // flank during the last held heading so the side view is waiting for the fall.
  const home = ((QUARTERS - 1) * span) / QUARTERS + lookPivot(score);
  return ease((t + LEAD) / (LEAD + SWING)) * (1 - ease((t - home) / Math.max(0.001, span - home)));
}
