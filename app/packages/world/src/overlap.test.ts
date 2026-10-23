/* Being inside something, and letting go of something.
 *
 * The two verbs a game with things to pick up and things to break needs from
 * the world and could not write for itself: what the narrow phase already
 * knows about what is touching what, and a fixed thing turned loose without
 * being rebuilt.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import {beforeAll, describe, expect, it} from 'vitest';

import {dynamicFromMesh, release, staticFromMesh} from './bodies';
import {overlapping} from './overlap';
import {settle} from './settle';
import {createWorld, ready} from './world';
import type {World} from './world';

beforeAll(async () => { await ready(); });

function slab(w: World, size: [number, number, number], at: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size));
  m.position.set(...at);
  return staticFromMesh(w, m);
}

/** Something that falls, so that Rapier bothers to watch what it is near. */
function loose(w: World, size: [number, number, number], at: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size));
  m.position.set(...at);
  return dynamicFromMesh(w, m, {sleeping: false});
}

/** A trigger volume that will notice a kinematic body as well as a dynamic
    one — which is not the default, and cannot be asked for afterwards. */
function trigger(w: World, radius: number, at: [number, number, number]) {
  const body = w.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(...at));
  return w.world.createCollider(
    RAPIER.ColliderDesc.ball(radius).setSensor(true)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL), body);
}

describe('overlapping', () => {
  it('reports a sensor a thing is inside, and not one it is not', () => {
    const w = createWorld({seed: 'sensors'});
    const box = loose(w, [.5, .5, .5], [0, 1, 0]);
    const around = trigger(w, 1.5, [0, 1, 0]);
    const elsewhere = trigger(w, 1.5, [20, 1, 0]);
    /* The pairs are the last step's, so there has to have been one: a world
       that has never stepped knows nothing about what is inside what. */
    w.stepN(1);

    const touching = overlapping(w, box.collider).map((c) => c.handle);
    expect(touching).toContain(around.handle);
    expect(touching).not.toContain(elsewhere.handle);
    expect(touching).not.toContain(box.collider.handle);
    w.dispose();
  });

  it('reports a solid it is resting on as well, and never twice', () => {
    const w = createWorld({seed: 'solids'});
    const floor = slab(w, [10, .4, 10], [0, -.2, 0]);
    const skin = trigger(w, 1, [0, .25, 0]);
    const thing = loose(w, [.5, .5, .5], [0, .25, 0]);
    w.stepN(2);

    const handles = overlapping(w, thing.collider).map((c) => c.handle);
    expect(handles).toContain(floor.collider.handle);
    expect(handles).toContain(skin.handle);
    expect(new Set(handles).size).toBe(handles.length);
    w.dispose();
  });

  it('says nothing about a thing on its own', () => {
    const w = createWorld({seed: 'alone'});
    slab(w, [10, .4, 10], [0, -.2, 0]);
    const lonely = loose(w, [.5, .5, .5], [0, 20, 0]);
    w.stepN(1);
    expect(overlapping(w, lonely.collider)).toEqual([]);
    w.dispose();
  });

  /* The trap, written down as a test because it is invisible otherwise: a
     figure is kinematic, a trigger left on the floor is fixed, and Rapier
     watches neither against the other unless it was asked to at the moment the
     collider was built. Both halves are here so that a future Rapier that
     changes its mind about this fails loudly rather than quietly. */
  it('sees a fixed sensor from a kinematic body only if the sensor was built to be seen', () => {
    const w = createWorld({seed: 'kinematic'});
    const body = w.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
    const figure = w.world.createCollider(RAPIER.ColliderDesc.ball(.3), body);

    const asked = trigger(w, 1, [0, 1, 0]);
    const plainBody = w.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 0));
    const plain = w.world.createCollider(
      RAPIER.ColliderDesc.ball(1).setSensor(true), plainBody);
    w.stepN(2);

    const handles = overlapping(w, figure).map((c) => c.handle);
    expect(handles).toContain(asked.handle);
    expect(handles).not.toContain(plain.handle);
    w.dispose();
  });
});

describe('release', () => {
  it('drops a fixed box onto the floor and lets it come to rest there', () => {
    const w = createWorld({seed: 'break'});
    slab(w, [10, .4, 10], [0, -.2, 0]);
    // Two metres up and going nowhere, because a fixed body never does.
    const piece = slab(w, [.4, .4, .4], [0, 2, 0]);
    w.stepN(60);
    expect(piece.body.translation().y).toBe(2);

    release(w, piece, {mass: 3});
    expect(piece.body.isDynamic()).toBe(true);
    expect(piece.body.isSleeping()).toBe(false);
    // The mass is the body's straight away and not only after the next step.
    expect(piece.body.mass()).toBeCloseTo(3, 3);

    settle(w, [piece], {maxSteps: 900});
    // On the floor: half of it above y = 0, and not a millimetre through.
    expect(piece.body.translation().y).toBeGreaterThan(.18);
    expect(piece.body.translation().y).toBeLessThan(.22);
    w.dispose();
  });

  it('leaves the mass to the shape when it is not told one', () => {
    const w = createWorld({seed: 'weightless'});
    slab(w, [10, .4, 10], [0, -.2, 0]);
    const piece = slab(w, [.4, .4, .4], [0, 2, 0]);
    release(w, piece);
    w.stepN(1);
    // A tenth of a cubic metre of Rapier's default density.
    expect(piece.body.mass()).toBeCloseTo(.064, 4);
    expect(piece.body.translation().y).toBeLessThan(2);
    w.dispose();
  });
});
