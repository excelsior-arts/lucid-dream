import * as THREE from 'three/webgpu';

/** Pack render attributes without moving simulation slots, seeds, or particle identities. */
export class ParticleBuffer {
  readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly attributes: {
    source: Float32Array;
    target: THREE.InstancedBufferAttribute;
  }[];
  count = 0;

  constructor(capacity: number, sources: Record<string, readonly [Float32Array, number]>) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    for (const name of ['position', 'normal', 'uv'])
      this.geometry.setAttribute(name, quad.getAttribute(name));
    this.attributes = Object.entries(sources).map(([name, [source, size]]) => {
      const target = new THREE.InstancedBufferAttribute(
        new Float32Array(capacity * size),
        size,
      ).setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, target);
      return {source, target};
    });
    this.geometry.instanceCount = 0;
  }

  begin() {
    this.count = 0;
  }

  append(slot: number) {
    for (const {source, target} of this.attributes) {
      const size = target.itemSize;
      for (let component = 0; component < size; component++)
        target.array[this.count * size + component] = source[slot * size + component]!;
    }
    this.count++;
  }

  upload() {
    this.geometry.instanceCount = this.count;
    for (const {target} of this.attributes) {
      target.clearUpdateRanges();
      if (this.count === 0) continue;
      target.addUpdateRange(0, this.count * target.itemSize);
      target.needsUpdate = true;
    }
  }
}
