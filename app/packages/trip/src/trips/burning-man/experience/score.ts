import defaults from './score.json';
import {lookSpan, lookStart} from './look-around';
import {musicSource} from '@lucid/world/desert';
export interface Score {
  version: 1;
  duration: number;
  /** Every stage he passes through, in seconds from the first note. Each is a
   * mark of its own: changing one never moves another, and the lengths further
   * down say how long a stage lasts, never when it begins. */
  stage_01_flame: number;
  stage_02_alight: number;
  stage_03_walk: number;
  stage_04_look: number;
  /** Seconds per quarter turn as he looks about, and seconds on each heading. */
  stage_04_look_pivot: number;
  stage_04_look_hold: number;
  stage_05_fall: number;
  /** How long he stays down before he rises. */
  stage_05_fall_hold: number;
  stage_06_fatigue: number;
  stage_07_crest: number;
  /** How long he stands on top of the last dune. */
  stage_07_crest_hold: number;
  stage_08_kneel: number;
  stage_09_settle: number;
  stage_10_bow: number;
  idleReturn: number;
  cameraDistance: number;
  cameraDrift: number;
  cameraReturn: number;
  walkSpeed: number;
  paceScale: number;
  endSpeed: number;
  spawnX: number;
  spawnZ: number;
  beachMargin: number;
  startHour: number;
  endHour: number;
  moonPhase: number;
  moonLight: number;
  moonElevation: number;
  moonAzimuth: number;
  wind: number;
  flame: number;
  legFire: number;
  smoke: number;
  ember: number;
  music: string;
  musicGain: number;
  ambienceGain: number;
  stepsGain: number;
  fireGain: number;
  heartbeatGain: number;
  heartbeatBpm: number;
  heartbeatPitch: number;
  surfGain: number;
  surfRange: number;
  heartbeatSlowAt: number;
  heartbeatStopBeforeEnd: number;
}
/** Metres from the shoreline at which the seaward rise begins. Below the shorter
 * bound a reach no longer clears the coastal dune, so such a value is a leftover
 * from the old plain audibility radius and takes the default instead. */
export const SURF_REACH_MIN = 30;
export const SURF_REACH_MAX = 200;
export const SURF_REACH_DEFAULT = 60;
const surfReach = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= SURF_REACH_MIN
    ? value
    : SURF_REACH_DEFAULT;
// Older authored scores keep their original tone until a deeper one is chosen.
/** Seconds of the song's intro before the flame takes, with him unlit in the
 * opening pose. Older scores were written before there was an intro to wait for. */
export const IGNITE_DELAY_DEFAULT = 2.5;
/** A man on fire does not stride. The authored walking speed is the speed of the
 * gait itself; this is how much of it he actually has left. */
export const PACE_SCALE_DEFAULT = 0.85;
/** Where the walk tops the coastal dune on the shipped score, and how long he
 * stands there. A mark to be moved rather than a position that is tracked. */
export const LOOK_AT_DEFAULT = 20;
export const CREST_PAUSE_AT_DEFAULT = 119;
export const CREST_PAUSE_DEFAULT = 2;
/** The score names every stage of the walk as a mark in seconds from the first
 * note, and the lengths beside a mark say how long that stage lasts. There is
 * one naming system and nothing reads an older one. */
export const DEFAULT_SCORE: Score = {
  ...defaults,
  paceScale: (defaults as Partial<Score>).paceScale ?? PACE_SCALE_DEFAULT,
  heartbeatPitch: (defaults as Partial<Score>).heartbeatPitch ?? 57,
  heartbeatBpm: (defaults as Partial<Score>).heartbeatBpm ?? 72,
  surfRange: surfReach((defaults as Partial<Score>).surfRange),
} as Score;
export const FALL_SECONDS = 1.9;
export const SETTLE_SECONDS = 4;
export const RISE_SECONDS = 6.866667;
/** When he is back on his feet after the exhaustion fall: the fall itself, the
 * time spent down, and the push back up. */
export const risenAt = (s: Score) =>
  s.stage_05_fall + FALL_SECONDS + s.stage_05_fall_hold + RISE_SECONDS;
/** A man who has just pushed himself up off the sand does not set off at his
 * walking pace. He gathers it over a few steps. */
export const GATHER_SECONDS = 2.6;
/** And he slows into one over about this long, rather than arriving at a
 * standstill inside a single frame. */
export const SLOW_SECONDS = 1.4;
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** What he actually walks at: the authored gait speed, less whatever the fire and
 * the fatigue have taken out of it. The stride follows this, so the cycle slows
 * with him and the feet neither slide nor outrun their prints. */
export function pace(s: Score) {
  return s.walkSpeed * s.paceScale;
}
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / Math.max(0.0001, b - a));
  return t * t * (3 - 2 * t);
};
export function validateScore(input: unknown): Score {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('A score must be a JSON object.');
  const imported = input as Partial<Score>;
  const s = {
    ...DEFAULT_SCORE,
    ...input,
    // Older scores coupled moonlight to phase. Preserve their lighting on import.
    moonLight: imported.moonLight ?? imported.moonPhase ?? DEFAULT_SCORE.moonLight,
    heartbeatPitch: imported.heartbeatPitch ?? 57,
    heartbeatBpm: imported.heartbeatBpm ?? 72,
    paceScale: imported.paceScale ?? PACE_SCALE_DEFAULT,
  } as Score;
  s.paceScale = clamp(s.paceScale, 0.4, 1.5);
  s.stage_04_look = clamp(s.stage_04_look, 0, s.duration);
  s.stage_04_look_pivot = clamp(s.stage_04_look_pivot, 0.5, 10);
  s.stage_07_crest = clamp(s.stage_07_crest, 0, s.duration);
  s.stage_07_crest_hold = clamp(s.stage_07_crest_hold, 0, 10);
  s.stage_04_look_hold = clamp(s.stage_04_look_hold, 0, 20);
  for (const [k, v] of Object.entries(DEFAULT_SCORE))
    if (typeof v === 'number' && !Number.isFinite(s[k as keyof Score]))
      throw new Error(`Invalid number: ${k}`);
  // Version 1 drafts used a shorter shared movement/camera timeout.
  if (s.idleReturn >= 5 && s.idleReturn <= 8) s.idleReturn = DEFAULT_SCORE.idleReturn;
  if (s.idleReturn < 10 || s.idleReturn > 15)
    throw new Error('Return to the ocean after 10–15 seconds without movement input.');
  if (
    s.cameraDistance < 4 ||
    s.cameraDistance > 12 ||
    s.cameraDrift < 0 ||
    s.cameraDrift > 35 ||
    s.cameraReturn < 3 ||
    s.cameraReturn > 20
  )
    throw new Error(
      'Camera distance, side-view drift or return delay is outside its supported range.',
    );
  if (s.version !== 1 || s.duration < 30 || s.duration > 600)
    throw new Error('Use a version 1 score between 30 and 600 seconds.');
  if (!(
    s.stage_01_flame >= 0 &&
    s.stage_02_alight > s.stage_01_flame &&
    s.stage_03_walk > s.stage_01_flame &&
    s.stage_02_alight < s.stage_06_fatigue &&
    s.stage_03_walk < s.stage_06_fatigue &&
    s.stage_06_fatigue < s.stage_08_kneel &&
    s.stage_08_kneel + FALL_SECONDS <= s.stage_09_settle &&
    s.stage_09_settle + SETTLE_SECONDS <= s.stage_10_bow &&
    s.stage_10_bow < s.duration
  ))
    throw new Error(
      'Check the order of the stages: flame, alight, walk, fatigue, kneel, settle onto heels (4 seconds), head bow, end.',
    );
  if (
    s.stage_05_fall < Math.max(s.stage_03_walk, s.stage_02_alight) ||
    risenAt(s) >= s.stage_08_kneel
  )
    throw new Error(
      'The exhaustion fall and recovery must fit between the opening and final kneel.',
    );
  if (
    s.walkSpeed < 0.3 ||
    s.walkSpeed > 2 ||
    s.endSpeed < 0.1 ||
    s.endSpeed > 1 ||
    s.beachMargin < 5 ||
    s.beachMargin > 20 ||
    s.stage_05_fall_hold < 0 ||
    s.stage_05_fall_hold > 10
  )
    throw new Error('Walking, beach margin or recovery is outside its supported range.');
  if (
    s.heartbeatSlowAt < 0 ||
    s.heartbeatStopBeforeEnd < 0 ||
    s.heartbeatStopBeforeEnd > 30 ||
    s.heartbeatSlowAt >= s.duration - s.heartbeatStopBeforeEnd
  )
    throw new Error('Heartbeat slowing must precede its stop; the final silence is 0–30 seconds.');
  if (s.surfRange > SURF_REACH_MAX)
    throw new Error(
      `Surf reach must be ${SURF_REACH_MIN}–${SURF_REACH_MAX} metres from the shore.`,
    );
  // A short legacy radius meant a distance gate the coastal dune now performs.
  s.surfRange = surfReach(s.surfRange);
  for (const key of [
    'moonPhase',
    'endSpeed',
    'legFire',
    'musicGain',
    'ambienceGain',
    'stepsGain',
    'fireGain',
    'heartbeatGain',
    'surfGain',
  ] as const)
    s[key] = clamp(s[key]);
  s.startHour = clamp(s.startHour, 0, 24);
  s.endHour = clamp(s.endHour, 0, 24);
  s.wind = clamp(s.wind, 0, 8);
  s.flame = clamp(s.flame, 0, 2);
  s.smoke = clamp(s.smoke, 0, 2);
  s.ember = clamp(s.ember, 0, 2);
  s.moonLight = clamp(s.moonLight, 0, 4);
  s.heartbeatPitch = clamp(s.heartbeatPitch, 28, 65);
  s.heartbeatBpm = clamp(s.heartbeatBpm, 40, 160);
  s.moonElevation = clamp(s.moonElevation, 5, 85);
  s.moonAzimuth = clamp(s.moonAzimuth, -180, 180);
  if (!musicSource(s.music))
    throw new Error('Music must be a local audio asset path.');
  // Export only documented fields, never arbitrary imported properties.
  return Object.fromEntries(
    Object.keys(DEFAULT_SCORE).map((k) => [k, s[k as keyof Score]]),
  ) as unknown as Score;
}
export type Cue = {
  phase: string;
  clip: 'opening' | 'locomotion' | 'kneefall' | 'kneeling' | 'standup' | 'settle';
  clipTime: number;
  mobility: number;
  burn: number;
  bow: number;
  fatigue: number;
  hour: number;
  ended: boolean;
};
/** A viewer who has taken the walk over is not stopped for the look-around, the
 * first fall or the pause at the crest; those play only on the scripted
 * crossing. The final kneel is the end of the piece and always comes. */
export function sampleScore(
  time: number,
  s: Score,
  started = true,
  skipScriptedStops = false,
): Cue {
  const t = clamp(time, 0, s.duration),
    fatigue = smooth(s.stage_06_fatigue, s.stage_08_kneel, t);
  // The fire takes its share of the fresh walk. Fatigue then runs from there down
  // to the authored final pace itself, never to a fraction of it, so the last slow
  // stretch is exactly as slow as it was authored and no slower.
  const settled = Math.min(1, s.endSpeed / s.paceScale);
  const cue: Cue = {
    phase: 'Walking',
    clip: 'locomotion',
    clipTime: t,
    mobility: 1 - fatigue + settled * fatigue,
    burn: smooth(s.stage_01_flame, s.stage_02_alight, t),
    bow: 0,
    fatigue,
    hour: s.startHour + (s.endHour - s.startHour) * smooth(0, s.duration, t),
    ended: t >= s.duration,
  };
  if (!started)
    return {
      ...cue,
      phase: 'Before the flame',
      clip: 'opening',
      clipTime: 0,
      mobility: 0,
      burn: 0,
      hour: s.startHour,
    };
  if (t < s.stage_03_walk)
    return {
      ...cue,
      phase: t < s.stage_01_flame ? 'The opening bars' : 'Ignition',
      clip: 'opening',
      clipTime: t,
      mobility: 0,
    };
  // He slows into a scripted stop and gathers his pace out of it. Coming to rest
  // within one frame is what made the crest read as a jolt rather than a pause.
  if (!skipScriptedStops)
    for (const [at, hold] of [
      [lookStart(s), lookSpan(s)],
      [s.stage_07_crest, s.stage_07_crest_hold],
    ] as const) {
      if (hold <= 0) continue;
      if (t > at - SLOW_SECONDS && t < at) cue.mobility *= 1 - smooth(at - SLOW_SECONDS, at, t);
      else if (t >= at + hold && t < at + hold + GATHER_SECONDS)
        cue.mobility *= smooth(at + hold, at + hold + GATHER_SECONDS, t);
    }
  // He stops, turns once all the way round, and only then gives way.
  if (!skipScriptedStops && t >= lookStart(s) && t < s.stage_05_fall)
    return {...cue, phase: 'Looking about', mobility: 0};
  if (!skipScriptedStops && t >= s.stage_05_fall) {
    const f = t - s.stage_05_fall;
    if (f < FALL_SECONDS)
      return {...cue, phase: 'Giving way', clip: 'kneefall', clipTime: f, mobility: 0};
    if (f < FALL_SECONDS + s.stage_05_fall_hold)
      return {
        ...cue,
        phase: 'Gathering strength',
        clip: 'kneeling',
        clipTime: f - FALL_SECONDS,
        mobility: 0,
      };
    if (f < FALL_SECONDS + s.stage_05_fall_hold + RISE_SECONDS)
      return {
        ...cue,
        phase: 'Rising',
        clip: 'standup',
        clipTime: f - FALL_SECONDS - s.stage_05_fall_hold,
        mobility: 0,
      };
    // On his feet again, and gathering his pace rather than finding it at once.
    const up = FALL_SECONDS + s.stage_05_fall_hold + RISE_SECONDS;
    if (f < up + GATHER_SECONDS) {
      cue.mobility *= smooth(up, up + GATHER_SECONDS, f);
      cue.phase = 'Finding his feet';
    }
  }
  // He tops the last dune, sees the water, and stands in it for a moment.
  if (
    !skipScriptedStops &&
    t >= s.stage_07_crest &&
    t < s.stage_07_crest + s.stage_07_crest_hold &&
    t < s.stage_08_kneel
  )
    return {...cue, phase: 'At the crest', mobility: 0};
  if (t >= s.stage_08_kneel) {
    cue.mobility = 0;
    cue.clip =
      t < s.stage_08_kneel + FALL_SECONDS ? 'kneefall' : t < s.stage_09_settle ? 'kneeling' : 'settle';
    cue.clipTime =
      cue.clip === 'settle'
        ? t - s.stage_09_settle
        : t - s.stage_08_kneel - (cue.clip === 'kneeling' ? FALL_SECONDS : 0);
    cue.bow = smooth(s.stage_10_bow, s.duration, t);
    cue.phase = cue.ended
      ? 'Still burning'
      : cue.bow > 0
        ? 'The last breath'
        : cue.clip === 'settle'
          ? 'Settling onto heels'
          : 'On his knees';
  } else if (fatigue > 0.05) cue.phase = 'Fading strength';
  return cue;
}
/** The audio and visuals share this transport; rendering never owns the score clock. */
export class Transport {
  time = 0;
  started = false;
  playing = false;
  rate = 1;
  start() {
    this.time = 0;
    this.started = true;
    this.playing = true;
  }
  reset() {
    this.time = 0;
    this.started = false;
    this.playing = false;
  }
  seek(t: number, duration: number) {
    this.time = clamp(t, 0, duration);
    this.started = true;
  }
  advance(dt: number, duration: number) {
    if (this.playing) {
      this.time = clamp(this.time + Math.max(0, dt) * this.rate, 0, duration);
      if (this.time === duration) this.playing = false;
    }
    return this.time;
  }
}

/** Changing the song length preserves the authored walking envelope by retiming
 * the cues and pace together. Knee-fall, recovery and final pose keep real seconds. */
export function retimeScore(score: Score, duration: number): Score {
  const finalKneel = duration - (score.duration - score.stage_08_kneel);
  const ratio = (finalKneel - score.stage_03_walk) / (score.stage_08_kneel - score.stage_03_walk);
  const retime = (at: number) => score.stage_03_walk + (at - score.stage_03_walk) * ratio;
  const next = {
    ...score,
    duration,
    finalKneel,
    stage_09_settle: duration - (score.duration - score.stage_09_settle),
    stage_10_bow: duration - (score.duration - score.stage_10_bow),
    stage_06_fatigue: retime(score.stage_06_fatigue),
    stage_05_fall: retime(score.stage_05_fall),
    heartbeatSlowAt: retime(score.heartbeatSlowAt),
  };
  const distance = (s: Score) => {
    let result = 0;
    for (let t = 0; t < s.stage_08_kneel; t += 1 / 120)
      result += (pace(s) * sampleScore(t, s).mobility) / 120;
    return result;
  };
  next.walkSpeed *= distance(score) / distance(next);
  return validateScore(next);
}
