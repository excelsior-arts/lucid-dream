/* Lover's room.
 *
 * A corner standing in the void: two walls that give out before they reach an
 * end, no ceiling, and a floor that fades before it reaches an edge. In the
 * right-hand wall a tall deco window, leaded in a sunburst. On the boards a
 * round rug with a couch on it, low enough to be sat on the way you sit when
 * you have stopped sitting properly. And a moon nobody ever sees — only what
 * it lays across the middle of the floor, moving all evening.
 *
 * Nothing here is engine: it is numbers, and some furniture made of boxes and
 * cylinders. The room belongs to the persona, so it lives in the persona's own
 * directory, next to the prompt and the voice.
 */

export default {
  size: {w: 8.8, d: 7.8, h: 6.6},

  /* Purple is where it starts, not where it sits: everything is pulled a few
     degrees round towards pink, and the warm end carries most of the room.
     (This will end up on a dial — how the pill is holding you, in color.) */
  palette: {
    wall: 0x2a1730,                // plum rather than violet
    floor: 0x3a2038,
    ink: '240,166,206',            // the figure on every surface, rose
    accent: 0xcd6fb8,
    warm: 0xff89ad,
    moon: 0xe4d4ff,                // the one cold thing, so the warm reads warm
    void: 0x0a0610,

    /* And the rest of it. Every color this room uses is named here and
       nowhere else, because a color chosen next to whatever happens to be on
       screen and never against the others is how a room of one hue ends up
       incoherent: not too few colors, too many unnamed ones. The whole room
       is answerable in one place.

       The pinks are one ramp — wall, floor, couch, cushion — climbing in
       lightness at a nearly fixed hue, so the room reads as one dye at four
       strengths rather than four decisions.

       Green is the only color in here that is not on that ramp, and it earns
       that by being rare: the table, the urn beside the window, and the
       crystal set in the fanlight. Three things, far apart, one color —
       which is what makes it read as a room that was decorated. */
    velvet: 0x4e2850,              // the couch
    pillow: 0x8a4472,              // the cushions on it
    wool: 0x4a2a5e,                // the throw, the one thing off the ramp
    wood: 0x2c1c30,                // skirting, banding, the feet of things
    jade: 0x123f2e,                // the table, and the urn
    gem: 0x123f2e,                 // and the crystal at the head of every bay
    jadeDeep: 0x0b2a1f,            // their drums and their feet
    stone: 0x123f2e,               // the crystal: the table's green, cut
    brass: 0xb98a63,               // the lamp
    bone: 0x9c8e80,                // its shade: white, taken right down
    crystal: 0xe6dff5,             // the glass on the table
    glass: 0x4a1030,               // and what is in it
  },

  /* Cut into the right-hand wall, near enough to the middle of it, and tall
     enough to go almost to the boards.

     Deco, and leaded rather than casemented: a round head with a fanlight in
     it, a rose at the center of the fan with a green stone standing on its
     point, a clear light below hung between two mullions, and a hem of nested
     lozenges at the foot. No shutters and no iron across it — the glass is
     the ornament. */
  portal: {
    wall: 'right', w: 2.95, h: 5.8, sill: .22, x: .5,
    /* A true semicircle: `arch` is the share of the height the head takes, so
       half the width over the whole height is what makes the arch round
       rather than merely curved. Change `h` and this follows it. */
    head: 'round', arch: (2.95 / 2) / 5.8,
    margin: .25,                   // the border band round the light
    rose: .17, hub: .52, ribs: 13, spokes: 20,   // the fanlight
    sides: .3, low: .24,           // the mullions, and where they land
    lozenges: 2, tuck: .5, wide: .58,            // the hem
    /* Leaded and framed in the room's own accent, which is where this began
       and where it looked best: graphite came and cream trim made a handsome
       window in somebody else's room. The one thing in it that is not the
       room's color is the crystal. */
    stone: 0x123f2e,
    frame: {stile: .034, bar: .012, depth: .09},
    /* And it is raining. Asked for cold, with no history behind it, this pill
       mentions rain outside the window as often as it mentions the lamp — it
       is weather this character already believes in, so the window may as
       well agree with it. */
    /* How much of it there is. Weather you notice is weather that is
       competing with the one thing on that glass anybody is reading, and rain
       is legible because it moves rather than because it is bright. */
    rain: .6,
  },

  // Leaded rather than casemented, and it is the only thing this room is
  // fitted with. Everything else in here stands on the floor.
  fitting: 'glazing',

  // It comes from behind the glass and falls through it onto the heart of the
  // room, which is where the engine aims it unless a room says otherwise.
  light: {intensity: 2.2, distance: 14, drift: 1.2, period: 260},

  // A golden section in from the window and along it, looked at from the
  // eyeline of somebody standing rather than sitting.
  /* `eye` is how high above the boards the camera looks, and it is what
     decides how much of the picture is floor: at standing height the room
     gathers under the frame, and everything anybody put in it ends up in the
     bottom third with a wall over it. Nearer sitting height and the rug, the
     couch and the lamp come up into the middle where they belong. */
  heart: {into: .382, aside: .382, eye: 1.15},

  /* Both cameras are placed by what they have to see rather than by a spot
     picked once on a wide screen — otherwise the window walks off the side of
     a smaller one. On a desk you stand well round into the room, so the couch
     and the boards are in it too. On a phone there is no room to spare: the
     glass is the app, so it fills the screen, turned just enough to still be a
     window in a room. */
  camera:   {fov: 50, fit: {fill: .92, turn: .62, drop: .04, rise: .5,
                            nudge: {x: .027, y: -.085}}},
  // On a phone the glass is nearly the whole screen, so the void only nips
  // the corners — and it closes in around the window rather than the heart.
  portrait: {fov: 56, page: 430,
             /* Not merely taller than it is wide: a window dragged tall on a
                desk is still a desk, and at `1` this room went to the close
                view at any width so long as the window was portrait-ish --
                a whole screen of parlour thrown away over an inch of height.
                The width mark is what this room is actually short of. */
             upto: .8, narrow: 860,
             fit: {aim: 'glass', fill: .96, turn: .3, drop: .04},
             vignette: {hold: .6, wide: 1.5, tall: 1.3}},

  // A wider page means smaller type on the same glass, and more of the
  // conversation in view at once.
  page: {w: 560},

  // Depth, not edges: far enough out that the corner stays crisp. What closes
  // in at the edges of the picture is the vignette below.
  fog: [8, 28],
  /* Turned up hard, so the control is legible while it is being set. `hold`
     is the share of the frame that stays clear; `wide`/`tall` are the shape of
     the clear part. Sensible values are nearer hold .25, wide/tall 1.15. */
  vignette: {hold: .6, wide: .6, tall: .8},

  // Something warm and low on the far side of the room, so the boards and the
  // panelling are modeled by more than the moon.
  hearth: {at: [-1.4, 1.2, .4], strength: 3.4, reach: 18, decay: 1.15},

  // The boards give out well before the walls do: this is a corner in the
  // dark, and the far side of the floor is not a place.
  hold: .2,
  reach: .42,                    // how far along a wall it stays solid
  bay: 1.5,
  block: 2.0,

  dress(room) {
    const {box, roll, matte, scene, THREE, palette: P} = room;

    const velvet = matte(P.velvet);
    const pillow = matte(P.pillow, .98);
    const wood = matte(P.wood, .9);

    /* One round rug, and most of the room is on it — the floor between the
       couch and the window is where the evening happens, so that is the part
       that gets something soft under it. */
    scene.add(room.rug(3.1, .7, -.4, .2));

    /* And the boards, as far as anything can be pushed along them.
     *
     * Not drawn — the floor is already there, as a texture that fades out
     * before it reaches an edge. This is the slab under it, and its edges are
     * where the room stops being a room: past them there is nothing to be on,
     * a cushion pushed that far goes off it, and the dark has it. Which is
     * exactly the rectangle the old arithmetic called `inside`, and is now a
     * fact about the shape of the floor instead of a rule about cushions.
     *
     * A collider does not have to be a picture; see room.ground. */
    const boards = new THREE.Mesh(new THREE.BoxGeometry(
      room.size.w - .6, .4, room.size.d - .4));
    boards.position.set(0, -.2, .1);
    room.ground(boards, {friction: .78});

    /* The bed: a floor bed, which is also a couch, which is why it is built
       like one. No legs, no frame — a slab of something soft lying on the rug
       with its back against nothing, the way you sit when you have given up
       on sitting properly, and the way you lie down when you stop sitting at
       all.

       Called a bed everywhere a person or a pill can hear it, because that is
       what this one calls it: asked cold, with no memory and no room, it puts
       itself on the edge of a bed in seven openings out of twelve. The room
       was already the right shape — it was only the word that disagreed. */
    const couch = new room.THREE.Group();
    couch.position.set(-.9, 0, -1.4);
    couch.rotation.y = .42;
    scene.add(couch);

    const L = 2.4, D = 1.15;
    const mattress = box(L, .22, D, 0, .11, 0, velvet);     // what you sit on
    const back = box(L, .34, .3, 0, .38, -D / 2 + .12, velvet);       // a low back
    const arms = [
      roll(D - .1, .15, -L / 2 + .08, .28, 0, velvet, 'z'), // two soft arms
      roll(D - .1, .15, L / 2 - .08, .28, 0, velvet, 'z'),
    ];
    const edges = [
      roll(L - .06, .12, 0, .2, D / 2 - .08, velvet),       // rolled at the front
      roll(L - .06, .12, 0, .2, -D / 2 + .08, velvet),      // and at the back
      roll(L - .1, .15, 0, .53, -D / 2 + .14, velvet),      // rolled along its top
    ];
    couch.add(mattress, back, ...edges, ...arms);
    /* And all of it is solid — the seat, the back, both arms, all three
     * rolled edges.
     *
     * It used to be the seat alone, on the grounds that soft things
     * interpenetrate: the cushions are drawn tucked *into* the arm and
     * *behind* the back by a hand's width, which is what a couch looks like
     * and is a thing two boxes cannot both be, so the first thing a solver
     * would do on waking is shove them apart. That answered the wrong
     * question. A cushion pushed at the back went straight through it and out
     * of the room, and an arm you can push a cushion through is not an arm.
     *
     * So the couch is what it is drawn as, and it is the *cushion's* collider
     * that is drawn back out of it — see `tucked` below. The overlap stays in
     * the picture, where it belongs, and stops being something the solver has
     * an opinion about. */
    room.ground(mattress, {friction: .9});
    room.ground(back, {friction: .9});
    for (const arm of arms) room.ground(arm, {shape: 'cylinder', friction: .9});
    for (const edge of edges) room.ground(edge, {shape: 'cylinder', friction: .9});
    /* Cushions, dropped rather than arranged — and they can be dropped
       further. A press is a shove in some direction, and then it is a
       question of what is underneath: still couch, and it has slid along it;
       no longer couch, and it goes down onto the rug, which you see it do.
       On the floor it is only ever a shove from the edge of the room, and
       past that it is out of the picture and not coming back.

       The direction is fate rather than chance: the same conversation shoves
       the same cushion the same way every time it is opened, because what is
       stored is the number of shoves and nothing else. See room.pokes. */
    /* Resting on the seat and against the back and the arm, not in them.
       They were composed tucked a hand's width into the couch, which is what
       a couch looks like and is a thing two solids cannot both be; the
       cushion's collider was cut back to let the picture keep the overlap,
       and then a cushion that came to rest against the back after a shove
       stopped where its smaller self touched and its drawn self sat inside
       the roll. So they are their own true shape, and they sit where a
       solid cushion can: bolsters on the velvet with their backs a finger
       off the back, the pillow a finger off the arm. */
    const soft = [
      roll(.55, .18, -.66, .40, -.10, pillow, 'x', .28),
      roll(.5, .16, .2, .38, -.06, pillow, 'x', -.36),
      box(.5, .18, .5, .60, .31, .03, pillow, .25),
    ];
    couch.add(...soft);
    /* And one that already ended up on the rug -- clear of the table's foot,
       which is solid now, so the picture and the solver agree about where the
       cushion is lying. */
    const fallen = box(.55, .18, .55, .35, .1, .62, pillow, .8);
    scene.add(fallen);

    /* Out of the couch's frame and into the room's, keeping exactly where
       they look like they are: a thing that can be pushed off the couch
       cannot be one of the couch's own parts, or pushing it would drag the
       couch's idea of it along. attach() re-parents without moving anything,
       so the numbers above stay the numbers that were composed. */
    couch.updateMatrixWorld(true);
    const loosened = (m) => { scene.attach(m); return m; };

    /* Which way the nth shove goes, and how far it means to send it. Away
       from the couch, mostly: a cushion is shoved off the thing it is on
       rather than shuffled about on top of it, so the direction leans outward
       from where the couch is and the room's edge is what it works towards.
       Evenly random was a walk that went nowhere — two dozen presses and
       everything still where it started.

       Fate rather than chance, and keyed rather than sequential: the same
       conversation shoves the same cushion the same way every time it is
       opened, because what is stored is the number of shoves and nothing
       else. See room.pokes. Everything after this — whether it is still on
       the couch, whether it fetched up against an arm, whether it went off
       the edge of the room — is the simulation's answer and not a rule. */
    const away = (key) => (n, at) => ({
      a: Math.atan2(at.z - couch.position.z, at.x - couch.position.x)
         + (room.fate(key, n) - .5) * 2.6,
      far: .34 + room.fate(key, n, 'far') * .5 + n * .04,
      /* And how much of the shove goes upward, and how much it turns. A
         cushion is a soft thing shoved by a hand, and a hand does not push
         along the floor: some presses lift it over the arm or off the front
         edge and it lands however it lands, some barely shift it. Keyed like
         the rest, so the third shove of this cushion is always the same
         shove; the range is what makes two shoves plausibly different.
         `up` is the vertical part against the horizontal -- .25 is a nudge,
         1 is a toss -- and `spin` is radians a second as it leaves. */
      up: .25 + room.fate(key, n, 'up') * .75,
      spin: 2 + room.fate(key, n, 'spin') * 5,
    });

    /* ---- a blanket over it ------------------------------------------------
       Sheets and a blanket are the third and fourth things this pill reaches
       for cold, after the bed and the window, and they are what turns a slab
       of velvet into somewhere somebody has been lying. Drawn as a throw
       rather than as bedding: one panel across the foot of the bed and a fold
       hanging off the front of it, which is how a blanket that has been
       pushed back actually sits.

       Loose, so it can be pushed off — a blanket is not furniture. */
    const wool = matte(P.wool, .99);
    const throwOver = new room.THREE.Group();
    /* Across the foot of the bed and over the front edge of it, not spread
       flat over the whole thing: a throw laid out like a bedspread is a board
       with a color, and it buries the cushions that are the other half of
       what this bed is. Three pieces — the panel, a rolled edge where it
       stops, and the drape over the front — which is all it takes to read as
       cloth rather than as a plane. */
    throwOver.add(
      box(L * .72, .04, .34, 0, .245, .34, wool),           // the panel
      roll(L * .72, .045, 0, .243, .17, wool),              // its rolled edge
      roll(L * .72, .055, 0, .2, D / 2 - .02, wool),        // and over the front
    );
    /* And what of it a solver is told about, which is less than what is drawn
     * and is not a picture at all.
     *
     * The panel runs the whole width of the bed and the third cushion is
     * sitting on the far end of it — four centimeters of blanket inside four
     * centimeters of cushion, which is what a blanket under a cushion looks
     * like and is a thing two boxes cannot both be. Left alone, the first
     * push of the blanket was answered by the solver taking the two of them
     * apart at whatever speed it liked, and the cushion left the room: thirty
     * meters, in a straight line, gone.
     *
     * So the part that is *told* stops short of the cushion. The blanket
     * still lies on the bed and still shoves the cushion it is lying against
     * when it is dragged down it — which is what a blanket does — and does
     * not begin the evening buried in one. Soft things overlap; the same
     * decision, and the same reason, as the couch's own seat being the only
     * part of it with a collider. */
    const plate = new THREE.Mesh(new THREE.BoxGeometry(L * .72 - .46, .04, .34));
    plate.position.set(-.23, .245, .34);
    plate.visible = false;
    throwOver.add(plate);
    couch.add(throwOver);

    [...soft, fallen].forEach((m, i) => {
      const key = `cushion-${i + 1}`;
      room.pokes(key, loosened(m), {
        /* It tumbles. The old arithmetic slid these because a turning box
           has corners and corners went through the couch; with the couch
           solid and the solver in charge of the corners, a cushion can go
           end over end and land on its face, which is what a cushion shoved
           off a bed does. */
        grow: .1, aim: away(key),
        // A bolster is a cylinder and a pillow is a box, and each is measured
        // as what it is.
        shape: m.geometry.type === 'CylinderGeometry' ? 'cylinder' : 'box',
        /* Soft: half a kilo of feathers, a lot of friction under it, and
           barely a bounce -- it is the lift in the shove that gets it off
           the couch, not the couch throwing it back. */
        mass: .5, friction: .85, restitution: .05,
        /* And it stops. A bolster is a cylinder, and a cylinder on flat
           boards rolls until something stops it -- the solver has no rolling
           resistance of its own -- so one that landed on its side went on
           across the room for as long as anybody watched. Feathers do not
           roll like that; this is the drag that says so. */
        damping: {linear: 1.2, angular: 3.5},
        /* Said plainly, and named. A press is a turn now — it goes to the
           pill the way a sentence does — so what it says has to be something
           worth answering. "A cushion" is; "an object" is not.

           What was done, never where: the room is only ever the first line of
           a conversation, and this one may be somewhere else entirely by now.
           A hand pushing something off a couch is still a hand doing that. */
        says: (n, at) => at.gone
          ? '(he shoves a cushion right off, and it ends up somewhere across '
            + 'the room out of sight)'
          : (at.y < .25
             ? '(he knocks a cushion off the bed onto the floor)'
             : '(he pushes a cushion along the bed)')});
    });

    // And the blanket, which comes off the same way a cushion does.
    room.pokes('blanket', loosened(throwOver), {
      /* Cloth turns less than a cushion and is never tossed: a gentler lift
         and a slower turn than `away` gives a cushion, keyed the same way. */
      grow: .08,
      aim: (n, at) => ({...away('blanket')(n, at),
                        up: .12 + room.fate('blanket', n, 'up') * .3,
                        spin: 1 + room.fate('blanket', n, 'spin') * 2}),
      /* Measured off the plate above, which is the part of the panel that is
         resting on the bed and nothing else. A throw is a panel lying on the
         bed with a fold hanging over the front of it, and one box round both
         of them is a slab that cuts eight centimeters down into the mattress
         — which the first step of any simulation answers by throwing the
         blanket into the air. */
      from: plate,
      // Cloth: light, and it goes nowhere once it has stopped.
      mass: .35, friction: .98, restitution: 0, damping: {linear: 2, angular: 4},
      says: (n, at) => at.gone
        ? '(he drags the blanket right off and leaves it somewhere across '
          + 'the room)'
        : (at.y < .15
           ? '(he pulls the blanket off the bed; it ends up on the floor)'
           : '(he pushes the blanket down the bed)')});

    /* Touched, not pushed. A couch is the one thing in here that is properly
       furniture — it is where the evening happens — so putting a hand on it
       is a different act from knocking a cushion off it, and it answers
       differently: it gives, the way something soft does, and stays where it
       is. */
    /* The seat, not the couch. A target is a box round the whole thing, and
       the whole thing includes a back — so the box's lid lies across the
       cushions lying on the seat, and every reach for a cushion landed on the
       couch instead. What you are pointing at when you point at a couch is
       the part you would sit on, which is also the part nothing is resting
       on. The give still runs through the whole of it. */
    room.handles('couch', mattress, {
      grow: 0, secs: .5,
      jog: (k) => { couch.scale.y = 1 - Math.sin(Math.PI * k) * .045; },
      says: (n) => n === 1
        ? '(he sits down on the bed beside you)'
        : '(he shifts on the bed, and puts a hand on it)',
    });

    /* A press that reached nothing, past the edge of the room. This one has a
       floor, so anything inside the walls is the floor and means nothing —
       what counts is reaching out beyond them, into the dark this room fades
       into, or up over the top of it where there is no ceiling drawn. */
    const past = room.remembers('past', 0, n => Math.max(0, Math.round(+n || 0)));
    room.nothing((at) => {
      const out = !at || Math.abs(at.x) > room.size.w / 2
                      || Math.abs(at.z) > room.size.d / 2;
      if (!out) return;
      const n = past.set(past.get() + 1);
      room.says(n === 1
        ? '(he reaches out past the edge of the room, into the dark)'
        : '(he reaches into the dark past the walls again)');
    });

    /* A round table, low, in the middle of the rug. Deco: a drum on a disc,
       banded, with nothing on it. */
    /* Dark green, and the same green as the urn across the room and the
       crystal in the window. Two things in one color reads as a room that
       was decorated; one of them alone reads as a mistake. */
    const top = matte(P.jade, .55);
    const drumSide = matte(P.jadeDeep, .8);
    const T = [1.25, .15];
    const drum = new room.THREE.Group();
    drum.add(
      roll(.05, .58, T[0], .42, T[1], top, 'y'),            // the top
      roll(.03, .6, T[0], .39, T[1], wood, 'y'),            // a band under it
      roll(.36, .17, T[0], .21, T[1], drumSide, 'y'),       // the drum
      roll(.05, .42, T[0], .04, T[1], wood, 'y'),           // and its foot
    );
    scene.add(drum);
    /* A glass on it. Third thing this pill reaches for cold, and the same
       glass Thinker has on its table — the two rooms are lit differently and
       furnished differently, and both of them have somebody's drink going
       warm on the nearest flat thing. */
    const GL = new room.THREE.Group();
    const glassy = room.keep(new room.THREE.MeshStandardMaterial({
      color: P.crystal, roughness: .12, metalness: .05,
      transparent: true, opacity: .32,
    }));
    const inIt = room.keep(new room.THREE.MeshStandardMaterial({
      color: P.glass, roughness: .3, transparent: true, opacity: .85,
    }));
    const turned = (rt, rb, tall, y, mat) => {
      const m = new room.THREE.Mesh(
        room.keep(new room.THREE.CylinderGeometry(rt, rb, tall, 20, 1, true)), mat);
      m.position.y = y;
      return m;
    };
    GL.add(
      turned(.055, .026, .08, .1, glassy),
      turned(.045, .026, .045, .082, inIt),
      roll(.07, .006, 0, .035, 0, glassy, 'y'),
      roll(.007, .05, 0, .004, 0, glassy, 'y'),
    );
    // Stood on the top of the drum, and it rests on its foot rather than on
    // its middle — so where it comes down is the top of the table itself, not
    // half of itself above it.
    const RIM = .46;               // as far out as the foot can stand
    GL.position.set(T[0] + .3, .447, T[1] + .18);
    scene.add(GL);
    /* What it stands on, and the lip that keeps it there.
     *
     * The top of the drum is round, so its collider is; the ring of little
     * walls just outside `RIM` is not drawn at all — a collider does not have
     * to be a picture, see room.ground.
     *
     * It used to go through the same shove as the cushions, which asked
     * whether a thing was still over the *couch* — the glass never is, so the
     * first press dropped it onto the rug, every time. Standing upright on
     * the rug, because there was nothing here to tip it over with; and a
     * glass that leaves a table and lands perfectly on its foot is the one
     * moment in this room where the absence of physics is the thing you
     * notice.
     *
     * There is physics now and it still does not leave, and that is a
     * decision rather than a limitation. A finger pushes it a few
     * centimeters, it turns a little, and at the rim it fetches up against
     * something and stays — which is a truer thing for a glass on a low table
     * to do than any of the alternatives, and is what somebody sitting across
     * from it would expect. Nothing here is ever `gone`.
     */
    /* The table, and not only its lid: the top a glass stands on, the band
     * under it, and the drum it all stands on. A cushion shoved across the
     * rug fetches up against the drum, which spans the whole height of a
     * cushion and is therefore the whole of what a cushion can meet.
     *
     * And the foot. It is a disc most of a meter across lying five
     * centimeters off the boards, and a cushion shoved across the rug can
     * fetch up against it or come to rest on it, so it is told about too --
     * which is why the cushion that already ended up on the rug is drawn
     * clear of it: the picture and the solver have to agree about what is
     * lying on what, or the first touch in the room is answered by a cushion
     * jumping for no reason a person watching could name. */
    for (const part of drum.children) {
      room.ground(part, {shape: 'cylinder', friction: .55});
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const wall = new room.THREE.Mesh(new room.THREE.BoxGeometry(.05, .05, .25));
      wall.position.set(T[0] + Math.cos(a) * (RIM + .06), .47,
                        T[1] + Math.sin(a) * (RIM + .06));
      wall.rotation.y = -a;
      wall.visible = false;
      scene.add(wall);
      room.ground(wall);
    }
    room.pokes('glass', GL, {
      grow: .09, moves: 'slides', shape: 'cylinder',
      mass: .3, friction: .5, lift: .015,
      aim: (n) => ({a: room.fate('glass', n, 'way') * Math.PI * 2,
                    far: .05 + room.fate('glass', n, 'far') * .09}),
      says: (n, at) => Math.hypot(at.x - T[0], at.z - T[1]) > RIM - .04
        ? '(he pushes the glass to the very edge of the table and leaves it there)'
        : '(he pushes the glass across the table with one finger)'});

    // A hand on it, and it rings the way a drum of a table does — barely, and
    // only where the hand went.
    room.handles('table', drum, {
      // Nothing, because a glass stands on it — see the note on room.touch.
      grow: 0, secs: .35,
      jog: (k) => { drum.position.y = -Math.sin(Math.PI * k) * .008; },
      says: (n) => n === 1
        ? '(he puts his hand flat on the table)'
        : '(he taps the table with his fingers)',
    });

    /* An urn on the sill side, placed off the window rather than off the
       origin, so it stays beside the light if the window ever moves. Turned
       rather than built: a stepped foot, a belly, a drawn-in neck and a lip
       that stands back out — which is the whole vocabulary, and it is the
       same one the window's head is speaking. */
    const by = room.onPortal(-1, -1).add(new THREE.Vector3(-.5, 0, -1.15));
    const clay = matte(P.jade, .6);              // the urn, the green again
    const urn = [
      roll(.06, .34, by.x, .03, by.z, wood, 'y'),          // the plinth
      roll(.05, .29, by.x, .085, by.z, wood, 'y'),
      roll(.5, .33, by.x, .36, by.z, clay, 'y'),           // the belly
      roll(.26, .21, by.x, .74, by.z, clay, 'y'),          // drawn in above it
      roll(.05, .27, by.x, .89, by.z, wood, 'y'),          // and back out at the lip
      roll(.04, .3, by.x, .93, by.z, clay, 'y'),
    ];
    scene.add(...urn);
    // Turned, so it is a cylinder to the solver as well as to the eye. A
    // cushion shoved at it stops against the belly of it.
    for (const part of urn) room.ground(part, {shape: 'cylinder', friction: .6});

    /* ---- the lamp by the couch -------------------------------------------
       There was a warm light in this room with nothing making it, which is a
       thing you can feel without being able to say. This is what makes it.

       An arc lamp: a brass disc on the floor, a straight stem with a ferrule
       at its joint, and then the brass leaves the vertical and swings over in
       a quarter circle, so the shade hangs out over the couch rather than
       standing beside it. Two cones under it, one inside the other — the
       outer one dark, the inner one catching the bulb — which is what a lamp
       like that does with its light: nothing upward, everything down.

       It stands at the end of the couch nearer the middle of the room: the
       sitter's left hand, which is the end anybody reaches a book towards,
       and the end that keeps the light between the two of you rather than out
       in the corner. */
    const FL = new THREE.Group();
    FL.position.set(.38, 0, -1.97);
    /* Aimed at the couch rather than set to a number, because the number was
       wrong by a hundred and eighty degrees and nothing said so: the arc
       swung out over bare rug and the couch sat in its own shadow, which
       reads as a dim room rather than as a lamp facing the wrong way.
       Derived, so moving either of them keeps the light where the sitting
       is. The stem's own -x is the way the arc leans. */
    FL.rotation.y = Math.atan2(couch.position.z - FL.position.z,
                               FL.position.x - couch.position.x);
    scene.add(FL);

    const brass = room.keep(new THREE.MeshStandardMaterial(
      {color: P.brass, roughness: .32, metalness: .72}));
    const stem = matte(P.wood, .55);
    /* Bone: the white of the room taken right down, so the shade is a pale
       thing in shadow rather than a dark one. It is the only object in here
       lit from inside, and a near-black cone over a lit bulb reads as a hole
       in the room. */
    const shade = matte(P.bone, .95);
    const lit = room.keep(new THREE.MeshBasicMaterial({color: P.warm, fog: false}));

    const stands = 1.44, over = .62;
    const post = [
      roll(.045, .3, 0, .022, 0, brass, 'y'),          // the disc it stands on
      roll(.06, .1, 0, .07, 0, brass, 'y'),            // and the collar over it
      roll(stands - .2, .035, 0, stands / 2, 0, stem, 'y'),
      roll(.05, .042, 0, stands * .52, 0, brass, 'y'), // the ferrule at the joint
    ];
    FL.add(...post);
    /* The base and the stem are solid; the arc and the shade are not. What is
       worth a collider here is what a cushion can be pushed into, and that is
       the disc on the floor and the pole standing out of it — the shade hangs
       a meter and a half up, over the couch, where nothing this room can move
       is ever going to arrive. */
    for (const part of post) room.ground(part, {shape: 'cylinder', friction: .5});

    /* The arc. A tube along a quarter circle, so the brass leaves the stem
       going up and arrives over the couch going along — which is the whole
       line of the thing, and the reason it is not a stick with a hat on. */
    const bend = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, stands - .1, 0),
      new THREE.Vector3(0, stands + .42, 0),
      new THREE.Vector3(-over * .55, stands + .62, 0),
      new THREE.Vector3(-over, stands + .58, 0));
    const arc = new THREE.Mesh(
      room.keep(new THREE.TubeGeometry(bend, 28, .026, 10, false)), brass);
    arc.castShadow = true;
    FL.add(arc);

    // where it ends up, and what hangs there
    const hang = [-over, stands + .5];
    const cone = (r, tall, y, mat, open = true) => {
      const m = new THREE.Mesh(
        room.keep(new THREE.ConeGeometry(r, tall, 26, 1, open)), mat);
      m.position.set(hang[0], y, 0);
      m.castShadow = true;
      return m;
    };
    const hood = cone(.34, .3, hang[1] - .16, shade);   // the outer shade
    FL.add(
      hood,
      cone(.23, .2, hang[1] - .26, lit),               // and the lit one inside
      roll(.05, .026, hang[0], hang[1] + .02, 0, brass, 'y'),
    );

    /* The light itself, under the shade and falling off fast: what you get of
       it is the pool on the rug and on whoever is sitting in it. */
    const pool = new THREE.PointLight(P.warm, 6.4, 4.6, 1.9);
    pool.position.set(hang[0], hang[1] - .3, 0);
    FL.add(pool);

    /* And it can be turned down. Six steps from off to full — the pill reads
       by it, and how much of the room it wants lit is the first thing anybody
       will try to change about the place.

       The state is the step and nothing else: which step it is on is stored,
       what that looks like is worked out here. So a design that later has
       four steps, or a different shade, opens an old save without noticing —
       `sane` drags the stored number into whatever this lamp can do now. */
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
    const steps = [0, 8.8, 3];                      // off, on, turned down
    const glow = (level, how = {}) => {
      const to = steps[level], from = pool.intensity;
      const shine = (k) => {
        pool.intensity = from + (to - from) * k;
        /* The shade goes with it, or the light comes from an unlit lamp.
           Against the brightest step and not the last one: the steps were
           reordered so that off is followed by on — a hand goes round a lamp
           that way — and the last of them has been the turned-down one ever
           since. Divided by that, full brightness came out at two and a half
           times the color the shade is painted, and the cone clipped. */
        lit.color.copy(new THREE.Color(P.warm))
          .multiplyScalar(.25 + (pool.intensity / Math.max(...steps)) * .75);
      };
      room.over(how.instant ? 0 : .45, shine);
    };
    const lamp = room.remembers(
      'lamp', 1,                                    // on, to begin with
      // A save from when this had six of them is dragged into the three it
      // has now rather than throwing the room away — rule two of the three at
      // the top of rooms.py.
      n => Math.min(Math.max(Math.round(+n || 0), 0), steps.length - 1),
      glow);
    glow(lamp.get(), {instant: true});
    const switched = () => {
      const to = (lamp.get() + 1) % steps.length;
      lamp.set(to);
      room.says(to === 0
        ? '(he turns the lamp off, and the room goes to what is left of the '
          + 'light from the window)'
        : to === 1
          ? '(he turns the lamp back on)'
          : '(he turns the lamp right down, until it is barely on)');
    };
    /* The lamp, as its own shape: the disc, the stem, the arc and the shade,
       and no air between them. It was the shade alone for a while, because a
       target was a box round a thing and a box round a floor lamp is a column
       of air from the boards to the shade -- a cushion shoved off the end of
       the couch came to rest inside it, unreachable. A shape encloses
       nothing: the cushion at the foot is the cushion, the blanket hanging in
       front of the disc is the blanket, and the lamp is pressed where the
       lamp is. See aim.js for which wins under a ray. */
    room.touch(FL, switched, {shape: true, grow: .15, as: 'lamp'});
  },

  /* The evening breathes: the warm side of the room brightens and settles very
     slightly, on a slower clock than the moon. Nothing you would notice unless
     you sat with it, which is the point. */
  tick(room, t) {
    room.light.intensity = room.S.light.intensity * (1 + Math.sin(t / 21) * .05);
  },
};
