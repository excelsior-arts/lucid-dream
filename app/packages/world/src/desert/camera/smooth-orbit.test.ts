// @vitest-environment jsdom
/* A canvas taken out of the page before its controls are let go of: the
   document must not keep the controls' Control listener, which held the whole
   piece once per open. */
import * as THREE from 'three';
import {expect, test, vi} from 'vitest';
import {SmoothOrbit} from './smooth-orbit';

test('the Control listener comes off the document even when the canvas has already left it', () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const added = vi.spyOn(document, 'addEventListener');
  const removed = vi.spyOn(document, 'removeEventListener');
  const orbit = new SmoothOrbit(new THREE.PerspectiveCamera(), canvas);
  const keydown = added.mock.calls.find(([type]) => type === 'keydown')?.[1];
  expect(keydown).toBeTypeOf('function');
  canvas.remove();                         // the route left first
  orbit.dispose();
  expect(removed.mock.calls.some(([type, fn]) => type === 'keydown' && fn === keydown)).toBe(true);
  added.mockRestore();
  removed.mockRestore();
});
