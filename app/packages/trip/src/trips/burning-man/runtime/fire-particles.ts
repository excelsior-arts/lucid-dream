import {createNodes} from '../render/fire-nodes.js';
import * as THREE from 'three/webgpu';
import type {Vec3} from '@lucid/world/desert';
import {ParticleBuffer} from '@lucid/world/desert';

const CAPACITY = 2400;
const ANCHORS = 192;
/** Bounded world-space fire. Only birth positions are sampled from the animated body. */
export class FireParticles {
  readonly wind = new THREE.Vector3(0.15, 0, 0);
  readonly object = new THREE.Group();
  private readonly flames: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly smoke: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly flameBuffer: ParticleBuffer;
  private readonly smokeBuffer: ParticleBuffer;
  private readonly position = new Float32Array(CAPACITY * 3);
  private readonly velocity = new Float32Array(CAPACITY * 3);
  private readonly state = new Float32Array(CAPACITY * 4);
  private readonly life = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly ids = new Uint32Array(CAPACITY);
  private readonly anchors: {
    indices: number[];
    weights: number[];
    /** Skinned position in the body's own frame, independent of where it stands. */
    local: THREE.Vector3;
    at: THREE.Vector3;
    previous: THREE.Vector3;
    legWeight: number;
  }[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly skeleton?: THREE.Skeleton;
  private readonly pose: Float32Array;
  private readonly boneScratch = new Float32Array(10);
  private cursor = 0;
  private serial = 0;
  private credit = 0;
  private time = 0;
  private initialized = false;
  private randomState = 713;
  legFire = 0.16;
  smokeAmount = 0.7;
  private birthRegions = {torso: 0, legs: 0};
  private reskins = 0;

  private readonly source: THREE.Mesh;
  private readonly texture: THREE.Texture;

  constructor(source: THREE.Mesh, texture: THREE.Texture) {
    this.source = source;
    this.texture = texture;
    const sources = {
      center: [this.position, 3],
      drift: [this.velocity, 3],
      state: [this.state, 4],
    } as const;
    this.flameBuffer = new ParticleBuffer(CAPACITY, sources);
    this.smokeBuffer = new ParticleBuffer(CAPACITY, sources);
    const nodes = createNodes({plume: {value: texture}});
    const flameMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    flameMaterial.vertexNode = nodes.particleVertex();
    flameMaterial.fragmentNode = nodes.particleFragment();
    this.flames = new THREE.Mesh(this.flameBuffer.geometry, flameMaterial);
    this.flames.name = 'Detached fire and embers';
    this.flames.frustumCulled = false;
    const smokeMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    smokeMaterial.vertexNode = nodes.particleVertex();
    smokeMaterial.fragmentNode = nodes.smokeFragment();
    this.smoke = new THREE.Mesh(this.smokeBuffer.geometry, smokeMaterial);
    this.smoke.name = 'Detached smoke';
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = -1;
    this.object.name = 'Detached fire particles';
    this.object.matrixAutoUpdate = false;
    this.object.add(this.flames, this.smoke);
    this.clear();

    // Area-weighted samples of the actual Blender surface, including the limbs.
    const positions = source.geometry.getAttribute('position');
    const index = source.geometry.index;
    const triangles = Math.floor((index?.count ?? positions.count) / 3);
    const cumulative = new Float64Array(triangles);
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    let area = 0;
    for (let i = 0; i < triangles; i++) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(i * 3 + k) : i * 3 + k));
      a.fromBufferAttribute(positions, ids[0]!);
      b.fromBufferAttribute(positions, ids[1]!).sub(a);
      c.fromBufferAttribute(positions, ids[2]!).sub(a);
      area += b.cross(c).length();
      cumulative[i] = area;
    }
    for (let i = 0; i < ANCHORS; i++) {
      const target = this.random() * area;
      let low = 0,
        high = triangles - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (cumulative[mid]! < target) low = mid + 1;
        else high = mid;
      }
      const u = Math.sqrt(this.random()),
        v = this.random();
      this.anchors.push({
        indices: [0, 1, 2].map((k) => (index ? index.getX(low * 3 + k) : low * 3 + k)),
        weights: [1 - u, u * (1 - v), u * v],
        local: new THREE.Vector3(),
        at: new THREE.Vector3(),
        previous: new THREE.Vector3(),
        legWeight: 0,
      });
    }
    if (source instanceof THREE.SkinnedMesh) this.skeleton = source.skeleton;
    this.pose = new Float32Array((this.skeleton?.bones.length ?? 0) * 10);
    // Bone influence classifies emission even when knees are bent or arms raised.
    const skinIndex = source.geometry.getAttribute('skinIndex'),
      skinWeight = source.geometry.getAttribute('skinWeight');
    if (source instanceof THREE.SkinnedMesh && skinIndex && skinWeight) {
      for (const anchor of this.anchors) {
        let leg = 0;
        for (let k = 0; k < 3; k++)
          for (let n = 0; n < 4; n++) {
            const id = anchor.indices[k]!,
              bone = source.skeleton.bones[skinIndex.getComponent(id, n)];
            if (bone && /UpLeg|Leg|Foot|Toe/.test(bone.name))
              leg += skinWeight.getComponent(id, n) * anchor.weights[k]!;
          }
        anchor.legWeight = leg;
      }
    }
  }

  /** Compare and store every bone's local transform: the whole skinned pose. */
  private poseChanged() {
    const bones = this.skeleton?.bones;
    if (!bones) return false;
    const scratch = this.boneScratch;
    let changed = false;
    let k = 0;
    for (const bone of bones) {
      bone.quaternion.toArray(scratch, 0);
      bone.position.toArray(scratch, 4);
      bone.scale.toArray(scratch, 7);
      for (let i = 0; i < 10; i++, k++)
        if (this.pose[k] !== scratch[i]) {
          this.pose[k] = scratch[i]!;
          changed = true;
        }
    }
    return changed;
  }

  private random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  clear() {
    this.age.fill(10);
    for (let i = 0; i < CAPACITY; i++) this.state[i * 4] = 1;
    this.credit = 0;
    this.initialized = false;
    this.pack();
  }

  update(dt: number, strength: number, bodyVelocity: Vec3, dashing: boolean) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.25);
    this.time += dt;
    this.source.updateWorldMatrix(true, false);
    // Skinning the emission anchors is the one per-frame cost here that scales
    // with the rig. A held pose gives the same answer every time, so re-skin
    // only when a bone actually moved; walking and turning are world transforms.
    if (this.poseChanged() || !this.initialized) {
      // SkinnedMesh refreshes its attached bind inverse in updateMatrixWorld,
      // not updateWorldMatrix. Repeated seek samples run before a renderer pass.
      this.source.updateMatrixWorld(true);
      this.skeleton?.update();
      for (const anchor of this.anchors) {
        anchor.local.set(0, 0, 0);
        for (let k = 0; k < 3; k++) {
          this.source.getVertexPosition(anchor.indices[k]!, this.scratch);
          anchor.local.addScaledVector(this.scratch, anchor.weights[k]!);
        }
      }
      this.reskins++;
    }
    for (const anchor of this.anchors) {
      anchor.previous.copy(anchor.at);
      anchor.at.copy(anchor.local).applyMatrix4(this.source.matrixWorld);
      if (!this.initialized) anchor.previous.copy(anchor.at);
    }
    this.initialized = true;
    // Cancel the character parent transform: all particle coordinates remain world-space.
    if (this.object.parent) {
      this.object.parent.updateWorldMatrix(true, false);
      this.object.matrix.copy(this.object.parent.matrixWorld).invert();
    }
    const damping = Math.exp(-2.8 * dt);
    for (let i = 0; i < CAPACITY; i++) {
      this.age[i] = this.age[i]! + dt;
      const fraction = Math.min(1, this.age[i]! / (this.life[i] || 1));
      this.state[i * 4] = fraction;
      if (fraction >= 1) continue;
      const j = i * 3;
      const x = this.position[j]!,
        y = this.position[j + 1]!,
        z = this.position[j + 2]!;
      const seed = this.state[i * 4 + 2]! * 6.28;
      const phase = this.time * 2.4 + seed;
      // Smooth spatial turbulence, buoyancy, weak ambient wind, and velocity drag.
      this.velocity[j] =
        (this.velocity[j]! - this.wind.x) * damping +
        this.wind.x +
        (0.25 + Math.sin(y * 5 + phase) * 1.1 + Math.cos(z * 4 - phase) * 0.45) * dt;
      this.velocity[j + 1] =
        (this.velocity[j + 1]! - this.wind.y) * damping +
        this.wind.y +
        (2.2 + Math.sin(x * 5 - phase) * 0.55) * dt;
      this.velocity[j + 2] =
        (this.velocity[j + 2]! - this.wind.z) * damping +
        this.wind.z +
        Math.sin(x * 4 + phase) * 0.85 * dt;
      this.position[j] = this.position[j]! + this.velocity[j]! * dt;
      this.position[j + 1] = this.position[j + 1]! + this.velocity[j + 1]! * dt;
      this.position[j + 2] = this.position[j + 2]! + this.velocity[j + 2]! * dt;
    }
    this.credit += Math.max(0, strength) * (dashing ? 2400 : 1700) * dt;
    const count = Math.floor(this.credit);
    this.credit -= count;
    for (let birth = 0; birth < count; birth++) {
      const i = this.cursor++ % CAPACITY,
        j = i * 3,
        k = i * 4;
      const anchor = this.anchors[Math.floor(this.random() * ANCHORS)]!;
      if (this.random() > 1 - anchor.legWeight * (1 - this.legFire)) continue;
      this.birthRegions[anchor.legWeight > 0.5 ? 'legs' : 'torso']++;
      const along = (birth + this.random()) / count;
      const kind = this.random();
      const smoke = kind < 0.2 * this.smokeAmount;
      const ember = !smoke && kind < 0.2 * this.smokeAmount + 0.1;
      this.scratch.lerpVectors(anchor.previous, anchor.at, along);
      this.position[j] = this.scratch.x;
      this.position[j + 1] = this.scratch.y;
      this.position[j + 2] = this.scratch.z;
      this.scratch.subVectors(anchor.at, anchor.previous).multiplyScalar(1 / dt);
      this.scratch.x -= bodyVelocity.x;
      this.scratch.y -= bodyVelocity.y;
      this.scratch.z -= bodyVelocity.z;
      this.scratch.clampLength(0, 4).multiplyScalar(0.18);
      const inherit = dashing ? 0.12 : 0.22;
      this.velocity[j] = bodyVelocity.x * inherit + this.scratch.x + (this.random() - 0.5) * 0.85;
      this.velocity[j + 1] = this.scratch.y + 0.3 + this.random() * (ember ? 1.6 : 0.65);
      this.velocity[j + 2] =
        bodyVelocity.z * inherit + this.scratch.z + (this.random() - 0.5) * 0.85;
      this.age[i] = dt * (1 - along);
      this.life[i] = smoke
        ? 1.0 + this.random() * 0.8
        : ember
          ? 0.6 + this.random() * 0.65
          : 0.32 + this.random() * 0.38;
      this.state[k] = this.age[i]! / this.life[i]!;
      this.position[j] = this.position[j]! + this.velocity[j]! * this.age[i]!;
      this.position[j + 1] = this.position[j + 1]! + this.velocity[j + 1]! * this.age[i]!;
      this.position[j + 2] = this.position[j + 2]! + this.velocity[j + 2]! * this.age[i]!;
      this.state[k + 1] = smoke
        ? 0.16 + this.random() * 0.12
        : ember
          ? 0.035 + this.random() * 0.035
          : 0.12 + this.random() * 0.13;
      this.state[k + 1] = this.state[k + 1]! * (1 - anchor.legWeight * 0.36);
      this.state[k + 2] = this.random();
      this.state[k + 3] = smoke ? 2 : ember ? 1 : 0;
      this.ids[i] = ++this.serial;
    }
    this.pack();
  }

  private pack() {
    this.flameBuffer.begin();
    this.smokeBuffer.begin();
    for (let i = 0; i < CAPACITY; i++) {
      if (this.age[i]! >= this.life[i]!) continue;
      (this.state[i * 4 + 3] === 2 ? this.smokeBuffer : this.flameBuffer).append(i);
    }
    this.flameBuffer.upload();
    this.smokeBuffer.upload();
    this.flames.visible = this.flameBuffer.count > 0;
    this.smoke.visible = this.smokeBuffer.count > 0;
    this.object.visible = this.flames.visible || this.smoke.visible;
  }

  inspect() {
    const living = [];
    for (let i = 0; i < CAPACITY; i++) if (this.age[i]! < this.life[i]!) living.push(i);
    return {
      count: living.length,
      smoke: living.filter((i) => this.state[i * 4 + 3] === 2).length,
      capacity: CAPACITY,
      drawn: this.flameBuffer.count + this.smokeBuffer.count,
      birthRegions: {...this.birthRegions},
      emitted: this.serial,
      reskins: this.reskins,
      particles: living.slice(0, 8).map((i) => ({
        id: this.ids[i],
        age: this.age[i],
        life: this.life[i],
        position: Array.from(this.position.subarray(i * 3, i * 3 + 3)),
      })),
    };
  }

  dispose() {
    this.texture.dispose();
    for (const mesh of [this.flames, this.smoke]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.object.removeFromParent();
  }
}
