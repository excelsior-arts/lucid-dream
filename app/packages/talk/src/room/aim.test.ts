/* Which box a press means, without a renderer in the room.
 *
 * This is the arithmetic that decides whether reaching for a cushion gets the
 * cushion or the couch it is lying on, and it was wrong for three rooms in a
 * row before anybody wrote down what the rule should be. What a raycaster
 * hands back is a distance and a box, so that is all this needs.
 */
import {expect, test} from 'vitest';
import {REACH, smallest, volume} from './aim.js';
import type {Hit} from './aim.js';

let n = 0;
/** A hit, as the raycaster gives them: how far, and a box of that size. */
const at = (distance: number, w: number, h: number, d: number): Hit => ({
  distance,
  object: {
    name: `box-${++n}`,
    geometry: {parameters: {width: w, height: h, depth: d}},
  } as unknown as Hit['object'],
});
const name = (o: unknown) => (o as {name: string} | null)?.name ?? null;

test('nothing under the ray is nothing pressed', () => {
  expect(smallest([])).toBe(null);
});

test('the cushion wins over the couch its box encloses', () => {
  // The couch's face is in front, which is the whole of why nearest-first
  // handed it every press meant for something lying on it.
  const couch = at(2.1, 2.4, .9, 1.15);
  const cushion = at(2.3, .5, .2, .5);
  expect(name(smallest([couch, cushion]))).toBe(name(cushion.object));
});

test('a stack of identical books answers with the one on top', () => {
  /* Same size, so nothing separates them but the order, and the order is
     nearest first — which for a stack seen from above is the top of it. */
  const top = at(1.8, .38, .06, .28);
  const next = at(1.86, .38, .06, .28);
  const under = at(1.92, .38, .06, .28);
  expect(name(smallest([top, next, under]))).toBe(name(top.object));
});

test('and something small across the room does not win from over there', () => {
  /* The reach is what makes this a rule about what you are pointing *at*
     rather than a rule about the smallest thing in the room. A glass on a
     table two meters behind the couch is behind the couch. */
  const couch = at(2.1, 2.4, .9, 1.15);
  const glass = at(2.1 + REACH + .01, .09, .12, .09);
  expect(name(smallest([couch, glass]))).toBe(name(couch.object));
  // A hand's width nearer and it is inside what the hand is reaching into.
  const closer = at(2.1 + REACH - .01, .09, .12, .09);
  expect(name(smallest([couch, closer]))).toBe(name(closer.object));
});

test('the bare couch is still there when nothing is lying on it', () => {
  const couch = at(2.1, 2.4, .9, 1.15);
  expect(name(smallest([couch]))).toBe(name(couch.object));
});

/** A hit on a thing's own shape, or a loose thing: what the eye is on. */
const seen = (distance: number, w: number, h: number, d: number, flag: 'exact' | 'loose'): Hit => {
  const hit = at(distance, w, h, d);
  (hit.object as unknown as {userData: Record<string, boolean>}).userData = {[flag]: true};
  return hit;
};

test('a lamp that is its own shape is pressed where it is, not where a box round it would be', () => {
  // The table's box encloses the lamp's foot; the foot is the thing.
  const table = at(2.0, 1.2, .08, .7);
  const foot = seen(2.05, .09, .13, .09, 'exact');
  expect(name(smallest([table, foot]))).toBe(name(foot.object));
});

test('a blanket hanging in front of the lamp is the blanket', () => {
  /* Smallest-wins is for boxes that enclose each other. A loose thing's box
     met first is the thing seen, and the disc behind it, smaller though it
     is, is behind it. */
  const blanket = seen(1.9, .6, .02, .4, 'loose');
  const disc = seen(2.0, .3, .02, .3, 'exact');
  expect(name(smallest([blanket, disc]))).toBe(name(blanket.object));
});

test('and a shape with no box measure still has a size', () => {
  const cone = {
    name: 'cone', userData: {},
    geometry: {parameters: {radius: .3, height: .3}, boundingBox: {min: {x: -.3, y: 0, z: -.3}, max: {x: .3, y: .3, z: .3}}},
  } as unknown as Hit['object'];
  expect(volume(cone)).toBeCloseTo(.6 * .3 * .6, 6);
});

test('a cushion lying on the blanket is the cushion, not the blanket whose box holds it', () => {
  /* Both loose, and the blanket's grown box encloses the cushion's from in
     front. Loose-met-first winning outright handed the blanket every press
     meant for the cushion on it -- the couch fault again, one layer up. */
  const blanket = seen(1.9, .9, .05, .6, 'loose');
  const cushion = seen(1.95, .4, .15, .4, 'loose');
  expect(name(smallest([blanket, cushion]))).toBe(name(cushion.object));
});

test('and a plane, or a shape with nothing to measure, does not win by being nothing', () => {
  const plane = {name: 'plane', userData: {}, geometry: {parameters: {width: 1, height: 1}, boundingBox: {min: {x: 0, y: 0, z: 0}, max: {x: 1, y: 1, z: 0}}}} as unknown as Hit['object'];
  expect(volume(plane)).toBeCloseTo(.01, 6);
  const blank = {name: 'blank', userData: {}, geometry: {parameters: {}}} as unknown as Hit['object'];
  expect(volume(blank)).toBe(Infinity);
});
