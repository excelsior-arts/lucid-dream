import type {WalkObstacle} from '@lucid/world/desert';

/** Against the sheltered west foot of the small southern dune. */
export const FALLEN_ALTAR = {
  position: [-34.8, 21.5] as const,
  yaw: -0.55,
  visitor: [-38, 24] as const,
  burial: 0.0381,
};

const {position: [x, z], yaw} = FALLEN_ALTAR;
const cos = Math.cos(yaw), sin = Math.sin(yaw);
const point = (along: number) => ({x: x + 0.035 * cos + along * sin,
  z: z - 0.035 * sin + along * cos});
const head = point(-0.52), feet = point(0.60);

/** Covers the baked head, torso and spread limbs; the walker adds foot clearance. */
export const FALLEN_OBSTACLES: readonly WalkObstacle[] = [{
  ax: head.x, az: head.z, bx: feet.x, bz: feet.z, radius: 0.47,
}];
