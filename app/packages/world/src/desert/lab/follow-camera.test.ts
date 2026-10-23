// @vitest-environment node
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {FollowCamera} from '../camera/follow-camera';

function setup() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-4, 3, 6);
  const orbit = {target: new THREE.Vector3(0, 1, 0), update: () => {}};
  let ground = 0;
  const rig = new FollowCamera(camera, orbit, () => ground);
  return {camera, orbit, rig, setGround: (height: number) => (ground = height)};
}

describe('terrain camera follow', () => {
  it('absorbs a sudden crest drop while following horizontal travel immediately', () => {
    const {camera, orbit, rig} = setup();
    const target = new THREE.Vector3(2, 0.6, -1);
    rig.update(target, 1 / 60, true);
    expect(orbit.target.x).toBe(2);
    expect(orbit.target.z).toBe(-1);
    expect(orbit.target.y).toBeGreaterThan(0.96);
    expect(orbit.target.y).toBeLessThan(1);
    expect(camera.position.y - orbit.target.y).toBeCloseTo(2);
    for (let i = 0; i < 120; i++) rig.update(target, 1 / 60, true);
    expect(orbit.target.y).toBeCloseTo(0.6, 4);
  });

  it('clears dunes without permanently increasing orbit height or distance', () => {
    const {camera, orbit, rig, setGround} = setup();
    const target = orbit.target.clone();
    const original = camera.position.clone();
    for (let cycle = 0; cycle < 5; cycle++) {
      setGround(4);
      for (let i = 0; i < 30; i++) rig.update(target, 1 / 60, true);
      expect(camera.position.y).toBeGreaterThanOrEqual(4.5);
      setGround(0);
      for (let i = 0; i < 180; i++) rig.update(target, 1 / 60, true);
      expect(camera.position.distanceTo(original)).toBeLessThan(0.00001);
    }
  });

  it('keeps the orbit fixed with follow disabled and snaps cleanly after a teleport', () => {
    const {camera, orbit, rig, setGround} = setup();
    const original = camera.position.clone();
    const target = new THREE.Vector3(20, -3, 10);
    rig.update(target, 1 / 60, false);
    expect(camera.position.toArray()).toEqual(original.toArray());
    setGround(4);
    rig.update(target, 1 / 60, false);
    rig.snap(target);
    expect(orbit.target.toArray()).toEqual(target.toArray());
    expect(camera.position.clone().sub(target).toArray()).toEqual([-4, 2, 6]);
  });
});
