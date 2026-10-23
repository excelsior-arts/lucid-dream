import * as THREE from 'three';

/** Area-weighted points on the Blender mesh, evaluated after skeletal animation. */
export class SurfaceSampler {
  readonly points: {
    at: THREE.Vector3;
    previous: THREE.Vector3;
    normal: THREE.Vector3;
    indices: number[];
    weights: number[];
  }[] = [];
  private initialized = false;
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly edge = new THREE.Vector3();

  private readonly source: THREE.Mesh;

  constructor(source: THREE.Mesh, random: () => number, count = 160) {
    this.source = source;
    const positions = source.geometry.getAttribute('position');
    const index = source.geometry.index;
    const triangleCount = Math.floor((index?.count ?? positions.count) / 3);
    const cumulative = new Float64Array(triangleCount);
    const indices = (i: number) =>
      [0, 1, 2].map((k) => (index ? index.getX(i * 3 + k) : i * 3 + k));
    let area = 0;
    for (let i = 0; i < triangleCount; i++) {
      const ids = indices(i);
      this.corners.forEach((v, k) => v.fromBufferAttribute(positions, ids[k]!));
      this.edge.subVectors(this.corners[1]!, this.corners[0]!);
      this.corners[2]!.sub(this.corners[0]!);
      area += this.edge.cross(this.corners[2]!).length();
      cumulative[i] = area;
    }
    for (let i = 0; i < count; i++) {
      const target = random() * area;
      let low = 0,
        high = triangleCount - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (cumulative[mid]! < target) low = mid + 1;
        else high = mid;
      }
      const u = Math.sqrt(random()),
        v = random();
      this.points.push({
        at: new THREE.Vector3(),
        previous: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        indices: indices(low),
        weights: [1 - u, u * (1 - v), u * v],
      });
    }
  }

  reset() {
    this.initialized = false;
  }

  update() {
    this.source.updateWorldMatrix(true, false);
    if (this.source instanceof THREE.SkinnedMesh) this.source.skeleton.update();
    for (const point of this.points) {
      point.previous.copy(point.at);
      point.at.set(0, 0, 0);
      this.corners.forEach((v, k) => {
        this.source.getVertexPosition(point.indices[k]!, v);
        v.applyMatrix4(this.source.matrixWorld);
        point.at.addScaledVector(v, point.weights[k]!);
      });
      this.edge.subVectors(this.corners[1]!, this.corners[0]!);
      point.normal.subVectors(this.corners[2]!, this.corners[0]!);
      point.normal.crossVectors(this.edge, point.normal).normalize();
      if (!this.initialized) point.previous.copy(point.at);
    }
    this.initialized = true;
  }
}
