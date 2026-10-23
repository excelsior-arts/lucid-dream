import * as THREE from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

type Point = readonly [number, number, number];
export function sculpture(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
export function beamGeometry(a: Point, b: Point, radius: number) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b);
  const geometry = new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8);
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.clone().sub(start).normalize(),
    ),
  );
  geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
  return geometry;
}
export function joined(geometries: THREE.BufferGeometry[]) {
  const result = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  return result;
}
export function ring(radius: number, thickness: number, y: number) {
  return new THREE.TorusGeometry(radius, thickness, 10, 80).translate(0, y, 0);
}

/** Small suspended hoop, woven web and three independent feather pendants. */
export function dreamcatcher(group: THREE.Group, metal: THREE.Material, cord: THREE.Material) {
  const pivot = new THREE.Group();
  pivot.name = 'Wind-suspended dreamcatcher';
  pivot.position.y = 1.9;
  group.add(pivot);
  sculpture(pivot, ring(0.235, 0.012, -0.48), metal);
  const strands = [beamGeometry([0, 0, 0], [0, -0.245, 0], 0.006)];
  for (let layer = 0; layer < 4; layer++) {
    const radius = 0.227 * Math.pow(0.64, layer),
      next = radius * 0.64;
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 9 + layer * 0.19;
      const b = a + Math.PI / 9;
      strands.push(
        beamGeometry(
          [Math.sin(a) * radius, Math.cos(a) * radius - 0.48, 0],
          [Math.sin(b) * next, Math.cos(b) * next - 0.48, 0],
          0.0035,
        ),
      );
      strands.push(
        beamGeometry(
          [Math.sin(b) * next, Math.cos(b) * next - 0.48, 0],
          [
            Math.sin(a + (Math.PI * 2) / 9) * radius,
            Math.cos(a + (Math.PI * 2) / 9) * radius - 0.48,
            0,
          ],
          0.0035,
        ),
      );
    }
  }
  sculpture(pivot, joined(strands), cord);
  const feathers: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const feather = new THREE.Group();
    feather.position.set((i - 1) * 0.14, -0.66 + Math.abs(i - 1) * 0.04, 0);
    pivot.add(feather);
    const length = i === 1 ? 0.25 : 0.17;
    sculpture(feather, beamGeometry([0, 0, 0], [0, -length - 0.19, 0], 0.0035), cord);
    const bead = new THREE.SphereGeometry(0.019, 8, 6).translate(0, -length + 0.025, 0);
    sculpture(feather, bead, metal);
    const shape = new THREE.Shape();
    shape.moveTo(0, -length);
    shape.bezierCurveTo(-0.055, -length - 0.04, -0.035, -length - 0.13, 0.014, -length - 0.21);
    shape.bezierCurveTo(0.065, -length - 0.13, 0.038, -length - 0.025, 0, -length);
    sculpture(feather, new THREE.ShapeGeometry(shape, 8), cord);
    feathers.push(feather);
  }
  return {pivot, feathers};
}
