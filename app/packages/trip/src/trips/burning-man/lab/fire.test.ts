// @vitest-environment node
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {FireParticles} from '../runtime/fire-particles';
function fixture() {
  const parent = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.25));
  parent.add(body);
  const fire = new FireParticles(body, new THREE.Texture());
  parent.add(fire.object);
  return {parent, body, fire};
}
const still = {x: 0, y: 0, z: 0};
describe('Detached fire', () => {
  it('keeps existing particles independent of body translation and rotation', () => {
    const a = fixture(),
      b = fixture();
    a.fire.update(0.05, 1, still, false);
    b.fire.update(0.05, 1, still, false);
    b.parent.position.set(2, 0, 4);
    b.parent.rotation.y = 1.3;
    a.fire.update(0.05, 0, still, false);
    b.fire.update(0.05, 0, still, false);
    b.parent.updateMatrixWorld(true);
    expect(b.fire.inspect().particles).toEqual(a.fire.inspect().particles);
    const matrix = b.fire.object.matrixWorld.elements;
    matrix.forEach((v, i) => expect(v).toBeCloseTo(new THREE.Matrix4().elements[i]!, 6));
    a.fire.dispose();
    b.fire.dispose();
  });
  it('responds to host wind after particles have detached', () => {
    const a = fixture(),
      b = fixture();
    a.fire.update(0.05, 1, still, false);
    b.fire.update(0.05, 1, still, false);
    b.fire.wind.set(3, 0, 0);
    a.fire.update(0.1, 0, still, false);
    b.fire.update(0.1, 0, still, false);
    expect(b.fire.inspect().particles[0]!.position[0]!).toBeGreaterThan(
      a.fire.inspect().particles[0]!.position[0]!,
    );
    a.fire.dispose();
    b.fire.dispose();
  });
  it('freezes exactly at zero dt and expires after emission stops', () => {
    const {fire} = fixture();
    fire.update(0.1, 1, still, false);
    const before = fire.inspect();
    fire.update(0, 1, {x: 18, y: 0, z: 0}, true);
    expect(fire.inspect()).toEqual(before);
    for (let i = 0; i < 20; i++) fire.update(0.1, 0, still, false);
    expect(fire.inspect().count).toBe(0);
    fire.dispose();
  });
  it('stays bounded under sustained dashing and resets cleanly', () => {
    const {fire} = fixture();
    for (let i = 0; i < 100; i++) fire.update(0.1, 1, {x: 18, y: 0, z: 0}, true);
    expect(fire.inspect().emitted).toBeGreaterThan(fire.inspect().capacity);
    expect(fire.inspect().count).toBeLessThanOrEqual(fire.inspect().capacity);
    fire.clear();
    expect(fire.inspect().count).toBe(0);
    fire.dispose();
  });
});

it('samples an attached rig at its new location before any renderer updates its bind inverse', () => {
  const parent = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.4, 1.8, 0.25);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(geometry);
  const bone = new THREE.Bone();
  body.add(bone);
  body.bind(new THREE.Skeleton([bone]));
  parent.add(body);
  const fire = new FireParticles(body, new THREE.Texture());
  parent.add(fire.object);
  for (const x of [100, -60, 20]) {
    parent.position.set(x, 5, 0);
    parent.rotation.y = 1.2;
    parent.updateWorldMatrix(true, true);
    fire.clear();
    fire.update(0.1, 1, still, false);
    expect(fire.inspect().count).toBeGreaterThan(0);
    for (const particle of fire.inspect().particles) {
      expect(Math.abs(particle.position[0]! - x)).toBeLessThan(2);
      expect(Math.abs(particle.position[1]! - 5)).toBeLessThan(2);
    }
  }
  fire.dispose();
  geometry.dispose();
});

it('draws each living particle once and lets detached smoke outlive emission and flames', () => {
  const {fire} = fixture();
  const [flames, smoke] = fire.object.children as THREE.Mesh<THREE.InstancedBufferGeometry>[];
  expect(fire.object.visible).toBe(false);
  fire.update(0.1, 1, still, false);
  const first = fire.inspect();
  expect(first.smoke).toBeGreaterThan(0);
  expect(first.drawn).toBe(first.count);
  expect(smoke!.geometry.instanceCount).toBe(first.smoke);
  expect(flames!.geometry.instanceCount).toBe(first.count - first.smoke);
  for (const mesh of [flames!, smoke!]) {
    const state = mesh.geometry.getAttribute('state');
    for (let i = 0; i < mesh.geometry.instanceCount; i++) {
      expect(state.getX(i)).toBeLessThan(1);
      expect(state.getW(i) === 2).toBe(mesh === smoke);
    }
  }
  fire.smokeAmount = 0;
  fire.update(0.05, 0, still, false);
  expect(smoke!.visible).toBe(true);
  for (let i = 0; i < 13; i++) fire.update(0.1, 0, still, false);
  expect(flames!.visible).toBe(false);
  expect(flames!.geometry.instanceCount).toBe(0);
  expect(smoke!.visible && fire.object.visible).toBe(true);
  fire.clear();
  expect(flames!.geometry.instanceCount + smoke!.geometry.instanceCount).toBe(0);
  expect(fire.object.visible).toBe(false);
  fire.dispose();
});
