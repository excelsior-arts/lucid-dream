/* Where the open box goes.
 *
 * Three rules, and they are the whole thing:
 *
 *   1. Leave a real gap at every edge. A box pressed against the sides of a
 *      phone looks like a mistake, not an object.
 *   2. Put the hinge — the fold where the lid meets the tray — on the middle
 *      line of the window. It is the one landmark both halves share, and
 *      anchoring it means the lid always has the top half and the tray the
 *      bottom, at every size and in either orientation. Centering the whole
 *      bounding box instead let the fold drift wherever the lid's height
 *      happened to put it.
 *   3. Size so both halves fit in their own half, not so the total fits
 *      somewhere.
 *
 * Everything is measured rather than modeled, because perspective is not
 * linear: scaling the box by z magnifies the standing lid by more than z, and a
 * translate inside the perspective moves the object further than it says. Both
 * are closed in on with a few damped passes — which is short, exact, and does
 * not care which browser is doing the projecting.
 */

/* Transitions stay off for a moment after the last fit rather than for a frame,
   and the timer belongs to the element rather than to this module: dragging a
   window edge fires resize continuously, and each fit would otherwise start a
   0.9s animation that the next one interrupts — which is the box lurching about
   under the pointer. */
const settling = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function fitOpenBox(
  caseEl: HTMLElement | null,
  roomEl: HTMLElement | null,
  openWith?: string,
): number | undefined {
  const box = caseEl?.querySelector<HTMLElement>('.box');
  const lid = caseEl?.querySelector<HTMLElement>('.lid');
  if (!caseEl || !box || !lid || !roomEl) return;

  const primed = caseEl.classList.contains('priming');
  const opened = !!openWith && !caseEl.classList.contains(openWith);
  caseEl.classList.add('priming');           // nothing animates while we work

  /* How far the browser is zoomed in. The window's own width is in screen
     pixels and the viewport's is in the page's, so the ratio between them is
     the zoom and nothing else. It is not exact to the pixel — a scrollbar or a
     docked inspector is inside one and not the other — but it is used for one
     thing only, a type size, where a percent either way is invisible.

     Nothing about the geometry is allowed to depend on it. The note below says
     why: fitting the box to anything but the window it is actually in ends the
     opening animation somewhere the freshly loaded next page does not agree
     with, and the box has to be the same object on both pages.

     A browser that will not tell — iOS reports the two as equal — comes out at
     1, which is the truth there: that page cannot be zoomed.

     Both axes, and the smaller of the two. Zoom narrows the viewport in both
     directions at once; a side panel, a vertical tab strip or a docked
     inspector narrows it in one. Read off the width alone, a Chrome with a
     panel open reported a zoom of one and a half and set the whole sheet in
     eighteen-pixel type while the cards beside it stayed at ten. The height
     ratio carries the toolbar and is always a little over one, so the
     smaller of the two is the zoom, give or take the percent the note above
     already forgives. */
  const ratio = (outer: number, inner: number) => (outer > 0 && inner > 0 ? outer / inner : 1);
  const eye = Math.min(ratio(window.outerWidth, window.innerWidth),
                       ratio(window.outerHeight, window.innerHeight));
  const near = eye >= 0.25 && eye <= 5 ? eye : 1;
  if (opened && openWith) caseEl.classList.add(openWith);

  // What of the room can actually be seen. Some browsers report a layout
  // viewport taller than the visible one, and the box was then sized and
  // centered for space that lives behind the toolbar.
  const vv = window.visualViewport;
  const r = roomEl.getBoundingClientRect();
  const room = {
    left: Math.max(r.left, 0),
    right: Math.min(r.right, vv ? vv.width : r.right),
    top: Math.max(r.top, 0),
    bottom: Math.min(r.bottom, vv ? vv.height : r.bottom),
  };
  const roomW = room.right - room.left, roomH = room.bottom - room.top;
  if (roomW <= 0 || roomH <= 0) return;

  // The gaps. Proportional, with a floor, so a phone gets air too.
  const gapX = Math.max(14, roomW * 0.06), gapY = Math.max(14, roomH * 0.05);
  const middle = room.top + roomH / 2;
  // Plain CSS pixels, and deliberately so. I tried multiplying these back up by
  // the browser's zoom, so that zooming would magnify the box rather than
  // re-fitting it — which looked right until you zoomed to 200% and opened the
  // box: the opening animation, fitted to the zoomed window, ended somewhere
  // the freshly-loaded next page did not agree with, and the box arrived with a
  // jump. Fitting to the window it is actually in means the two pages always
  // agree, and the box can never overflow.
  const above = middle - room.top - gapY;    // room the lid has
  const below = room.bottom - middle - gapY; // room the tray has
  const across = roomW - gapX * 2;

  // The three numbers that matter, at whatever scale it is drawn at now: how
  // far the object reaches left-to-right, how far above the hinge, and how far
  // below it. The hinge is the box's own far edge — the line the lid turns on —
  // which is the top of the box's rectangle.
  const reach = () => {
    const b = box.getBoundingClientRect(), l = lid.getBoundingClientRect();
    const hinge = b.top;
    return {wide: Math.max(b.right, l.right) - Math.min(b.left, l.left),
            up: hinge - Math.min(b.top, l.top),
            down: Math.max(b.bottom, l.bottom) - hinge,
            hinge};
  };

  caseEl.style.setProperty('--sink', '0px');
  let zoom = 1;
  for (let pass = 0; pass < 4; pass++) {
    caseEl.style.setProperty('--zoom', zoom.toFixed(3));
    // The eye steps back as the box grows: perspective is a fixed distance in
    // CSS, and a box scaled up against a fixed distance is a wide-angle lens
    // pressed against it — the tray splays out and the thing looks bent.
    const stage = caseEl.parentElement;
    // Swept against the rendered box: further back than 1900 and the lid stops
    // tapering at all, nearer and the tray splays away from it. Here the two
    // are within a few percent and both are visibly boxes.
    if (stage) stage.style.perspective = Math.round(1900 * zoom) + 'px';
    const at = reach();
    if (at.wide <= 0 || at.up <= 0 || at.down <= 0) break;
    const off = Math.min(across / at.wide, above / at.up, below / at.down);
    if (Math.abs(off - 1) < 0.02) break;
    zoom = Math.max(0.15, Math.min(zoom * off, 2.4));
  }

  /* And how big the writing on it comes out.
   *
   * Everything inside the box is drawn inside a transform that scales with the
   * box, so type asked for in fixed pixels arrives multiplied by the fit — and
   * the fit is against the window in CSS pixels, which browser zoom makes
   * *smaller* the further in you go. The two cancel out exactly. The box and
   * every word on it came out the same size on the glass at 50% as at 200%, and
   * a hair smaller the further in you went, while the rest of the page grew
   * around it: zooming did the opposite of what zooming is for.
   *
   * The cancelling is the whole of it, so undoing it is the whole of the
   * answer: ask for a size, times the zoom. At 100% that is a plain number of
   * pixels and nothing on this box moves; at 200% the writing is twice the size
   * on the glass, which is what 200% means, and it is a straight line between
   * and past them. Every other proportion is left alone — the writing is still
   * a share of the box, still smaller in a smaller window, still the phone's
   * own size on a phone.
   *
   * Twelve, not the ten the sheet was first drawn at. Read at arm's length on a
   * desk that was a squint; this is that fifth back, and it is the one number
   * the sheet is set in, so moving it moves the whole of it together.
   *
   * The line is straight wherever the box keeps its shape, which on an ordinary
   * window is the whole of a browser's zoom range. Zoomed far enough that the
   * window measures as a phone on its side, the shared sheet turns the box
   * shallow and the writing steps with it — because the writing is a share of
   * the box, and that is a different box. Both pages step the same way at the
   * same place, which is the part that matters.
   */
  caseEl.style.setProperty('--type', (12 * near).toFixed(2) + 'px');

  // And the hinge onto the middle line. Damped, because a translate inside the
  // perspective moves the object further on screen than it is told to.
  let sink = 0;
  for (let pass = 0; pass < 4; pass++) {
    const off = middle - reach().hinge;
    if (Math.abs(off) < 1) break;
    sink += off * 0.72;
    caseEl.style.setProperty('--sink', Math.round(sink) + 'px');
  }

  if (opened && openWith) caseEl.classList.remove(openWith);
  if (!primed) {
    const was = settling.get(caseEl);
    if (was) clearTimeout(was);
    settling.set(caseEl, setTimeout(() => caseEl.classList.remove('priming'), 160));
  }
  return zoom;
}
