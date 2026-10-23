/* A figure walking the desert: where it is, how fast, which way it faces.
 *
 * Walk-only. Acceleration and slope effort never exceed the stride it is
 * given, the shore is always kept dry, obstacles are walked round, and the
 * figure settles onto the ground rather than snapping to it. What the stride
 * is -- a score's pace, a figure's mobility -- arrives per step, and the way
 * a figure under the keys plants its feet and turns (Burning Man's captured
 * gait) arrives as a Gait; without one, the keys steer a plain velocity.
 *
 * This is Burning Man's Walker less its score and its gait, which that trip
 * puts back in its own experience/walker.ts. The arithmetic is the same.
 */
import type {MotionState} from './runtime/types';
import {moveAroundObstacles, type WalkObstacle} from './obstacles';

/** How a figure under the keys moves its own body: steps into turns, a
    starting and a stopping step, a shift of weight at rest. Writes `gesture`
    and `intent` on the state. */
export interface Gait {
  reset(): void;
  step(state: MotionState, heading: number | null, speed: number, dt: number): void;
}

/** What one step is allowed: the full pace in metres a second, how much of
    it the figure can use (0 is held still), and how close to the water the
    sand is still dry. */
export interface Stride {
  pace: number;
  mobility: number;
  beachMargin: number;
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export class Walker {
  readonly state: MotionState = {
    position: {x: 0, y: 0, z: 0},
    velocity: {x: 0, y: 0, z: 0},
    speed: 0,
    distance: 0,
    facing: -Math.PI / 2,
  };
  private readonly height: (x: number, z: number) => number;
  private readonly coastX: (z: number) => number;
  private readonly obstacles: readonly WalkObstacle[];
  private readonly gait: Gait | undefined;

  constructor(
    height: (x: number, z: number) => number,
    coastX: (z: number) => number,
    obstacles: readonly WalkObstacle[] = [],
    gait?: Gait,
  ) {
    this.height = height;
    this.coastX = coastX;
    this.obstacles = obstacles;
    this.gait = gait;
  }
  reset(x: number, z: number) {
    if (this.obstacles.length) ({x, z} = moveAroundObstacles(x, z, x, z, this.obstacles));
    this.gait?.reset();
    delete this.state.gesture;
    delete this.state.intent;
    Object.assign(this.state.position, {x, y: this.height(x, z), z});
    Object.assign(this.state.velocity, {x: 0, y: 0, z: 0});
    this.state.speed = 0;
    this.state.distance = 0;
    this.state.facing = -Math.PI / 2;
  }
  restore(state: MotionState) {
    this.gait?.reset();
    if (state.gesture) this.state.gesture = {...state.gesture};
    else delete this.state.gesture;
    if (state.intent !== undefined) this.state.intent = state.intent;
    else delete this.state.intent;
    Object.assign(this.state.position, state.position);
    Object.assign(this.state.velocity, state.velocity);
    this.state.speed = state.speed;
    this.state.distance = state.distance;
    this.state.facing = state.facing;
  }
  /** Lay a pose over the state: what a scripted look-around decides. */
  pose(pose: Partial<MotionState>) {
    Object.assign(this.state, pose);
  }
  step(x: number, z: number, dt: number, stride: Stride, manual = false) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const p = this.state.position,
      v = this.state.velocity;
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    const rise = len
      ? (this.height(p.x + x * 0.3, p.z + z * 0.3) - this.height(p.x - x * 0.3, p.z - z * 0.3)) /
        0.6
      : 0;
    const target = stride.pace * stride.mobility * clamp(1 - Math.max(0, rise) * 0.55, 0.48, 1);
    if (manual && stride.mobility > 0 && this.gait) {
      this.gait.step(this.state, len ? Math.atan2(x, z) : null, target, dt);
    } else {
      this.gait?.reset();
      delete this.state.gesture;
      delete this.state.intent;
      const ease = 1 - Math.exp(-dt * 9);
      v.x += (x * target - v.x) * ease;
      v.z += (z * target - v.z) * ease;
    }
    if (stride.mobility === 0) v.x = v.z = 0;
    const oldX = p.x,
      oldZ = p.z,
      oldY = p.y;
    p.x += v.x * dt;
    p.z += v.z * dt;
    // A dry shore is always retained, including lateral approaches and author retuning.
    p.x = Math.max(this.coastX(p.z) + stride.beachMargin, p.x);
    if (this.obstacles.length)
      Object.assign(p, moveAroundObstacles(oldX, oldZ, p.x, p.z, this.obstacles));
    v.x = (p.x - oldX) / dt;
    v.z = (p.z - oldZ) / dt;
    const floor = this.height(p.x, p.z);
    p.y += (floor - p.y) * (1 - Math.exp(-dt / 0.075));
    v.y = (p.y - oldY) / dt;
    this.state.speed = Math.hypot(v.x, v.z);
    this.state.distance += this.state.speed * dt;
    if (!manual && this.state.speed > 0.02) this.turn(Math.atan2(v.x, v.z), dt);
  }
  /** A pivot bounded per frame for small steering changes during travel. */
  turn(heading: number, dt: number, rate = 12, limit = 6) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const delta = Math.atan2(
      Math.sin(heading - this.state.facing),
      Math.cos(heading - this.state.facing),
    );
    this.state.facing += clamp(delta * (1 - Math.exp(-dt * rate)), -dt * limit, dt * limit);
  }
}
