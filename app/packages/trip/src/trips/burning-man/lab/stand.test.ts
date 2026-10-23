// @vitest-environment node
/* He stands square: the standing clip is the Idle averaged with its mirror
   image, so whatever is one-sided in it -- a hip out, the pelvis rolled or
   turned, the weight on one leg -- cancels, and the breath stays. */
import {expect, test} from 'vitest';
import * as THREE from 'three/webgpu';
import {symmetricClip} from '../character/stand';

const q = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const reflected = (a: number[]) => [a[0]!, -a[1]!, -a[2]!, a[3]!];

/* A person waiting: hips 9 cm out and rolled, the left leg straight under
   him and the right one cocked, breathing through the chest. */
const lopsided = new THREE.AnimationClip('Idle', 2, [
  new THREE.VectorKeyframeTrack('mixamorig1Hips.position', [0, 1, 2], [9, 99, 3, 7, 100, 3, 9, 99, 3]),
  new THREE.QuaternionKeyframeTrack('mixamorig1Hips.quaternion', [0, 2], [...q(0.02, 0.28, -0.17), ...q(0.02, 0.28, -0.17)]),
  new THREE.QuaternionKeyframeTrack('mixamorig1Spine2.quaternion', [0, 1, 2], [...q(0.05, 0.1, 0), ...q(0.09, 0.1, 0), ...q(0.05, 0.1, 0)]),
  new THREE.QuaternionKeyframeTrack('mixamorig1LeftUpLeg.quaternion', [0, 2], [...q(0, 0, 3.1), ...q(0, 0, 3.1)]),
  new THREE.QuaternionKeyframeTrack('mixamorig1RightUpLeg.quaternion', [0, 2], [...q(-0.3, 0.2, -2.8), ...q(-0.3, 0.2, -2.8)]),
]);

const stand = symmetricClip(lopsided, 'stand');
const track = (name: string) => stand.tracks.find((t) => t.name === name)!;
const at = (name: string, t: number) => Array.from(track(name).InterpolantFactoryMethodLinear().evaluate(t));
const near = (a: number[], b: number[]) => {
  // Either hemisphere is the same rotation.
  const d = Math.abs(a.reduce((s, v, i) => s + v * b[i]!, 0));
  expect(d).toBeCloseTo(1, 6);
};

test('the hips come to the middle, level and square, and keep their rise and fall', () => {
  for (const t of [0, 0.5, 1, 1.5, 2]) {
    const [x, y] = at('mixamorig1Hips.position', t);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeGreaterThan(98.9);
  }
  expect(at('mixamorig1Hips.position', 1)[1]! - at('mixamorig1Hips.position', 0)[1]!).toBeCloseTo(1, 5);
  const hips = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(at('mixamorig1Hips.quaternion', 0)));
  expect(hips.y).toBeCloseTo(0, 6);
  expect(hips.z).toBeCloseTo(0, 6);
});

test('the legs are each other\'s mirror image, so the weight is on both', () => {
  for (const t of [0, 1, 2])
    near(at('mixamorig1RightUpLeg.quaternion', t), reflected(at('mixamorig1LeftUpLeg.quaternion', t)));
});

test('the breath in the chest stays; its turn does not', () => {
  const chest = (t: number) => new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(at('mixamorig1Spine2.quaternion', t)));
  expect(chest(1).x - chest(0).x).toBeGreaterThan(0.03);
  expect(chest(0).y).toBeCloseTo(0, 6);
  expect(stand.duration).toBe(2);
  expect(stand.name).toBe('stand');
});
