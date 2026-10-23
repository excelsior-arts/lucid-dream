import {clamp, risenAt, SLOW_SECONDS, smooth, type Score} from './score';
import {LOOK_BEHIND, LOOK_ELEVATION, lookCameraYaw, lookLean} from './look-around';
import type {CameraShot} from '@lucid/world/desert';

export type {CameraShot};

/** The piece opens on his face. He walks west, so the camera waits west of him,
 * a little under his eye line, with the eastern playa and the range behind him. */
const OPENING_ANGLE = -90;
const OPENING_ELEVATION = 1.5;
/** He walks into that shot, so the camera arcs off his line and onto the flank. */
export const HANDOVER_SECONDS = 6;

/** Standing on the crest he looks along the water, so the camera goes with his
 * eye: thirty degrees each way and back. It lives inside the pause he already
 * takes and the seconds he spends slowing into it, so it costs the walk nothing. */
const CREST_SWAY = 30;
export function crestSway(time: number, score: Score) {
  if (score.stage_07_crest_hold <= 0) return 0;
  // It begins as he slows and is finished by the time he walks on, so the camera
  // is square behind him again the moment he moves rather than trailing round.
  const span = score.stage_07_crest_hold + SLOW_SECONDS;
  const f = (time - (score.stage_07_crest - SLOW_SECONDS)) / span;
  if (f <= 0 || f >= 1) return 0;
  // Out and back once, tapered at both ends so it starts and finishes still.
  return Math.sin(f * Math.PI * 2) * Math.sin(f * Math.PI) * CREST_SWAY;
}

/** Between getting up from the fall and starting up the last dune there is a
 * long walk with nothing scripted in it. Left alone, the camera takes a step
 * back and drifts slowly round him, which is the only thing in the piece that
 * makes the distance felt. It is all given back over the climb, so the pause at
 * the crest, the look along the water and the descent begin from the usual
 * frame. A viewer who takes the walk themselves gets none of it. */
const WIDE_STEP = 0.8;
const WIDE_SWING = 26;
const wideFrom = (score: Score) => risenAt(score) + 1.5;
function wideOpen(time: number, score: Score, coast: number, skip: boolean) {
  if (skip) return 0;
  const from = wideFrom(score);
  return smooth(from, from + 7.5, time) * (1 - coast);
}
/** One unbroken sweep round him across the whole crossing, rather than a cycle
 * that repeats: it leaves one shoulder as he sets out and arrives at the other
 * as the dune comes up, and stands still at both ends. */
function wideSweep(time: number, score: Score) {
  const from = wideFrom(score);
  const span = Math.max(1, score.stage_07_crest - from);
  return Math.sin((clamp((time - from) / span) - 0.5) * Math.PI) * WIDE_SWING;
}

/** The three-quarter rear angle the altar reveals and the old ending used. */
export const REVEAL_ANGLE = 72;
/** On the walk to the sea the reveal looks roughly toward the moon, pulled a
 * little back toward the flank, so the water lies on the left of the frame and
 * the dune runs up the right: a diagonal along the shore rather than a stare
 * straight out to sea. The range keeps it a rear view whatever azimuth is authored. */
const SHORE_DIAGONAL = 16;
export function seawardRevealAngle(score: Score) {
  const opposite = ((score.moonAzimuth + 180) % 360 + 360) % 360;
  const rear = opposite > 180 ? opposite - 360 : opposite;
  return clamp(Math.abs(rear) - SHORE_DIAGONAL, 30, REVEAL_ANGLE);
}

/** Sea travel is -X and wind is +X; the camera stays on the +Z flank of that axis. */
export function sampleCameraShot(
  time: number,
  score: Score,
  coast = 0,
  revealAngle = REVEAL_ANGLE,
  skipLook = false,
): CameraShot {
  const progress = clamp(time / score.duration);
  // The ending's turn forward, brought on early by the climb of the last dune so
  // the sea is already in frame as he crests it. The ending then just continues.
  const reveal = Math.max(smooth(score.stage_08_kneel - 22, score.stage_08_kneel + 5, time), coast);
  const steps = score.stage_03_walk;
  const facing = 1 - smooth(steps, steps + HANDOVER_SECONDS, time);
  const sideAngle = 10 + Math.sin(progress * Math.PI * 2.2) * score.cameraDrift;
  // The final three-quarter rear view keeps the discovered landscape in frame.
  const flank = sideAngle * (1 - reveal) + revealAngle * reveal;
  // While he looks about, the camera leaves the flank for a lower eye behind his
  // back and rides his turn all the way round, so the viewer is given what he is
  // looking at. LOOK_BEHIND is measured from his facing; the flank is ninety less.
  const lean = skipLook ? 0 : lookLean(time, score);
  const aside = flank + (LOOK_BEHIND - 90 - flank) * lean;
  const wide = wideOpen(time, score, coast, skipLook);
  const around = wideSweep(time, score) * wide;
  const angle =
    ((aside + (OPENING_ANGLE - aside) * facing + (skipLook ? 0 : crestSway(time, score)) + around) *
      Math.PI) /
      180 +
    (skipLook ? 0 : lookCameraYaw(time, score));
  const drift = 8.5 + Math.sin(progress * Math.PI * 1.6) * 2;
  const over = drift + (LOOK_ELEVATION - drift) * lean;
  const elevation = ((over + (OPENING_ELEVATION - over) * facing) * Math.PI) / 180;
  const closing = smooth(score.stage_08_kneel - 12, score.duration - 2, time);
  const radius = (score.cameraDistance - closing * 1.1) * (1 + WIDE_STEP * wide);
  return {
    offset: {
      x: Math.sin(angle) * Math.cos(elevation) * radius,
      y: Math.sin(elevation) * radius,
      z: Math.cos(angle) * Math.cos(elevation) * radius,
    },
    weight: 1,
  };
}

/** Camera gestures own only the view. Movement takeover is managed by WalkDirector. */
export class CameraDirector {
  private held = false;
  private lastOrbit: number | null = null;
  private returning = 6;

  begin(time: number) {
    this.held = true;
    this.lastOrbit = time;
    this.returning = 0;
  }

  end(time: number) {
    this.held = false;
    this.lastOrbit = time;
  }

  release(time: number) {
    if (this.held) this.end(time);
  }

  reset() {
    this.held = false;
    this.lastOrbit = null;
    this.returning = 6;
  }

  inspect(time: number, score: Score, steering = false, study = false) {
    const returnIn = this.held
      ? score.cameraReturn
      : this.lastOrbit === null
        ? 0
        : Math.max(0, score.cameraReturn - (time - this.lastOrbit));
    return {
      mode: study
        ? 'study'
        : steering || returnIn > 0
          ? 'manual'
          : this.returning < 6
            ? 'returning'
            : 'scripted',
      returnIn,
    };
  }

  update(
    time: number,
    dt: number,
    score: Score,
    steering: boolean,
    study: boolean,
    coast = 0,
    revealAngle = REVEAL_ANGLE,
    skipLook = false,
  ): CameraShot {
    const state = this.inspect(time, score, steering, study);
    const blocked = state.mode === 'manual' || state.mode === 'study';
    this.returning = blocked ? 0 : Math.min(6, this.returning + Math.max(0, dt));
    const shot = sampleCameraShot(time, score, coast, revealAngle, skipLook);
    // Ease back without snapping or changing the viewer's WASD basis during takeover.
    shot.weight = blocked
      ? 0
      : (1 - Math.exp(-Math.max(0, dt) / 1.6)) * smooth(0, 2, this.returning);
    return shot;
  }
}
