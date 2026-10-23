/** Runtime boundary: metres, seconds, Y-up. No DOM, renderer, or game dependency. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface MotionState {
  position: Vec3;
  velocity: Vec3;
  facing: number;
  speed: number;
  distance: number;
  /** Captured footwork sampled by manual control or the scripted look-around. */
  gesture?: {clip: string; time: number};
  intent?: number;
}
