import type {Score} from './score';
import {journeyHeading} from './journey';
import type {MapPoint} from '../landscape';

export type WalkRoutine =
  'story' | 'keyboard' | 'coast' | 'air' | 'fire' | 'earth' | 'circle' | 'still';

/** Only movement input takes over the walk; the score clock and camera remain independent. */
export class WalkDirector {
  private lastMovement: number | null = null;
  routine: WalkRoutine = 'story';

  private engage(time: number) {
    this.lastMovement = time;
  }

  reset() {
    this.lastMovement = null;
  }

  inspect(time: number, score: Score) {
    const remaining =
      this.lastMovement === null ? 0 : Math.max(0, score.idleReturn - (time - this.lastMovement));
    return {
      mode: this.routine === 'story' ? (remaining > 0 ? 'player' : 'ocean') : this.routine,
      returnIn: remaining,
      routine: this.routine,
    };
  }

  direction(
    time: number,
    x: number,
    z: number,
    engaged: boolean,
    score: Score,
    position: MapPoint = [score.spawnX, score.spawnZ],
  ): [number, number] {
    if (engaged) this.engage(time);
    if (this.routine === 'air' || this.routine === 'fire' || this.routine === 'earth')
      return journeyHeading(this.routine, score, position);
    if (this.routine === 'keyboard') return [x, z];
    if (this.routine === 'circle') return [Math.sin(time * 0.12), Math.cos(time * 0.12)];
    if (this.routine === 'still') return [0, 0];
    if (this.routine === 'story' && this.inspect(time, score).mode === 'player') return [x, z];
    // The coastline lies west even after the player wanders north or south.
    return [-1, 0];
  }
}
