// @vitest-environment node
import {expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {SandField} from '../sand/field';
import {geo} from './test-landscape';
import {SandTerrain} from '../sand/terrain';
import {shadowAnchor} from '../scene/shadow-anchor';

it('keeps geometry buffers fixed across the old eight-metre rebuild boundary', () => {
  const terrain = new SandTerrain(new SandField(geo));
  const meshes = terrain.object.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  const attributes = meshes.map((m) => m.geometry.getAttribute('position'));
  const versions = attributes.map((a) => (a as THREE.BufferAttribute).version);
  terrain.update(3.9, 0, 0.1);
  const positions = meshes.map((m) => m.position.x);
  terrain.update(4.1, 0, 0.1);
  expect(meshes.map((m) => m.position.x)).toEqual(positions);
  terrain.update(4.6, 0, 0.1);
  expect(meshes.every((m, i) => m.position.x - positions[i]! === 1)).toBe(true);
  expect(attributes.map((a) => (a as THREE.BufferAttribute).version)).toEqual(versions);
  expect(meshes.every((m) => m.castShadow && m.receiveShadow && !m.frustumCulled)).toBe(true);
  // Node displacement is shared by color and shadow passes.
  expect(
    meshes.every(
      (m) => m.material instanceof THREE.MeshStandardNodeMaterial && !!m.material.positionNode,
    ),
  ).toBe(true);
  expect(meshes.every((m) => !m.customDepthMaterial)).toBe(true);
  // Fine rings overlap the static two-metre survey before its outer edge.
  const outer = attributes.at(-1)!;
  let extent = 0;
  for (let i = 0; i < outer.count; i++) extent = Math.max(extent, outer.getX(i));
  expect(extent - 55 - 0.5).toBeGreaterThan(100);
  terrain.dispose();
});

it('keeps a low-sun shadow image fixed during sub-texel player travel', () => {
  const snap = shadowAnchor(),
    direction = new THREE.Vector3(-1, 0.12, -0.05).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3();
  const texel = 192 / 4096;
  snap(new THREE.Vector3(), direction, texel, a);
  snap(right.clone().multiplyScalar(texel * 0.2), direction, texel, b);
  expect(a.distanceTo(b)).toBeLessThan(1e-8);
  snap(right.clone().multiplyScalar(texel * 0.8), direction, texel, b);
  expect(b.dot(right)).toBeCloseTo(texel, 8);
});

it('omits static terrain only where the near rings completely cover its bounds', () => {
  const terrain = new SandTerrain(new SandField(geo));
  const group = terrain.object.children.find(
    (o) => o.name === 'Authored dunes beyond the walking rings',
  )!;
  for (const [x, z] of [
    [0, 0],
    [-100, 0],
    [-39, 102],
    [110, 0],
  ]) {
    terrain.update(x!, z!, 0.1);
    let hidden = 0,
      visible = 0;
    for (const tile of group.children) {
      const extent = Math.max(Math.abs(tile.position.x - x!), Math.abs(tile.position.z - z!)) + 64;
      if (!tile.visible) {
        hidden++;
        expect(extent).toBeLessThan(158.5);
      } else {
        visible++;
        expect(extent).toBeGreaterThanOrEqual(158.5);
      }
    }
    expect(hidden).toBeGreaterThan(0);
    expect(visible).toBeGreaterThan(0);
  }
  terrain.dispose();
});
