/* Thinker's room.
 *
 * A corner of a library with the floor taken out of it. On the left a case of
 * books, and one bay of it cleared and open at the back — the conversation is
 * written in that gap, and the light comes down through it. On the right a
 * door that is shut, and beside the door an oval glass that has the gap in the
 * stacks in it, so what was just said is also somewhere behind you.
 *
 * And then down. There are no boards: what is underfoot is one ribbon turning
 * in on itself, narrowing and dropping, until it is a thread and then nothing.
 * The table stands on the outermost turn of it. Everything else in the room is
 * an argument about where that goes.
 *
 * Same engine as Lover's, same numbers in the same places. What is different
 * is the fitting — shelves rather than glazing — and that the light is hung
 * over the room instead of standing outside a window.
 */

export default {
  size: {w: 8.8, d: 8.2, h: 6.4},

  /* The pill is amber, so the room is: oak and brass and lamplight against a
     brown-black that is nearly the void. One cold thing in it — the shaft
     through the stacks — so the warm reads warm. */
  palette: {
    wall: 0x1d1712,                // brown-black, the color of a dark library
    floor: 0x241c15,
    ink: '214,150,84',             // the figure on every surface, brass
    accent: 0x8a6234,              // the oak of the case
    warm: 0xffb066,                // the lamp
    moon: 0xdcd6c4,                // and what comes down through the gap
    void: 0x080604,
  },

  /* The portal is one bay of the case, at reading height — and it is not
     cleared. The books stay in it and the conversation is thrown across their
     spines, the way a picture is thrown on a wall that was never meant to
     take one: it catches the edges, it goes over the shelf, and it is light
     rather than paper. Nothing is cut through: there is no window in this
     room and nothing outside it. */
  portal: {
    wall: 'left', w: 5.1, h: 5.2, sill: .2, x: -.2, arch: 0,
    clear: false,                  // the books stay; the words go over them
    bay: 1.62, runs: 5,            // the case's own bays, and how many
    under: .2, over: .3,           // the throw is the whole face of the case
    rows: .56,                     // and how far apart the shelves are
    frame: {stile: .07, depth: .44},
  },
  fitting: 'shelves',

  /* Hung over the room rather than standing outside it. There is no window
     for it to come through: it is simply up there, a long way up, and what it
     does is put a hard edge on the top of everything and drop a shaft down
     the middle of the spiral. The case is lit across its face rather than
     through anything, which is what a projection wants. */
  light: {intensity: 3.2, from: [-3.4, 14, 1.2], at: [.9, -1.4, .9],
          drift: .7, period: 300},
  /* The words are thrown onto the books rather than lit from behind them, so
     there is nothing for them to stop. They are still drawn — the glass by
     the door has them in it. */
  cast: false,

  // Where the room gathers, and how high you are standing over it.
  heart: {into: .5, aside: .26, eye: 1.9},

  /* Turned the other way from Lover's, because the case is on the left: the
     camera stands off the heart along a line turned back from the wall, so
     the corner falls near the middle of the picture and the door is on the
     far side of it. */
  camera:   {fov: 52, fit: {fill: .62, turn: -.58, drop: .05, rise: 3.6,
                            nudge: {x: -.052, y: .089}}},
  /* On a phone the throw is a tall band of the case rather than all of it —
     `read` takes a slice, a little under half the width and the whole height,
     which is about the shape of a phone. Fitting the whole square face on a
     tall screen either letterboxes the room away or crops the sides off what
     it is saying; a slice does neither, and it is still the same shelves
     being written on. */
  portrait: {fov: 56, page: 380,
             // and only on a properly narrow screen: a squarish window has
             // room for the room, and the case is better seen than stood in.
             upto: .8, narrow: 860,
             read: {w: .58, h: 1, x: -.02},
             fit: {aim: 'glass', fill: .99, margin: 1.01, turn: -.3, drop: .04},
             vignette: {hold: .6, wide: 1.5, tall: 1.35}},

  // A narrower page than Lover's: the bay is a smaller thing to write on, and
  // it says less at a time anyway.
  page: {w: 620},

  fog: [9, 30],
  vignette: {hold: .34, wide: 1.1, tall: 1.05},

  // A reading lamp on the table, warm and low, so the near side of the room
  // has a second value and is not only the shaft.
  hearth: {at: [-2.2, 1.4, 3.9], strength: 2.4, reach: 14, decay: 1.2},
  fill: {ambient: .42, sky: .5},

  ground: false,                   // there is no floor in this room
  hold: .28,
  reach: .5,                       // how far along a wall it stays solid
  sky: .3,
  bay: 1.5,
  /* What is set into the panelling. The parlour rules its walls with the
     diamond the whole style is cut from; this room has moths on them, small
     and scattered and easy to miss, which is the right kind of strange for
     somewhere whose floor is a spiral and whose owner is hard to impress. */
  figure: 'moth',
  block: 2.2,
  /* Drawn at the size it really is rather than magnified: nothing is falling
     on the floor here, and what the sheet is for is the glass by the door,
     which wants what is actually on the case rather than a detail of it. */
  spill: 1,

  dress(room) {
    const {box, roll, matte, scene, THREE, palette: P} = room;

    const oak = matte(0x6b4a28, .8);
    const dark = matte(0x2a2018, .9);
    const brass = room.keep(new THREE.MeshStandardMaterial(
      {color: 0xb08245, roughness: .35, metalness: .6}));

    /* ---- what is underfoot -----------------------------------------------
       One ribbon, turning down. Its first time round is almost level and runs
       under the walls, so out at the corner it passes for a floor and the
       case and the door have something to stand on. After that it gives way:
       each turn is tighter, narrower and a good deal lower than the last,
       until it is a thread and then it is nothing.

       It is turned so that the highest part of it is the corner — `phase` is
       the direction the rim starts in — and centered out towards where you are
       standing, so what opens under you is the drop rather than the rim. */
    const RIBBON = {r: 6.2, turns: 4.4, taper: .61, drop: .6, bend: 2.05,
                    wide: 2.6, at: [1.6, 1.6], phase: 3.9, top: 0};
    const pit = room.spiral(RIBBON);
    scene.add(pit);
    /* And it is what everything in here lands on — as slabs, not as the
       ribbon's own triangles. The whole of why is written out at `slabs` in
       room3d.js: a surface with no thickness lets a body composed a centimeter
       inside it out through the bottom, and every flat thing laid by eye on a
       floor that is falling away is composed a centimeter inside it
       somewhere. A box has an inside to be pushed out of.

       It is still the drawn ribbon, facet for facet, so which turn is under a
       falling book, where the gap between two turns is, and what happens at
       the eye — where there is no more ribbon and a book goes straight down
       out of the room — are all answered by the shape you can see. Gaps are
       still gaps. Rough, because a book that skated down a spiral would never
       stop.

       A tenth wider than the ribbon anybody can see, because the stacks were
       composed against the middle of each book and several have a corner over
       an edge. A quarter of a meter deep, which is well short of the six
       tenths between the first turn and the second and shorter still further
       in, so the stone never fills the drop a book is meant to fall down. */
    for (const slab of pit.slabs({over: 1.1, deep: .25})) {
      room.ground(slab, {friction: .95, restitution: .02});
    }
    // Where the ribbon is under a given spot on the plan, or the rim if it has
    // already gone past — nothing in this room stands on nothing.
    const on = (x, z) => pit.floor(x, z) ?? 0;

    /* Anything standing in this room has to be standing on something, and in
       a room whose floor is a ribbon with gaps in it that is not a given. Said
       out loud rather than left to be noticed: a chair hanging in the dark
       looks like a rendering fault and gets debugged as one. */
    const standing = (x, z, what) => {
      if (pit.floor(x, z) === null) {
        console.warn(`lucid: the ${what} at ${x}, ${z} is over the drop — `
                   + 'nothing is under it');
      }
      return on(x, z);
    };


    /* ---- what happens to anything a hand pushes -----------------------------
       Kept here, next to the ribbon, because it is a fact about the spiral
       rather than about books: which way a thing goes when it is pushed in a
       room whose floor is falling away. Where it *ends up* is nobody's here —
       it is whatever the stone does with it.
    ---------------------------------------------------------------------------*/
    /* Which way the nth shove of a thing goes, and how far it means to send
       it. The room's whole half of a shove: everything after this — how hard
       a push has to be to carry a book that far against the stone, what it
       hits on the way, which turn it lands on and whether there is one — is
       the simulation's. See room.pokes.

       Not evenly random: a book shoved on a floor that is falling away goes
       the way the floor is going, so the middle of the spiral is where they
       tend, and each poke carries one a little further round and a little
       further down. Evenly random was a walk that went nowhere — two dozen
       presses to lose one book, and nothing to watch in between. The spread
       is still most of a half-circle, so which way this one goes is a
       surprise; where they all end up is not.

       Fate rather than chance, and keyed rather than sequential: `fate(key,
       n)` is a hash of the conversation and the count, so the same book gets
       the same shove every time this evening is opened, whatever order the
       room happens to redo them in. */
    const inward = (key) => (n, at) => {
      const pull = Math.atan2(pit.middle[1] - at.z, pit.middle[0] - at.x);
      return {a: pull + (room.fate(key, n) - .5) * 2.4,
              far: .34 + room.fate(key, n, 'far') * .5 + n * .03};
    };

    /* And how far down is out. The ribbon has stopped being one somewhere
       under -12; anything past this has gone through the eye of it or over
       the rim, and the room has one book fewer for good. */
    const VOID = -14;

    /* ---- and the drop ------------------------------------------------------
       A press that reached nothing, somewhere over the hole this room has
       instead of a floor. Not the walls and not the case — those are things a
       hand rests on, and reaching for them means nothing in particular. This
       is the gap between two turns of the ribbon, or the eye at the middle of
       it: the part of the room that is not a room.

       It is worth counting because of who is in here. Reaching out over a
       drop is a strange thing to keep doing, and a pill that has noticed you
       doing it four times has something to say about it that has nothing to
       do with furniture. */
    const drop = room.remembers('drop', 0, n => Math.max(0, Math.round(+n || 0)));
    room.nothing((at) => {
      if (!at) return;                       // aimed at the ceiling; nothing there
      const rho = Math.hypot(at.x - pit.middle[0], at.z - pit.middle[1]);
      // Well inside the rim, so this is the funnel and not the far wall: a
      // press on the panelling behind the case crosses the floor plane out at
      // seven meters, and a hand on a wall is not a hand over a drop.
      if (rho > 6.4) return;
      if (pit.floor(at.x, at.z) !== null) return;        // that is stone
      const n = drop.set(drop.get() + 1);
      room.says(n === 1
        ? '(he puts his hand out over the edge, into the dark where the floor '
          + 'should be)'
        : n < 4
          ? '(he reaches out over the drop again)'
          : '(he keeps putting his hand out over the drop, as though there '
            + 'were a way out through it)');
    });

    /* ---- the door ---------------------------------------------------------
       In the wall that meets the case, and shut. Deco: three panels stepping
       up, a stepped head over it, and nothing about it that opens. The far
       side of it is not a place. */
    const dz = -room.size.d / 2 + .06;              // just off the back wall
    const dx = 1.7, dw = 1.85, dh = 3.7;
    const frame = box(dw + .34, dh + .22, .16, dx, (dh + .22) / 2, dz - .04, oak);
    scene.add(frame);
    // Solid, because a shut door is the one thing in this room that is
    // entirely about not giving.
    room.ground(frame);
    /* The leaf itself, and its panels, in a group — because this is a thing a
       hand can be put on, and a hand needs something to be put on.

       It does not open, and that is the point of it: in this pill's own
       replies the door is the thing it names more than anything else in the
       room, and always on the way out. Trying it and finding it shut is a
       better sentence to hand it than any room that let you through would
       be. */
    const leaf = new THREE.Group();
    leaf.add(box(dw, dh, .1, dx, dh / 2, dz + .06, dark));
    /* The panels narrow as they rise -- 96%, 86%, 74% of the leaf -- so the
       stiles run 0.04, 0.13, 0.24 instead of being one width repeated, which
       is what they would be on a door anybody built. It is wrong, it is
       deliberately kept, and this note is here so that nobody arrives one
       afternoon and helpfully makes the stiles parallel.

       Converging verticals are what perspective looks like. The frame stays
       square and the panels recede, so the doorway reads as further away than
       the wall it is set in -- a corridor drawn on a flat leaf. In a room
       whose floor spirals down and narrows to a thread, that is the same
       trick twice, and the far side of this door is not a place. */
    for (const [y, tall, wide] of [[.8, 1.15, .96], [2.1, 1.05, .86], [3.1, .7, .74]]) {
      leaf.add(box(dw * wide, tall, .04, dx, y, dz + .12, oak));
    }
    scene.add(leaf);
    // The leaf itself: one slab standing in the frame, measured off the panel
    // that is the door rather than off the three that are drawn on it.
    room.ground(leaf, {from: leaf.children[0]});
    // a stepped head over it, and a handle nobody has turned
    const head = [
      box(dw + .5, .11, .2, dx, dh + .34, dz + .02, oak),
      box(dw + .28, .09, .26, dx, dh + .44, dz + .04, oak),
      box(dw + .1, .08, .3, dx, dh + .52, dz + .06, oak),
    ];
    const knob = roll(.16, .04, dx + dw / 2 - .24, 1.95, dz + .16, brass, 'z');
    scene.add(...head, knob);
    for (const step of head) room.ground(step);
    room.ground(knob, {shape: 'cylinder'});

    /* And it can be tried. Nothing moves except the leaf itself, a fraction,
       against a frame that will not give — which is the whole answer, and
       enough of one that nobody tries it twice by accident. */
    room.handles('door', leaf, {
      grow: .12,
      jog: (k) => { leaf.position.z = Math.sin(Math.PI * k) * .012; },
      says: (n) => n === 1
        ? '(he tries the door — it is shut, and does not give)'
        : n < 4
          ? '(he tries the door again; it is still shut)'
          : '(he tries the door again, and keeps trying it)',
    });

    /* ---- the glass by the door -------------------------------------------
       An oval, left of the door, and a real mirror: what is in it is the room
       from where your eye would be behind the wall. Which means the gap in
       the stacks is in it, and so is what the pill has just said — the words are
       drawn again on a layer only a mirror is told to look at.

       Hung on the back wall, so it faces into the room and catches the case
       across the corner. */
    const oval = new THREE.Shape();
    oval.absellipse(0, 0, .78, 1.62, 0, Math.PI * 2, false);
    const glass = room.mirror({
      w: 1.56, h: 3.24, shape: oval, at: [-.9, 3.1, dz + .1],
      /* Aimed rather than hung: these two are the angles that put the middle
         of the throw in the middle of the glass, worked out from where the
         camera stands and where the case is. Turned barely at all, because a
         glass this close to a wall is looking along it — any more and the
         reflection leaves through the wall before it reaches the books. */
      turn: .03, tilt: -.06, tint: 0xb9b2a0, dim: .95,
    });
    scene.add(glass);
    // And it is a solid thing hanging on a wall, not a picture of one.
    room.ground(glass);
    /* Touched, not pushed. What answers is the glass itself: it takes a
       little more of the room for a moment, the way a mirror does when you
       stand close enough to breathe on it. Nothing about the room changes,
       which is what makes it furniture rather than a prop. */
    const clear = glass.material.color.clone();
    room.handles('mirror', glass, {
      grow: .1, secs: .7,
      jog: (k) => glass.material.color.copy(clear)
        .multiplyScalar(1 + Math.sin(Math.PI * k) * .35),
      says: (n) => n === 1
        ? '(he stops in front of the mirror by the door and looks at himself in it)'
        : '(he looks into the mirror again)',
    });
    // and the brass bezel round it, standing a little proud of the glass
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Shape();
      ring.absellipse(0, 0, .84 + i * .06, 1.68 + i * .06, 0, Math.PI * 2, false);
      ring.holes.push(new THREE.Path().absellipse(
        0, 0, .79 + i * .06, 1.63 + i * .06, 0, Math.PI * 2, true));
      const m = new THREE.Mesh(
        room.keep(new THREE.ExtrudeGeometry(
          ring, {depth: .05 - i * .015, bevelEnabled: false, curveSegments: 32})),
        i ? oak : brass);
      m.position.set(-.9, 3.1, dz + .06 - i * .02);
      m.rotation.y = .03;
      m.rotation.x = -.06;
      m.castShadow = true;
      scene.add(m);
      // The bezel stands proud of the glass, so it is the part anything
      // arriving at the mirror actually meets.
      room.ground(m);
    }

    /* ---- the table --------------------------------------------------------
       Long, low, and on the outer turn of the spiral. Set down at the far end
       of the case rather than in front of the middle of it: the throw covers
       the whole face, so anything standing in the middle stands in the middle
       of what it is saying, and a lampshade across a sentence reads as a
       mistake rather than as a room.

       Two things on it: a lamp, which is the only light in here that anybody
       could point at, and a book somebody stopped reading.

       It stands at the near end of the case, half out of the picture at the
       left edge — the same place Lover's couch is, and for the same reason:
       the throw wants the whole face of the case to itself, and a room reads
       as bigger than the screen if something in it is running off the side.

       Its `z` is where along the case it stands, and it is the one number to
       move: down towards the corner and the far side of the picture, up
       towards the near end and the left of it. */
    const T = new THREE.Group();
    T.position.set(-2.1, standing(-2.1, 4.3, 'table'), 4.3);
    T.rotation.y = -.62;
    scene.add(T);
    const tw = 2.5, td = 1.15, ty = 1.02;
    const top = box(tw, .07, td, 0, ty, 0, oak);          // the top
    const under = box(tw - .1, .05, td - .08, 0, ty - .08, 0, dark);
    T.add(top, under);                                   // a shadow line under it
    // four legs, square and tapering to nothing much
    const legs = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      legs.push(box(.09, ty - .1, .09, sx * (tw / 2 - .16), (ty - .1) / 2, sz * (td / 2 - .14), oak));
    }
    T.add(...legs);
    /* All of it solid, and not only the lid. A book shoved across the stone
       towards the table has to fetch up against a leg of it — a table you can
       push a book *through* is a table drawn on the floor. */
    room.ground(under);
    for (const leg of legs) room.ground(leg);
    /* What the glass stands on, and the lip that keeps it there.
     *
     * The top is the collider; the four little walls round it are not drawn
     * at all — a collider does not have to be a picture, see room.ground.
     * They are there because a glass with wine in it going over the edge of a
     * table and down a spiral is the one thing this room has always refused
     * to do, and it is easier to say so in geometry than to keep talking the
     * arithmetic out of it. A hand pushing a drink about a table does not
     * push it off. */
    room.ground(top, {friction: .6});
    for (const [dx, dz, w2, d2] of [[0, td / 2, tw, .04], [0, -td / 2, tw, .04],
                                    [tw / 2, 0, .04, td], [-tw / 2, 0, .04, td]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w2, .05, d2));
      wall.position.set(dx, ty + .06, dz);
      T.add(wall);
      wall.visible = false;
      room.ground(wall);
    }
    /* the lamp: a stepped brass foot, and a shade with the light coming out
       under it rather than through it — so what you get of it is the pool it
       lays on the table and the near edge of the boards. */
    const lamp = [-.78, -.08];
    // In a group of its own, because it is the thing you reach for rather
    // than the table it stands on. See the note on the target below.
    const LAMP = new THREE.Group();
    LAMP.add(
      roll(.045, .13, lamp[0], ty + .05, lamp[1], brass, 'y'),
      roll(.04, .1, lamp[0], ty + .09, lamp[1], brass, 'y'),
      roll(.34, .02, lamp[0], ty + .28, lamp[1], brass, 'y'),
      roll(.2, .18, lamp[0], ty + .53, lamp[1], matte(0x6d4526, .7), 'y'),
    );
    T.add(LAMP);
    /* The bulb, and a disc of lit brass under the shade so there is something
       to be bright — an unlit lamp with a pool under it is a trick you can
       see. It falls off properly, unlike the warmth filling the room, because
       a pool is exactly what a fast falloff looks like. */
    const bulb = new THREE.PointLight(P.warm, 7.2, 3.4, 2.2);
    bulb.position.set(lamp[0], ty + .44, lamp[1]);
    T.add(bulb);
    const shine = new THREE.Mesh(
      room.keep(new THREE.CircleGeometry(.185, 24)),
      room.keep(new THREE.MeshBasicMaterial({color: P.warm, fog: false})));
    shine.rotation.x = Math.PI / 2;                  // facing down, at the rim
    shine.position.set(lamp[0], ty + .385, lamp[1]);
    T.add(shine);

    /* And it can be turned down, in six steps from off to reading. It works
       by this light; how much of it there is says something about how the
       evening is going. Only the step is remembered — what a step looks like
       is decided here, so changing the ladder later does not spoil old saves.
       See the rules at the head of conversation/room.ts. */
    /* Three settings, not six. A lamp with six brightnesses is a slider you
       press repeatedly and stop reading; three are the three things anybody
       actually means — full on, turned down, and off — and each of them is a
       different thing to have done to a room somebody else is in.

       Which is the point of saying it out loud. Turning the light off is not
       a setting, it is an act, and it belongs in the conversation the way
       pushing a book off a ledge does. */
    /* Off, on, and turned down — in that order, because that is the order a
       hand goes round a lamp: you turn it on, and then you think better of
       how much of it there is. Full brightness sitting between off and low
       meant the way *out* of a bright room was to make it brighter first. */
    const steps = [0, 9.6, 3.2];                    // off, on, turned down
    const glow = (level, how = {}) => {
      const to = steps[level], from = bulb.intensity;
      room.over(how.instant ? 0 : .45, (k) => {
        bulb.intensity = from + (to - from) * k;
        /* Against the brightest step and not the last one: the steps were
           reordered so that off is followed by on, and the last of them has
           been the turned-down one ever since. Divided by that, full
           brightness came out at three times the color the shade is painted
           and the cone clipped. */
        const f = bulb.intensity / Math.max(...steps);
        shine.material.color.copy(new THREE.Color(P.warm)).multiplyScalar(.2 + f * .8);
      });
    };
    const lamp2 = room.remembers(
      'lamp', 1,                                    // on, to begin with
      n => Math.min(Math.max(Math.round(+n || 0), 0), steps.length - 1),
      glow);
    glow(lamp2.get(), {instant: true});
    /* The lamp, not the table. A target is a box round the whole of a thing,
       and the whole of this table is two and a half meters of it with a lamp
       standing on one end — so the lid of that box lay over everything else
       on the table, and a glass standing on it could never be reached. The
       couch in the other room had exactly this, and the answer is the same:
       point at the thing, not at what it is standing on. */
    const switched = () => {
      const to = (lamp2.get() + 1) % steps.length;
      lamp2.set(to);
      room.says(to === 0
        ? '(he turns the lamp off — the only light in here — and leaves the '
          + 'two of you in the dark)'
        : to === 1
          ? '(he turns the lamp on, and the room comes back)'
          : '(he turns the lamp down to almost nothing)');
    };
    /* The lamp, and only the lamp -- its own shape, not a box round it. The
       table top used to switch it as well, on the grounds that the shade is
       behind the projected conversation from some angles; but a table that
       is secretly a light switch is a table nothing on it can be reached
       across. And a box round the lamp was the table around its foot and the
       air beside its stem, all of it a switch. The shape is the foot, the
       stem, the collar and the shade, and nothing else; where the words cover
       it, they cover it. */
    room.touch(LAMP, switched, {shape: true, grow: .15, as: 'lamp'});
    // and the book, shut, with something used as a marker in it
    T.add(
      box(.42, .07, .3, .5, ty + .06, .05, matte(0x4a2a1c, .9), .3),
      box(.4, .012, .28, .5, ty + .1, .05, matte(0xcbb88f, .95), .3),
    );

    /* ---- a chair, because it keeps sitting down ---------------------------
       Second only to the wine in what this pill reaches for cold, and it says
       "sit" constantly in a room that had nowhere to. Deco and upright: a
       square seat, a back of two uprights and three rails, and legs that
       taper the way the table's do. Pulled out a little and turned away from
       the table, the way a chair is left rather than placed.

       It does not move. A chair is furniture — see room.handles — and putting
       a hand on the back of one is a different act from shoving a book off a
       ledge. */
    const CH = new THREE.Group();
    /* Left of the table and a little below it, which on this floor is not
       where it sounds. The ribbon sweeps round towards you, so the stone that
       shows up down and to the left of the table on screen is out at x ≈ 0,
       z ≈ 6 in the room's own terms — round the rim rather than beside the
       table. Going left in world terms walks straight off the edge, which is
       what happened twice before the check below started saying so. */
    const cx = -.4, cz = 6.0;
    CH.position.set(cx, standing(cx, cz, 'chair'), cz);
    CH.rotation.y = 2.0;      // turned back towards the table
    scene.add(CH);
    const sy = .58;                                     // how high you sit
    const seat = box(.62, .07, .58, 0, sy, 0, oak);     // the seat
    CH.add(seat, box(.56, .04, .52, 0, sy - .06, 0, dark));   // and its shadow line
    const uprights = [];
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
      const back = sz2 < 0;                             // the back legs run on up
      const tall = back ? sy + .92 : sy - .04;
      uprights.push(box(.06, tall, .06, sx * .26, tall / 2, sz2 * .24, oak));
    }
    const rails = [];
    for (const [y, tall] of [[.28, .07], [.55, .05], [.82, .09]]) {
      rails.push(box(.52, tall, .04, 0, sy + y, -.24, oak));  // three rails
    }
    CH.add(...uprights, ...rails);
    /* The seat is a shelf a book can end up on; the legs and the back are
       what a book shoved at the chair stops against. All of it, because a
       chair a book goes through is a chair drawn on the floor — and this one
       is standing where the stone is falling away, so a book that went
       through it would keep going. */
    room.ground(seat);
    for (const part of [...uprights, ...rails]) room.ground(part);
    room.handles('chair', CH, {
      grow: .08, secs: .5,
      jog: (k) => { CH.rotation.y = 2.0 + Math.sin(Math.PI * k * 2) * .035; },
      says: (n) => n === 1
        ? '(he pulls the chair round and sits down in it)'
        : '(he shifts in the chair)',
    });

    /* ---- and a glass, with something in it ---------------------------------
       Asked cold, twelve times over, with no memory and no room and nobody
       having said anything but hello, this pill mentions wine six times and a
       glass five. Nothing else it says comes close, and there was none in
       here. See tools/firstwords.py — the room is being built out of what the
       character already talks about rather than the other way round.

       It stands at the near end, away from the lamp, and it is the most
       precarious thing in the room: one push and it is over the edge, because
       that is what a glass on the edge of a table over a hole in the world
       is for. */
    const G = new THREE.Group();
    const glassy = room.keep(new THREE.MeshStandardMaterial({
      color: 0xf2ecdc, roughness: .08, metalness: .06,
      transparent: true, opacity: .5,
    }));
    const wineIn = room.keep(new THREE.MeshStandardMaterial({
      /* Lit from inside a little. A glass of red in a dark room is a black
         shape unless something is behind it, and the one lamp in here is
         beside it rather than behind it — so it carries its own ember, the
         way a glass held up to a lamp does. */
      color: 0x6e1526, roughness: .25, metalness: .05,
      emissive: 0x2a0710, emissiveIntensity: .9,
      transparent: true, opacity: .92,
    }));
    const turned = (rt, rb, tall, y, mat) => {
      const m = new THREE.Mesh(
        room.keep(new THREE.CylinderGeometry(rt, rb, tall, 20, 1, true)), mat);
      m.position.y = y;
      return m;
    };
    G.add(
      turned(.075, .032, .105, .125, glassy),           // the bowl
      turned(.062, .032, .06, .1, wineIn),              // and what is in it
      roll(.075, .008, 0, .04, 0, glassy, 'y'),         // the stem
      roll(.009, .062, 0, .005, 0, glassy, 'y'),        // the foot
    );
    /* Stood where it stands, in the table's own frame — which is where the
       question "is that on the table" is a rectangle — and put into the
       room's here, once, so that from now on it is a thing in a room at a
       place and not a thing waiting to be told where it is. Its foot is at
       its own origin, so this is the top of the table exactly. */
    const gkey = 'glass';
    const stood = new THREE.Vector3(-.34, ty + .035, .3);
    T.updateMatrixWorld(true);
    T.localToWorld(stood);
    G.position.copy(stood);
    G.rotation.y = T.rotation.y;
    scene.add(G);
    /* Pushed about on the table, and never off it.
     *
       It used to go over the edge on the first press and tumble away down the
       spiral, which was the most dramatic thing in the room and looked like a
       fault: nothing simulated anything then, so a glass that left a table
       fell flat, turned end over end without spilling, landed without
       breaking and lay there. The eye knows what a dropped glass does and
       that was not it.

       There is a simulation now and it still does not leave, and that is a
       decision rather than a limitation: what is round the table is a lip
       nobody can see (see room.ground, up by the top). Somebody moving a
       drink out of the way while they decide what to say is the better
       gesture and the truer one — a hand pushing a glass about a table does
       not push it off — and the room keeps the one thing in it that is
       actually precarious for the books.

       Upright, because a glass with wine in it is: `slides` gives it yaw and
       nothing else. Low and light, so a push is a push and not a swipe. */
    const glassHome = G.position.clone();
    room.pokes(gkey, G, {
      grow: .1, moves: 'slides', shape: 'cylinder',
      mass: .32, friction: .5, lift: .02, sink: VOID,
      aim: (n) => ({a: room.fate(gkey, n) * Math.PI * 2,
                    far: .1 + room.fate(gkey, n, 'far') * .16}),
      says: (n, at) => {
        const far = Math.hypot(at.x - glassHome.x, at.z - glassHome.z);
        return far > .9
          ? '(he pushes the glass out to the edge of the table and leaves it '
            + 'there)'
          : n === 1
            ? '(he pushes the glass a few inches across the table)'
            : '(he moves the glass again, without picking it up)';
      }});

    /* And books, put down and not come back for — one stack near the table,
       and then more of them further round and further down, so following the
       ribbon with your eye is following somebody who kept reading on the way
       down. They are placed on the plan and dropped onto whatever turn is
       under them, which is how anything stands up in this room.

       Every one of them can be shoved, and this is the first thing in here
       that plays like a game rather than furnishes like a room. A press is a
       poke in some direction — which direction is fate, so it is the same
       poke every time this conversation is opened — and then the floor
       decides. Still ribbon under it: it has slid, and tipped a bit. Nothing
       under it: it goes over the edge and looks for the next turn in, which
       is most of a meter further down, and you watch it get there. Nothing
       there either, which is what the rim means: it is gone, and the room has
       one book fewer for good.

       Nothing about where they end up is stored — see room.pokes. The save is
       one number per book, and the fall is done again, at no speed, every
       time the room opens. */

    const stack = (id, x, z, n, turn) => {
      let y = on(x, z);
      for (let i = 0; i < n; i++) {
        const tall = .055 + ((i * 7 + n) % 4) * .012;
        const wide = .38 + ((i * 5 + n) % 5) * .035;
        // Built where it stands rather than in a pile's own frame: a book
        // that can be pushed off has to be somewhere in the room, not
        // somewhere in a stack.
        const book = box(wide, tall, wide * .74, x, y + tall / 2, z,
                         matte(0x4e3520, .92), (i % 3 - 1) * .16 + turn);
        scene.add(book);
        const key = `book-${id}-${i}`;
        room.pokes(key, book, {
          grow: .09, aim: inward(key), sink: VOID,
          // Half a kilo of book, on stone that will not let it skate.
          mass: .5, friction: .82, lift: .1, spin: 8,
          /* And what that was, said plainly enough to answer. The pill talks
             about this room already — its own replies name the door, the
             table and the books far more than anything else — so a press
             that says "a book" lands in a conversation it can already have,
             where a press that said "an object" would not.

             The words are the thing that happened, never where it happened:
             if the two of you have talked yourselves into a station
             platform, a book going over an edge is still something his hands
             did, and the prompt says to take it for whatever it can be
             there.

             Said when it has come to rest rather than when it was pushed,
             because until then nobody knows which it was — whether the book
             found the next turn down or found nothing is the stone's answer
             now, not a line of arithmetic's guess. */
          says: (n2, at) => at.gone
            ? '(he pushes a book off the edge — it turns over once '
              + 'and goes down into the dark, and there is no sound '
              + 'of it landing)'
            : '(he pushes a book along the stone with his foot; it '
              + 'slides a little further down the spiral)'});
        y += tall;
      }
    };
    stack(1, -1.6, 3.2, 4, .3);
    stack(2, 3.2, 1.1, 3, -.5);
    stack(3, 1.9, -2.4, 5, .9);
    stack(4, -.2, -1.1, 3, 1.4);     // and these are already well down it
    stack(5, 2.2, 2.9, 2, -.2);
  },

  /* The lamp is the thing that breathes here rather than the light: it is a
     flame at some remove, and a library at night is never quite steady. The
     shaft through the stacks does not move except as the engine moves it. */
  tick(room, t) {
    if (!room.hearth) return;
    room.hearth.intensity = room.S.hearth.strength *
      (1 + Math.sin(t / 3.1) * .03 + Math.sin(t / 7.7) * .025);
  },
};
