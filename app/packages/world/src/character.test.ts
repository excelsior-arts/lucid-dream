/* The character controller, which no room in this checkout uses.
 *
 * It is tested because it is the piece the next games are built on and the
 * one that is hard to add afterwards — and because a capsule that cannot get
 * up a step is a bug nobody finds until there are stairs.
 */
import * as THREE from 'three';
import {beforeAll, expect, test} from 'vitest';

import {staticFromMesh} from './bodies';
import {createCharacter} from './character';
import {createWorld, ready} from './world';

beforeAll(async () => { await ready(); });

test('a capsule walks across a floor and up a step', () => {
  const w = createWorld({seed: 'walk'});

  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, .4, 20));
  floor.position.y = -.2;
  staticFromMesh(w, floor);

  // A kerb a fifth of a meter high, three meters along.
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(4, .2, 8));
  kerb.position.set(4.5, .1, 0);
  staticFromMesh(w, kerb);

  const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});

  // Two seconds of walking east at a meter and a half a second.
  for (let i = 0; i < 120; i++) who.move({x: 1.5, y: 0, z: 0}, 1 / 60);

  expect(who.at().x).toBeGreaterThan(2.4);
  expect(who.grounded).toBe(true);
  // On top of the kerb rather than stopped against it.
  expect(who.at().y).toBeGreaterThan(.95);
  who.dispose();
  w.dispose();
});

test('and is stopped by a wall rather than going through it', () => {
  const w = createWorld({seed: 'wall'});
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, .4, 20));
  floor.position.y = -.2;
  staticFromMesh(w, floor);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(.4, 3, 8));
  wall.position.set(2, 1.5, 0);
  staticFromMesh(w, wall);

  const who = createCharacter(w, {radius: .3, height: 1.2, at: {x: 0, y: .9, z: 0}});
  for (let i = 0; i < 180; i++) who.move({x: 2, y: 0, z: 0}, 1 / 60);
  expect(who.at().x).toBeLessThan(1.6);
  who.dispose();
  w.dispose();
});
