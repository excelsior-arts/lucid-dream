import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

/** Critically damped input remainder: ease into a drag, then coast to its endpoint. */
export class OrbitSpring {
  remaining = 0;
  velocity = 0;

  add(delta: number) {
    this.remaining += delta;
  }

  advance(dt: number) {
    if (dt <= 0) return 0;
    const omega = 14;
    const decay = Math.exp(-omega * dt);
    const term = omega * this.remaining - this.velocity;
    const next = (this.remaining + term * dt) * decay;
    this.velocity = (this.velocity + omega * term * dt) * decay;
    const delta = this.remaining - next;
    this.remaining = next;
    return delta;
  }

  reset() {
    this.remaining = this.velocity = 0;
  }
}

/** OrbitControls collects intent on a separate camera; only the frame loop moves the visible one. */
export class SmoothOrbit {
  readonly input: OrbitControls;
  private proxy: THREE.PerspectiveCamera;
  private yaw = new OrbitSpring();
  private pitch = new OrbitSpring();
  private zoom = new OrbitSpring();
  private goal = new THREE.Spherical();
  private sphere = new THREE.Spherical();
  private offset = new THREE.Vector3();
  private syncing = false;
  onInput?: () => void;

  private camera: THREE.PerspectiveCamera;
  /** The document the controls listen to for Control, as it was when they did. */
  private root: Node;

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement) {
    this.camera = camera;
    this.root = element.getRootNode();
    this.proxy = camera.clone();
    this.input = new OrbitControls(this.proxy, element);
    this.input.enablePan = false;
    this.input.enableDamping = false;
    this.input.rotateSpeed = 0.65;
    this.input.zoomSpeed = 0.65;
    this.input.minDistance = 0.45;
    this.input.maxDistance = 30;
    this.input.maxPolarAngle = Math.PI * 0.49;
    this.snap();
    this.input.addEventListener('change', () => {
      if (this.syncing) return;
      this.sphere.setFromVector3(this.offset.copy(this.proxy.position).sub(this.target));
      // The input angle retains a fast drag's full turn, even when it crosses pi.
      this.yaw.add(this.input.getAzimuthalAngle() - this.goal.theta);
      this.pitch.add(this.sphere.phi - this.goal.phi);
      this.zoom.add(Math.log(this.sphere.radius / this.goal.radius));
      this.goal.copy(this.sphere);
      this.onInput?.();
    });
  }

  get moving() {
    return [this.yaw, this.pitch, this.zoom].some(
      (spring) => Math.abs(spring.remaining) > 0.000001 || Math.abs(spring.velocity) > 0.00001,
    );
  }

  get target() {
    return this.input.target;
  }

  update(dt = 0) {
    this.sphere.setFromVector3(this.offset.copy(this.camera.position).sub(this.target));
    this.sphere.theta += this.yaw.advance(dt);
    this.sphere.phi += this.pitch.advance(dt);
    this.sphere.radius *= Math.exp(this.zoom.advance(dt));
    this.constrain();
    this.camera.position.copy(this.target).add(this.offset.setFromSpherical(this.sphere));
    this.camera.lookAt(this.target);
    this.syncProxy();
  }

  /** A seek/reset installs an exact view and must not inherit an old drag's momentum. */
  snap() {
    this.yaw.reset();
    this.pitch.reset();
    this.zoom.reset();
    this.camera.lookAt(this.target);
    this.syncProxy();
  }

  private constrain() {
    this.sphere.phi = THREE.MathUtils.clamp(this.sphere.phi, 0.001, this.input.maxPolarAngle);
    this.sphere.radius = THREE.MathUtils.clamp(
      this.sphere.radius,
      this.input.minDistance,
      this.input.maxDistance,
    );
  }

  private syncProxy() {
    this.sphere.setFromVector3(this.offset.copy(this.camera.position).sub(this.target));
    this.sphere.theta += this.yaw.remaining;
    this.sphere.phi += this.pitch.remaining;
    this.sphere.radius *= Math.exp(this.zoom.remaining);
    this.constrain();
    this.proxy.position.copy(this.target).add(this.offset.setFromSpherical(this.sphere));
    this.proxy.aspect = this.camera.aspect;
    this.proxy.updateProjectionMatrix();
    this.syncing = true;
    this.input.update();
    this.syncing = false;
    this.goal.setFromVector3(this.offset.copy(this.proxy.position).sub(this.target));
  }

  dispose() {
    this.input.dispose();
    /* OrbitControls listens for Control on the canvas's root node, and on
       dispose asks the canvas for that root again. A canvas already taken out
       of the page -- a route leaving, whose cleanup runs after React has
       removed it -- answers with itself, so the document kept the listener,
       and through its bound controls the whole piece: about 80 MB of heap
       held for every time Burning Man was opened and left. Taken off the root
       it was put on. */
    const own = this.input as unknown as {_interceptControlDown?: EventListener; _interceptControlUp?: EventListener};
    if (own._interceptControlDown) this.root.removeEventListener('keydown', own._interceptControlDown, {capture: true});
    if (own._interceptControlUp) this.root.removeEventListener('keyup', own._interceptControlUp, {capture: true});
  }
}
