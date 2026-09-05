import {describe, expect, it} from 'vitest';

import {DEFAULT} from './index';

/* The spec is a type over an object nobody type-checks: room3d.js is hand-set
   JavaScript with checkJs off, so `DEFAULT` and `RoomSpec` could drift apart
   silently and the first anybody would hear of it is a room that ignores a
   key. This list is the seam. `satisfies` makes the compiler agree every name
   here is a key the facade declares, and the assertion below makes the
   runtime agree it is every key there actually is — so adding one to either
   side without the other fails. */
const DECLARED = [
  'size', 'palette', 'portal', 'fitting', 'light', 'heart', 'camera',
  'portrait', 'page', 'casts', 'cast', 'spill', 'fog', 'vignette', 'hearth',
  'fill', 'ceiling', 'ground', 'hold', 'reach', 'sky', 'thick', 'bay',
  'block', 'dress', 'tick',
] satisfies (keyof typeof DEFAULT)[];

describe('the room spec', () => {
  it('is the object the engine actually defaults to', () => {
    expect(Object.keys(DEFAULT).sort()).toEqual([...DECLARED].sort());
  });

  it('has a portal on a wall, which is what every room is arranged around', () => {
    expect(DEFAULT.portal.wall).toBe('right');
    expect(DEFAULT.size).toEqual({w: 8.4, d: 7.4, h: 6.5});
  });
});
