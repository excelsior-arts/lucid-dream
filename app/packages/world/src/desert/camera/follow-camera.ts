import * as THREE from 'three';

/** Where a director wants the camera: an offset from what it looks at, and
    how much of that to take against the viewer's own orbit. */
export interface CameraShot {
  offset: {x: number; y: number; z: number};
  weight: number;
}

interface Orbit {
  target: THREE.Vector3;
  update(dt?: number): unknown;
}

/** Follow horizontal travel directly; absorb terrain settling vertically. */
export class FollowCamera {
  private tracked = new THREE.Vector3();
  private shift = new THREE.Vector3();
  private lift = 0;
  private offset = new THREE.Vector3();
  private current = new THREE.Spherical();
  private desired = new THREE.Spherical();
  private distanceScale = 1;

  private camera: THREE.PerspectiveCamera;
  private orbit: Orbit;
  private groundHeight: (x: number, z: number) => number;

  constructor(
    camera: THREE.PerspectiveCamera,
    orbit: Orbit,
    groundHeight: (x: number, z: number) => number,
  ) {
    this.camera = camera;
    this.orbit = orbit;
    this.groundHeight = groundHeight;
    this.tracked.copy(orbit.target);
  }

  /** Preserve the chosen orbit when the visible viewport changes shape. */
  setDistanceScale(scale: number) {
    this.removeLift();
    this.camera.position
      .sub(this.orbit.target)
      .multiplyScalar(scale / this.distanceScale)
      .add(this.orbit.target);
    this.distanceScale = scale;
  }

  snap(target: THREE.Vector3, shot?: CameraShot) {
    this.removeLift();
    this.shift.copy(target).sub(this.orbit.target);
    if (shot)
      this.camera.position
        .copy(target)
        .add(this.offset.copy(shot.offset).multiplyScalar(this.distanceScale));
    else this.camera.position.add(this.shift);
    this.orbit.target.copy(target);
    this.tracked.copy(target);
  }

  update(target: THREE.Vector3, dt: number, follow: boolean, shot?: CameraShot) {
    // Restore the user's orbit before OrbitControls measures its radius again.
    // Collision correction belongs only to the rendered view, not that orbit.
    const previousLift = this.lift;
    this.removeLift();
    const ease = 1 - Math.exp(-Math.max(0, dt) / 0.18);
    if (follow) {
      this.shift.set(
        target.x - this.tracked.x,
        (target.y - this.tracked.y) * ease,
        target.z - this.tracked.z,
      );
      this.camera.position.add(this.shift);
      this.orbit.target.add(this.shift);
      this.tracked.add(this.shift);
    } else {
      this.tracked.copy(target);
    }
    if (shot && shot.weight > 0) {
      this.current.setFromVector3(this.offset.copy(this.camera.position).sub(this.orbit.target));
      this.desired.setFromVector3(this.offset.copy(shot.offset).multiplyScalar(this.distanceScale));
      const weight = THREE.MathUtils.clamp(shot.weight, 0, 1);
      const turn = Math.atan2(
        Math.sin(this.desired.theta - this.current.theta),
        Math.cos(this.desired.theta - this.current.theta),
      );
      this.current.theta += turn * weight;
      this.current.phi += (this.desired.phi - this.current.phi) * weight;
      this.current.radius += (this.desired.radius - this.current.radius) * weight;
      this.camera.position.copy(this.orbit.target).add(this.offset.setFromSpherical(this.current));
    }
    this.orbit.update(dt);
    const floor = this.groundHeight(this.camera.position.x, this.camera.position.z) + 0.5;
    const requiredLift = Math.max(0, floor - this.camera.position.y);
    // Clear rising terrain immediately, then ease back to the chosen orbit.
    this.lift = Math.max(requiredLift, previousLift * (1 - ease));
    if (this.lift < 0.00001) this.lift = 0;
    this.camera.position.y += this.lift;
    this.camera.lookAt(this.orbit.target);
  }

  private removeLift() {
    this.camera.position.y -= this.lift;
    this.lift = 0;
  }
}
