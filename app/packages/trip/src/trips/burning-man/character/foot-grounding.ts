import * as THREE from 'three';

export interface GroundSurface {
  height: (x: number, z: number) => number;
  sinkDepth?: (x: number, z: number) => number;
}

type SoleProbe = {
  foot: 'left' | 'right';
  part: 'heel' | 'toe' | 'knee';
  bone: THREE.Object3D;
  local: THREE.Vector3;
  world: THREE.Vector3;
  ground: number;
};

/** Metres from the knee joint to the skin that meets the ground. */
const KNEE_DROP = 0.055;
/** How far a kneeling weight presses into loose sand. */
const KNEEL_SINK = 0.035;
/** Settle the intact authored rig onto its lower foothold; yielding sand absorbs the higher foot. */
export class FootGrounding {
  private probes: SoleProbe[] = [];
  private height?: number;
  private previousBodyY?: number;
  private offset = 0;
  private desired = 0;

  private surface: GroundSurface;

  constructor(body: THREE.Object3D, rig: THREE.Object3D, surface: GroundSurface) {
    this.surface = surface;
    body.updateWorldMatrix(true, true);
    for (const foot of ['left', 'right'] as const) {
      const name = foot === 'left' ? 'Left' : 'Right';
      const ankle = rig.getObjectByName(`mixamorig1${name}Foot`);
      const toe = rig.getObjectByName(`mixamorig1${name}ToeBase`);
      if (!ankle || !toe) throw new Error(`Missing ${foot} foot for terrain support.`);
      const heelPoint = ankle.getWorldPosition(new THREE.Vector3());
      const toePoint = toe.getWorldPosition(new THREE.Vector3());
      const forward = toePoint.clone().sub(heelPoint).setY(0).normalize();
      toePoint.addScaledVector(forward, 0.055);
      // The rest rig is authored with its soles at body origin. Bind these probes
      // once; they then follow the actual ankle/toe animation, including foot lift.
      heelPoint.y = toePoint.y = body.position.y;
      // A kneeling pose rests on the knees, so they are probed too. Their contact
      // is the skin below the joint rather than the joint itself.
      const knee = rig.getObjectByName(`mixamorig1${name}Leg`);
      if (!knee) throw new Error(`Missing ${foot} knee for terrain support.`);
      const kneePoint = knee.getWorldPosition(new THREE.Vector3());
      kneePoint.y -= KNEE_DROP;
      for (const [part, bone, point] of [
        ['heel', ankle, heelPoint],
        ['toe', toe, toePoint],
        ['knee', knee, kneePoint],
      ] as const) {
        this.probes.push({
          foot,
          part,
          bone,
          local: bone.worldToLocal(point),
          world: new THREE.Vector3(),
          ground: 0,
        });
      }
    }
  }

  /** Called after sampling the animation, before applying this frame's body translation. */
  update(bodyY: number, dt: number, standing: boolean) {
    for (const probe of this.probes) {
      probe.world.copy(probe.local).applyMatrix4(probe.bone.matrixWorld);
      probe.ground = this.surface.height(probe.world.x, probe.world.z);
    }
    let lowerGround = Infinity;
    for (const foot of ['left', 'right'] as const) {
      let sole = Infinity,
        clearance = Infinity,
        sink = 0;
      for (const probe of this.probes) {
        if (probe.foot !== foot || probe.part === 'knee') continue;
        sole = Math.min(sole, probe.world.y);
        clearance = Math.min(clearance, probe.world.y - probe.ground);
        sink = Math.max(
          sink,
          Math.max(0, Math.min(0.075, this.surface.sinkDepth?.(probe.world.x, probe.world.z) ?? 0)),
        );
      }
      // Cancel the terrain gap, not the rig's existing swing-foot lift. A slanted
      // sole can contact at its heel or toe; chasing the lowest terrain under its
      // other end would unnecessarily bury the whole foot.
      lowerGround = Math.min(lowerGround, sole - clearance - sink);
    }
    // Never chase the swinging foot's height: its authored lift must survive.
    // Use ground beneath both feet, not the ground beneath the pelvis.
    const deepest = Math.min(...this.probes.map((p) => p.world.y - p.ground));
    // Off his feet he rests on whatever is lowest, the knees and the tops of the
    // feet, and the sand yields under that weight. Holding the walk's support
    // level through these poses leaves him in the air wherever the ground is not
    // the flat floor the clip was authored on, which on a beach is everywhere.
    if (!standing) {
      const drop = (probe: SoleProbe) =>
        probe.world.y -
        probe.ground +
        Math.max(
          0,
          Math.min(KNEEL_SINK, this.surface.sinkDepth?.(probe.world.x, probe.world.z) ?? 0),
        );
      let floor = Infinity,
        low = Infinity,
        high = -Infinity;
      for (const probe of this.probes) {
        const d = drop(probe);
        floor = Math.min(floor, d);
        if (probe.part !== 'knee') continue;
        low = Math.min(low, d);
        high = Math.max(high, d);
      }
      // A kneeling clip is authored on a flat floor. On a dune the ground falls
      // away under the knees while the feet still find the slope behind, so
      // resting on the first thing that touches leaves him kneeling in the air
      // on his toes. Sink until both knees reach the sand and let it take his
      // feet, which is what kneeling on a slope looks like. Only while he is
      // actually on both knees: through the fall and the rise one knee is lifted
      // or still high, and he has to go on landing on whatever touches down.
      const down =
        THREE.MathUtils.clamp((0.38 - (high - floor)) / 0.12, 0, 1) *
        THREE.MathUtils.clamp((0.2 - (high - low)) / 0.1, 0, 1);
      lowerGround = bodyY - (floor + Math.max(0, down * (high - floor)));
    }
    // At abrupt crest edges, do not turn an existing uphill intersection into a
    // knee-deep burial merely to reach the other foot. Preserve the authored pose.
    const burialLimit = bodyY + Math.min(0, -0.45 - deepest);
    this.desired = Math.max(
      burialLimit,
      bodyY + THREE.MathUtils.clamp(lowerGround - bodyY, -0.42, 0.18),
    );
    const travel = this.previousBodyY === undefined ? 0 : Math.abs(bodyY - this.previousBodyY);
    this.previousBodyY = bodyY;
    if (this.height === undefined) this.height = this.desired;
    else if (dt > 0) {
      const delta = this.desired - this.height;
      const ease = 1 - Math.exp(-dt / (delta < 0 ? 0.07 : 0.045));
      // Follow the controller's already-smoothed vertical travel, plus a bounded
      // settling correction. A fixed world-speed cap would leave the body behind
      // on a sustained steep descent.
      const limit = travel + dt * 1.25;
      this.height += THREE.MathUtils.clamp(delta * ease, -limit, limit);
    }
    // Keep the chosen support level through authored knee/fall/rise poses.
    // No leg rotations, joint scaling or accumulated corrections are introduced.
    this.offset = this.height - bodyY;
    return this.offset;
  }

  reset() {
    this.height = undefined;
    this.previousBodyY = undefined;
    this.offset = 0;
  }

  inspect() {
    return {
      height: this.height,
      offset: this.offset,
      desired: this.desired,
      probes: this.probes.map((p) => ({
        foot: p.foot,
        part: p.part,
        x: p.world.x,
        z: p.world.z,
        ground: p.ground,
        y: p.world.y + this.offset,
        clearance: p.world.y + this.offset - p.ground,
      })),
    };
  }
}
