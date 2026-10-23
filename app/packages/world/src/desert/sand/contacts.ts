import type {MotionState} from '../runtime/types';
import {SandField} from './field';

/** Where a figure's soles land as it walks: each foot's place in character
    space at full contact and its phase in the stride, and the stride's
    arithmetic -- which step a distance walked is on, and where that step was
    planted. A figure's own numbers; Burning Man's are measured off its clip. */
export interface Footfalls {
  contacts: readonly {foot: 'left' | 'right'; phase: number; x: number; z: number; yaw: number}[];
  stepCount(distance: number): number;
  stepDistance(step: number): number;
}

type Sole = {x: number; y: number; z: number; facing: number};
type Plant = {last: Sole; printed: Sole; age: number};

/** Footprints and kicked sand follow the authored walk's sole positions and plant phases. */
export class SandContacts {
  private distance = 0;
  private previous?: {x: number; z: number; facing: number};
  private plants: Plant[] = [];
  readonly field: SandField;
  private readonly footfalls: Footfalls;
  constructor(field: SandField, footfalls: Footfalls) {
    this.field = field;
    this.footfalls = footfalls;
  }
  reset(distance = 0) {
    this.distance = distance;
    this.previous = undefined;
    this.plants = [];
  }
  /** Captures can pivot on a toe without lifting it: a newly settled sole counts
   * after either travel or a twist. A held pose never digs a repeating hole. */
  updatePose(motion: MotionState, feet: readonly Sole[], dt: number): number[] {
    if (!motion.gesture) {
      this.plants = [];
      return [];
    }
    if (dt <= 0) return [];
    const landed: number[] = [];
    for (const [i, foot] of feet.entries()) {
      const plant = this.plants[i] ??= {last: {...foot}, printed: {...foot}, age: 0};
      plant.age += dt;
      const speed = Math.hypot(foot.x - plant.last.x, foot.z - plant.last.z) / dt;
      const travel = Math.hypot(foot.x - plant.printed.x, foot.z - plant.printed.z);
      const turn = Math.abs(Math.atan2(Math.sin(foot.facing - plant.printed.facing),
        Math.cos(foot.facing - plant.printed.facing)));
      if (plant.age > 0.24 && speed < 0.32 && (travel > 0.1 || turn > 0.5)
        && foot.y - this.field.height(foot.x, foot.z) < 0.035) {
        this.field.contact({...foot, force: 0.65, kind: 'step'});
        Object.assign(plant.printed, foot);
        plant.age = 0;
        landed.push(i);
      }
      Object.assign(plant.last, foot);
    }
    return landed;
  }
  update(motion: MotionState) {
    if (motion.distance < this.distance) this.reset(motion.distance);
    const previous = this.previous ?? {...motion.position, facing: motion.facing};
    const travel = motion.distance - this.distance;
    if (!motion.gesture && motion.speed >= 0.12 && travel > 0) {
      const turn = Math.atan2(
        Math.sin(motion.facing - previous.facing),
        Math.cos(motion.facing - previous.facing),
      );
      const {stepCount, stepDistance, contacts} = this.footfalls;
      for (let step = stepCount(this.distance); step < stepCount(motion.distance); step++) {
        const foot = contacts[step % 2]!;
        // A scrub's coarse samples and a live fixed step must stamp the same spot.
        const f = (stepDistance(step) - this.distance) / travel;
        const facing = previous.facing + turn * f;
        const x = previous.x + (motion.position.x - previous.x) * f;
        const z = previous.z + (motion.position.z - previous.z) * f;
        const sin = Math.sin(facing),
          cos = Math.cos(facing);
        this.field.contact({
          x: x + cos * foot.x + sin * foot.z,
          z: z - sin * foot.x + cos * foot.z,
          facing: facing + foot.yaw,
          force: 1,
          kind: 'step',
        });
      }
    }
    this.distance = motion.distance;
    previous.x = motion.position.x;
    previous.z = motion.position.z;
    previous.facing = motion.facing;
    this.previous = previous;
  }
}
