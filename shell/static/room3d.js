/* room3d — the rooms the game happens in.
 *
 * A room is data, not code: how big it is, what color it is, which wall the
 * window is cut into, where the light comes from. A persona ships that data in
 * its own bundle (personas/<slug>/room.js) and may add anything else it wants
 * to the scene in dress(); everything below is the part every room shares.
 *
 * Two ideas hold the whole thing together:
 *
 *   The window is a hole. The wall carrying it is a shape with the opening cut
 *   out, so the light outside comes *through* rather than being painted on,
 *   and what it lays on the floor is cast by that hole — every glazing bar
 *   included — rather than drawn by hand.
 *
 * The frame of reference is the same in every room, so that a thing placed in
 * one room means the same thing in the next:
 *
 *   the origin is the middle of the floor — x across, y up, z towards you;
 *   the room runs x ∈ ±w/2, z ∈ ±d/2, y from 0 at the boards to h at the
 *   ceiling; you stand somewhere out at positive z, past the missing fourth
 *   wall, looking in.
 *
 * A window is placed in its own wall's frame instead (x along that wall, y up,
 * z into the room), so a room says where the window is without knowing which
 * wall is carrying it. dress() is handed `glass`, the window's middle in world
 * terms, and `onPortal(u, v)`, any point on it — so furniture can be arranged
 * around the light rather than around the origin.
 *
 * The origin is only where the numbers start. What a room is actually composed
 * around is its *heart*: on the boards at the foot of the window, then a golden
 * section into the room and the same fraction off to one side. The light lands
 * there, the camera looks there, and furniture is arranged about it — so
 * nothing in any room sits dead center, and every room is weighted the same
 * way towards its own window. `heart` in the spec moves those fractions.
 *
 *   The conversation is not in the scene, and it is not a rectangle either. It
 *   stays HTML, and each frame we work out the projection that maps its flat
 *   page onto the window's plane in the room and hand that to CSS as a
 *   matrix3d. So the words lie on the glass at whatever angle the glass is at
 *   — real text, real selection, real scrolling, in perspective.
 *
 * ---- where this is going ---------------------------------------------------
 *
 * The rooms are becoming the game. Not a game beside the chat: the room is the
 * game and the conversation is what plays it. Most things in a room will be
 * touchable — a shelf that drops its books onto the spiral and, clicked again,
 * pushes them a turn lower until they are gone; a lamp that steps through five
 * or six brightnesses; an urn that starts a crystal plant growing and goes on
 * growing it as you talk. Whoever picks this up next: read
 * lucid_talk/rooms.py, which has the whole intention written down, and then
 * come back here.
 *
 * Four rules constrain everything that gets built on top of this file, and
 * they are load-bearing rather than stylistic:
 *
 *   Nothing is on a clock. Things change when a hand touches them and when
 *   somebody says something, never otherwise. No setTimeout that advances
 *   state, no growth per second. The tick loop animates; it does not decide.
 *
 *   A room is a pure function of the conversation, the clicks, and the
 *   persona's current temperature. Same three, same room. So a room is rebuilt
 *   rather than restored, and loading a save is this same construction with
 *   the animation durations set to zero.
 *
 *   Animations never own state. They travel to it. A book falling is a
 *   transient; the fact that it fell is one integer in the save.
 *
 *   Randomness is keyed, never sequential — rng(id, step), hashed, not a
 *   running stream. A stream desyncs the moment two events replay in a
 *   different order, and then a restored room is subtly wrong in ways that are
 *   miserable to find. Two seeds: one from persona+session for what happened,
 *   which never changes; one mixing the live temperature for how it looks now,
 *   which is meant to.
 *
 * The engine's side of that is four primitives, none of which exist yet:
 * `touch` (pick proxies on their own layer, so the camera never renders them
 * and the raycaster tests nothing else), `over` (a frame scheduler on the
 * existing loop), `stats` (the conversation as numbers, computed on the same
 * dirty flag the glyph sheet already uses), and `seed`. Rooms then do the rest
 * in dress(), which is where the game actually lives.
 *
 * Layers are already spoken for: 1 is mirror glass, 2 is the echo of the words
 * that only mirrors see. 3 is for pick proxies when they arrive.
 */

import * as THREE from './vendor/three.module.js';
// The library of things a portal can be made of. A room names one.
import FITTINGS from './fittings.js';

export {THREE};

/* Textures are drawn here rather than shipped: the game is offline, and a
   canvas costs less than a PNG anyway. */
export function paint(px, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  draw(c.getContext('2d'), px);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* The lattice: diamonds inside diamonds, at two scales, because one scale is
   graph paper. The same figure the box on the front page wears. */
export function lattice(ink = '180,140,240', ground = '#140e1e') {
  return paint(256, (g, px) => {
    g.fillStyle = ground;
    g.fillRect(0, 0, px, px);
    const rule = (step, alpha) => {
      g.strokeStyle = `rgba(${ink},${alpha})`;
      g.lineWidth = 1;
      for (let i = -px; i < px * 2; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + px, px); g.stroke();
        g.beginPath(); g.moveTo(i, px); g.lineTo(i + px, 0); g.stroke();
      }
    };
    rule(64, .17);
    rule(32, .07);
  });
}

/* The floor, as a figure: diamond parquet. Blocks laid point to point, the
   way a French floor is, with each one a shade off its neighbour so the light
   crossing it has something to find. The same diamond as everything else,
   lying down. */
export function parquet(ink = '180,140,240', ground = '#241d33') {
  return paint(512, (g, px) => {
    g.fillStyle = ground;
    g.fillRect(0, 0, px, px);
    const n = 4, step = px / n;
    // Two passes of diagonals make the blocks; the shading makes them boards.
    for (let r = -n; r < n * 2; r++) {
      for (let c = -n; c < n * 2; c++) {
        const x = c * step, y = r * step;
        // A quiet variation, fixed per block so it never crawls.
        const v = ((r * 7 + c * 13) % 5) / 5;
        g.save();
        g.translate(x + step / 2, y + step / 2);
        g.rotate(Math.PI / 4);
        g.fillStyle = `rgba(255,255,255,${.03 + v * .055})`;
        const a = step * .7;
        g.fillRect(-a / 2, -a / 2, a, a);
        g.strokeStyle = `rgba(${ink},.22)`;
        g.lineWidth = 1;
        g.strokeRect(-a / 2, -a / 2, a, a);
        // and the grain, running the length of each block
        g.strokeStyle = `rgba(${ink},.09)`;
        for (let i = 1; i < 4; i++) {
          g.beginPath();
          g.moveTo(-a / 2, -a / 2 + (a / 4) * i);
          g.lineTo(a / 2, -a / 2 + (a / 4) * i);
          g.stroke();
        }
        g.restore();
      }
    }
  });
}

/* A wall, as a figure: one bay of panelling, repeated along it. Skirting at
   the foot, a dado rail, a tall panel above with the room's own figure set in
   it, and a frieze under the ceiling. Drawn rather than built — at this
   distance, in this light, a panel is a line, and a thousand thin sticks
   would be a thousand thin sticks.

   The figure is three diamonds inside one another with a single block set
   into the left flank of them, between the outer and the middle. Everything
   else on this wall is symmetrical, which is what makes the block work: it is
   the one thing in the pattern that could have been elsewhere, so the eye
   finds it in every bay and the wall stops being a texture. It is painted in
   whatever the room calls `gem` — in the parlour, the green of the table, the
   urn and the crystal in the window, which is the fourth place that color
   appears and the only one you meet a hundred times. */
export function panelling(ink = '180,140,240', ground = '#1c1430',
                          gem = 'rgba(27,92,66,.55)', squash = 1,
                          figure = 'diamond') {
  return paint(512, (g, px) => {
    g.fillStyle = ground;
    g.fillRect(0, 0, px, px);
    const line = (a, w = 1) => { g.strokeStyle = `rgba(${ink},${a})`; g.lineWidth = w; };
    const across = (y, a, w) => { line(a, w); g.beginPath(); g.moveTo(0, y); g.lineTo(px, y); g.stroke(); };

    // The canvas runs floor at the bottom to ceiling at the top.
    const skirt = px * .93, dado = px * .74, frieze = px * .1;
    across(skirt, .5, 3);                      // skirting board
    across(skirt - 6, .2);
    across(dado, .44, 2);                      // dado rail
    across(dado + 7, .17);
    across(frieze, .38, 2);                    // frieze under the cornice
    across(frieze + 6, .15);

    // The tall panel between rail and frieze, and the low one under it.
    const panel = (top, bottom, inset) => {
      line(.3);
      g.strokeRect(inset, top, px - inset * 2, bottom - top);
      line(.14);
      g.strokeRect(inset + 7, top + 7, px - inset * 2 - 14, bottom - top - 14);
      /* The figure, set in the middle of it: three diamonds nested, and the
         block on the left arm of them. */
      const cx = px / 2, cy = (top + bottom) / 2;
      /* Wide, and drawn wide on purpose. This square canvas is stretched
         across a bay that is much taller than it is wide, so a diamond with
         equal arms reaches the wall several times taller than it is drawn.
         `squash` is that stretch, and the figure is drawn short by exactly
         it — so what lands on the plaster is the shape intended.

         One number for the whole wall, not one per panel: the canvas maps to
         the wall linearly, so a texel is the same height in the tall panel as
         in the low one. Squashing each panel by its own height is what made
         the two of them disagree. */
      /* One proportion for everything in the figure: the three rings and the
         crystal at their head are the same diamond at four sizes, so the bay
         has one angle in it rather than an argument between two. Standing,
         not square -- the room is cut from a diamond taller than it is wide,
         and every one of them here says so. */
      /* How tall the figure stands for its width, in the world rather than on
         this canvas. The diamond family is 2 — the parlour is cut from a
         lozenge and every one of them says so. A moth is not, and wings
         spread over that 2 reach the wall at twice the height they are drawn
         at. Its own number is a little under one, which is a butterfly. */
      const FIGURE = figure === 'moth' ? .8 : 2;
      let wide = (px - inset * 2) * (figure === 'moth' ? .42 : .34);
      let tall = wide * squash * FIGURE;
      /* And it has to fit the panel it is set in. The low panel under the
         dado is a third the height of the tall one, and a figure sized off
         the bay's width alone burst straight through the rail and the
         skirting -- three diamonds sawn off top and bottom, which reads as a
         pattern that was tiled rather than drawn.

         Scaled down whole, so the angle survives: a short panel gets a
         smaller figure, which is what panelling does anyway. */
      const room = (bottom - top) * .38;
      if (tall > room) { const k = room / tall; wide *= k; tall *= k; }
      // Whatever the room is ruled with, sized the same way and set in the
      // same place. A room that names nothing gets the house diamond.
      if (figure === 'moth') return moth(g, line, gem, cx, cy, wide, tall);
      const lozenge = (f) => {
        g.beginPath();
        g.moveTo(cx, cy - tall * f); g.lineTo(cx + wide * f, cy);
        g.lineTo(cx, cy + tall * f); g.lineTo(cx - wide * f, cy);
        g.closePath();
      };
      const rings = [1, .68, .4];
      rings.forEach((f, i) => { line(.34 - i * .06); lozenge(f); g.stroke(); });
      /* The stone, set into the head of the figure: the only solid thing on
         the wall, and the same shape as the one in the window — a lozenge
         standing well up on its point rather than a block. Sitting at the
         top rather than off to one side, it reads as the thing the figure
         was drawn around, and the bay gets a head.

         Elongated in the world and not on the canvas: `tall` already carries
         the wall's stretch, so the half-width is divided back out of it and
         the crystal arrives at the same angle as the rings around it. Drawn
         to a shape here, it arrives as that shape. */
      const midY = cy - tall * (rings[0] + rings[1]) / 2;
      const hh = tall * (rings[0] - rings[1]) * .62;
      const hw = hh / (squash * FIGURE);           // the family's own angle
      g.fillStyle = gem;
      g.beginPath();
      g.moveTo(cx, midY - hh); g.lineTo(cx + hw, midY);
      g.lineTo(cx, midY + hh); g.lineTo(cx - hw, midY);
      g.closePath(); g.fill();
      line(.34);
      g.stroke();
    };
    panel(frieze + 18, dado - 12, 26);
    panel(dado + 16, skirt - 10, 26);
  });
}

/* A moth, where the parlour has its diamonds: one to a panel, centered,
   spread as far apart as they are. Four scattered specimens read as a
   naturalist's case and as clutter -- this room already has clutter, and a
   wall is not where it goes.

   Geometric, and cut from the same figure as everything else: four kites off
   a waist, a lozenge for the body, two straight antennae. No curve anywhere,
   because at an inch of dark wall a curve is a smudge and a straight line is
   still a straight line -- and because the parlour's diamonds and this are
   the same shape with different numbers of corners.

   Sized by the caller, so it fits its panel exactly as the diamonds do, and
   drawn heavier than the parlour's figure on purpose: this room's wall is
   brown-black where that one is plum, and the same ink at the same weight
   disappears into it entirely. A figure nobody can find is not cryptic, it
   is absent. */
function moth(g, line, gem, cx, cy, wide, tall) {
  const kite = (pts) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y)));
    g.closePath();
    g.stroke();
  };
  for (const sx of [-1, 1]) {
    /* Upper pair: tall rather than wide. Thrown out flat they read as a
       dragonfly, which is a different animal and a worse shape. */
    line(.62);
    kite([[0, -tall * .1], [sx * wide * .58, -tall * 1.02],
          [sx * wide * .82, -tall * .34], [sx * wide * .16, -tall * .02]]);
    line(.46);                                  // and the lower, tucked under
    kite([[sx * wide * .12, tall * .04], [sx * wide * .66, tall * .5],
          [sx * wide * .44, tall * .92], [0, tall * .16]]);
    /* Antennae, above the wings and short. Long ones cross the upper pair and
       stop being antennae -- they become veins, and the whole figure turns
       into a leaf. */
    line(.4);
    g.beginPath();
    g.moveTo(cx + sx * wide * .04, cy - tall * .58);
    g.lineTo(cx + sx * wide * .26, cy - tall * 1.1);
    g.stroke();
  }
  /* The body, and the one solid thing on this wall — the same weight the
     parlour gives its crystal, and the same job: something for the eye to
     find once it has stopped reading the pattern.

     An oval, not a lozenge. A diamond body would be the parlour's figure
     wearing wings, and this room is not cut from that shape: its floor is a
     spiral, its case is a grid, and the one curve in the whole library ought
     to be the thing at the middle of this. The wings stay straight, so the
     curve reads as deliberate rather than as a failure of nerve. */
  g.fillStyle = gem;
  g.beginPath();
  g.ellipse(cx, cy - tall * .04, wide * .085, tall * .6, 0, 0, Math.PI * 2);
  g.fill();
  line(.7);
  g.stroke();
}

/* Where a surface stops being there.
 *
 * The room is not a room: it is a corner, and the rest is void. Nobody should
 * ever find the far end of a wall or look up at a ceiling, because there is
 * nothing there — so the surfaces are given an alpha that holds near the
 * corner and lets go towards the edges. Drawn once, at whole-surface scale, so
 * it works under a figure that repeats.
 */
export function fadeAway(toward = 'left', top = .34, reach = .42) {
  return paint(256, (g, px) => {
    const run = toward === 'left'
      ? g.createLinearGradient(px, 0, 0, 0)
      : g.createLinearGradient(0, 0, px, 0);
    run.addColorStop(0, '#fff');
    run.addColorStop(Math.min(.98, Math.max(0, reach)), '#fff');
    run.addColorStop(1, '#000');
    g.fillStyle = run;
    g.fillRect(0, 0, px, px);
    // and the ceiling end of it, which nobody is meant to reach either
    g.globalCompositeOperation = 'multiply';
    const up = g.createLinearGradient(0, px, 0, 0);
    up.addColorStop(0, '#fff');
    up.addColorStop(1 - top, '#fff');
    up.addColorStop(1, '#000');
    g.fillStyle = up;
    g.fillRect(0, 0, px, px);
  });
}

/* The same for the boards: it holds under the middle of the room and gives out
   before it reaches any edge, so the floor has no far side. */
export function fadePool(cx = .5, cy = .5, hold = .3) {
  return paint(256, (g, px) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, px, px);
    const r = g.createRadialGradient(cx * px, cy * px, px * hold,
                                     cx * px, cy * px, px * .62);
    r.addColorStop(0, '#fff');
    r.addColorStop(1, '#000');
    g.fillStyle = r;
    g.fillRect(0, 0, px, px);
  });
}

/* The opening, as an outline. `arch` is the share of the height its head
   takes, and `head` is what shape that head is: a round one, struck as a true
   ellipse so a fanlight's ribs can be struck from the same center — or a
   diamond, which is two straight rakes to an apex, and the top half of the
   figure this whole game is cut from. */
function opening(w, h, sill, x, arch, head) {
  const p = new THREE.Path();
  const l = x - w / 2, r = x + w / 2, b = sill, t = sill + h;
  const rise = h * arch, spring = t - rise;
  p.moveTo(l, b);
  p.lineTo(r, b);
  p.lineTo(r, spring);
  if (rise <= 0) p.lineTo(l, t);
  else if (head === 'diamond') { p.lineTo(x, t); p.lineTo(l, spring); }
  else if (head === 'stepped') {
    // A ziggurat: three setbacks a side, which is the shape the whole style
    // is built on — every tower of that decade in one outline.
    const n = 3, dx = (w / 2) * .82 / n, dy = rise / n;
    for (let i = 0; i < n; i++) {
      p.lineTo(r - dx * i, spring + dy * (i + 1));
      p.lineTo(r - dx * (i + 1), spring + dy * (i + 1));
    }
    p.lineTo(l + dx * n, spring + rise);
    for (let i = n; i > 0; i--) {
      p.lineTo(l + dx * (i - 1), spring + dy * i);
      p.lineTo(l + dx * (i - 1), spring + dy * (i - 1));
    }
  }
  else p.absellipse(x, spring, w / 2, rise, 0, Math.PI, false);
  p.lineTo(l, b);
  p.closePath();
  return p;
}

/* The projection that lays a flat page of size W×H onto four points on the
   screen. Eight unknowns, eight equations, solved the way you would by hand.
   Without this the chat is an upright rectangle stuck on an angled wall. */
function homography(W, H, q) {
  const src = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [], y = [];
  for (let i = 0; i < 4; i++) {
    const [x, v] = src[i], [X, Y] = q[i];
    A.push([x, v, 1, 0, 0, 0, -x * X, -v * X]); y.push(X);
    A.push([0, 0, 0, x, v, 1, -x * Y, -v * Y]); y.push(Y);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let best = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    [A[c], A[best]] = [A[best], A[c]];
    [y[c], y[best]] = [y[best], y[c]];
    const p = A[c][c];
    if (!p) return null;                       // degenerate: the plane is edge-on
    for (let k = c; k < 8; k++) A[c][k] /= p;
    y[c] /= p;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      y[r] -= f * y[c];
    }
  }
  const [a, b, c, d, e, f, g, i] = y;
  // CSS wants it column-major, and flat: no z anywhere, just the perspective
  // row that makes the far edge smaller than the near one.
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${i},0,0,1,0,${c},${f},0,1)`;
}

const rgb = (n) => new THREE.Color(n);

/* What a room gets if nobody dressed it — and the shape of the object a
   persona's room.js exports. Everything here may be overridden. */
export const DEFAULT = {
  size: {w: 8.4, d: 7.4, h: 6.5},
  palette: {
    wall: 0x1c1430, floor: 0x2a2338, ink: '180,140,240',
    accent: 0x8d5cd6, warm: 0xec78be, moon: 0xd6c6ff, void: 0x07050c,
  },
  /* The portal: the rectangle the conversation is written on. Every room has
     one, and almost everything else is worked out from it — where the light
     comes through, where the room gathers, where the camera stands. Which
     wall it is on, how big, how far along it, how high off the boards. For a
     side wall, +x is towards you; for the far wall, +x is to your right.

     The rest of the numbers here belong to whichever fitting is dressing it,
     and a fitting that has no use for one simply never reads it. */
  portal: {
    wall: 'right', w: 2.9, h: 5.7, sill: .26, x: .1, arch: .17,
    head: 'round',                        // or 'diamond', 'stepped', or square
    margin: .26,
    rose: .17, hub: .52, ribs: 13, spokes: 20,   // the fanlight and its rose
    sides: .3, low: .24,                  // the mullions, and where they land
    lozenges: 2, tuck: .5, wide: .58,     // the hem
    stone: 0x125c3f,                      // set on its point in the rose
    read: 0,                              // lifts the foot of the reading area
    frame: {stile: .05, bar: .018, depth: .13},
  },
  /* What the portal is made of. A name out of fittings.js, or a function of
     the same shape written here — a room may build its own. `null` leaves the
     portal bare, which is a rectangle of words hanging on a wall. */
  fitting: 'glazing',
  /* The one light that casts. It is never seen: what you get of it is what it
     does to the room. By default it stands outside the portal and shines in,
     which is a moon; give it `from` and it stands where it is told, which is
     a lamp hung over the middle of a room. `at` is what it aims at; null is
     the heart. `drift` and `period` are how far and how slowly it moves.  */
  light: {intensity: 1.7, distance: 13, drift: 1.1, period: 260,
          from: null, at: null},
  // Where the room gathers: a golden section in from the window and aside
  // along it, and how high above the boards the camera looks at that point.
  heart: {into: .382, aside: .382, eye: 1.15},
  // `look` may be left out: then the camera looks at the heart. `fit` places
  // the camera instead, by how much of the screen the window should have.
  camera: {fov: 46, fit: {fill: .9, turn: .6, drop: .04, rise: .5}},
  /* A phone is not the same room from closer in: it is the window, with a room
     around it. `fit` puts the camera wherever that turns out to be.

     Which also settles what a phone is *for*, and it is worth writing down
     because the answer looks like a fault: almost nothing in either room can
     be pressed at this size, and that is the design rather than a regression.
     There is no room around the words to put a hand into — a phone is for
     talking and reading, which is what it is already good at, and the game of
     pushing things about belongs to a screen with room in it. So `reach` is
     not asked about portrait sizes (see tools/reach.mjs), and nobody should
     go looking for a way to make the furniture reachable here: the way would
     be to give the conversation less of the screen, and the conversation is
     the reason anybody opened it on a phone. */
  /* A phone is nearly all glass, so its vignette only nips the corners — and
     it is centered on the window rather than on the heart, because that is what
     the portrait camera is looking at. Set `vignette: null` here for none. */
  portrait: {fov: 58, page: 440, fit: {aim: 'glass', fill: .94, turn: .32, drop: .04},
             vignette: {hold: .55, wide: 1.5, tall: 1.35}},
  page: {w: 720},                 // the chat's own width, in its own flat pixels
  casts: '.msg',                  // what on the glass stands in the light's way
  /* And whether they stand in it at all. A room where the words are lit from
     behind throws them across the floor; a room where they are thrown onto a
     surface has nothing to cast, and says `cast: false`. Either way they are
     drawn, because a mirror may still want them. */
  cast: true,
  spill: 3,                       // how much larger the words fall on the floor
  /* How far into the room you can see. This is depth: it is what makes the far
     side recede. Push it out, or say null, if the room should be crisp all the
     way back — the edges are the vignette's job, not this one. */
  fog: [12, 34],
  /* And how much of the picture survives before the void takes it. `hold` is
     the share of the frame that stays clear, measured from the heart. */
  vignette: {hold: .3, wide: 1.2, tall: 1.2},
  // The warm light inside. `at` is where it stands; it casts no shadows.
  hearth: {strength: 4, reach: 14, decay: 1.2},
  // How much light there is before either of the two real ones: `ambient` is
  // flat and cold, `sky` leans the accent color down onto the floor color.
  // Raise them to see the panelling, lower them for a room that is mostly dark.
  fill: {ambient: .5, sky: .7},
  ceiling: false,                 // there is no lid on this
  /* And what is underfoot. 'boards' is a floor; false is no floor at all —
     for a room that has something else down there, or nothing. */
  ground: 'boards',
  /* How much of each surface survives before the void takes it. `hold` is the
     share of the floor that stays solid, measured out from the middle; `reach`
     is the share of a wall's length that stays solid, measured from the
     corner; `sky` is how much of a wall's height goes at the top. Raise reach
     and lower sky for walls that are more there. */
  hold: .28,
  reach: .42,
  sky: .34,
  thick: .22,                     // how deep the wall is, so the opening has a reveal
  bay: 1.6,                       // how wide one bay of panelling is
  block: 2.2,                     // and how big a parquet block is
  dress: null,
  tick: null,
};

export function mount(spec, {stage, glass, under}) {
  const S = {
    ...DEFAULT, ...spec,
    size: {...DEFAULT.size, ...spec.size},
    palette: {...DEFAULT.palette, ...spec.palette},
    portal: {...DEFAULT.portal, ...spec.portal},
    light: {...DEFAULT.light, ...spec.light},
    page: {...DEFAULT.page, ...spec.page},
    heart: {...DEFAULT.heart, ...spec.heart},
    fill: {...DEFAULT.fill, ...spec.fill},
    hearth: spec.hearth === false ? false : {...DEFAULT.hearth, ...spec.hearth},
  };
  const {w, d, h} = S.size, P = S.palette, win = S.portal;
  /* Whichever fitting is dressing the portal, resolved now: a name out of the
     library, or a function the room brought with it. */
  const fitted = typeof S.fitting === 'function' ? S.fitting : FITTINGS[S.fitting];
  const pierce = S.portal.pierce ?? (fitted ? fitted.pierce !== false : true);

  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // three models share this GPU
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = rgb(P.void);
  // Fog is for depth, not for edges — it is what makes the far side of the
  // room recede. A room that wants none says `fog: null`.
  if (S.fog) scene.fog = new THREE.Fog(P.void, S.fog[0], S.fog[1]);

  /* The void closing in from the edges of the picture. A phone gets its own
     numbers, because there the glass is most of the screen and a clear area
     smaller than the viewport would be eating the conversation. */
  stage.style.setProperty('--void', '#' + rgb(P.void).getHexString());
  function shroud(view) {
    const v = view.vignette !== undefined ? view.vignette : S.vignette;
    stage.classList.toggle('vignetted', !!v);
    if (!v) return;
    stage.style.setProperty('--vig-hold', ((v.hold ?? .3) * 100).toFixed(0) + '%');
    stage.style.setProperty('--vig-w', ((v.wide ?? 1.15) * 100).toFixed(0) + '%');
    stage.style.setProperty('--vig-h', ((v.tall ?? 1.15) * 100).toFixed(0) + '%');
  }
  const camera = new THREE.PerspectiveCamera(S.camera.fov, 1, .1, 60);

  const bin = [];                                  // everything to give back
  const mirrors = [];                              // and everything that reflects
  const keep = (o) => { bin.push(o); return o; };
  const tile = (rx, ry) => {
    const t = keep(lattice(P.ink, '#' + rgb(P.wall).getHexString()));
    t.repeat.set(rx, ry);
    return t;
  };

  /* One bay of panelling, repeated along the wall — so the joint between bays
     falls where a joint would, and a wall twice as long has twice as many
     panels rather than wider ones. Clamped vertically, because a bay runs from
     the skirting to the frieze exactly once. */
  const bay = (width) => {
    const t = keep(panelling(P.ink, '#' + rgb(P.wall).getHexString(),
                             '#' + rgb(P.gem ?? P.accent).getHexString(),
                             // one bay wide against the whole wall's height
                             (S.bay ?? 1.6) / h, S.figure));
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(Math.max(1, Math.round(width / (S.bay || 1.6))), 1);
    return t;
  };
  /* The boards, fading out before they reach an edge. A room may have none:
     `ground: false` leaves nothing underfoot, for a room where what is down
     there is not a floor. Then it is the room's own business, and `dress`
     builds it. */
  if (S.ground) {
    const boards = keep(parquet(P.ink, '#' + rgb(P.floor).getHexString()));
    boards.repeat.set(Math.round(w / (S.block || 2.2)), Math.round(d / (S.block || 2.2)));
    const floorMat = keep(new THREE.MeshStandardMaterial({
      map: boards, color: 0xffffff, roughness: .92, metalness: .04,
      alphaMap: keep(fadePool(.5, .5, S.hold ?? .28)),
      transparent: true,
    }));
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  /* No ceiling. This is not a room with a lid on it — it is a corner standing
     in the dark, and a ceiling is the fastest way to tell somebody otherwise.
     A room that wants one says so. */
  if (S.ceiling) {
    const ceilMat = keep(new THREE.MeshStandardMaterial(
      {color: P.void, roughness: 1, metalness: 0, side: THREE.FrontSide}));
    const ceiling = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = h;
    scene.add(ceiling);
  }

  /* One wall carries the window; the others are plain. The carrier is built in
     its own frame — x across it, y up, z into the room — and then stood where
     it belongs, so nothing below has to know which wall it is. */
  const walls = {
    back:  {span: w, at: [0, 0, -d / 2], turn: 0},
    right: {span: d, at: [w / 2, 0, 0], turn: -Math.PI / 2},
    left:  {span: d, at: [-w / 2, 0, 0], turn: Math.PI / 2},
  };
  const carrier = new THREE.Group();
  const place = walls[win.wall] || walls.back;
  carrier.position.set(...place.at);
  carrier.rotation.y = place.turn;
  scene.add(carrier);
  carrier.updateMatrixWorld(true);

  /* Which wall stands beside this one. Only these two are built: the room is
     a corner, and the other two were never there. */
  const carried = win.wall || 'back';
  const meets = S.corner || (carried === 'back' ? 'right' : 'back');

  const span = place.span;
  const face = new THREE.Shape();
  face.moveTo(-span / 2, 0); face.lineTo(span / 2, 0);
  face.lineTo(span / 2, h); face.lineTo(-span / 2, h);
  face.closePath();
  /* Cut, or not. A window is a hole in a wall and the wall has to be built
     with it in; a bookcase stands against the wall and the wall behind it is
     simply a wall. The fitting says which it is. */
  if (pierce) face.holes.push(opening(win.w, win.h, win.sill, win.x, win.arch, win.head));

  /* A shape's texture coordinates are its own coordinates rather than 0..1,
     so the bay is placed by hand: shifted to put the wall's left edge at zero,
     and scaled so one bay is one bay. */
  const cut = bay(span);
  cut.repeat.set(cut.repeat.x / span, 1 / h);
  cut.offset.set(.5, 0);
  /* And it fades like the other one. Which end holds depends on where the
     corner is, so it is worked out rather than assumed: the two wall planes
     meet somewhere, and whichever end of this wall is nearer that meeting is
     the end that stays. Without this the wall carrying the window simply
     stops, and on a wide, short screen you see it stop.

     Only its look fades. The shadow pass ignores an alpha map unless there is
     an alphaTest, so the wall still cuts the moonlight to the last inch of it
     — which is the whole reason the wall is there. */
  const post = walls[meets]
    ? new THREE.Vector3(walls[meets].at[0], 0, walls[meets].at[2])
        .add(new THREE.Vector3(place.at[0], 0, place.at[2]))
    : new THREE.Vector3();
  const holdEnd = carrier.worldToLocal(post.clone()).x;
  /* The wall carrying the window has to stay solid at least until it is past
     the window. Otherwise the wall behind the joinery is half gone while the
     joinery is not, and the whole thing reads as stuck on the front of the
     room rather than cut into it. So `reach` is a floor, not a setting, here:
     it is raised to clear the opening if it does not already. */
  const goes = holdEnd < 0 ? 'right' : 'left';
  const lip = [(win.x - win.w / 2) / span + .5, (win.x + win.w / 2) / span + .5];
  const clear = goes === 'right' ? lip[1] : 1 - lip[0];
  const cutFade = keep(fadeAway(goes, S.sky ?? .34,
                                Math.max(S.reach ?? .42, clear + .07)));
  cutFade.repeat.set(1 / span, 1 / h);
  cutFade.offset.set(.5, 0);
  const cutMat = keep(new THREE.MeshStandardMaterial({
    map: cut, color: 0xffffff, roughness: .95, metalness: 0,
    alphaMap: cutFade, transparent: true,
    side: THREE.FrontSide, shadowSide: THREE.DoubleSide,
  }));
  /* And the wall has a thickness, so the opening has a reveal. A window cut in
     a plane of zero depth has no jamb for the light to cross, and reads as
     stuck on the front of the room however carefully the joinery is drawn.
     The sides get their own material: they are a returned edge, not more
     panelling, and they do not fade with the face. */
  const thick = S.thick ?? .22;
  const jamb = keep(new THREE.MeshStandardMaterial(
    {color: P.wall, roughness: .9, metalness: .05}));
  const pierced = new THREE.Mesh(
    keep(new THREE.ExtrudeGeometry(face, {depth: thick, bevelEnabled: false, curveSegments: 20})),
    [cutMat, jamb]);
  pierced.position.z = -thick;                     // its face on the wall line
  pierced.castShadow = true;                       // this is what shapes the light
  pierced.receiveShadow = true;
  carrier.add(pierced);

  /* The wall that meets the window's wall in a corner, and nothing else. Its
     far end fades out, and so does everything above head height: the room is a
     corner, and the rest of it was never built. */
  const plain = (width, x, z, turn, away) => {
    const mat = keep(new THREE.MeshStandardMaterial({
      // White, because the figure is drawn on the wall's own color already;
      // tinting it again multiplies the wall by itself and the room goes out.
      map: bay(width), color: 0xffffff, roughness: .95, metalness: 0,
      alphaMap: keep(fadeAway(away, S.sky ?? .34, S.reach ?? .42)),
      transparent: true,
      side: THREE.FrontSide, shadowSide: THREE.DoubleSide,
    }));
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, h)), mat);
    m.position.set(x, h / 2, z);
    m.rotation.y = turn;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  /* Which end holds depends on where the corner is. With the window in the
     right-hand wall, the back wall holds at its right and lets go to the left;
     with it in the back wall, the right-hand wall holds at its far end. */
  const beside = walls[meets];
  if (beside) plain(beside.span, beside.at[0], beside.at[2], beside.turn,
                    carried === 'right' ? 'left' : 'right');

  /* Skirting and cornice: the two lines that say where a room stops. Drawn
     panelling is flat and takes light flatly; these stand proud, so the moon
     finds an edge on the way past and the corner reads. */
  const trim = keep(new THREE.MeshStandardMaterial(
    {color: P.wall, roughness: .8, metalness: .1}));
  const run = (len, x, y, z, turn, tall, deep) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(len, tall, deep)), trim);
    m.position.set(x, y, z);
    m.rotation.y = turn;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  for (const name of [carried, meets]) {
    const p = walls[name];
    if (!p) continue;
    const into = p.turn === 0 ? [0, .07] : [p.at[0] > 0 ? -.07 : .07, 0];
    // Skirting only: a cornice is a ceiling's idea, and there is no ceiling.
    run(p.span, p.at[0] + into[0], .09, p.at[2] + into[1], p.turn, .18, .06);
  }

  /* ---- the fitting --------------------------------------------------------
     What the portal is actually made of, and the only part of the room the
     engine does not build itself. It is handed the tools rather than left to
     import them, so a persona can write one of these in its own room.js.

     What comes back is the rectangle it has left clear: the conversation goes
     there, the camera frames that, and nothing above knows or cares whether
     it was glass or a shelf.
  --------------------------------------------------------------------------*/

  // Everything a fitting builds is a stick of some size, somewhere, turned.
  const stick = (g, bw, bh, bd, x, y, z, mat, turn = 0, tilt = 0) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(bw, bh, bd)), mat);
    m.position.set(x, y, z);
    m.rotation.z = turn;
    m.rotation.x = tilt;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  const fitting = fitted
    ? fitted({THREE, keep, carrier, S, P, portal: win, opening, paint, stick, pierce})
    : {};
  /* A portal with nothing fitted to it is the rectangle itself. */
  const read = fitting.read ||
    {x: win.x, y: win.sill + win.h / 2, w: win.w, h: win.h, z: .04};
  /* Open, or shut — if the fitting has anything that shuts. A room with no
     shutters still answers to this, and does nothing. */
  const shutter = fitting.shutter || (() => {});
  /* And a fitting may have weather. Called with the same clock the room's own
     tick gets, and it is for ambience only — a thing that moves and decides
     nothing, like the moon. Anything a fitting wanted to *remember* would be
     the room's business and would go through pokes or handles like everything
     else. */
  const fittingTick = typeof fitting.tick === 'function' ? fitting.tick : null;


  // ---- light -------------------------------------------------------------
  let room_hearth = null;
  scene.add(new THREE.AmbientLight(P.moon, S.fill.ambient));
  scene.add(new THREE.HemisphereLight(P.accent, P.floor, S.fill.sky));

  /* One light inside, warm, low, and off to the far side — a fire, or a lamp
     nobody drew. It casts nothing: it is only there so the room has a second
     value, and the panelling and the boards have something to be modeled by.
     A room lit by a single cold source is a set of objects in the dark. */
  if (S.hearth) {
    /* Falling off slowly on purpose: a physical falloff puts the far wall in
       the dark, and the far wall is most of the picture. */
    const glow = new THREE.PointLight(P.warm, S.hearth.strength ?? 4,
                                      S.hearth.reach ?? 9, S.hearth.decay ?? 1.2);
    glow.position.set(...(S.hearth.at || [-w * .3, 1.1, d * .1]));
    scene.add(glow);
    room_hearth = glow;
  }

  carrier.updateMatrixWorld(true);
  /* Any point on the portal, in world terms: u across it and v up it, each
     from -1 at one edge to 1 at the other, 0 at the middle. A room arranges
     itself around this rather than around the origin — the portal is where
     the conversation is, and the conversation is what the room is for. */
  const onPortal = (u = 0, v = 0, out = new THREE.Vector3()) => out
    .set(win.x + u * win.w / 2, win.sill + (v + 1) * win.h / 2, 0)
    .applyMatrix4(carrier.matrixWorld);
  const portalAt = onPortal();

  /* The heart of the room: the foot of the portal, walked a golden section
     into the room and the same fraction along the wall. Everything gathers
     here — the light lands on it, and the camera looks at it. */
  const inward = new THREE.Vector3(0, 0, 1).transformDirection(carrier.matrixWorld);
  const across = (win.wall === 'right' || win.wall === 'left') ? w : d;
  const heart = onPortal(-S.heart.aside, -1)
    .addScaledVector(inward, S.heart.into * across);
  heart.y = 0;                                     // it is a place on the boards

  /* Where the light should land, and where it stands to do it.

     Two rooms want two different things of this. One has a moon outside: the
     light is placed by what it should do rather than where it should be —
     aim at the middle of the floor, run the line back out through the middle
     of the portal, and stand it far enough along that line to be a moon. The
     other has something hung over the room, and says where. Either way what
     is cast is the same, and the words fall the same way. */
  const K = S.light;
  const target = K.at ? new THREE.Vector3(...K.at) : heart.clone();
  const home = K.from
    ? new THREE.Vector3(...K.from)
    : onPortal(0, 0).sub(target).normalize().multiplyScalar(K.distance).add(target);

  const moon = new THREE.DirectionalLight(P.moon, K.intensity);
  moon.position.copy(home);
  moon.target.position.copy(target);
  moon.castShadow = true;
  moon.shadow.mapSize.set(4096, 4096);
  moon.shadow.bias = -.0006;
  /* Big enough to hold the whole room from wherever the light is aimed, and
     no bigger: every meter the shadow camera covers is resolution taken off
     the letters on the floor — but anything that falls outside it is lit as if
     no wall stood in the way, which is worse than a soft letter. */
  const reach = Math.hypot(w, d) / 2 + target.length() + 1;
  Object.assign(moon.shadow.camera,
    {left: -reach, right: reach, top: reach, bottom: -reach, near: 1,
     far: home.distanceTo(target) + Math.max(w, d, h) + 8});
  moon.shadow.camera.updateProjectionMatrix();
  scene.add(moon, moon.target);

  // ---- what the room itself puts in the room ------------------------------

  const room = {
    THREE, scene, carrier, S, size: S.size, palette: P, portal: win, keep,
    light: moon, middle: portalAt, onPortal, heart, shutter, hearth: room_hearth,
    mirrors,
  };
  room.matte = (color, roughness = .95) =>
    keep(new THREE.MeshStandardMaterial({color: color, roughness}));
  /* A bolster: a cylinder lying along one axis. Everything soft in a room is
     round somewhere, and a box with a rolled edge on it stops being a box. */
  room.roll = (len, r, x, y, z, mat, along = 'x', turn = 0) => {
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, len, 18, 1)), mat);
    if (along === 'x') m.rotation.z = Math.PI / 2;
    else if (along === 'z') m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    if (turn) { m.rotation.y = turn; }
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  /* A rug, round: the figure the room gathers on. Concentric bands with a
     ring of rays between them — a sunburst lying down, which is the same thing
     the window is doing standing up. Round because a corner in the void has no
     corners to square a rug to. */
  room.rug = (radius, x, z, turn = 0, ink = P.ink) => {
    const cloth = keep(paint(512, (g, px) => {
      const c = px / 2;
      g.clearRect(0, 0, px, px);
      const ring = (r, a, wide) => {
        g.strokeStyle = `rgba(${ink},${a})`;
        g.lineWidth = wide;
        g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
      };
      // the ground of it, fading out before the edge so it has no hard rim
      const wash = g.createRadialGradient(c, c, px * .05, c, c, c);
      wash.addColorStop(0, `rgba(${ink},.16)`);
      wash.addColorStop(.72, `rgba(${ink},.12)`);
      wash.addColorStop(1, `rgba(${ink},0)`);
      g.fillStyle = wash;
      g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();

      ring(c * .93, .3, 3); ring(c * .86, .16, 1.5);
      ring(c * .55, .26, 2);  ring(c * .5, .14, 1.5);
      ring(c * .19, .3, 2);
      // rays between the two inner bands
      g.strokeStyle = `rgba(${ink},.2)`;
      g.lineWidth = 2;
      for (let i = 0; i < 36; i++) {
        const t = (Math.PI * 2 / 36) * i;
        g.beginPath();
        g.moveTo(c + Math.cos(t) * c * .21, c + Math.sin(t) * c * .21);
        g.lineTo(c + Math.cos(t) * c * .49, c + Math.sin(t) * c * .49);
        g.stroke();
      }
      // and a diamond set at the middle of it
      g.strokeStyle = `rgba(${ink},.34)`;
      g.lineWidth = 2.5;
      const r = c * .11;
      g.beginPath();
      g.moveTo(c, c - r); g.lineTo(c + r, c); g.lineTo(c, c + r); g.lineTo(c - r, c);
      g.closePath(); g.stroke();
    }));
    const m = new THREE.Mesh(
      keep(new THREE.CircleGeometry(radius, 64)),
      keep(new THREE.MeshStandardMaterial(
        {map: cloth, transparent: true, roughness: 1, metalness: 0})));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = turn;
    m.position.set(x, .006, z);           // just off the boards, not in them
    m.receiveShadow = true;
    return m;
  };
  room.box = (bw, bh, bd, x, y, z, mat, turn = 0) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(bw, bh, bd)), mat);
    m.position.set(x, y, z);
    m.rotation.y = turn;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  /* A spiral, going down.
   *
   * For a room with no floor in it. It starts as a wide ribbon out at the rim,
   * where a floor would have been, and then it stops being a floor: each turn
   * is narrower than the last, and lower, and further in, until it is a thread
   * and then nothing. Anything standing near the rim stands on it. Anything
   * the light throws — the words, most of all — falls onto it and goes round
   * with it.
   *
   * It is one ribbon of triangles rather than a stack of rings, so it is
   * continuous: you can follow it down with your eye and never find the joint,
   * which is the whole trick.
   */
  room.spiral = ({r = 3.4, turns = 3.4, taper = .64, drop = 1.4, bend = 2,
                  wide = 2.4, at = [0, 0], top = 0, phase = 0, steps = 96,
                  ink = P.ink, face = P.floor} = {}) => {
    const TAU = Math.PI * 2;
    const radius = (rounds) => r * Math.pow(taper, rounds);
    const width = (rounds) => wide * Math.pow(taper, rounds);
    /* How far it has fallen by then. Not a constant rate: the first time round
       is very nearly level, which is what lets it pass for a floor out at the
       rim, and it gives way faster the further in it gets. `drop` is how far
       it has gone by the end of the first turn; `bend` is how much worse it
       gets after that. */
    const fallen = (rounds) => drop * Math.pow(rounds, bend);
    const N = Math.round(steps * turns);
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, rounds = t * turns;
      const a = phase + rounds * TAU;
      const R = radius(rounds);                     // in a little further each turn
      const W = width(rounds);                      // and narrower with it
      const y = top - fallen(rounds);
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(at[0] + c * (R + W / 2), y, at[1] + sn * (R + W / 2));
      pos.push(at[0] + c * (R - W / 2), y, at[1] + sn * (R - W / 2));
      uv.push(t, 1, t, 0);
      if (i < N) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    /* The figure on it: rings running with the ribbon, drawn along its length
       rather than round the room, since the ribbon is what there is. */
    const cloth = keep(paint(512, (g2, px) => {
      g2.fillStyle = '#' + rgb(face).getHexString();
      g2.fillRect(0, 0, px, px);
      g2.strokeStyle = `rgba(${ink},.5)`;
      for (const [at2, wide2, a] of [[.12, 1.5, .5], [.5, 1, .3], [.88, 1.5, .5]]) {
        g2.globalAlpha = a;
        g2.lineWidth = wide2;
        g2.beginPath(); g2.moveTo(0, px * at2); g2.lineTo(px, px * at2); g2.stroke();
      }
      g2.globalAlpha = 1;
      // and the rungs across it, closing up as it goes
      g2.strokeStyle = `rgba(${ink},.22)`;
      g2.lineWidth = 1;
      for (let i = 0; i < 64; i++) {
        const x = px * (i / 64);
        g2.beginPath(); g2.moveTo(x, px * .12); g2.lineTo(x, px * .88); g2.stroke();
      }
    }));
    cloth.wrapS = THREE.RepeatWrapping;
    cloth.repeat.set(turns * 6, 1);
    /* And it goes out. Not fog and not the vignette — this one fades along
       its own length, so what takes it is the going-down rather than the
       distance or the edge of the picture. */
    const gone = keep(paint(256, (g2, px) => {
      const grad = g2.createLinearGradient(0, 0, px, 0);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(.5, 'rgba(255,255,255,.92)');
      grad.addColorStop(.78, 'rgba(255,255,255,.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, px, px);
    }));
    const m = new THREE.Mesh(g, keep(new THREE.MeshStandardMaterial({
      map: cloth, color: 0xffffff, roughness: .95, metalness: .03,
      alphaMap: gone, transparent: true, side: THREE.DoubleSide,
    })));
    m.receiveShadow = true;
    /* Where the ribbon is, under a given spot on the plan — so a room can
       stand a table on a floor that is not level and never was. Which turn is
       under you is a question with more than one answer near the middle, so
       it takes the highest one that is actually there, and null if the ribbon
       has already gone past. */
    /* A place on the ribbon itself, by how far round it you are: 0 is where
       the rim starts, `turns` is where it has become a thread and stopped.
       `across` runs -1 at the inner edge to +1 at the outer one. What stands
       on the spiral is placed by floor() below; what *travels down* it is
       placed by this. */
    m.at = (rounds, across = 0) => {
      const a = phase + rounds * TAU;
      const rho = radius(rounds) + across * width(rounds) / 2;
      return {x: at[0] + Math.cos(a) * rho, y: top - fallen(rounds),
              z: at[1] + Math.sin(a) * rho,
              a, rho, wide: width(rounds)};
    };
    m.rounds = turns;                    // how far down it goes before it is gone
    m.middle = [at[0], at[1]];
    /* The eye of it: how close to the middle you can get before there is
       nothing under you at all. The ribbon has stopped being a floor by then
       — it is a thread — and what is inside it is the drop the whole room is
       arranged around. Anything that reaches here has run out of spiral. */
    m.eye = Math.max(0, radius(turns) - width(turns) / 2);
    m.floor = (x, z) => {
      const dx = x - at[0], dz = z - at[1];
      const rho = Math.hypot(dx, dz);
      let turn = Math.atan2(dz, dx) - phase;
      turn = ((turn % TAU) + TAU) % TAU;            // where in its round we are
      for (let k = 0; k * TAU + turn <= turns * TAU; k++) {
        const rounds = k + turn / TAU;
        if (Math.abs(radius(rounds) - rho) <= width(rounds) / 2) {
          return top - fallen(rounds);
        }
      }
      return null;                                 // over the edge of it
    };
    return m;
  };

  /* A mirror, and a real one: what is in it is the room, rendered again from
   * where your eye would be if it were standing behind the glass.
   *
   * The trick is the frustum. The virtual camera stands at the reflected eye
   * and looks along the mirror's own normal, and its projection is struck
   * through the mirror's rectangle — off-axis, the way a window is — so what
   * comes back can be laid on the glass with plain coordinates and is right
   * from wherever you are standing. The one flip is across: a mirror swaps
   * left for right, and the texture is read backwards to say so.
   *
   * `shape` may be a THREE.Shape for a mirror that is not a rectangle; it is
   * measured for its own coordinates and mapped over its bounding box.
   */
  room.mirror = ({w = 1, h = 1.6, shape = null, at = [0, 1.6, 0], turn = 0,
                  tilt = 0, px = 512, tint = 0x8a8f9c, dim = .82} = {}) => {
    const target = keep(new THREE.WebGLRenderTarget(
      Math.round(px * (w / h)), px, {samples: 4}));
    target.texture.colorSpace = THREE.SRGBColorSpace;
    // Read backwards across: this is the swap a mirror does.
    target.texture.repeat.set(-1, 1);
    target.texture.offset.set(1, 0);

    let geo;
    if (shape) {
      geo = keep(new THREE.ShapeGeometry(shape, 32));
      geo.computeBoundingBox();
      const bb = geo.boundingBox, uv = geo.attributes.uv;
      // A shape's coordinates are its own, so they are mapped by hand.
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (uv.getX(i) - bb.min.x) / (bb.max.x - bb.min.x),
                    (uv.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
      }
    } else {
      geo = keep(new THREE.PlaneGeometry(w, h));
    }
    const glass = new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial(
      {map: target.texture, color: tint, fog: false})));
    glass.position.set(...at);
    glass.rotation.y = turn;
    /* Leaned. A glass hung on a chain is never quite flat to the wall, and
       which way it leans is what it shows you: top back for what is high up
       in the room, top forward for the floor. */
    glass.rotation.x = tilt;
    /* Dimmed, because a mirror in a dark room is not a hole in the wall. The
       color multiplies what came back; the room behind it does the rest. */
    glass.material.color.multiplyScalar(dim);
    // On its own layer, so a mirror never has to look at itself.
    glass.layers.set(1);
    mirrors.push({glass, target, w, h});
    return glass;
  };

  /* ---- what a hand can do -------------------------------------------------
     Four small things, and the game is built out of them in dress(). See the
     rules at the top of this file: nothing here is on a clock, animations
     never own state, and the same construction runs whether a thing is being
     touched now or restored from a save with the durations at zero.
  --------------------------------------------------------------------------*/

  /* Pick proxies live on layer 3: the camera is never told to render them and
     the raycaster is told to look at nothing else. So a click tests a handful
     of boxes rather than the whole room, and an invisible target costs
     nothing to draw because it is never drawn. */
  const pick = [];
  /* Whether the room is being shown as a room at all, rather than as the
     window with a room somewhere behind it. Set by frame(), which is where
     that is decided, and read by everything that takes a press. Declared here
     because frame() runs before the pointer handlers are built. */
  let close = false;
  room.pressable = () => !close;
  const rays = new THREE.Raycaster();
  rays.layers.disableAll();
  rays.layers.enable(3);
  const nowhere = keep(new THREE.MeshBasicMaterial({visible: false}));

  /* Anything already in the scene can be touched. What is registered is a box
     round it rather than its own geometry — a lamp is a dozen little
     cylinders and hitting one of them with a fingertip on a phone is not a
     game, it is a test of patience. `grow` is how much bigger than the thing
     itself, in meters.
   *
   * ---- what to hand this, and it is not what you think -------------------
   *
   * Read this before making anything else in a room touchable. It has been
   * got wrong three times, in three different rooms, and it looks identical
   * every time: the cursor changes, so the thing is plainly touchable, and
   * pressing it does something else entirely or nothing at all.
   *
   * Two facts, and everything below follows from them.
   *
   *   A target is a box round the *whole* of what it is given, square to the
   *   world. Hand it a group and you get one box containing every part of
   *   that group, however far from the part you would actually put a hand on.
   *
   *   The nearest box to the eye wins. Not the smallest, not the one you
   *   meant, not the one on top in the picture. The nearest.
   *
   * So the trap is a big thing with small things resting on it. A table is
   * two and a half meters of table with a lamp standing at one end, and the
   * box round all of that has a lid at the height of the lampshade, lying
   * flat across the whole table — including over the glass standing in the
   * middle of it. Every reach for the glass lands on the table, from every
   * angle, forever. A couch is worse, because the thing hiding under its own
   * box is the cushions, which are the part anybody would reach for first.
   *
   * The rule that comes out of it: **point at the thing, not at what it is
   * standing on.** Register the seat rather than the couch, the table top
   * rather than the table, the lamp rather than the table it is on. All three
   * of those are one child of a group instead of the group, and the animation
   * can still run through the whole of it — `jog` and `pokes` move whatever
   * they like, and only the target has to be the part.
   *
   * And then `grow`, which is the same idea in miniature:
   *
   *   generous (.08–.12) for small loose things — a book, a cushion, a glass.
   *     They are what a hand is reaching for and they should be easy to hit.
   *   nothing (0) for any surface something else is resting on. Every
   *     centimeter of grow on a table top is a centimeter of lid over the
   *     glass standing on it.
   *
   * Two more, so nobody rediscovers them the slow way:
   *
   *   Things properly stacked — a pile of books — are fine, and the top one
   *   wins, which is what a pile is. Aiming at the third book up a stack and
   *   getting the fourth is correct.
   *
   *   Anything the projected conversation covers belongs to the conversation,
   *   not to the room. That is deliberate (see the note by the pointer
   *   handlers), and it means part of any room is not reachable from any
   *   given angle. Something worth pressing should not live only behind the
   *   words.
   *
   * When a press seems to go to the wrong thing, do not reach for the
   * raycaster. Ask what box you actually registered, and how tall its lid is.
   */
  room.touch = (target, on, {grow = .07, as = '', follows = false} = {}) => {
    /* Upwards as well as down. `updateMatrixWorld(true)` walks a thing's own
       children and takes its *parents* on trust — so a table top measured
       through the group that carries it came back in the group's frame:
       unrotated, unmoved, the right size and the wrong shape, in roughly the
       wrong place. The target was a slice through the room a meter from the
       table, which is why the lamp and the table would not light the cursor
       while the books, which hang off the scene itself and have no parent to
       be wrong about, worked perfectly. */
    target.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target).expandByScalar(grow);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    if (!isFinite(size.x + size.y + size.z)) return null;    // nothing there yet
    const proxy = new THREE.Mesh(
      keep(new THREE.BoxGeometry(size.x, size.y, size.z)), nowhere);
    proxy.position.copy(mid);
    proxy.layers.set(3);
    scene.add(proxy);
    /* Things that move. A proxy is a box measured once, which is right for a
       lamp and wrong for anything a hand can shove across the room: shove it
       twice and the second press lands on where it used to be. `follows`
       keeps the offset it was measured at and re-reads the thing's position
       before a test — before, not every frame, because the answer is only
       ever wanted at the moment somebody points at it. */
    const lead = follows ? mid.clone().sub(target.getWorldPosition(new THREE.Vector3())) : null;
    const it = {proxy, on, as, target, lead};
    it.follow = () => {
      if (!lead) return;
      target.getWorldPosition(proxy.position).add(lead);
      /* And its matrix with it. A raycaster does not read `position`, it reads
         `matrixWorld` — which the renderer refreshes once a frame, on its own
         schedule. Moving a target and testing it in the same breath therefore
         tested where the thing used to be; and since a pushable thing is
         registered while it is still at the origin and only ever moved by
         this, every one of them was a box sitting in the middle of the floor
         until a frame had passed. It worked at all only because a hand moves
         before it presses, and the frame in between put things right. */
      proxy.updateMatrixWorld(true);
    };
    /* And things that leave. A book that has gone over the edge is not in the
       room any more, so it stops being something to point at — and comes back
       if the state it was in comes back, which happens every time a different
       conversation is opened in here.

       Not `on` and `off`, however much they want to be called that: `on` is
       already this record's word for what to do when the thing is pressed,
       and adding a method of that name quietly replaced it. Every touchable
       thing in every room stopped answering — the two lamps included —
       while the cursor went on promising they would. */
    it.enable = () => { proxy.layers.set(3); };
    it.disable = () => { proxy.layers.disableAll(); };
    pick.push(it);
    return it;
  };

  /* Something you can shove, and that remembers being shoved.
   *
   * The whole of it is one integer: how many times a hand has been put to
   * this. Where the thing has ended up is *worked out* from that number every
   * time the room opens, by `place(n)`, which the room supplies — because
   * where a book goes when you push it is a fact about that room's floor, and
   * this file does not know whether there is one.
   *
   * That split is what makes the rule at the top of this file hold. The save
   * says `{"book-2-1": 3}` and nothing else. Opening it runs the same three
   * shoves with the durations at zero, so the room comes back exactly as it
   * was left without ever having stored a position — and a redesign that
   * moves the shelf moves everything that fell off it, instead of leaving
   * books hanging in the air where the old shelf used to be.
   *
   * What to hand this as `thing` is the same question as for room.touch, and
   * the answer is written out in full there: point at the thing, not at what
   * it is standing on.
   *
   * `place(n)` returns where the thing is after n shoves: {x, y, z, turn,
   * tilt, roll, gone}. `gone` means it ends up there and is then out of the
   * room — it stops being something to point at, and it is not drawn. It can
   * come back: opening a conversation in which it was never touched puts it
   * back on the shelf, which is the same code with n at 0.
   */
  room.pokes = (name, thing, place, {grow = .12, secs = .5, limit = 40,
                                     says = null, moves = 'tumbles'} = {}) => {
    let handle = null;
    /* Two ways a thing can be shoved, and which one it is belongs to the
       thing, not to the shove.

       `tumbles` is a book: it goes end over end, it lands however it lands,
       and being face down on a floor is a perfectly good place for it to be.

       `slides` is a cushion, a blanket, a glass — anything whose whole idea
       is that it lies flat on something. Tumbling those looked wrong for a
       reason worth naming: with no physics, a turning box has corners, and
       corners go through the couch and through the floor. Nothing can stop
       that except not turning them.

       So a slider keeps the tilt and roll it was made with, and only where it
       is and which way it faces can change. It is worth having the engine
       insist on that rather than asking each room to remember: a room says
       where a thing ends up, and it may well say "tipped over" out of the
       same jitter that gives it a place — but a cushion that lies flat lies
       flat, and that is one rule in one place instead of a rule per object.
       The pose it was made in is place(0), which is where everything starts. */
    const level = moves === 'slides';
    const made = level ? (place(0) || {}) : null;
    const put = (pose) => {
      thing.position.set(pose.x, pose.y, pose.z);
      thing.rotation.set(pose.tilt || 0, pose.turn || 0, pose.roll || 0);
    };
    const settle = (n, how = {}) => {
      const to = place(n);
      if (!to) return;
      if (level) { to.tilt = made.tilt || 0; to.roll = made.roll || 0; }
      const from = {x: thing.position.x, y: thing.position.y, z: thing.position.z,
                    tilt: thing.rotation.x, turn: thing.rotation.y,
                    roll: thing.rotation.z};
      const finish = () => {
        thing.visible = !to.gone;
        if (handle) (to.gone ? handle.disable() : handle.enable());
      };
      if (how.instant || !(secs > 0)) {
        put(to);
        finish();
        return;
      }
      thing.visible = true;
      if (handle) handle.disable();       // not while it is in the air
      const drop = from.y - to.y;
      const across = Math.hypot(to.x - from.x, to.z - from.z);
      /* Which way it went, and the axis it turns about on the way.
       *
       * There is no physics here and there is not going to be — see the note
       * on this function. What there is instead is the three things the eye
       * actually reads as weight, none of which cost anything:
       *
       *   it turns end over end, about the axis across its own travel, rather
       *   than spinning about its middle like a coin on a table. A whole
       *   number of turns, so it lands in the pose the arithmetic says it is
       *   in, and the tumble is a transient that has left nothing behind.
       *
       *   it slows as it goes, because things dragged across a floor do.
       *
       *   and it bounces once, small, and settles. A thing that arrives
       *   exactly on the floor and stops has been placed there; a thing that
       *   overshoots by a tenth and comes back has been dropped.
       */
      const spin = new THREE.Vector3(-(to.z - from.z), 0, to.x - from.x)
        .normalize();
      const flips = (!level && across > .12)
        ? Math.max(1, Math.round(across * 1.6)) : 0;
      const rest = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(to.tilt || 0, to.turn || 0, to.roll || 0));
      const began = thing.quaternion.clone();
      const turning = new THREE.Quaternion();
      room.over(secs + Math.min(.9, Math.max(0, drop) * .18), (k) => {
        // Across, easing off — friction, and it is most of what tells you the
        // floor is a floor.
        const slide = 1 - (1 - k) * (1 - k);
        // Down, accelerating, and then the one bounce.
        let fall;
        if (drop > .05) {
          fall = k < .78 ? (k / .78) * (k / .78)
                         : 1 - Math.sin(Math.PI * (k - .78) / .22) * .13 * (1 - (k - .78) / .22);
        } else {
          fall = slide;
        }
        /* And the little arc over the surface, which is a hop for something
           that tumbles and a scuff for something that does not: a cushion
           pushed along a bed rises a centimeter, enough not to grind through
           what it is lying on, and nowhere near enough to have been thrown.
           A slider that goes off an edge still falls and still lands — that
           is the `drop` branch above, and it is the same for both. */
        const lift = drop > .05 ? 0 : Math.sin(Math.PI * k) * (level ? .012 : .04);
        thing.position.set(
          from.x + (to.x - from.x) * slide,
          from.y + (to.y - from.y) * fall + lift,
          from.z + (to.z - from.z) * slide);
        thing.quaternion.slerpQuaternions(began, rest, k);
        if (flips) {
          turning.setFromAxisAngle(spin, k * flips * Math.PI * 2);
          thing.quaternion.premultiply(turning);
        }
      }, finish);
    };
    const mind = room.remembers(
      name, 0,
      v => Math.min(Math.max(Math.round(+v || 0), 0), limit),
      settle);
    handle = room.touch(thing, () => {
      const n = mind.set(mind.get() + 1);
      /* And the room says what was done, in its own words: not "book-3-2
         went from 2 to 3" but "he pushes the books off the ledge; they fall
         into the dark". This is the only part of the program that knows a
         book from a cushion, so it is the only part that can write that
         sentence — and the sentence is a turn, which is why touching things
         is a way of talking to a pill and not only a way of tidying up.

         Only when a hand actually did it. Restoring a save runs the same
         shoves again with the durations at zero, and a room that reported
         those would open by telling the pill about a dozen things nobody has
         just done. */
      if (says) room.says(says(n, place(n)));
    }, {grow, follows: true, as: name});
    settle(mind.get(), {instant: true});
    return mind;
  };

  /* And the other kind of thing: one you can put a hand on but not move.
   *
   * A door that is shut, a mirror on a wall, a table with a lamp on it. The
   * room is not all loose objects, and treating it as though it were is what
   * makes a place feel like a shelf of props — everything skitters when you
   * touch it and nothing is furniture. Pushing is for what is loose; this is
   * for what is not, and the difference is most of what tells you which is
   * which before you have touched anything.
   *
   * What it keeps is the same integer: how many times a hand has been put to
   * it. Nothing about the room changes, so there is nothing to restore — but
   * the count is worth having anyway, because "he tries the door" and "he
   * tries the door again, for the fourth time tonight" are different things
   * to say, and the second one is the more interesting.
   *
   * What to hand this as `thing` matters more here than anywhere, because the
   * things that do not move are the big ones with everything else resting on
   * them. See the note on room.touch: the seat, not the couch.
   *
   * `jog` is the answer in the room itself: a rattle, a shine, a give. It is
   * a transient and owns nothing — the rule at the top of this file — so it
   * is not run when a save is being restored, because nothing was just done.
   */
  room.handles = (name, thing, {says = null, jog = null, grow = .1,
                                secs = .45, limit = 999} = {}) => {
    const mind = room.remembers(
      name, 0, v => Math.min(Math.max(Math.round(+v || 0), 0), limit));
    room.touch(thing, () => {
      const n = mind.set(mind.get() + 1);
      if (jog) room.over(secs, (k) => jog(k, n));
      if (says) room.says(says(n));
    }, {grow, as: name});
    return mind;
  };

  /* ---- can it still be pressed? -------------------------------------------
   *
   * Everything a room remembers survives being rearranged: the save is a
   * count per name, where a thing has got to is worked out from where it
   * lives *now*, and a target follows the thing it is watching. Move the
   * chair and its state moves with it; move the shelf and everything that
   * fell off it comes with the shelf.
   *
   * What does not survive is reachability, and nothing complains when it
   * breaks. A chair moved eighteen inches can put itself between the eye and
   * the lamp; a table pushed along can bring its own lid over the glass; a
   * thing nudged upward can end up behind the projected conversation, which
   * keeps its own presses. In every case the cursor still says the room is
   * touchable and the wrong thing answers, or nothing does.
   *
   * So: after moving anything, ask. For each target, this points at where it
   * actually is and reports what a press there would reach — itself, or
   * something else, or nothing because the words are over it. It is the sweep
   * that was being run by hand while the last three of these were found.
   */
  room.reach = () => {
    const spot = new THREE.Vector3();
    const proxies = () => pick.map(q => q.proxy);
    /* Several points on each thing, not just the middle of it. A blanket
       lying across the foot of a bed covers the middle of the bed and none of
       the rest of it: aiming once, at the center, would call that bed
       unreachable when a hand finds it immediately. The question worth asking
       is "can this be pressed at all", so it is asked five times. */
    const tries = (it) => {
      const g = it.proxy.geometry.parameters;
      const out = [[0, 0, 0]];
      for (const [dx, dz] of [[-.34, 0], [.34, 0], [0, -.34], [0, .34]]) {
        out.push([g.width * dx, 0, g.depth * dz]);
      }
      // And up and down it, for the tall things. A door is four meters of
      // door and a book standing in front of the middle of it does not make
      // it unreachable — you would press it higher up.
      out.push([0, g.height * .34, 0], [0, -g.height * .34, 0]);
      return out;
    };
    /* Aimed at the thing, not at the target that stands for it.
     *
       Which sounds like the same sentence twice and is the difference between
       a check that works and one that agrees with itself. A target in the
       wrong place is exactly the fault worth catching — it happened, for
       every object in a room that hangs off a group rather than off the scene
       — and a sweep that points where the *target* is finds it there and
       calls the room healthy while a hand passing over the actual table
       finds nothing at all. So the ray is aimed at the object, and what it
       ought to arrive at is the target. */
    const aim = new THREE.Vector3();
    const round = new THREE.Box3();
    if (close) return [{name: 'the room', ok: null,
                       why: 'not pressed at this size — the window has the '
                          + 'screen, and the words keep every press'}];
    return pick.map((it) => {
      it.follow && it.follow();
      const name = it.as || '(unnamed)';
      if (it.proxy.layers.mask === 0) return {name, ok: null, why: 'gone from the room'};
      let best = null;
      /* The middle of the thing as it stands now, measured rather than asked
         for. `getWorldPosition` gives a group's *origin*, and a group whose
         parts carry their own offsets — a lamp built out of four turned
         pieces sitting on a table — has its origin wherever the table is. So
         this pointed at the table and reported the lamp unreachable, which is
         a fault in the question rather than in the room. Measuring it also
         means the check never takes the target's word for where the thing is,
         which is the whole point of asking. */
      round.setFromObject(it.target);
      round.getCenter(aim);
      for (const [dx, dy, dz] of tries(it)) {
        spot.copy(aim);
        spot.x += dx; spot.y += dy; spot.z += dz;
        const at = spot.clone().project(camera);
        const x = (at.x * .5 + .5) * innerWidth, y = (-at.y * .5 + .5) * innerHeight;
        if (at.z > 1 || x < 0 || x > innerWidth || y < 0 || y > innerHeight) {
          best = best || {name, ok: false, why: 'off the screen at this size'};
          continue;
        }
        const over = document.elementFromPoint(x, y);
        if (!over || over.tagName !== 'CANVAS') {
          best = {name, ok: false,
                  why: 'behind the words — the conversation keeps that press'};
          continue;
        }
        rays.setFromCamera({x: at.x, y: at.y}, camera);
        const found = rays.intersectObjects(proxies(), false)[0];
        const got = found && pick.find(q => q.proxy === found.object);
        if (got === it) return {name, ok: true, why: 'reaches itself'};
        best = {name, ok: false, why: got
          ? `a press there reaches ${got.as || 'something else'}`
          : 'a press there reaches nothing at all'};
      }
      return best || {name, ok: false, why: 'nowhere to press it'};
    });
  };

  /* A frame scheduler on the loop that is already running. `secs` of 0 runs
     the last frame and nothing else, which is how a save is restored: the
     same code that animates a thing puts it where it ended up. */
  const running = [];
  room.over = (secs, step, done) => {
    if (!(secs > 0)) {
      step && step(1, 0);
      done && done();
      return {stop() {}};
    }
    const job = {t: 0, secs, step, done, dead: false, stop() { job.dead = true; }};
    running.push(job);
    return job;
  };

  /* The conversation as numbers. Recomputed only when the page says something
     changed — the same signal the glyph sheet is drawn from — so this costs
     nothing on a quiet frame. A room seeds itself from these; see `mood`. */
  const stats = {said: 0, theirs: 0, yours: 0, letters: 0, words: 0, asks: 0,
                 last: {letters: 0, words: 0, asks: 0}};
  room.stats = stats;
  function count() {
    const all = [...glass.querySelectorAll(S.casts)];
    let letters = 0, words = 0, asks = 0, theirs = 0;
    let last = {letters: 0, words: 0, asks: 0};
    for (const el of all) {
      const t = el.textContent.trim();
      const w = t ? t.split(/\s+/).length : 0;
      const q = (t.match(/\?/g) || []).length;
      letters += t.length;
      words += w;
      asks += q;
      if (el.classList.contains('pill')) theirs++;
      last = {letters: t.length, words: w, asks: q};
    }
    const spoke = theirs !== stats.theirs;             // the pill has answered
    Object.assign(stats, {said: all.length, theirs, yours: all.length - theirs,
                          letters, words, asks, last});
    if (spoke && S.said) S.said(room, stats);
  }

  /* ---- seeds --------------------------------------------------------------
     Two of them, with different lifetimes, and both keyed rather than
     sequential: `fate('books', 3)` is a hash, not the third number out of a
     stream. A stream desyncs the moment two events replay in a different
     order, and a room restored from a save would then be subtly wrong.

     `fate` is what happened: the persona and the session, and nothing else,
     so it is the same every time this conversation is opened. `mood` is how
     it looks today: the persona's live temperature and the conversation so
     far, so the same history grows in a different hand at a different
     setting. Neither is random until the page has said who we are — before
     that they are stable nonsense, which is fine, because everything drawn
     from them is redrawn when it finds out.
  --------------------------------------------------------------------------*/
  const knows = {persona: '', session: '', temperature: .8, top_p: .95,
                 // Where the pill is holding you: the slow axis, and today's
                 // temper. Both from relation.py, both -100..100, and 0 is a
                 // pill that has no opinion of you yet — which is a room
                 // exactly as it was painted.
                 warmth: 0, temper: 0,
                 did: null};
  const hash = (...parts) => {
    let h = 2166136261 >>> 0;
    for (const s2 of parts) {
      const str = String(s2);
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      h = Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0;
    }
    return h >>> 0;
  };
  // One number in 0..1 from a key. Same key, same number, forever.
  const off = (h) => {
    let x = (h + 0x6d2b79f5) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  room.fate = (...key) => off(hash(knows.persona, knows.session, ...key));
  room.mood = (...key) => off(hash(knows.persona, knows.temperature.toFixed(3),
                                   stats.said, ...key));

  /* ---- what is remembered -------------------------------------------------
     One of these per object that can be changed. `initial` is what a room
     that has never been touched looks like; `sane` drags anything out of a
     save into a value this room can actually use *now*, which is what lets a
     save written three redesigns ago still open; `apply` puts the object into
     that state, and is handed {instant: true} when it is being restored
     rather than done, so it can skip the animation.

     A name that is no longer in the room is simply never read — the room
     opens without it and nothing complains. And what this room does not
     mention is not touched: the server merges rather than replaces, so an
     object taken out for a redesign finds its state waiting when it returns.
  --------------------------------------------------------------------------*/
  const minds = [];
  let tell = null;                   // the page's way of saving; set by knows()
  const gather = () => Object.fromEntries(minds.map(m => [m.name, m.value]));
  room.remembers = (name, initial, sane = (v) => v, apply = null) => {
    const it = {name, initial: sane(initial), value: sane(initial), apply};
    it.get = () => it.value;
    it.set = (v, how = {}) => {
      const was = it.value;
      it.value = sane(v);
      if (apply) apply(it.value, how);
      if (it.value !== was && !how.quiet && tell) tell(gather());
      return it.value;
    };
    minds.push(it);
    return it;
  };

  /* What the page knows and the room does not: who this is, which conversation
     it is, how the persona is set right now, and whatever the last save of
     this room said. Arrives over the websocket, so it may well be after the
     room is built — everything above is written to be told later. */
  room.knows = ({persona, session, mood, state, save, did} = {}) => {
    if (persona) knows.persona = persona;
    if (session !== undefined) knows.session = session;
    if (mood) Object.assign(knows, mood);
    if (save) tell = save;
    // How the room says what a hand has just done. The page owns the socket;
    // this file owns the sentence.
    if (did) knows.did = did;
    if (state) {
      /* Both directions. What the save mentions is applied; what it does not
         goes back to how a room nobody has touched looks — because that is
         what an untouched room *is*, and because this runs again whenever the
         conversation changes underneath us. Without the second half, opening
         a second conversation would leave the first one's lamp burning in it. */
      for (const m of minds) {
        m.set(m.name in state ? state[m.name] : m.initial,
              {instant: true, quiet: true});
      }
    }
    /* The first one lands without a fade. A room is built before the socket
       has said whose it is, so it starts at the machine's own setting — and
       fading up from that is a room opening in somebody else's mood and
       correcting itself in front of you. Every change after that is a change
       of light, and takes its time. */
    grade({instant: !toldMood});
    if (mood) toldMood = true;
    if (S.woke) S.woke(room, knows);
    return knows;
  };

  /* ---- how the pill is holding you, seen rather than read ----------------
   *
   * A room is lit by whoever is in it, and by how they feel about the person
   * standing in it. That is `warmth` in relation.py — the slow axis, contempt
   * through to fondness, the one the box calls frozen, cold, cool, even, warm,
   * close, devoted — with today's temper riding on top of it at half weight,
   * because a mood is real and is not where you stand.
   *
   * Cold washes the color out of the place. `saturate` pulls every pixel
   * towards its own luminance, so what is left of a bleached room is its
   * light and its shape — Lover's one lamp and its long throw across a rug,
   * Thinker's shelves — with the plum and the oxblood gone out of them. Not
   * quite to gray, even at the bottom: a trace of what the room was painted
   * survives being frozen out, which is a better sentence about a pill that
   * cannot stand you than a black-and-white photograph is. Warm goes the
   * other way and keeps going, past what the room was painted, into a place
   * that is slightly too much.
   *
   * It moves while you are sitting in it. The relation is scored after every
   * turn that had you in it, so a conversation going well warms the room
   * around it over a second and a half, and one going badly takes the color
   * out. Nothing announces it. You notice on the way out that the room is not
   * the one you sat down in.
   *
   * A filter on the canvas, and not a pass over the scene: it is the whole
   * picture at once — mirrors, rain, the shadow the words cast on the floor —
   * for one line and no render target. The words themselves are HTML lying on
   * a surface in the room and are left alone. What is being shown is how the
   * pill is holding you, and the conversation is not part of the furniture.
   *
   * The relation belongs to the pill and not to any one conversation. So an
   * evening from a month ago opens in today's color, and a pill you have
   * since turned cold repaints everything it ever said to you. There is no
   * going back to how it used to feel in there.
   *
   * The sampling temperature is a different number with a confusingly similar
   * name, and this is deliberately not it: it lives in a config file, it does
   * not move, and every persona in the box sits within a tenth of the same
   * value. It still seeds `mood` above, which is what it is for.
   */
  let graded = '', toldMood = false;
  function grade({instant = false} = {}) {
    const heat = Math.max(-100, Math.min(100,
      (+knows.warmth || 0) + (+knows.temper || 0) * .5));
    // Straight lines either side of even, so a band in the box is a band on
    // the wall: frozen bleaches, devoted burns, and the six steps between
    // them are six rooms.
    const sat = 1 + heat / 100 * (heat >= 0 ? 1 : .9);
    const d = sat - 1;
    /* And the two that stop it being a slider on a photograph. Washed out is
       flat and slightly lifted, the way a thing left in the sun goes; too
       warm is harder and a shade deeper, which is what keeps an oversaturated
       room from just looking bright. */
    const want = `saturate(${sat.toFixed(3)}) contrast(${(1 + d * .1).toFixed(3)}) `
               + `brightness(${(1 - d * .06).toFixed(3)})`;
    if (want === graded) return;
    graded = want;
    // Long enough to be a change of light rather than a cut.
    canvas.style.transition = instant ? 'none' : 'filter 1.6s ease';
    canvas.style.filter = want;
  }
  grade({instant: true});
  /* A room saying what has just been done in it, for the things that are
     neither a shove nor a handle — a lamp turned down, a hand put out over a
     drop. `pokes` and `handles` go through this too; anything a room builds
     for itself can as well. Silent until the page has given us the way out,
     which is a moment after the room is built. */
  room.says = (line) => { if (line && knows.did) knows.did(String(line)); };

  /* And a press that reached nothing at all.
   *
   * Which is not the same as a press that meant nothing. Most of both rooms
   * is not a target — the boards, the panelling, the stone of the spiral, the
   * dark past the walls — and where somebody puts their hand when they put it
   * nowhere is worth knowing: reaching over the edge of a room with no floor
   * in it is a different act from resting a hand on a wall.
   *
   * The engine does not decide which is which, because it does not know what
   * is under any of it. It hands over where the press would land on the floor
   * plane — or null, for a press aimed above the horizon at nothing at all —
   * and the room, which has a floor or has a hole, says what that was.
   */
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const landing = new THREE.Vector3();
  let missed = null;
  room.nothing = (fn) => { missed = fn; };
  room.told = knows;

  if (S.dress) S.dress(room);

  // ---- the reading pane ---------------------------------------------------
  /* An invisible plane filling whatever the fitting left clear. Each frame we
     project its four corners and hand the page the projection that lands on
     them, so the conversation lies on it — leaning with the wall rather than
     pasted over a picture of one.

     Flush with the joinery, because the fitting measured it: the page runs to
     the inside faces of the frame, so the scrolling area meets the trim
     rather than floating in the middle with a rim of nothing around it. What
     keeps the words off the trim is the page's own padding, which is type,
     and scrolls with them. */
  const pane = new THREE.Object3D();
  pane.position.set(read.x, read.y, read.z ?? .04);
  carrier.add(pane);

  /* How much of that rectangle is in use. A view may take a slice of it
     rather than the whole: a phone is a tall screen and the face of a
     bookcase is not a tall shape, so fitting all of it on leaves the
     conversation in a band across the middle with room above and below it.
     A tall slice of the same throw fills the screen instead, and it is still
     the same wall being written on. Fractions of the rectangle: `w`/`h` how
     much, `x`/`y` where, from its middle. */
  let pw = read.w, ph = read.h;

  /* The flat page the conversation is written on. Its width is a choice — a
     wider page is smaller type on the same glass — and a phone wants a
     different one from a desk, so it is re-laid whenever the screen changes
     shape rather than fixed once. */
  const page = {w: 0, h: 0};
  glass.style.transformOrigin = '0 0';
  function layPane(view) {
    const cut = (view && view.read) || {};
    const w2 = read.w * (cut.w ?? 1), h2 = read.h * (cut.h ?? 1);
    pane.position.set(read.x + (cut.x ?? 0) * read.w,
                      read.y + (cut.y ?? 0) * read.h, read.z ?? .04);
    const same = w2 === pw && h2 === ph;
    if (!same) {
      pw = w2;
      ph = h2;
      page.w = 0;                    // its shape changed, so it is laid again
    }
    if (!words) return;
    if (!same) {
      /* And the old one goes back now rather than at the end. This runs on
         every change of shape — dragging a window across the threshold where
         the portrait slice starts and stops does it repeatedly — and the bin
         is only emptied when the room closes, so each crossing left a
         geometry behind for the rest of the evening. */
      const was = words.geometry;
      const geo = new THREE.PlaneGeometry(pw, ph);
      words.geometry = geo;
      echo.geometry = geo;
      if (was && was !== geo) was.dispose();
    }
    words.position.copy(pane.position);
    words.position.z += .015;
    echo.position.copy(words.position);
  }
  function setPage(width) {
    if (width === page.w) return;
    /* Whatever is being read stays where it was. Re-laying the page re-wraps
       every line in it, and a conversation that jumps when the window is
       dragged is a conversation you lose your place in. */
    const scroller = glass.querySelector('#chat') || glass;
    const was = scroller.scrollHeight - scroller.clientHeight;
    const at = was > 0 ? scroller.scrollTop / was : 1;
    page.w = width;
    page.h = Math.round(width * (ph / pw));
    glass.style.width = page.w + 'px';
    glass.style.height = page.h + 'px';
    const now = scroller.scrollHeight - scroller.clientHeight;
    if (now > 0) scroller.scrollTop = at * now;
    last = '';                       // the projection is struck from the size
    smudge();                        // and the sheet is drawn from the type
  }
  function layPage(view) {
    if (!page.w) setPage((view && view.page) || S.page.w);
  }

  /* The page is laid out at the size it is drawn at.
   *
   * It used to be laid out at whatever width the room asked for and then
   * projected onto the portal, which on a small one meant a page of 620
   * pixels squashed into 270 — so every glyph was rasterised at one size and
   * minified to another, and the conversation came out soft and grainy while
   * the room behind it was sharp.
   *
   * None of that was buying anything. The type is asked for in real screen
   * pixels (that is what `--px` is for), so how many words fit on a line is
   * decided by the projection and not by this number: all a mismatched page
   * width changes is how badly the letters are resampled. So the page is told
   * what it actually measures, once it is known, and then it is drawn at one
   * to one. `page.w` in a room is only the guess it starts from.
   *
   * Nudged rather than tracked: the camera glides between views, and a page
   * that re-wrapped on every frame of that would be unreadable while it
   * moved.
   */
  // Far in the past, not zero: the first of these happens within a few
  // hundred milliseconds of the page loading, and it is the one that matters.
  let settled = -1e9;
  function fitPage(scale, now) {
    if (Math.abs(scale - 1) < .12 || now - settled < 300) return;
    settled = now;
    setPage(Math.round(Math.min(1600, Math.max(220, page.w * scale))));
  }

  /* What the moon does with what it said.
   *
   * Not the bubbles — the words. The chat is HTML and cannot be in the scene,
   * but its text can be redrawn onto a canvas, and that canvas hung in the
   * window's plane as a sheet which is never itself drawn (colorWrite off) and
   * lets light through everywhere except where a letter is. So the moon throws
   * the sentence across the middle of the floor, and when you scroll, the
   * conversation moves over the boards.
   *
   * The moon is far away, so its rays are parallel and a shadow comes out the
   * size of the thing that cast it — at reading size, illegible grain on the
   * boards. So the sheet is drawn magnified about the middle of the glass:
   * what falls on the floor is a few lines of what was just said, large, and
   * the rest is off the edge of the window. Which is the right amount.
   */
  const SS = 3;                                    // drawn larger than the page
  const sheet = document.createElement('canvas');
  const ink = sheet.getContext('2d');
  const glyphs = keep(new THREE.CanvasTexture(sheet));
  glyphs.colorSpace = THREE.NoColorSpace;          // it is a stencil, not a picture

  let words = null, echo = null;
  words = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(pw, ph)),
    keep(new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false,
      alphaMap: glyphs, alphaTest: .3, transparent: true,
    })));
  words.castShadow = true;
  words.position.copy(pane.position);
  words.position.z += .015;
  if (S.cast) carrier.add(words);

  /* The same sheet again, but drawn — and on a layer nothing in the room can
     see. The conversation is HTML: it is in front of the picture rather than
     in it, so a mirror hung on a wall would have nothing to reflect. This is
     what it reflects. Only the reflecting cameras are told to look at layer
     two, so from where you are standing it is not there at all. */
  echo = new THREE.Mesh(words.geometry, keep(new THREE.MeshBasicMaterial({
    color: P.warm, alphaMap: glyphs, transparent: true, depthWrite: false,
    fog: false,
  })));
  echo.position.copy(words.position);
  echo.layers.set(2);
  carrier.add(echo);

  /* Where an element sits on the flat page, before the projection touches it:
     up the offset chain to the glass, less whatever has been scrolled away. */
  function flat(el, root) {
    let x = 0, y = 0;
    for (let n = el; n && n !== root; n = n.offsetParent) {
      x += n.offsetLeft; y += n.offsetTop;
      for (let q = n.parentElement; q && q !== n.offsetParent && q !== root; q = q.parentElement) {
        x -= q.scrollLeft; y -= q.scrollTop;
      }
    }
    return {x, y, w: el.offsetWidth, h: el.offsetHeight};
  }

  // The same words, broken the same way the browser broke them.
  function lines(text, width) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = line ? line + ' ' + word : word;
        if (line && ink.measureText(next).width > width) { out.push(line); line = word; }
        else line = next;
      }
      out.push(line);
    }
    return out;
  }

  /* Redrawing every frame would be a canvas of text sixty times a second for
     a picture that only changes when somebody says something or scrolls. So
     it is redrawn when it is told to, and it is told by the page itself —
     anything added or edited anywhere under the glass, and any scroll of
     anything under it, which is what `true` is for: scroll does not bubble,
     it has to be caught on the way down.

     This used to compare a summary of the page against the last one, which
     missed whatever the summary happened not to mention — a line growing, a
     reflow — and left the glass by Thinker's door holding an old sentence. */
  let dirty = true, paper = '', slid = false;
  const smudge = () => { dirty = true; };
  /* Scrolling is not the same event as a word arriving, and must not be
     rationed like one. A word is new type appearing in place; a scroll moves
     every line at once, and the shadow on the floor and the reflection in the
     glass are of those lines. Held to ten a second they follow the
     conversation a tenth of a second behind — which is nothing while reading
     and a visible drag while scrolling, because the eye is tracking the type
     it is dragging. */
  const slide = () => { dirty = true; slid = true; };
  const watchWords = new MutationObserver(smudge);
  watchWords.observe(glass, {childList: true, subtree: true, characterData: true});
  glass.addEventListener('scroll', slide, true);

  /* Ten times a second at most, while words are arriving.

     A reply streams a word at a time, and every word is a mutation — so this
     redrew the whole visible transcript into a canvas of several million
     pixels and re-uploaded it as a texture, once per frame, on a machine
     already holding three models. The eye cannot read a shadow at sixty hertz
     anyway. It stays dirty, so nothing is lost: the last word lands within a
     tenth of a second of being written. A change of shape is a resize and
     redraws at once, because that one is visible as a jump. */
  let drawnAt = 0;
  const EASY = 100;

  function shadows() {
    const shape = page.w + 'x' + page.h;
    if (!dirty && shape === paper) return;
    const now = performance.now();
    // A scroll redraws on the frame it happened, like a resize. Scroll events
    // do not outrun the frames they are dispatched on, so this is a redraw per
    // frame at the very most, and only while something is actually moving.
    if (shape === paper && !slid && now - drawnAt < EASY) return;
    drawnAt = now;
    dirty = false;
    slid = false;
    count();                         // the conversation changed, so its numbers did
    if (shape !== paper) {
      paper = shape;
      sheet.width = page.w * SS;
      sheet.height = page.h * SS;
    }

    // Magnified about the middle of the glass, and clipped by the opening.
    const M = S.spill, k = SS * M;
    ink.setTransform(k, 0, 0, k, -page.w / 2 * (M - 1) * SS, -page.h / 2 * (M - 1) * SS);
    ink.save();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, sheet.width, sheet.height);
    ink.restore();
    ink.textBaseline = 'top';
    for (const el of glass.querySelectorAll(S.casts)) {
      const r = flat(el, glass);
      if (r.y + r.h < 0 || r.y > page.h) continue;      // scrolled out of the room
      const css = getComputedStyle(el);
      /* The words and nothing else — no box round them. This sheet is what
         the room gets of the conversation: a shadow across Lover's floor, a
         reflection in the glass by Thinker's door. Either way it is the
         sentence that carries, and a bubble drawn into it is a blob. The
         boxes belong to the page, where they are type and scroll with it. */
      ink.fillStyle = '#fff';
      ink.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      const pad = {
        l: parseFloat(css.paddingLeft), t: parseFloat(css.paddingTop),
        r: parseFloat(css.paddingRight),
      };
      const lh = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.45;
      let y = r.y + pad.t;
      for (const line of lines(el.textContent.trim(), r.w - pad.l - pad.r)) {
        ink.fillText(line, r.x + pad.l, y);
        y += lh;
      }
    }
    /* And the sheet goes to the card as a new texture rather than as an
       update to the old one.

       `needsUpdate` is the way to say "this canvas has changed", and three
       does take it: it re-uploads, and its own bookkeeping moves on. What
       comes back out of the glass afterwards is the picture from before. The
       page is HTML and draws itself, so the only place this was visible was
       the one surface that reads the sheet — Thinker's mirror, which held the
       first exchange of the evening for the rest of it while a few pixels
       along the sharpest edges twitched as the conversation moved underneath.
       A conversation that is not reflected is the one thing that room is for.

       Dropping the texture forces a fresh upload, and it is not as heavy as
       it sounds: this runs only when the page has actually changed, which is
       a few times a sentence and not once a frame. */
    glyphs.dispose();
    glyphs.needsUpdate = true;
  }

  const at = new THREE.Vector3();
  // How much of the room's turn the words keep when they are laid flat. Enough
  // to say they are on the glass; not enough to be read as a slanted page.
  const TILT = .3;

  /* Everything the homography does except the perspective.
   *
   * Deliberately `matrix` and not `matrix3d`: the two are nearly the same
   * arithmetic to look at and are not the same thing to a finger.
   *
   * Built from three corners rather than a bounding box, which is the whole
   * difference between this reading as glass and reading as a flat panel
   * pasted over the picture. The window it lies on is turned a little, so the
   * words are turned with it — take that away and the type stands bolt upright
   * in front of a room that plainly is not, which is the one arrangement that
   * looks like a mistake. Scale, rotation and shear all survive; only the
   * trapezoid goes, and at this distance the trapezoid is a couple of pixels.
   */
  function flatten(w, h, q) {
    const [tl, tr, br, bl] = q;
    /* The lean comes off the foot of the opening.
     *
     * A projected window is a trapezoid — nearer at one end — so its top edge
     * and its bottom edge fall opposite ways, and there is no one angle that
     * is "the" lean of it. Three answers are available and only one of them
     * is what the eye is doing.
     *
     * The top edge is what this used to take, and head-on it is the wrong
     * one: the type came out several degrees against every visible line in
     * the window. The average of the two is honest and lifeless — on a
     * symmetric keystone it is level, and the page reads as a flat card
     * pasted over the picture, which is the thing the tilt exists to avoid.
     *
     * The foot is what the eye pairs the words with. Type lying on a surface
     * is read against whatever runs underneath it — the transom, the sill,
     * the board it sits on — and those are below the page, not above it. So
     * the horizontal axis is the bottom edge, and the words fall the way the
     * things under them fall. */
    const mid = (p, q2) => [(p[0] + q2[0]) / 2, (p[1] + q2[1]) / 2];
    const top = mid(tl, tr), foot = mid(bl, br);
    const ax = (br[0] - bl[0]) / w, ay = (br[1] - bl[1]) / w;
    const cx = (foot[0] - top[0]) / h, cy = (foot[1] - top[1]) / h;
    const wide = Math.hypot(ax, ay), tall = Math.hypot(cx, cy);
    if (!(wide > .001 && tall > .001)) return '';
    /* And most of the turn comes out.
     *
     * With the perspective there, a turned page reads as a page seen from an
     * angle. Without it, the same numbers read as type that has been rotated,
     * which is a different and much louder thing — the room tilts a little and
     * the words tilt with it, and on a screen held in one hand that is all
     * anybody sees. What is wanted is the hint that these words are lying on
     * something, not a demonstration of it. */
    const lean = (from, to) => to + (from - to) * TILT;
    const u = lean(Math.atan2(ay, ax), 0);
    const v = lean(Math.atan2(cy, cx), Math.PI / 2);
    const a = wide * Math.cos(u), b = wide * Math.sin(u);
    const c = tall * Math.cos(v), d = tall * Math.sin(v);
    /* Placed by the middle rather than by a corner. The axes are the quad's
       center lines now, so the corner they used to start from is not on them
       — hung off `tl` the page would sit half a keystone up and to the left
       of the opening it belongs to. */
    const cx0 = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
    const cy0 = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
    const ox = cx0 - (a * w + c * h) / 2, oy = cy0 - (b * w + d * h) / 2;
    return `matrix(${a.toFixed(5)},${b.toFixed(5)},${c.toFixed(5)},`
         + `${d.toFixed(5)},${ox.toFixed(2)},${oy.toFixed(2)})`;
  }

  const project = (sx, sy) => {
    at.set(pw / 2 * sx, ph / 2 * sy, 0).applyMatrix4(pane.matrixWorld).project(camera);
    return [(at.x * .5 + .5) * innerWidth, (-at.y * .5 + .5) * innerHeight];
  };
  let last = '';
  function layOut() {
    const q = [project(-1, 1), project(1, 1), project(1, -1), project(-1, -1)];
    /* Flat when the glass is all there is.
     *
     * A conversation is a scrolling box, and a scrolling box inside a 3D
     * transform is one a finger cannot move: the browser hands the drag to the
     * transformed layer and the words stay where they are. On a desk that is
     * nobody's problem — there is a wheel, and a trackpad, and the room around
     * it is the point. On a phone the glass *is* the screen and scrolling is
     * the only thing anybody does to it.
     *
     * `close` is already the word for that framing — see frame(), where it is
     * also what stops the room taking presses, and for the same reason: every
     * touch there is either a mistake or a scroll. So the same framing drops
     * the perspective and keeps the placement, as a plain 2D transform onto
     * the box the quad occupies. At that distance the perspective is worth
     * almost nothing to look at and everything to scroll.
     */
    const m = close ? flatten(page.w, page.h, q) : homography(page.w, page.h, q);
    if (!m) return;
    /* Only written when it has actually changed — but everything below runs
       either way. It used to return here, which meant that once the camera
       came to rest nothing was measured again: if the page's own size still
       needed a correction at that moment, it never got one, and the
       conversation sat at the wrong scale until the window was touched. */
    if (m !== last) {
      last = m;
      glass.style.transform = m;
    }

    /* How many screen pixels a page pixel is worth, on average. The page is
       hung on a wall some distance away, so its type is at the mercy of the
       framing — set 15px on it and you get whatever the perspective makes of
       that, which on a small window was twice the size of the panel's. So the
       glass is told its own scale and the stylesheet divides by it: type on
       the glass is then asked for in real screen pixels, like everything else
       in the app, and comes out that size wherever the camera happens to be. */
    const top = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    const bottom = Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]);
    const wide = (top + bottom) / 2;
    const scale = wide / page.w;
    if (scale > .001) {
      glass.style.setProperty('--px', (1 / scale).toFixed(4));
      /* And how big the glass itself came out, in the same screen pixels. The
         room does not grow with the window past a point — the camera frames it
         — so type tied to the viewport goes on climbing after the shelves and
         the door have stopped, until the conversation is the biggest thing in
         the picture. Tied to this it keeps its share of the glass at any size.
         The stylesheet decides what that share is. */
      glass.style.setProperty('--glass-px', wide.toFixed(1) + 'px');
      fitPage(scale, performance.now());
    }

    /* The void closes in from the edges of the picture.
     *
     * Not fog: fog is distance from the camera, so it eats the far corner —
     * which is the part that should be clearest. This is distance from the
     * middle of the frame instead, drawn over the canvas rather than in it,
     * and centered on the heart so it moves with the composition rather than
     * with the browser window. */
    if (stage.classList.contains('vignetted')) {
      const c = middle.clone().project(camera);
      stage.style.setProperty('--eye-x', ((c.x * .5 + .5) * 100).toFixed(1) + '%');
      stage.style.setProperty('--eye-y', ((-c.y * .5 + .5) * 100).toFixed(1) + '%');
    }

    /* What is standing in front of the glass. On a phone the panel covers the
       foot of the window, and the newest thing said is the one that matters —
       so the page is told how much of itself is hidden and keeps its last line
       above it. In the room's own units, since that is what the page is in. */
    if (under && scale > .001) {
      const sill = Math.max(q[2][1], q[3][1]);          // the glass's low edge
      const hides = Math.max(0, sill - under.getBoundingClientRect().top);
      glass.style.setProperty('--under', (hides / scale).toFixed(1) + 'px');
    }
  }

  /* ---- what the mirrors see -----------------------------------------------
     The room again, from the reflected eye, with the projection struck
     through the mirror's own rectangle. See `room.mirror` above for why that
     is the right frustum; here is only the arithmetic of it, done once per
     mirror per frame.
  --------------------------------------------------------------------------*/
  const MX = new THREE.Vector3(), MY = new THREE.Vector3(), MN = new THREE.Vector3();
  const spot = new THREE.Vector3(), turn = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const eye2 = new THREE.PerspectiveCamera();
  camera.layers.enable(1);                         // the glass itself
  eye2.layers.enable(2);                           // and what only a mirror sees
  function reflections() {
    if (!mirrors.length) return;
    for (const m of mirrors) {
      m.glass.getWorldPosition(spot);
      m.glass.getWorldQuaternion(turn);
      MX.set(1, 0, 0).applyQuaternion(turn);
      MY.set(0, 1, 0).applyQuaternion(turn);
      MN.set(0, 0, 1).applyQuaternion(turn);
      const rel = camera.position.clone().sub(spot);
      const ex = rel.dot(MX), ey = rel.dot(MY), ez = rel.dot(MN);
      if (ez < .08) continue;                      // standing behind it
      eye2.position.copy(spot)
        .addScaledVector(MX, ex).addScaledVector(MY, ey).addScaledVector(MN, -ez);
      // Looking along the mirror's normal, and turned about with it — which
      // is the half of the swap that is geometry rather than texture.
      basis.makeBasis(MX.clone().negate(), MY, MN.clone().negate());
      eye2.quaternion.setFromRotationMatrix(basis);
      eye2.projectionMatrix.makePerspective(
        ex - m.w / 2, ex + m.w / 2, m.h / 2 - ey, -m.h / 2 - ey, ez, ez + 80);
      eye2.projectionMatrixInverse.copy(eye2.projectionMatrix).invert();
      /* Without the fog. It is depth from the camera, and the reflected eye
         stands twice the mirror's distance further back than yours — so a
         room that is clear to look at comes back in the glass as a fogged
         nothing. What the glass loses to distance it loses through `dim`. */
      const haze = scene.fog;
      scene.fog = null;
      renderer.setRenderTarget(m.target);
      renderer.clear();
      renderer.render(scene, eye2);
      scene.fog = haze;
    }
    renderer.setRenderTarget(null);
  }

  // ---- the loop ----------------------------------------------------------
  const eyeline = heart.clone().setY(S.heart.eye);
  const UP = new THREE.Vector3(0, 1, 0);
  // What the picture is composed about, whichever view is in use — the heart
  // on a desk, the glass itself on a phone. The vignette clears around it.
  const middle = eyeline.clone();

  /* Standing where the whole window is on the screen.
   *
   * Not by picking a spot — a spot chosen on a wide screen walks the window
   * off the side of a narrow one — and not by pointing straight at the glass
   * either, which centers it and throws the room away. The camera stands off
   * the room's heart, along a line turned `turn` away from the window's own
   * normal, and looks at the heart. Then it walks backwards until the window's
   * furthest corner falls inside `fill` of the screen.
   *
   * So the composition holds — the window over there, the room around it —
   * and the framing is a consequence of the shape of the screen rather than
   * something that has to be guessed once per device.
   *
   * And what has to be on screen is the conversation, not the joinery. A tall
   * window is mostly glass nobody is reading; insisting on its head pushes the
   * camera back and takes the words with it. So the thing framed is the
   * reading pane, and the fanlight goes off the top of the screen if it must.
   */
  const onPane = (u, v, out = new THREE.Vector3()) => out
    .set(pane.position.x + u * pw / 2, pane.position.y + v * ph / 2, pane.position.z)
    .applyMatrix4(carrier.matrixWorld);
  const probe = new THREE.PerspectiveCamera(50, 1, .1, 60);
  const ndc = new THREE.Vector3();
  function stand(view) {
    const f = view.fit;
    const fill = f.fill ?? .8;
    const dir = inward.clone().applyAxisAngle(UP, f.turn ?? .45).normalize();
    /* What the camera is really looking at. On a desk, the heart — so the
       room is the picture and the window is in it. On a phone there is no
       room to spare, so it looks at the glass itself, which puts it in the
       middle of the screen and fills it. */
    const edge = f.margin ?? 1.06;                // a little air around the words
    const corners = [];
    for (const u of [-edge, edge]) for (const v of [-edge, edge]) corners.push(onPane(u, v));

    const onward = f.aim === 'glass';
    const base = onward ? onPane(0, 0) : heart.clone().setY(S.heart.eye);
    const from = base.clone().setY(base.y + (f.rise ?? 0));
    const look = base.clone().setY(base.y - (f.drop ?? 0) * (onward ? win.h : S.heart.eye));

    probe.fov = view.fov;
    probe.aspect = camera.aspect;
    let dist = f.from ?? 7;
    // A few passes: how far out it stands changes how much of the screen the
    // window takes, but not in a straight line, so it is walked rather than
    // solved. Four is plenty and it is only done on a resize.
    for (let i = 0; i < 5; i++) {
      probe.position.copy(from).addScaledVector(dir, dist);
      probe.lookAt(look);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();
      let out = 0;
      for (const c of corners) {
        ndc.copy(c).project(probe);
        out = Math.max(out, Math.abs(ndc.x), Math.abs(ndc.y));
      }
      if (!out) break;
      dist = Math.min(40, Math.max(2, dist * (1 + (out / fill - 1) * .7)));
    }
    const set = {at: from.clone().addScaledVector(dir, dist), look};
    /* And last of all, the picture slid a little across the screen.
     *
     * After the walk above and never during it: `drop` aims the camera before
     * the fitting has chosen a distance, so a room aimed further down is a
     * room whose window has climbed towards the top of the frame -- and the
     * walk answers that by standing further back. Aim and zoom come out
     * coupled, which is why nudging a room with `drop` shrinks it.
     *
     * Here the distance is already settled. The camera turns on the spot and
     * the room slides, and nothing measures it again. `x` and `y` are which
     * way the room moves and roughly how much of the screen it moves by --
     * scaled by the distance it turned out to stand at, so the same numbers
     * mean the same thing in a room of any size. For centering a composition
     * by eye; a room needing much of it wants its heart moved instead. */
    const by = f.nudge;
    if (by) {
      const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
      // Aim right and the room goes left, so both are turned around here and
      // the numbers read as what you see rather than as what the camera does.
      set.look.addScaledVector(side, -(by.x ?? 0) * dist);
      set.look.y -= (by.y ?? 0) * dist;
    }
    return set;
  }

  /* Where the camera is going, and where it is. Turning a phone, or dragging a
     window wider, changes which view the room wants — and it moves there
     rather than cutting, because the room is a place and a place does not
     jump. The glide is frame-rate independent, so it is the same on a phone
     that is managing forty. */
  const goal = {at: new THREE.Vector3(), look: new THREE.Vector3(), fov: S.camera.fov};
  const eye = {at: new THREE.Vector3(), look: new THREE.Vector3(), fov: S.camera.fov};
  let placed = false;

  function frame() {
    /* Which of the two this screen is.
     *
     * Taller than it is wide, by default — but a room may set the mark lower:
     * a tall window suits a narrow screen long before a wide bookcase does,
     * and on a squarish one the room is better company than a close-up of it.
     *
     * And `narrow`, which is the same question asked in pixels. Shape alone
     * misses the window dragged narrow on a desk: it stays wider than it is
     * tall all the way down, so the room went on being framed as a room in a
     * strip too small to hold one, with the furniture cropped off both sides
     * and nothing left to press anyway. Either mark reaching means the close
     * view, because both are asking whether there is room to spare and one
     * "no" is enough. */
    const upto = S.portrait ? (S.portrait.upto ?? 1) : 0;
    const narrow = S.portrait ? (S.portrait.narrow ?? 0) : 0;
    const shut = camera.aspect < upto || innerWidth < narrow;
    const view = shut ? S.portrait : S.camera;
    /* And whether there is a room to put a hand into.
     *
     * Not "is this a phone" — nothing here asks what device it is, and it
     * would get the answer wrong in both directions: an iPad held sideways is
     * a room and a laptop window dragged narrow is not. The framing already
     * knows. When the camera has come in close enough to be showing the
     * window with a room somewhere behind it, there is nothing on screen to
     * press, and every press is either a mistake or a scroll — so the room
     * stops taking them, and the words, which are what anybody came to that
     * screen for, keep all of them.
     *
     * It follows the framing rather than the first measurement, so turning an
     * iPad hands the room back and turning it again takes it away. */
    if (close !== shut) {
      close = shut;
      if (close) { hovering = null; reaching(false); }
    }
    layPane(view);
    layPage(view);
    shroud(view);
    goal.fov = view.fov;
    if (view.fit) {
      const {at, look} = stand(view);
      goal.at.copy(at);
      goal.look.copy(look);
      middle.copy(view.fit.aim === 'glass' ? pane.getWorldPosition(new THREE.Vector3())
                                           : eyeline);
    } else {
      goal.at.set(...view.at);
      goal.look.copy(view.look ? new THREE.Vector3(...view.look) : eyeline);
      middle.copy(goal.look);
    }
    if (!placed) {
      placed = true;
      eye.at.copy(goal.at);
      eye.look.copy(goal.look);
      eye.fov = goal.fov;
    }
    glide(1);                          // so a resize still shows something now
  }

  function glide(dt) {
    const k = 1 - Math.pow(.0006, Math.min(dt, .25));
    eye.at.lerp(goal.at, k);
    eye.look.lerp(goal.look, k);
    eye.fov += (goal.fov - eye.fov) * k;
    camera.position.copy(eye.at);
    camera.lookAt(eye.look);
    camera.fov = eye.fov;
    camera.updateProjectionMatrix();
  }

  function resize() {
    smudge();                        // the type is re-sized, so it re-wraps
    camera.aspect = innerWidth / innerHeight;
    renderer.setSize(innerWidth, innerHeight, false);
    frame();
    last = '';
    layOut();
  }

  let alive = true, loop = 0, t0 = 0, was = 0;
  /* When the room first drew itself, and how long after that it starts taking
     presses.

     Everything in here is touchable, including the dark past the walls — a
     hand put out over the edge is a sentence, and the pill answers it. Which
     is right, and wrong for the first moment of a room: the page arrives, the
     canvas is listening before there is anything drawn on it, and a click
     that was meant for the box you just pressed, or a stray one while you
     find your bearings, lands in the void and starts the evening on your
     behalf.

     Long enough to cover a second click carried in from the doorway, short
     enough that somebody who knows the room and reaches straight for the lamp
     is not told to wait. Not seconds: a delay that long stops being a guard
     and becomes a room that ignores you. */
  const WAKING_MS = 700;
  let shown = 0;
  function tick(now) {
    if (!alive) return;
    loop = requestAnimationFrame(tick);
    if (!t0) t0 = was = now;
    const t = (now - t0) / 1000;
    const was2 = was;                // the frame before this one, for the jobs
    glide((now - was) / 1000);
    was = now;
    /* The moon moves. Because the light is cast rather than painted, the patch
       on the floor and every bar in it move with it — slowly enough that you
       never catch it moving and always notice that it has. */
    const swing = (Math.PI * 2 * t) / S.light.period;
    moon.position.set(
      home.x + Math.sin(swing) * S.light.drift * 2,
      home.y + Math.cos(swing * .7) * S.light.drift * .5,
      home.z + Math.cos(swing) * S.light.drift);
    /* Whatever is mid-animation. Frame-rate independent, and a job that
       throws is dropped rather than left to throw sixty times a second. */
    for (let i = running.length - 1; i >= 0; i--) {
      const job = running[i];
      const dt = (now - was2) / 1000;
      job.t += dt;
      const k = Math.min(1, job.t / job.secs);
      try {
        job.step && job.step(k, dt);
        if (k >= 1 || job.dead) {
          running.splice(i, 1);
          if (k >= 1 && !job.dead) job.done && job.done();
        }
      } catch (err) {
        running.splice(i, 1);
        const why = 'an animation stopped — ' + (err && err.message || err);
        console.warn('lucid:', why);
        if (window.Hatch) Hatch.say(why, 'error');
      }
    }
    if (fittingTick) fittingTick(t);
    if (S.tick) S.tick(room, t);
    shadows();
    reflections();
    renderer.render(scene, camera);
    // The first frame there has ever been. Until this, the room is a black
    // canvas that happens to be listening — see `up`, which will not take a
    // press from before it.
    if (!shown) shown = performance.now();
    layOut();
  }

  /* Nothing renders while the tab is away: this machine is being asked for
     three models and a GPU at the same time. */
  function wake() {
    if (document.hidden) { alive = false; cancelAnimationFrame(loop); }
    else if (!alive) { alive = true; t0 = 0; loop = requestAnimationFrame(tick); }
  }

  /* Hands. Bound to the canvas rather than the window, so the conversation
     and the panel keep their own clicks — anything the chat covers is the
     chat's, which is the right answer anyway: the words are the app.

     A press and a release, with a little slack between them, because a drag
     across a room on a phone is somebody scrolling and not somebody touching
     a lamp. */
  const where = (e) => {
    const r = canvas.getBoundingClientRect();
    return {x: ((e.clientX - r.left) / r.width) * 2 - 1,
            y: -((e.clientY - r.top) / r.height) * 2 + 1};
  };
  const hit = (e) => {
    if (close || !pick.length) return null;
    for (const p of pick) p.follow && p.follow();
    rays.setFromCamera(where(e), camera);
    const found = rays.intersectObjects(pick.map(p => p.proxy), false)[0];
    return found ? pick.find(p => p.proxy === found.object) : null;
  };
  let pressed = null;
  const down = (e) => {
    pressed = {x: e.clientX, y: e.clientY, at: e.pointerId, t: performance.now()};
  };
  const up = (e) => {
    const was = pressed;
    pressed = null;
    if (!was || was.at !== e.pointerId) return;
    if (Math.hypot(e.clientX - was.x, e.clientY - was.y) > 8) return;
    if (close) return;                   // no room on screen to press
    // A room that has only just appeared, or a press that began before it
    // had. See WAKING_MS.
    if (!shown || was.t < shown || performance.now() - shown < WAKING_MS) return;
    const got = hit(e);
    if (got) { got.on(got, e); return; }
    // Nothing was under it. `hit` has already aimed the ray, so where that
    // ray meets the floor plane is the answer to "where were they pointing".
    if (missed) {
      const at = rays.ray.intersectPlane(ground, landing);
      missed(at ? {x: at.x, z: at.z} : null);
    }
  };
  /* And the cursor, which is the only way anybody finds out the room can be
     touched at all. Throttled: a raycast per mousemove is wasteful for an
     answer that changes a few times a minute. */
  let sniffed = 0, hovering = null;
  /* Saying so, in the one way that works in every browser.
   *
   * Setting `cursor` on the canvas is the whole of it in Chrome and Firefox,
   * and Safari sets it too — asked, it will tell you the style is `pointer` —
   * and then goes on drawing an arrow. It settles the cursor when the pointer
   * enters an element and does not look again while it sits still over the
   * same one, which is exactly the case here: one canvas, filling the window,
   * with the whole room inside it. Nothing about the pointer changes when it
   * crosses from the floor onto a book, so nothing asks the question again.
   *
   * Two things make it look. The property is set on the element the canvas
   * lives in as well, since `cursor` inherits and a change there counts as a
   * change to the tree the pointer is in; and its layout is read, which
   * forces the style to be resolved now rather than at some convenient later
   * moment of Safari's choosing. Neither costs anything: this runs when the
   * answer changes, which is a few times a minute. */
  const reaching = (on) => {
    const hand = on ? 'pointer' : '';
    canvas.style.cursor = hand;
    if (canvas.parentElement) canvas.parentElement.style.cursor = hand;
    void canvas.offsetWidth;
  };
  const move = (e) => {
    if (e.timeStamp - sniffed < 60) return;
    sniffed = e.timeStamp;
    const got = hit(e);
    if (got === hovering) return;
    hovering = got;
    reaching(!!got);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { pressed = null; });
  canvas.addEventListener('pointermove', move);

  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', wake);
  let watch;
  if (under && window.ResizeObserver) {
    watch = new ResizeObserver(() => { last = ''; layOut(); });
    watch.observe(under);
  }
  resize();
  loop = requestAnimationFrame(tick);

  return {
    scene, camera, renderer, room, page,
    stop() {
      alive = false;
      cancelAnimationFrame(loop);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', wake);
      watchWords.disconnect();
      glass.removeEventListener('scroll', smudge, true);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointermove', move);
      running.length = 0;
      if (watch) watch.disconnect();
      bin.forEach(o => o.dispose && o.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
