// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three/webgpu';
import {SandField} from '../sand/field';
import {geo} from './test-landscape';
import {SandGrains} from '../sand/grains';
import {SandParticleBatch} from '../sand/particle-batch';

function fixture(wind = 0, slope = 0, amount = 20) {
  const field = new SandField(geo);
  field.wind = {x: wind, z: 0};
  field.height = (x) => slope * x;
  field.gradient = () => ({x: slope, z: 0});
  const events = vi
    .spyOn(field, 'drainBursts')
    .mockReturnValueOnce([{x: 0, y: 0, z: 0, amount, kind: 'step', facing: 0}]);
  const sand = new SandGrains(field);
  const swells = sand.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>;
  const positions = swells.geometry.getAttribute('sandCenter');
  const state = swells.geometry.getAttribute('sandParticle');
  sand.update(0.05, 0, 0);
  return {field, events, sand, swells, positions, state};
}

describe('Footstep sand', () => {
  it('expands into low swells, then settles and expires without further contacts', () => {
    const {sand, positions, state} = fixture();
    expect(sand.inspect().swells).toBe(5);
    const width = state.getY(0);
    for (let i = 0; i < 4; i++) sand.update(0.05, 0, 0);
    expect(state.getY(0)).toBeGreaterThan(width);
    expect(state.getZ(0)).toBeLessThan(state.getY(0) * 0.6);
    expect(positions.getY(0)).toBeGreaterThan(0.04);
    expect(positions.getY(0)).toBeLessThan(0.3);
    for (let i = 0; i < 30; i++) sand.update(0.1, 0, 0);
    expect(sand.inspect()).toMatchObject({grains: 0, swells: 0});
    sand.dispose();
  });

  it('entrains the swells in wind and rolls them downhill while staying above the surface', () => {
    const still = fixture(),
      windy = fixture(3),
      downhill = fixture(0, -0.4);
    for (let i = 0; i < 10; i++) {
      for (const f of [still, windy, downhill]) f.sand.update(0.05, 0, 0);
    }
    expect(windy.positions.getX(0)).toBeGreaterThan(still.positions.getX(0) + 0.1);
    expect(downhill.positions.getX(0)).toBeGreaterThan(still.positions.getX(0) + 0.02);
    for (let i = 0; i < downhill.sand.inspect().swells; i++)
      expect(downhill.positions.getY(i)).toBeGreaterThan(
        downhill.field.height(downhill.positions.getX(i), downhill.positions.getZ(i)),
      );
    for (const f of [still, windy, downhill]) f.sand.dispose();
  });

  it('freezes when paused, stays bounded under repeated collapses, and clears on reset', () => {
    const {sand, events, positions, state} = fixture();
    const before = [positions.array.slice(), state.array.slice()];
    sand.update(0, 100, 100);
    expect([positions.array, state.array]).toEqual(before);
    events.mockReturnValue([{x: 0, y: 0, z: 0, kind: 'crest', amount: 500}]);
    for (let i = 0; i < 100; i++) sand.update(1 / 60, 0, 0);
    expect(sand.inspect().grains).toBeLessThanOrEqual(sand.inspect().grainCapacity);
    expect(sand.inspect().swells).toBe(sand.inspect().swellCapacity);
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    sand.clear();
    expect(sand.inspect()).toMatchObject({grains: 0, swells: 0});
    expect(Array.from(state.array).every((v) => v === 0)).toBe(true);
    sand.dispose();
  });

  it('uses lit, shadow-receiving, fogged materials and shares the terrain color', () => {
    const color = new THREE.Color('#b99160');
    const sand = new SandGrains(new SandField(geo), color);
    for (const object of sand.object.children as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardNodeMaterial
    >[]) {
      expect(object.receiveShadow).toBe(true);
      expect(object.castShadow).toBe(false);
      expect(object.material.lights && object.material.fog).toBe(true);
      expect(object.material.colorNode).toMatchObject({value: color});
      expect(object.material.positionNode).toBeTruthy();
      expect(object.material.vertexNode).toBeNull();
      expect(object.material.fragmentNode).toBeNull();
      expect(object.material.blending).toBe(THREE.NormalBlending);
    }
    sand.dispose();
  });
});

it('packs sparse live sand slots with their original seeds and uploads only the drawn range', () => {
  const batch = new SandParticleBatch(4, true, new THREE.Color());
  expect(batch.object.visible).toBe(false);
  batch.age[2] = 0.1;
  batch.life[2] = 1;
  batch.positions.set([3, 4, 5], 6);
  batch.state.set([0.5, 0.6, 0.7, 0.1], 8);
  batch.upload();
  const geometry = batch.object.geometry;
  const center = geometry.getAttribute('sandCenter') as THREE.InstancedBufferAttribute;
  const seed = geometry.getAttribute('sandSeed');
  expect(batch.object.visible).toBe(true);
  expect(geometry.instanceCount).toBe(1);
  expect(Array.from(center.array.slice(0, 3))).toEqual([3, 4, 5]);
  expect(seed.getX(0)).toBeCloseTo((2 * 0.61803398875) % 1);
  expect(center.updateRanges).toEqual([{start: 0, count: 3}]);
  // A lower-numbered slot becoming alive moves the draw index, never the particle seed.
  batch.age[0] = 0.1;
  batch.life[0] = 1;
  batch.upload();
  expect(geometry.instanceCount).toBe(2);
  expect(seed.getX(1)).toBeCloseTo((2 * 0.61803398875) % 1);
  expect(center.getX(1)).toBe(3);
  const version = center.version;
  batch.clear();
  expect(geometry.instanceCount).toBe(0);
  expect(batch.object.visible).toBe(false);
  expect(center.version).toBe(version);
  batch.dispose();
});
