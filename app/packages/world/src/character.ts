/* Somebody walking.
 *
 * Not used by Lucid Talk — nobody walks in either of its rooms; a hand
 * reaches into them and that is all. It is here because the games after it
 * are the kind with a figure in them, and a kinematic character controller is
 * the one piece of a physics engine that is genuinely hard to add later: it
 * decides how a body that is *told* where to go negotiates the world it is
 * being told to go through, and everything above it — the animation, the
 * camera, the stairs — is written against its answers.
 *
 * Kinematic rather than dynamic, which is the whole point. A capsule with
 * mass in it is a ragdoll: it tips on a slope, it is knocked over by a
 * cushion, and it accelerates the way a barrel does. A character moves
 * because somebody said so, and the controller's job is only to work out how
 * much of that movement the world will actually allow — sliding along a wall,
 * stepping up a kerb, staying on the ground going downhill.
 */
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type {Vec3, World} from './world';

export interface CharacterOpts {
  /** The capsule: how wide, and how tall between the two caps. */
  radius: number;
  height: number;
  /** Where it starts. The middle of the capsule, not its feet. */
  at?: Vec3;
  /** How far off the walls it is kept. Small, and never zero: a controller
      allowed to touch is a controller that jitters against what it touched. */
  skin?: number;
  /** The tallest thing it can walk up without jumping. A kerb, a stair. */
  step?: number;
  /** How steep a slope it will climb, in radians. */
  climb?: number;
}

export interface Character {
  controller: RAPIER.KinematicCharacterController;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Ask to go that way for `dt` seconds. What actually happens is what the
      world allows, and that is where it ends up. */
  move(dir: Vec3, dt: number): void;
  /** Whether the last move ended with something under it. */
  readonly grounded: boolean;
  /** The middle of the capsule, now. */
  at(): Vec3;
  dispose(): void;
}

export function createCharacter(
  w: World,
  {radius, height, at = {x: 0, y: 0, z: 0}, skin = .02, step = .3, climb = .8}: CharacterOpts,
): Character {
  const R = w.RAPIER;
  const body = w.world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z));
  const collider = w.world.createCollider(
    R.ColliderDesc.capsule(Math.max(height / 2, .01), radius), body);

  const controller = w.world.createCharacterController(skin);
  controller.setUp({x: 0, y: 1, z: 0});
  controller.setSlideEnabled(true);
  controller.enableAutostep(step, radius * .5, true);
  /* Held down on the way downhill. Without it a figure walking off the top of
     a ramp leaves the ground for a frame at every step and the camera bobs. */
  controller.enableSnapToGround(Math.max(step * .5, .1));
  controller.setMaxSlopeClimbAngle(climb);

  let grounded = false;
  return {
    controller,
    body,
    collider,
    get grounded() { return grounded; },
    move(dir, dt) {
      /* Gravity by hand, because a kinematic body has none: what is asked for
         is the walk plus a step's worth of falling, and the controller
         decides how much of either it gets. */
      const want = {
        x: dir.x * dt,
        y: dir.y * dt - 9.81 * dt * dt,
        z: dir.z * dt,
      };
      controller.computeColliderMovement(collider, want);
      const got = controller.computedMovement();
      grounded = controller.computedGrounded();
      const now = body.translation();
      body.setNextKinematicTranslation(
        {x: now.x + got.x, y: now.y + got.y, z: now.z + got.z});
      /* A kinematic body only actually moves on a step, and the caller may be
         fast-forwarding rather than drawing. One step, here, so `move` means
         moved. */
      w.stepN(1);
    },
    at() {
      const t = body.translation();
      return {x: t.x, y: t.y, z: t.z};
    },
    dispose() {
      w.world.removeCharacterController(controller);
      w.world.removeRigidBody(body);
    },
  };
}
