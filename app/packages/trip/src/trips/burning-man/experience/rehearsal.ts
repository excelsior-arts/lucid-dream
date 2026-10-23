import type {MotionState} from '@lucid/world/desert';
import {sampleScore, clamp, type Score} from './score';
import {Walker} from './walker';
import {journeyHeading, type Journey} from './journey';
import {duneHeight} from '../landscape';
import type {WalkObstacle} from '@lucid/world/desert';

const STEP = 1 / 60;
const copy = (m: MotionState): MotionState => ({
  ...m,
  position: {...m.position},
  velocity: {...m.velocity},
  ...(m.gesture ? {gesture: {...m.gesture}} : {}),
});

/** Cached base-terrain rehearsal. Backward/forward scrubs reuse the same motion samples. */
export class ScriptedWalk {
  private readonly walker: Walker;
  private readonly samples: MotionState[] = [];
  private readonly score: Score;
  private readonly journey: Journey;
  /** An altar is reached by a viewer holding a key, and a viewer skips every
   * scripted stop, so replaying one of those walks as the script would take it
   * lands fifty metres short of where anybody actually gets to. */
  private driven: boolean;
  constructor(
    score: Score,
    journey: Journey = 'sea',
    driven = false,
    obstacles: readonly WalkObstacle[] = [],
  ) {
    this.driven = driven;
    this.walker = new Walker(duneHeight, obstacles);
    this.journey = journey;
    this.score = structuredClone(score);
    this.walker.reset(score.spawnX, score.spawnZ);
    this.samples.push(copy(this.walker.state));
  }

  sample(time: number): MotionState {
    const t = clamp(time, 0, this.score.duration);
    const index = Math.floor(t / STEP + 1e-8);
    while (this.samples.length <= index) {
      const at = (this.samples.length - 1) * STEP;
      this.walker.restore(this.samples.at(-1)!);
      this.advance(at, STEP);
      this.samples.push(copy(this.walker.state));
    }
    this.walker.restore(this.samples[index]!);
    const remainder = Math.max(0, t - index * STEP);
    if (remainder > 1e-8) this.advance(index * STEP, remainder);
    const result = copy(this.walker.state);
    // A cue exactly at a fall/end boundary stops motion on that same music timestamp.
    if (sampleScore(t, this.score, true, this.driven).mobility === 0) {
      result.speed = 0;
      result.velocity = {x: 0, y: 0, z: 0};
    }
    return result;
  }

  /** One step of the same walk the piece runs, look-around pivot included. */
  private advance(at: number, dt: number) {
    const heading = journeyHeading(this.journey, this.score, [
      this.walker.state.position.x,
      this.walker.state.position.z,
    ]);
    this.walker.step(...heading, dt, sampleScore(at, this.score, true, this.driven).mobility, this.score);
    if (!this.driven) this.walker.look(at + dt, this.score, heading);
  }
}
