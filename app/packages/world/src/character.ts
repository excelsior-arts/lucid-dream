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
 *
 * ---- who steps the world ---------------------------------------------------
 *
 * `move` used to take a step of its own, so that "moved" meant moved. That is
 * the wrong shape for a game whose whole loop is the world's: a walk applies
 * this step's input, moves the figure, checks what it picked up and counts the
 * dose, all inside one fixed step, and a `move` that stepped would have taken
 * a second one in the middle of that. So `move` now only writes down where the
 * body is to be next, and the world's own `advance`/`stepN` is what puts it
 * there. Call it from the `onStep` callback, once per step, and the figure
 * moves exactly once per step whatever the frame rate did.
 *
 * ---- and who does the falling ----------------------------------------------
 *
 * A kinematic body has no gravity, so the fall is kept here: metres per
 * second, negative downward, gathering at 9.81 per second for as long as
 * nothing is under it and zeroed the moment something is. Which makes walking
 * off a two-metre ledge an arc rather than a slide down an invisible ramp,
 * and makes "how long has it been in the air" a number the game above can
 * read rather than guess.
 */
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type {Vec3, World} from './world';

/** Metres per second per second, downward, when the game does not say. The
    same 9.81 the world is built with; kept apart because a kinematic body is
    not in the world's gravity and this is a decision about a character, not
    a planet -- and a game may want its figure to fall harder than the earth
    pulls, so a jump is a snap rather than a float. */
const G = 9.81;

export interface CharacterOpts {
  /** The capsule: how wide, and how tall between the two caps. */
  radius: number;
  height: number;
  /** How hard it falls, m/s². Left out, the earth's; a function is read at
      every step, for a game whose numbers are knobs turned while it runs. */
  gravity?: number | (() => number);
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
  /** Ask to go that way this step: metres per second on x and z. The vertical
      is the controller's own — a fall that accumulates while nothing is under
      it, and is zeroed on landing. Sets the next kinematic translation and
      steps NOTHING: the world's `advance()` applies it. Call once per step,
      from the world's `onStep`. */
  move(dir: {x: number; z: number}, dt: number): void;
  /** Put it somewhere, standing, with no velocity. */
  warp(at: Vec3): void;
  readonly grounded: boolean;
  /** Vertical speed, m/s, negative falling. */
  readonly fall: number;
  /** Colliders the last move ran into, by handle. What a dash is judged
      against.

      The ground is a collider like any other, so the thing being walked on is
      in here on almost every step: a caller asking "what did I hit" means
      "which of these is not the floor", and only the caller knows which one
      that is. Sensors are never in here — see `move`. */
  hits(): number[];
  /** Leave the ground at this many metres a second upward. Nothing while
      it is already in the air: a jump is from the ground. `even` launches
      whether or not there is ground -- for a game that has decided the
      figure leaves it now, a dash carried into the air. */
  jump(up: number, even?: boolean): boolean;
  at(): Vec3;
  dispose(): void;
}

export function createCharacter(
  w: World,
  {radius, height, at = {x: 0, y: 0, z: 0}, skin = .02, step = .3, climb = .8, gravity = G}: CharacterOpts,
): Character {
  const R = w.RAPIER;
  const g = () => (typeof gravity === 'function' ? gravity() : gravity);
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
  let fall = 0;
  /* Reused rather than rebuilt each step: at sixty steps a second for ten
     minutes this is thirty-six thousand arrays nobody reads twice. `hits()`
     hands out a copy, so a caller that keeps one is keeping its own. */
  const bumped: number[] = [];

  return {
    controller,
    body,
    collider,
    get grounded() { return grounded; },
    get fall() { return fall; },
    hits() { return bumped.slice(); },
    jump(up, even = false) {
      if (!grounded && !even) return false;
      fall = up;
      grounded = false;
      return true;
    },
    move(dir, dt) {
      if (!grounded) fall -= g() * dt;
      const want = {
        x: dir.x * dt,
        /* Standing, it still asks for a step's worth of falling. Zero would
           be a figure that never presses on what it is standing on, and a
           controller with nothing to detect against is a controller that says
           it is not grounded — so the fall the game reads is zero and the
           movement asked for is not. */
        y: grounded ? -g() * dt * dt : fall * dt,
        z: dir.z * dt,
      };
      /* Sensors excluded: a trigger volume is a question about where the
         figure is, never a wall. A walk that was stopped by one would have
         embers you cannot reach. */
      controller.computeColliderMovement(
        collider, want, R.QueryFilterFlags.EXCLUDE_SENSORS);
      const got = controller.computedMovement();
      grounded = controller.computedGrounded();
      if (grounded) fall = 0;

      bumped.length = 0;
      const many = controller.numComputedCollisions();
      for (let i = 0; i < many; i++) {
        const handle = controller.computedCollision(i)?.collider?.handle;
        /* The same collider is reported once per contact, and a capsule
           arriving at a corner has two. */
        if (handle !== undefined && !bumped.includes(handle)) bumped.push(handle);
      }

      const now = body.translation();
      body.setNextKinematicTranslation(
        {x: now.x + got.x, y: now.y + got.y, z: now.z + got.z});
    },
    warp(to) {
      /* Both, and in this order. `setTranslation` is where it is; a
         `setNextKinematicTranslation` left over from the last move is where
         the next step would put it, and without overwriting that, a warp is
         undone one sixtieth of a second later. */
      body.setTranslation(to, true);
      body.setNextKinematicTranslation(to);
      fall = 0;
      /* Not grounded until a move has proved it is: what it was standing on
         before says nothing about where it has been put. */
      grounded = false;
      bumped.length = 0;
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
