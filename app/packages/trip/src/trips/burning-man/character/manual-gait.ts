import profiles from './locomotion-data.json';
import type {MotionState} from '@lucid/world/desert';

type ProfileName = keyof typeof profiles;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** The same captured curve that was removed from the rig is applied to the body. */
export function motionAt(name: ProfileName, time: number) {
  const {times, curve} = profiles[name];
  if (time <= times[0]!) return curve[0]!;
  if (time >= times.at(-1)!) return curve.at(-1)!;
  let low = 0, high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle]! > time) high = middle;
    else low = middle;
  }
  const f = (time - times[low]!) / (times[high]! - times[low]!);
  return curve[low]! + (curve[high]! - curve[low]!) * f;
}

type Action = {name: ProfileName; time: number; rate: number; facing?: number; angle?: number};

/** Captured footwork for manual control. The score's original walk stays independent. */
export class ManualGait {
  private action?: Action;
  private moving = false;
  private idleTime = 0;

  reset() {
    this.action = undefined;
    this.moving = false;
    this.idleTime = 0;
  }

  step(state: MotionState, heading: number | null, speed: number, dt: number) {
    const wants = heading !== null;
    state.intent = heading ?? state.facing;
    const error = heading === null ? 0 : angleDelta(heading, state.facing);
    let action = this.action;
    // A planted turn finishes its step even when the key is released. A changed
    // direction is considered at its end, rather than snapping the supporting leg.
    if (action?.angle === undefined) {
      if (wants && Math.abs(error) > (state.speed < 0.12 ? 0.7 : 1.15)) {
        const half = Math.abs(error) >= Math.PI * 0.75;
        const name: ProfileName = error > 0
          ? half ? 'turnleft180' : 'turnleft90'
          : half ? 'turnright180' : 'turnright90';
        const nominal = half ? Math.PI : Math.PI / 2;
        action = {name, time: 0, facing: state.facing, angle: error,
          rate: 1 / (1.2 * clamp(Math.abs(error) / nominal, 0.7, 1.2))};
      } else {
        if (action?.name === 'stopwalk' && wants) action = undefined;
        if (action?.name === 'startwalk' && !wants) action = undefined;
        if (!action) {
          const name = !wants && this.moving && state.speed > 0.08 ? 'stopwalk'
            : wants && !this.moving && state.speed < 0.12 ? 'startwalk' : null;
          if (name) action = {name, time: 0,
            rate: clamp((name === 'stopwalk' ? state.speed : speed) / profiles[name].speed, 0.5, 1.8)};
        }
      }
    }
    this.moving = wants;
    let travel = 0;
    if (action) {
      const profile = profiles[action.name];
      const before = action.time;
      action.time = Math.min(profile.duration, action.time + dt * action.rate);
      state.gesture = {clip: action.name, time: action.time};
      if (action.angle !== undefined) {
        state.facing = action.facing! + action.angle * motionAt(action.name, action.time);
        // Finishing a turn leaves him standing, so a held key starts a real step.
        this.moving = false;
      } else {
        travel = Math.max(0, motionAt(action.name, action.time) - motionAt(action.name, before));
        // The last captured sample may consume only a fraction of this step.
        // Carry the rest into cruising, rather than reporting a near-zero speed
        // for one tick and accelerating from standstill a second time.
        if (action.name === 'startwalk' && action.time >= profile.duration)
          travel += speed * Math.max(0, dt - (action.time - before) / action.rate);
        if (wants) this.steer(state, error, dt);
      }
      this.action = action.time >= profile.duration ? undefined : action;
    } else if (wants) {
      this.steer(state, error, dt);
      travel = (state.speed + (speed - state.speed) * (1 - Math.exp(-dt * 7))) * dt;
      delete state.gesture;
    } else {
      this.idleTime += dt;
      // Standing is standing square (character/stand.ts), not the captured
      // weight-shift idle, whose cocked hip is a person waiting.
      state.gesture = {clip: 'stand', time: this.idleTime};
    }
    const velocity = travel / dt;
    state.velocity.x = Math.sin(state.facing) * velocity;
    state.velocity.z = Math.cos(state.facing) * velocity;
  }

  private steer(state: MotionState, error: number, dt: number) {
    state.facing += clamp(error * (1 - Math.exp(-dt * 9)), -2.8 * dt, 2.8 * dt);
  }
}
