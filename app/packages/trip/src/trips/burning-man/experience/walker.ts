/* Burning Man walking: the desert's walker with his score and his gait on it.
 *
 * The locomotion is the platform's (@lucid/world/desert's Walker): slope
 * effort, the dry shore, the obstacles, the settle onto the ground. What this
 * adds is what only he has -- the score that says how fast he walks and how
 * much of that he can use at each moment, the gait captured off his clips
 * that plants his feet under the keys, and the scripted look-around -- and
 * the rehearsals that calibrate the score against his own dunes.
 */
import {Walker as DesertWalker} from '@lucid/world/desert';
import type {Score} from './score';
import {sampleScore, pace} from './score';
import {sampleLook} from './look-around';
import {coastX, duneHeight} from '../landscape';
import {ManualGait} from '../character/manual-gait';
import type {WalkObstacle} from '@lucid/world/desert';

/** Walk-only controller. Acceleration and slope effort never exceed the score's speed budget. */
export class Walker extends DesertWalker {
  constructor(height: (x: number, z: number) => number = duneHeight,
    obstacles: readonly WalkObstacle[] = []) {
    super(height, coastX, obstacles, new ManualGait());
  }
  /** One step under the score: its pace, how much of it he has, and the beach it keeps him off. */
  override step(x: number, z: number, dt: number, mobility: number, s: Score, manual?: boolean): void;
  override step(x: number, z: number, dt: number, stride: {pace: number; mobility: number; beachMargin: number}, manual?: boolean): void;
  override step(x: number, z: number, dt: number, how: number | {pace: number; mobility: number; beachMargin: number},
    sOrManual?: Score | boolean, manual = false): void {
    if (typeof how === 'number') {
      const s = sOrManual as Score;
      super.step(x, z, dt, {pace: pace(s), mobility: how, beachMargin: s.beachMargin}, manual);
    } else super.step(x, z, dt, how, (sOrManual as boolean | undefined) ?? false);
  }
  /** The script uses the same captured turn as the player, slowed to its score slot. */
  look(time: number, score: Score, walking: readonly [number, number]) {
    const pose = sampleLook(time, score, walking);
    if (pose) this.pose(pose);
  }
}
export function rehearse(s: Score, spawnX = s.spawnX) {
  const walker = new Walker();
  walker.reset(spawnX, s.spawnZ);
  let arrival: number | null = null;
  for (let t = 0; t < s.duration; t += 1 / 30) {
    const c = sampleScore(t, s);
    walker.step(-1, 0, 1 / 30, c.mobility, s);
    walker.look(t + 1 / 30, s, [-1, 0]);
    if (
      arrival === null &&
      walker.state.position.x - coastX(walker.state.position.z) < s.beachMargin + 0.15
    )
      arrival = t;
  }
  return {
    x: walker.state.position.x,
    z: walker.state.position.z,
    waterDistance: walker.state.position.x - coastX(walker.state.position.z),
    arrival,
    distance: walker.state.distance,
  };
}
/** Calibrate against the actual dune profile, with margin before the final knee fall. */
export function calibratedSpawn(s: Score) {
  const end = s.stage_08_kneel - 1.5;
  let low = coastX(s.spawnZ) + 30,
    high = coastX(s.spawnZ) + 260;
  for (let i = 0; i < 25; i++) {
    const middle = (low + high) / 2;
    const r = rehearse({...s, duration: end}, middle);
    if (r.waterDistance > s.beachMargin + 0.2) high = middle;
    else low = middle;
  }
  return Math.round(((low + high) / 2) * 100) / 100;
}

/** Keep the authored start on its crest; tune pace instead of relocating it. */
export function calibratedPace(score: Score) {
  let low = 0.3,
    high = 2;
  for (let i = 0; i < 22; i++) {
    const speed = (low + high) / 2;
    const result = rehearse({...score, duration: score.stage_08_kneel - 1.5, walkSpeed: speed});
    if (result.waterDistance > score.beachMargin + 0.15) low = speed;
    else high = speed;
  }
  return (low + high) / 2;
}
