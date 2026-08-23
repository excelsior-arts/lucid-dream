/* What a room is fitted with, where the conversation is written.
 *
 * Every room has a portal: a rectangle on a wall, at a height, of a size. The
 * engine cares about very little of it — it hangs the chat on it, aims the
 * light through it, and composes the camera around it. What the portal *is*
 * — a window with the night behind it, a bay of shelving with the books
 * pushed back — is a fitting, and lives here.
 *
 * A fitting is a function. It is handed the room's own tools (nothing is
 * imported into this file, on purpose: a persona can write one of these in
 * its room.js without reaching for the engine) and it returns the rectangle
 * it has left clear for the words:
 *
 *     ({THREE, keep, carrier, S, P, portal, opening, paint, stick})
 *        => {read: {x, y, w, h, z}, shutter?}
 *
 * `read` is in the carrier's own frame: x across the wall, y up it, z into
 * the room. `shutter(t)` is optional — 0 open, 1 shut — the room saying that
 * nobody is home.
 *
 * `pierce` on the function says whether the wall wants a hole in it. A window
 * does. A bookcase stands against the wall, so it does not.
 */

/* ---- a window ------------------------------------------------------------
   Deco, and leaded rather than casemented: a molded architrave standing off
   the wall in two steps; a sill on an apron; one sheet of small lights held
   in a lead came — a margin border round a clear light, a fanlight in the
   head with a rose at its center, two mullions hung from the transom, and a
   hem of nested lozenges at the foot, with one green stone standing on its
   point in the middle of the rose. Every one of those is a line, and every
   line of it is also a line the light lays on the floor.

   Optionally a wrought balustrade outside the lower third, and louvered
   shutters folded back against the wall.
--------------------------------------------------------------------------*/
export function glazing(fit) {
  const {THREE, keep, carrier, S, P, portal: win, opening, paint, stick} = fit;

  const F = {
    stile: .05, bar: .018, depth: .13,     // leaf frame, muntin, how proud
    ...(win.frame || {}),
  };
  /* The trim: architrave, sill and apron. Its own color, like the came, and
     for the same reason — joinery painted the wall's accent is a molding
     drawn on the wall rather than one standing off it. */
  const frameMat = keep(new THREE.MeshStandardMaterial(
    {color: win.trim ?? P.accent, roughness: .5, metalness: .12}));
  /* The came — every lead in the window — which is not the frame's color by
     default and does not have to be the room's either. Left as the accent it
     is the wall's own pink drawn on glass; given something darker it becomes
     what it is, which is metal holding panes apart. */
  const barMat = keep(new THREE.MeshStandardMaterial(
    {color: win.came ?? P.accent, roughness: .55, metalness: .35}));
  const ironMat = keep(new THREE.MeshStandardMaterial(
    {color: P.iron || 0x1a1526, roughness: .45, metalness: .55}));

  const springing = win.sill + win.h * (1 - win.arch);   // where the arch begins
  const light = springing - win.sill;                    // the square part of it
  const rise = win.h * win.arch;

  // The architrave: two steps, the outer one wider and shallower.
  const molding = (grow, depth, at) => {
    const ring = new THREE.Shape();
    ring.curves = opening(win.w + grow * 2, win.h + grow * 1.7,
                          win.sill - grow, win.x, win.arch, win.head).curves;
    const thin = grow - .045;
    ring.holes.push(opening(win.w + thin * 2, win.h + thin * 1.7,
                            win.sill - thin, win.x, win.arch, win.head));
    const m = new THREE.Mesh(
      keep(new THREE.ExtrudeGeometry(ring, {depth, bevelEnabled: false, curveSegments: 24})),
      frameMat);
    m.position.z = at;
    m.castShadow = true;
    m.receiveShadow = true;
    carrier.add(m);
  };
  molding(.055, .04, .015);                // the inner bead, close to the glass
  molding(.125, .026, .04);                // and the band standing off it

  // The sill, and the apron under it.
  stick(carrier, win.w + .36, .055, .26, win.x, win.sill - .028, .09, frameMat);
  stick(carrier, win.w + .24, .13, .09, win.x, win.sill - .12, .04, frameMat);

  const L = win.x - win.w / 2, R = win.x + win.w / 2;   // the opening's sides
  const B = win.sill, T = springing;                    // and its foot and head
  const GZ = F.depth * .55;                             // where the glass sits

  // A bar from one point to another: the only thing lead ever does.
  const lead = (x1, y1, x2, y2, thick = F.bar) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < .01) return;
    stick(carrier, thick, len, thick * 2.2, (x1 + x2) / 2, (y1 + y2) / 2, GZ,
          barMat, Math.atan2(dy, dx) - Math.PI / 2);
  };
  // A jewel: the little cabochon set where the leads cross.
  const jewelMat = keep(new THREE.MeshStandardMaterial(
    {color: P.warm, roughness: .25, metalness: .35}));
  const jewel = (x, y, r = F.bar * 2.6) => {
    const m = new THREE.Mesh(keep(new THREE.SphereGeometry(r, 12, 8)), jewelMat);
    m.position.set(x, y, GZ + r * .3);
    m.castShadow = true;
    carrier.add(m);
  };

  const margin = win.margin ?? .26;                     // the border band
  const bl = L + margin, br = R - margin, bb = B + margin;

  /* ---- the leaded panel ---------------------------------------------------
   *
   * A border band round a clear light, a fanlight in the head, and a hem of
   * lozenges at the foot. Every line in here is a lead, and the rule the
   * whole figure is drawn by is that a lead ends on the frame, on a transom,
   * or on another lead. Nothing ends in open glass.
   *
   * That rule is the difference between leadwork and a drawing of it. An
   * inset panel with nothing touching the frame hangs in the opening with
   * nothing carrying it, and reads as wrong long before anybody can say which
   * line is at fault.
   */
  const arc = (r, from, to, thick = F.bar, steps = 26) => {
    // The head is an ellipse where the rise is not half the width, so a point
    // on it is not simply polar. Everything in the head goes through this.
    const squash = rise / (win.w / 2);
    let px = null;
    for (let i = 0; i <= steps; i++) {
      const a = from + (to - from) * (i / steps);
      const q = [win.x + Math.cos(a) * r, T + Math.sin(a) * r * squash];
      if (px) lead(px[0], px[1], q[0], q[1], thick);
      px = q;
    }
  };
  const on = (r, a) => [win.x + Math.cos(a) * r,
                        T + Math.sin(a) * r * (rise / (win.w / 2))];

  // the border band: sides and foot straight, head following the arch
  lead(bl, bb, br, bb, F.stile * .6);
  lead(bl, bb, bl, T, F.stile * .6);
  lead(br, bb, br, T, F.stile * .6);
  if (rise > 0) arc(win.w / 2 - margin, 0, Math.PI, F.stile * .6);

  /* The fanlight. Ribs from the rose out to the band, and on across it into
     the frame -- the band is glazed too, and what divides it is the same ribs
     carrying on rather than a second pattern. */
  const rose = (win.rose ?? .17) * win.w;
  const ribs = win.ribs ?? 13;
  if (rise > 0) {
    const rOut = win.w / 2 - margin;
    for (let i = 0; i < ribs; i++) {
      const a = Math.PI * (i + .5) / ribs;
      const [x1, y1] = on(rose, a), [x2, y2] = on(rOut, a), [x3, y3] = on(win.w / 2, a);
      lead(x1, y1, x2, y2);
      lead(x2, y2, x3, y3, F.bar * .8);
    }
  }

  /* The transom the arch stands on, in two pieces with the rose set into it,
     and running the whole width into both stiles. This is what the lights
     below hang from; without it they are drawn in mid-air. */
  lead(L, T, win.x - rose, T, F.bar * 1.6);
  lead(win.x + rose, T, R, T, F.bar * 1.6);

  // The rose itself: two rings, spoked between, with the stone set in it.
  if (rise > 0) {
    const hub = rose * (win.hub ?? .52);
    arc(rose, 0, Math.PI * 2, F.bar * 1.4, 30);
    arc(hub, 0, Math.PI * 2, F.bar, 24);
    const spokes = win.spokes ?? 20;
    for (let i = 0; i < spokes; i++) {
      const a = Math.PI * 2 * i / spokes;
      lead(win.x + Math.cos(a) * hub, T + Math.sin(a) * hub,
           win.x + Math.cos(a) * rose, T + Math.sin(a) * rose, F.bar * .8);
    }
    /* And the one stone in the window: the only green thing in the room, set
       on its point where every rib is pointing anyway. Standing rather than
       square -- turned square it is a tile, and the figure this whole style
       is cut from is taller than it is wide.

       Flat-shaded on purpose. Smoothed, an octahedron is a green egg and
       reads as a bead; faceted, every face takes the light at its own angle
       and it reads as something cut. It is the smallest object in the room
       and the only one anybody will look at twice.

       And graded down its own height rather than lit evenly: deep at the
       foot, lifted towards the point. One light in a room can only tell you
       which side of a thing faces it, which leaves a stone this small
       reading as a flat shape of one color -- the gradient is what gives it
       a top and a bottom, and a bottom is most of what depth is. */
    const r = hub * .92;
    const cut = keep(new THREE.OctahedronGeometry(r, 0));
    const deep = new THREE.Color(win.stone ?? 0x125c3f);
    const lifted = deep.clone().lerp(new THREE.Color(0xffffff), .38);
    const at = cut.attributes.position, tint = new Float32Array(at.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < at.count; i++) {
      c.copy(deep).lerp(lifted, at.getY(i) / (r * 2) + .5);
      tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
    }
    cut.setAttribute('color', new THREE.BufferAttribute(tint, 3));
    const gem = new THREE.Mesh(cut,
      keep(new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: .18, metalness: .5,
        flatShading: true,
        emissive: win.stone ?? 0x125c3f, emissiveIntensity: .3})));
    gem.scale.set(.62, 1, .5);
    gem.position.set(win.x, T, GZ + r * .2);
    gem.castShadow = true;
    carrier.add(gem);
  }

  /* The light below: two mullions and a middle one, hung from the transom and
     landing on a low one; then the hem. */
  const sides = (win.sides ?? .3) * win.w;
  const low = bb + (T - bb) * (win.low ?? .24);
  for (const sx of [-1, 1]) {
    lead(win.x + sx * sides, T, win.x + sx * sides, low);
    jewel(win.x + sx * sides, T, F.bar * 1.4);
    jewel(win.x + sx * sides, low, F.bar * 1.4);
  }
  lead(win.x, T - rose, win.x, low, F.bar * 1.3);
  lead(L, low, R, low);

  /* The hem: lozenges, nested, lying on their sides, tied out to both stiles
     at the waist so the figure is held between them. */
  const midY = (low + bb) / 2, hh = (low - bb) * .34;
  const nest = win.lozenges ?? 2;
  for (let i = 0; i < nest; i++) {
    const f = 1 - i * (win.tuck ?? .5);
    const hw = (win.wide ?? .58) * win.w * f / 2, ph = hh * f;
    const t = F.bar * (i ? .85 : 1.1);
    lead(win.x - hw, midY, win.x, midY + ph, t);
    lead(win.x, midY + ph, win.x + hw, midY, t);
    lead(win.x + hw, midY, win.x, midY - ph, t);
    lead(win.x, midY - ph, win.x - hw, midY, t);
    if (!i) {
      lead(L, midY, win.x - hw, midY);
      lead(win.x + hw, midY, R, midY);
      jewel(win.x - hw, midY, F.bar * 1.3);
      jewel(win.x + hw, midY, F.bar * 1.3);
    }
  }
  // and the foot of the band tied down into the sill under each mullion
  for (const sx of [-1, 0, 1])
    lead(win.x + sx * sides, bb, win.x + sx * sides, B, F.bar * .8);

  /* The balustrade, outside. A window this tall is a door that nobody walks
     through, and this is what the French put across it. */
  if (win.rail) {
    const rail = new THREE.Group();
    rail.position.z = -.14;
    carrier.add(rail);
    const top = win.sill + win.rail;
    stick(rail, win.w + .16, .045, .045, win.x, top, 0, ironMat);
    stick(rail, win.w + .1, .03, .03, win.x, top - .07, 0, ironMat);
    stick(rail, win.w + .1, .03, .03, win.x, win.sill + .06, 0, ironMat);
    const bars = Math.max(6, Math.round(win.w / .17));
    for (let i = 0; i <= bars; i++) {
      const x = win.x - win.w / 2 + (win.w / bars) * i;
      stick(rail, .022, win.rail - .1, .022, x, win.sill + win.rail / 2 - .02, 0, ironMat);
      // a little belly in the middle of each baluster, so they are turned
      stick(rail, .045, .1, .045, x, win.sill + win.rail * .45, 0, ironMat);
    }
  }

  /* The shutters, louvered, folded back flat against the wall. They are hung
     on their hinges rather than placed, so they can be swung shut — which is
     what a room does when nobody is home. */
  const shutters = [];
  if (win.shutters) {
    const sw = win.w * .42, sh = light + rise * .55;
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(win.x + side * (win.w / 2 + .1), win.sill, -.06);
      carrier.add(hinge);
      shutters.push({hinge, side});
      const leaf = new THREE.Group();
      leaf.position.x = side * sw / 2;
      hinge.add(leaf);
      stick(leaf, .035, sh, .05, -side * (sw / 2 - .02), sh / 2, 0, frameMat);
      stick(leaf, .035, sh, .05, side * (sw / 2 - .02), sh / 2, 0, frameMat);
      stick(leaf, sw, .05, .05, 0, .03, 0, frameMat);
      stick(leaf, sw, .05, .05, 0, sh - .03, 0, frameMat);
      stick(leaf, sw, .06, .05, 0, sh * .52, 0, frameMat);
      const slats = Math.round(sh / .075);
      for (let i = 1; i < slats; i++) {
        const y = (sh / slats) * i;
        if (Math.abs(y - sh * .52) < .06) continue;
        stick(leaf, sw - .06, .05, .022, 0, y, 0, barMat, 0, -.5);
      }
    }
  }
  /* Open, or shut. 0 is flat against the wall, 1 is closed over the glass —
     the room saying that nobody has started anything yet. */
  const shutter = (t) => shutters.forEach(({hinge, side}) =>
    hinge.rotation.y = side * (Math.PI / 2) * (1 - Math.min(Math.max(t, 0), 1)));
  shutter(0);

  /* The night outside, seen through the opening.

     No stars, and the weather is the reason: it is raining down this glass,
     and rain means cloud, and cloud means there is nothing up there to see.
     They were drawn anyway — ninety of them, most too faint to count — and
     the eye still caught the contradiction before it could name it.

     What is left is the thing stars were standing in for, which is depth: a
     sky that goes dark overhead and lifts towards the ground, because that is
     where the city is and a city under cloud lights the underside of it. The
     wash of cloud has no edge anywhere, so nothing in the pane is legible and
     all of it is far away. */
  const sky = keep(paint(512, (g, px) => {
    const grad = g.createLinearGradient(0, 0, 0, px);
    grad.addColorStop(0, '#120c22');            // overhead, and nearly nothing
    grad.addColorStop(.38, '#1a1233');
    grad.addColorStop(.74, '#2a1d4d');
    grad.addColorStop(1, '#3d2a63');            // the city, under all of it
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);

    // Cloud: three wide, soft, barely-there bands. No edge anywhere.
    for (const [cy, r, a] of [[px * .30, px * .55, .07],
                              [px * .58, px * .70, .06],
                              [px * .86, px * .60, .10]]) {
      const c = g.createRadialGradient(px * .5, cy, 0, px * .5, cy, r);
      c.addColorStop(0, `rgba(150,132,196,${a})`);
      c.addColorStop(1, 'rgba(150,132,196,0)');
      g.fillStyle = c;
      g.fillRect(0, 0, px, px);
    }
    // And the glow of somewhere else, along the bottom.
    const low = g.createLinearGradient(0, px, 0, px * .55);
    low.addColorStop(0, 'rgba(214,150,110,.22)');
    low.addColorStop(1, 'rgba(214,150,110,0)');
    g.fillStyle = low;
    g.fillRect(0, 0, px, px);
  }));
  /* The night is cut to the opening rather than hung behind it.

     It used to be a plane a little larger than the hole, which was fine while
     the wall was solid — the wall hid the overlap. The wall fades now, so
     anything behind it shows through, and a rectangle of sky was appearing
     across the panelling and as a bright line under the sill. So the sky is
     the shape of the hole, and there is no overlap to show. */
  const pane_sky = new THREE.Shape();
  pane_sky.curves = opening(win.w, win.h, win.sill, win.x, win.arch, win.head).curves;
  const nightGeo = keep(new THREE.ShapeGeometry(pane_sky, 20));
  // A shape's uvs are its own coordinates, so the sky is placed by hand.
  const skyMap = sky;
  skyMap.repeat.set(1 / win.w, 1 / win.h);
  skyMap.offset.set(.5 - win.x / win.w, -win.sill / win.h);
  const night = new THREE.Mesh(
    nightGeo, keep(new THREE.MeshBasicMaterial({map: skyMap, fog: false})));
  // Set at the back of the reveal, so you look through the thickness of the
  // wall to it rather than at a pane hung on the front of one.
  night.position.z = -((S.thick ?? .22) - .015);
  carrier.add(night);

  /* ---- weather -----------------------------------------------------------
     Rain, if the window asks for it: `rain` on the portal, 0 to 1.

     Two sheets of it, at different sizes and different speeds, which is the
     whole trick — one layer of streaks is a screensaver and two is distance.
     The far one is small, faint and slow; the near one is longer, brighter
     and quicker, and between them the eye invents the space they are falling
     through.

     Nothing is redrawn. The streaks are painted once and the sheets are moved
     by sliding the texture along itself, so weather costs two numbers a
     frame. It slides along its own slant rather than straight down, so the
     rain falls the way it is drawn instead of shearing sideways through it.

     It decides nothing and remembers nothing — the same standing as the moon.
  ---------------------------------------------------------------------------*/
  const wet = Math.min(Math.max(+(win.rain || 0), 0), 1);
  const sheets = [];
  if (wet > 0) {
    /* Straight down, along the window's own verticals rather than across
       them. Rain drawn on a slant is what rain looks like out of doors, and
       through a window it reads as rain that has nothing to do with the
       window: the glazing bars are the strongest lines on that glass and
       anything crossing them at an angle argues with them. Falling parallel
       to them, it belongs to the window. */
    const SLANT = 0;
    const drops = (px, n, len, wide, alpha) => keep(paint(px, (g, size) => {
      g.clearRect(0, 0, size, size);
      g.lineCap = 'round';
      let seed = 4;
      const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < n; i++) {
        const x = next() * size, y = next() * size;
        const l = size * len * (.55 + next() * .9);
        const a = alpha * (.35 + next() * .65);
        g.strokeStyle = `rgba(232,238,255,${a})`;
        g.lineWidth = wide;
        // Twice, a whole tile apart, so the streak that runs off the bottom
        // is the same streak arriving at the top. Without it the seam is a
        // line of chopped rain crossing the window once a second.
        for (const dy of [0, -size, size]) {
          g.beginPath();
          g.moveTo(x, y + dy);
          g.lineTo(x + l * SLANT, y + dy + l);
          g.stroke();
        }
      }
    }));
    const sheet = (tex, repeat, z, opacity) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat / win.w, repeat / win.h);
      const m = new THREE.Mesh(nightGeo, keep(new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      })));
      m.position.z = night.position.z + z;
      carrier.add(m);
      return tex;
    };
    sheets.push(
      // far: fine, dim, and slow enough to sit behind the other
      {tex: sheet(drops(256, 100, .08, 1, .4), 2.8, .006, .17 * wet), rate: .26, slant: SLANT},
      /* near: longer, brighter, quicker — and fewer of them than reads right
         in a still. Rain is legible because it moves; painted thick enough to
         look like rain in a photograph it looks like a screensaver in the
         room, and it is competing with the one thing on that glass anybody is
         actually reading. */
      /* Slow. Rain at the speed rain actually falls is a smear at this
         scale, and the two sheets only read as depth if the eye has time to
         notice that one is behind the other. */
      {tex: sheet(drops(256, 32, .15, 1.4, .6), 1.35, .012, .2 * wet), rate: .5, slant: SLANT},
    );
  }

  /* What is left for the conversation: the square part of the opening, sill
     to springing, since the fanlight above the transom is not a pane anybody
     would write on. Flush with the joinery — the page runs to the inside
     faces of the frame, so the scrolling area meets the trim rather than
     floating with a rim of nothing around it. What keeps the words off the
     glazing bars is the page's own padding, which is type, and scrolls with
     them. `read` lifts its foot if a room wants the bottom kept clear. */
  const inset = F.stile;
  const foot = win.sill + inset + light * (win.read || 0);
  const head = springing - inset;
  return {
    read: {x: win.x, y: (foot + head) / 2, w: win.w - inset * 2, h: head - foot, z: .04},
    shutter,
    // Weather, on the room's own clock. Absolute rather than incremental, so
    // a dropped frame or a tab left in the background does not leave the rain
    // somewhere it should not be.
    tick: sheets.length ? (t) => {
      for (const s of sheets) {
        /* Downwards, which is the other sign. Sliding a texture's offset up
           moves what you see of it *down* — the offset shifts where the
           lookup happens, not where the picture goes — so the negative that
           reads correctly in the source had the rain falling towards the
           ceiling for a day. Along the slant on x, for the same reason. */
        s.tex.offset.y = t * s.rate;
        s.tex.offset.x = t * s.rate * s.slant;
      }
    } : null,
  };
}
glazing.pierce = true;                 // a window is a hole in a wall

/* ---- a bay of shelving ---------------------------------------------------
   For a room where the conversation is not outside but in: a bookcase built
   against the wall, and one bay of it left empty at reading height. Uprights,
   shelves between them, and books — drawn rather than modeled, since a book
   at this distance is a colored edge and nothing else.

   The portal is one bay of it. `clear` says what happens to that bay: cleared
   out, so the conversation stands in a gap in the stacks — or left exactly as
   full as the rest, and then the words are thrown across the spines like a
   picture on a rough wall, which is what this room does.
--------------------------------------------------------------------------*/
export function shelves(fit) {
  const {THREE, keep, carrier, S, P, portal: sh, paint, stick, pierce} = fit;

  const F = {stile: .06, depth: .42, ...(sh.frame || {})};
  const woodMat = keep(new THREE.MeshStandardMaterial(
    {color: P.accent, roughness: .62, metalness: .12}));
  const darkMat = keep(new THREE.MeshStandardMaterial(
    {color: P.void, roughness: 1, metalness: 0}));

  /* How far the case runs along the wall, and how tall. The bays are the
     case's own business — a bay is a bay wide whatever is happening in front
     of it — and the case is centered on the portal and runs `runs` of them.
     What is above and below the portal is measured from the portal, since
     that is the part anybody is looking at. */
  const bayW = sh.bay ?? (sh.w + F.stile * 2);
  const runs = sh.runs ?? 3;
  const from = sh.x - bayW * runs / 2;
  const foot = sh.sill - (sh.under ?? 1.15);           // the case starts lower
  const top = sh.sill + sh.h + (sh.over ?? 1.4);       // and goes on above
  const D = F.depth;

  /* The back of it, and the plinth it stands on. If the wall behind has been
     cut through, the back is built in four pieces around the gap instead of
     one across the lot — the whole point of that room is that the bay the
     conversation is in opens onto nothing. */
  /* The case stands against the wall and in front of it — its back is
     on the wall face and everything else comes towards you. */
  const backTo = .02;
  if (pierce) {
    const l = sh.x - bayW / 2, r = sh.x + bayW / 2;
    stick(carrier, l - from, top - foot, .04, (from + l) / 2, (foot + top) / 2, backTo, darkMat);
    stick(carrier, from + bayW * runs - r, top - foot, .04,
          (r + from + bayW * runs) / 2, (foot + top) / 2, backTo, darkMat);
    stick(carrier, bayW, sh.sill - foot, .04, sh.x, (foot + sh.sill) / 2, backTo, darkMat);
    stick(carrier, bayW, top - (sh.sill + sh.h), .04, sh.x,
          (top + sh.sill + sh.h) / 2, backTo, darkMat);
  } else {
    stick(carrier, bayW * runs, top - foot, .04, from + bayW * runs / 2,
          (foot + top) / 2, backTo, darkMat);
  }
  stick(carrier, bayW * runs + .1, .22, D + .06, from + bayW * runs / 2,
        foot + .11, D / 2 + .03, woodMat);

  // The uprights, one between each pair of bays and one at either end.
  for (let i = 0; i <= runs; i++) {
    stick(carrier, F.stile, top - foot, D, from + bayW * i, (foot + top) / 2,
          D / 2, woodMat);
  }
  // A cornice, stepped: the case is deco too, whatever is on it.
  stick(carrier, bayW * runs + .16, .07, D + .1, from + bayW * runs / 2, top + .04, D / 2 + .05, woodMat);
  stick(carrier, bayW * runs + .08, .06, D + .04, from + bayW * runs / 2, top + .11, D / 2 - .02, woodMat);

  /* The books: a strip of colored edges, drawn once and repeated. Heights
     and colors wander, because a shelf of books that repeats reads as
     wallpaper — which is what it would be if it did. */
  const spines = keep(paint(512, (g, px) => {
    g.clearRect(0, 0, px, px);
    let x = 0, seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    while (x < px) {
      const w = 6 + next() * 16, tall = px * (.66 + next() * .3);
      const warm = next();
      g.fillStyle = `rgba(${Math.round(120 + warm * 110)},${Math.round(70 + warm * 60)},${Math.round(48 + next() * 50)},${.5 + next() * .4})`;
      g.fillRect(x, px - tall, w - 1.5, tall);
      if (next() > .6) {                       // a band of tooling on the spine
        g.fillStyle = 'rgba(240,220,170,.5)';
        g.fillRect(x, px - tall * .82, w - 1.5, 1.5);
      }
      x += w;
    }
  }));

  /* The shelves themselves, and what stands on them. The bay the words are in
     is skipped: it is the one that was cleared. */
  const rows = sh.rows ?? .62;                     // how far apart the shelves are
  for (let i = 0; i < runs; i++) {
    const bx = from + bayW * (i + .5);
    const mine = Math.abs(bx - sh.x) < bayW * .5;   // the one to be cleared
    let y = foot + .22;
    while (y < top - .1) {
      const cleared = mine && (sh.clear !== false)
        && y > sh.sill - rows && y < sh.sill + sh.h;
      if (!cleared) {
        stick(carrier, bayW - F.stile, .035, D - .04, bx, y, D / 2 - .02, woodMat);
        // and a row of books on it, unless the shelf was left bare
        if (y > foot + .3 && (i + Math.round(y * 3)) % 5) {
          const wide = (bayW - F.stile) * (.62 + ((i * 3 + Math.round(y * 7)) % 5) * .07);
          const t = keep(spines.clone());
          t.needsUpdate = true;
          t.repeat.set(wide / .5, 1);
          const m = new THREE.Mesh(
            keep(new THREE.BoxGeometry(wide, rows * .78, D * .62)),
            [keep(new THREE.MeshStandardMaterial({color: 0x241a14, roughness: .95})),
             keep(new THREE.MeshStandardMaterial({color: 0x241a14, roughness: .95})),
             keep(new THREE.MeshStandardMaterial({color: 0x241a14, roughness: .95})),
             keep(new THREE.MeshStandardMaterial({color: 0x241a14, roughness: .95})),
             keep(new THREE.MeshStandardMaterial({map: t, roughness: .9, metalness: 0})),
             keep(new THREE.MeshStandardMaterial({color: 0x241a14, roughness: .95}))]);
          m.position.set(bx - (bayW - F.stile - wide) / 2, y + rows * .39 + .02, D / 2 - .04);
          m.castShadow = true;
          m.receiveShadow = true;
          carrier.add(m);
        }
      }
      y += rows;
    }
  }

  // A shelf under the bay the conversation is in, if it was cleared for it.
  if (sh.clear !== false) {
    stick(carrier, bayW - F.stile, .04, D - .04, sh.x, sh.sill - .03, D / 2 - .02, woodMat);
  }

  /* What is left for the words. A cleared bay leaves them standing in the
     gap, back where the shelf would have been; a full one leaves them on the
     face of the books, which is what `z` is doing here — the spines stand
     that far proud of the wall. */
  const face = sh.clear === false ? D / 2 - .04 + D * .31 + .01 : .12;
  return {read: {x: sh.x, y: sh.sill + sh.h / 2, w: sh.w, h: sh.h, z: face}};
}
shelves.pierce = false;             // a case stands against a wall, not in it

export default {glazing, shelves};
