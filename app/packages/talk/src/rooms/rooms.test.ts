import {describe, expect, it} from 'vitest';

import {rooms} from './index';
describe('the rooms in the bundle', () => {
  it('are the two personas that have one', () => {
    expect(Object.keys(rooms).sort()).toEqual(['lover', 'thinker']);
  });

  // Loaded rather than merely listed: a glob that resolves to nothing is
  // still an object with the right keys in it.
  it('each export a spec with a palette', async () => {
    for (const [slug, load] of Object.entries(rooms)) {
      const spec = (await load()).default;
      expect(spec.palette, slug).toBeTruthy();
      expect(spec.portal, slug).toBeTruthy();
    }
  });
});
