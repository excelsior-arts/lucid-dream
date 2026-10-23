import * as THREE from 'three/webgpu';
import type {SandBurst, SandField} from './field';
import {SandParticleBatch} from './particle-batch';

/** Detached grains and broad, ground-hugging swells; both receive the world's lighting. */
export class SandGrains {
  readonly object = new THREE.Group();
  private readonly grains: SandParticleBatch;
  private readonly swells: SandParticleBatch;
  private seed = 41;
  private windCredit = 0;

  private field: SandField;

  constructor(field: SandField, color = new THREE.Color('#b99160')) {
    this.field = field;
    this.grains = new SandParticleBatch(2200, false, color);
    this.swells = new SandParticleBatch(160, true, color);
    this.object.add(this.swells.object, this.grains.object);
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private sampleGround(pool: SandParticleBatch, i: number) {
    const j = i * 3;
    const x = pool.positions[j]!,
      z = pool.positions[j + 2]!;
    const slope = this.field.gradient(x, z);
    const magnitude = Math.hypot(slope.x, 1, slope.z);
    pool.ground[i * 4] = -slope.x / magnitude;
    pool.ground[i * 4 + 1] = 1 / magnitude;
    pool.ground[i * 4 + 2] = -slope.z / magnitude;
    const floor = this.field.height(x, z);
    pool.ground[i * 4 + 3] = floor;
    return floor;
  }

  private spawnGrain(x: number, y: number, z: number, kick: number) {
    const pool = this.grains;
    const i = pool.cursor++ % pool.capacity,
      j = i * 3;
    pool.positions[j] = x + (this.random() - 0.5) * 0.3;
    pool.positions[j + 1] = y + 0.08;
    pool.positions[j + 2] = z + (this.random() - 0.5) * 0.3;
    pool.velocities[j] = (this.random() - 0.5) * kick + this.field.wind.x * 0.35;
    pool.velocities[j + 1] = 0.25 + this.random() * kick * 0.6;
    pool.velocities[j + 2] = (this.random() - 0.5) * kick + this.field.wind.z * 0.35;
    pool.life[i] = 0.45 + this.random() * 0.9;
    pool.age[i] = 0;
    const size = 0.0075 + this.random() * 0.015;
    pool.state[i * 4 + 1] = pool.state[i * 4 + 2] = size;
    this.sampleGround(pool, i);
  }

  private spawnSwell(burst: SandBurst) {
    const pool = this.swells;
    const i = pool.cursor++ % pool.capacity,
      j = i * 3;
    const angle = this.random() * Math.PI * 2;
    const strength = burst.kind === 'crest' ? 1.7 : burst.kind === 'slide' ? 0.7 : 1;
    // Foot pressure spreads sand sideways and back. Loose crest sand gives a wider surge.
    const kick = (0.25 + this.random() * 0.4) * strength;
    const facing = burst.facing ?? 0;
    const heel = burst.kind === 'step' ? 0.22 : 0;
    pool.positions[j] = burst.x + Math.cos(angle) * 0.1;
    pool.positions[j + 2] = burst.z + Math.sin(angle) * 0.1;
    pool.velocities[j] = Math.cos(angle) * kick - Math.sin(facing) * heel;
    pool.velocities[j + 2] = Math.sin(angle) * kick - Math.cos(facing) * heel;
    pool.life[i] = (0.95 + this.random() * 0.65) * Math.sqrt(strength);
    pool.age[i] = 0;
    pool.size[i] = (0.45 + this.random() * 0.2) * strength;
    pool.positions[j + 1] = this.sampleGround(pool, i) + 0.09;
  }

  update(dt: number, x: number, z: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    for (const burst of this.field.drainBursts()) {
      const kick = burst.kind === 'crest' ? 2.3 : burst.kind === 'step' ? 1.3 : 0.4;
      for (let i = 0; i < Math.min(burst.amount, 180); i++)
        this.spawnGrain(burst.x, burst.y, burst.z, kick);
      const lobes = Math.min(14, Math.ceil(burst.amount / 4));
      for (let i = 0; i < lobes; i++) this.spawnSwell(burst);
    }
    this.windCredit += Math.hypot(this.field.wind.x, this.field.wind.z) * 18 * dt;
    while (this.windCredit >= 1) {
      this.windCredit--;
      const px = x + (this.random() - 0.5) * 26;
      const pz = z + (this.random() - 0.5) * 26;
      this.spawnGrain(px, this.field.height(px, pz), pz, 0.3);
    }
    this.updateGrains(dt);
    this.updateSwells(dt);
  }

  private updateGrains(dt: number) {
    const pool = this.grains;
    for (let i = 0; i < pool.capacity; i++) {
      pool.age[i] = pool.age[i]! + dt;
      if (pool.age[i]! >= pool.life[i]!) {
        pool.state[i * 4] = 0;
        continue;
      }
      const j = i * 3;
      pool.velocities[j] =
        pool.velocities[j]! + (this.field.wind.x - pool.velocities[j]!) * dt * 0.8;
      pool.velocities[j + 2] =
        pool.velocities[j + 2]! + (this.field.wind.z - pool.velocities[j + 2]!) * dt * 0.8;
      pool.velocities[j + 1] = pool.velocities[j + 1]! - 5.5 * dt;
      for (let k = 0; k < 3; k++)
        pool.positions[j + k] = pool.positions[j + k]! + pool.velocities[j + k]! * dt;
      const floor = this.field.height(pool.positions[j]!, pool.positions[j + 2]!);
      if (pool.positions[j + 1]! < floor) {
        pool.positions[j + 1] = floor + 0.01;
        pool.velocities[j + 1] = Math.abs(pool.velocities[j + 1]!) * 0.2;
        pool.life[i] = Math.min(pool.life[i]!, pool.age[i]! + 0.12);
      }
      pool.state[i * 4] =
        0.75 * Math.min(1, pool.age[i]! / 0.06) * (1 - pool.age[i]! / pool.life[i]!);
    }
    pool.upload();
  }

  private updateSwells(dt: number) {
    const pool = this.swells;
    for (let i = 0; i < pool.capacity; i++) {
      pool.age[i] = pool.age[i]! + dt;
      if (pool.age[i]! >= pool.life[i]!) {
        pool.state[i * 4] = 0;
        continue;
      }
      const j = i * 3;
      const t = pool.age[i]! / pool.life[i]!;
      this.sampleGround(pool, i);
      const ny = Math.max(0.3, pool.ground[i * 4 + 1]!);
      // Wind entrains the fines; the dense leading swell still rolls downhill.
      for (const [axis, wind] of [
        [0, this.field.wind.x],
        [2, this.field.wind.z],
      ] as const) {
        const downhill = pool.ground[i * 4 + axis]! / ny;
        pool.velocities[j + axis] =
          pool.velocities[j + axis]! +
          (wind * 0.28 - pool.velocities[j + axis]!) * (1 - Math.exp(-dt * 1.4)) +
          downhill * dt * 1.2;
        pool.positions[j + axis] = pool.positions[j + axis]! + pool.velocities[j + axis]! * dt;
      }
      const nextFloor = this.field.height(pool.positions[j]!, pool.positions[j + 2]!);
      pool.ground[i * 4 + 3] = nextFloor;
      const width = pool.size[i]! * (0.65 + t * 2.1);
      const height = width * (0.46 + t * 0.12);
      const loft = 0.07 + Math.sin(t * Math.PI) * 0.14;
      const target = nextFloor + loft;
      pool.positions[j + 1] = Math.max(
        nextFloor + 0.04,
        pool.positions[j + 1]! + (target - pool.positions[j + 1]!) * (1 - Math.exp(-dt * 10)),
      );
      pool.state[i * 4] = 0.75 * Math.min(1, pool.age[i]! / 0.1) * Math.pow(1 - t, 1.3);
      pool.state[i * 4 + 1] = width;
      pool.state[i * 4 + 2] = height;
      pool.state[i * 4 + 3] = t;
    }
    pool.upload();
  }

  clear() {
    this.grains.clear();
    this.swells.clear();
    this.windCredit = 0;
    this.seed = 41;
  }

  inspect() {
    return {
      grains: this.grains.count,
      swells: this.swells.count,
      grainCapacity: this.grains.capacity,
      swellCapacity: this.swells.capacity,
    };
  }

  dispose() {
    this.object.removeFromParent();
    this.grains.dispose();
    this.swells.dispose();
  }
}
