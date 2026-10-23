import * as THREE from 'three/webgpu';
import {ParticleBuffer} from '../runtime/particle-buffer';
import {
  Fn,
  attribute,
  cameraViewMatrix,
  cameraWorldMatrix,
  dot,
  float,
  length,
  max,
  mx_noise_float,
  normalize,
  positionGeometry,
  positionWorld,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';

/** Fixed buffers for either ballistic grains or low, expanding sand swells. */
export class SandParticleBatch {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardNodeMaterial>;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  /** Opacity, width, height, normalized age. All sizes are in metres. */
  readonly state: Float32Array;
  /** Local ground normal and height, for lighting and a soft intersection with the surface. */
  readonly ground: Float32Array;
  readonly life: Float32Array;
  readonly age: Float32Array;
  readonly size: Float32Array;
  cursor = 0;
  private readonly buffer: ParticleBuffer;

  readonly capacity: number;

  constructor(capacity: number, soft: boolean, color: THREE.Color) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.state = new Float32Array(capacity * 4);
    this.ground = new Float32Array(capacity * 4);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.buffer = new ParticleBuffer(capacity, {
      sandCenter: [this.positions, 3],
      sandParticle: [this.state, 4],
      sandGround: [this.ground, 4],
      // The seed belongs to a simulation slot, never to its changing draw index.
      sandSeed: [Float32Array.from({length: capacity}, (_, i) => (i * 0.61803398875) % 1), 1],
    });
    const geometry = this.buffer.geometry;
    const material = new THREE.MeshStandardNodeMaterial({
      color,
      roughness: 0.96,
      transparent: true,
      depthWrite: false,
    });
    const center = attribute<'vec3'>('sandCenter', 'vec3');
    const particle = attribute<'vec4'>('sandParticle', 'vec4');
    const ground = attribute<'vec4'>('sandGround', 'vec4');
    const seed = attribute<'float'>('sandSeed', 'float');
    // Keep the displaced position in the normal node-material pipeline. A custom
    // clip-space vertexNode would leave the light/shadow lookup at the quad origin.
    material.positionNode = center.add(
      cameraWorldMatrix.mul(vec4(positionGeometry.xy.mul(particle.yz), 0, 0)).xyz,
    );
    material.normalNode = Fn(() => {
      // A shallow rounded lobe gives the swell some volume without making its
      // lighting depend entirely on the camera-facing billboard normal.
      const contour = soft
        ? cameraWorldMatrix.mul(vec4(uv().sub(0.5).mul(0.7), 0.28, 0)).xyz
        : vec3(0);
      return normalize(cameraViewMatrix.mul(vec4(normalize(ground.xyz.add(contour)), 0)).xyz);
    })();
    material.colorNode = uniform(color);
    material.maskNode = particle.x.greaterThan(0.002);
    material.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const radius = length(p);
      if (!soft) return max(0, float(1).sub(radius.mul(radius))).mul(particle.x);
      // Slowly rolling, feathered lobes, with no bright additive core or hard sprite edge.
      const noise = mx_noise_float(vec3(p.mul(2.1), seed.mul(23).add(particle.w.mul(1.8))));
      const edge = float(1).sub(smoothstep(0.2, 1, radius.add(noise.mul(0.16))));
      const density = float(0.68).add(noise.mul(0.32));
      const aboveGround = dot(positionWorld.sub(vec3(center.x, ground.w, center.z)), ground.xyz);
      return edge
        .pow(1.6)
        .mul(density)
        .mul(particle.x)
        .mul(smoothstep(0.005, 0.09, aboveGround));
    })();
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = soft ? 'Sand swells' : 'Sand grains';
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
    // Dust remains translucent: receiving dune shadows must not cast rectangular ones.
    this.object.castShadow = false;
    this.clear();
  }

  clear() {
    this.age.fill(10);
    this.life.fill(0);
    this.state.fill(0);
    this.cursor = 0;
    for (const attribute of Object.values(this.object.geometry.attributes))
      if (attribute instanceof THREE.InstancedBufferAttribute) attribute.array.fill(0);
    this.upload();
  }

  upload() {
    this.buffer.begin();
    for (let i = 0; i < this.capacity; i++) if (this.age[i]! < this.life[i]!) this.buffer.append(i);
    this.buffer.upload();
    this.object.visible = this.buffer.count > 0;
  }

  get count() {
    let count = 0;
    for (let i = 0; i < this.capacity; i++) if (this.age[i]! < this.life[i]!) count++;
    return count;
  }

  dispose() {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
