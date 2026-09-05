import {afterEach, describe, expect, it, vi} from 'vitest';
import {fitOpenBox} from './fit';

/* jsdom lays nothing out, so the geometry passes give up on their first
   measurement and what is left to check is the one number read off the
   window: how far the browser is zoomed in, and so how big the type is. */
function stage() {
  document.body.innerHTML =
    '<main id="room"><div id="case"><div class="box"></div><div class="lid"></div></div></main>';
  const room = document.getElementById('room')!;
  room.getBoundingClientRect = () =>
    ({left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800} as DOMRect);
  return {room, kase: document.getElementById('case')!};
}

function windowIs(outerW: number, innerW: number, outerH: number, innerH: number) {
  vi.stubGlobal('outerWidth', outerW);
  vi.stubGlobal('innerWidth', innerW);
  vi.stubGlobal('outerHeight', outerH);
  vi.stubGlobal('innerHeight', innerH);
}

afterEach(() => vi.unstubAllGlobals());

describe('the type on the box follows the zoom and nothing else', () => {
  it('is twelve pixels in a window that is not zoomed', () => {
    const {room, kase} = stage();
    windowIs(1440, 1440, 900, 820);
    fitOpenBox(kase, room);
    expect(kase.style.getPropertyValue('--type')).toBe('12.00px');
  });

  it('grows with a zoom that narrows the page both ways', () => {
    const {room, kase} = stage();
    windowIs(1440, 960, 900, 600);
    fitOpenBox(kase, room);
    expect(kase.style.getPropertyValue('--type')).toBe('18.00px');
  });

  it('is not fooled by a panel that narrows the page one way', () => {
    const {room, kase} = stage();
    windowIs(1440, 960, 900, 840);
    fitOpenBox(kase, room);
    expect(parseFloat(kase.style.getPropertyValue('--type'))).toBeLessThan(13);
  });
});
