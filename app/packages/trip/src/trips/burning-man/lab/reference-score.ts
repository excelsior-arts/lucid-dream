import {validateScore, type Score} from '../experience/score';

/** The score the suite measures. src/experience/score.json is the author's to tune
 * from one minute to the next, so the tests must not move under him: only the
 * score-validity test reads the authored file, and everything else reads this. */
export const REFERENCE: Score = validateScore({
  version: 1,
  duration: 150,
  stage_01_flame: 2.5,
  stage_02_alight: 8.5,
  stage_03_walk: 6.5,
  stage_05_fall: 35,
  stage_05_fall_hold: 1.2,
  stage_06_fatigue: 62,
  stage_08_kneel: 133,
  stage_09_settle: 137,
  stage_10_bow: 143,
  idleReturn: 12,
  walkSpeed: 1.202,
  paceScale: 0.85,
  endSpeed: 0.28,
  spawnX: 0,
  spawnZ: 0,
  beachMargin: 8,
  startHour: 18,
  endHour: 18.35,
  moonPhase: 0.72,
  moonLight: 1.8,
  moonElevation: 16,
  moonAzimuth: -124,
  wind: 5.4,
  flame: 1.15,
  legFire: 0.16,
  smoke: 0.9,
  ember: 0.45,
  music: '',
  musicGain: 0.8,
  ambienceGain: 0.3,
  stepsGain: 0.45,
  fireGain: 0.24,
  heartbeatGain: 0.88,
  heartbeatBpm: 72,
  surfGain: 0.5,
  surfRange: 60,
  heartbeatPitch: 32,
  heartbeatSlowAt: 70,
  heartbeatStopBeforeEnd: 10,
  cameraDistance: 6.4,
  cameraDrift: 20,
  cameraReturn: 8,
});

/** The score less one of its fields, for a test of what a missing field
    defaults to. A destructure that drops a name leaves an unused binding the
    lint refuses; this does not. */
export function without<K extends keyof Score>(score: Score, key: K): Omit<Score, K> {
  const copy: Partial<Score> = {...score};
  delete copy[key];
  return copy as Omit<Score, K>;
}
