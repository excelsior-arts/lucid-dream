// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {PerspectiveCamera, Vector3} from 'three';
import {FollowCamera} from '@lucid/world/desert';
import {viewportFraming} from '@lucid/world/desert';
import {sampleCameraShot} from '../experience/camera-director';
import {DEFAULT_SCORE} from '../experience/score';

const body = [
  new Vector3(0, 1.95, 0),
  new Vector3(-0.3, 0, 0.2),
  new Vector3(0.3, 0, 0.2),
  new Vector3(-0.95, 1.2, 0),
  new Vector3(0.95, 1.2, 0),
];

describe('viewport framing', () => {
  it('keeps the full body inside phone portrait and landscape views, including the nearest zoom', () => {
    for (const [width, height] of [
      [320, 844],
      [390, 844],
      [844, 390],
      [768, 1024],
    ]) {
      const camera = new PerspectiveCamera(49, width! / height!, 0.08, 1100);
      const framing = viewportFraming(width!, height!, camera.fov);
      const orbit = {target: new Vector3(0, 0.95, 0), update() {}};
      const follow = new FollowCamera(camera, orbit, () => -10);
      follow.setDistanceScale(framing.distanceScale);
      for (const time of [0, 7, 100, 150, 200]) {
        follow.snap(orbit.target, sampleCameraShot(time, DEFAULT_SCORE));
        follow.update(orbit.target, 1 / 60, false);
        camera.updateMatrixWorld();
        for (const point of body) {
          const projected = point.clone().project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.82);
          expect(Math.abs(projected.y)).toBeLessThan(0.82);
        }
      }
      if (Math.min(width!, height!) <= 600) {
        for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
          camera.position
            .set(Math.sin(angle), 0, Math.cos(angle))
            .multiplyScalar(framing.minDistance)
            .add(orbit.target);
          camera.lookAt(orbit.target);
          camera.updateMatrixWorld();
          for (const point of body) {
            const projected = point.clone().project(camera);
            expect(Math.abs(projected.x)).toBeLessThan(0.82);
            expect(Math.abs(projected.y)).toBeLessThan(0.82);
          }
        }
      }
    }
  });

  it('preserves a chosen angle and zoom through repeated rotations without changing desktop framing', () => {
    const desktop = viewportFraming(1440, 1000, 49);
    expect(desktop.distanceScale).toBe(1);
    expect(desktop.minDistance).toBe(0.45);
    const camera = new PerspectiveCamera();
    const orbit = {target: new Vector3(2, 3, 4), update() {}};
    camera.position.copy(orbit.target).add(new Vector3(-3, 2, 8));
    const original = camera.position.clone();
    const follow = new FollowCamera(camera, orbit, () => -10);
    for (let i = 0; i < 30; i++) {
      follow.setDistanceScale(viewportFraming(390, 844, 49).distanceScale);
      expect(
        camera.position
          .clone()
          .sub(orbit.target)
          .normalize()
          .distanceTo(original.clone().sub(orbit.target).normalize()),
      ).toBeLessThan(1e-12);
      follow.setDistanceScale(desktop.distanceScale);
    }
    expect(camera.position.distanceTo(original)).toBeLessThan(1e-10);
  });
});
