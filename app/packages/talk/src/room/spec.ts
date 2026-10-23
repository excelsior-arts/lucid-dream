/* What a room is, in types.
 *
 * room3d.js and the two rooms are hand-set JavaScript and stay that way — the
 * comments in them are the design document, and a type checker cannot read a
 * comment. This file is the boundary: what a room may say of itself, and what
 * the engine hands back. It is derived from `DEFAULT` in room3d.js, which is
 * the de-facto schema, and the doc comments here are lifted from beside the
 * keys they describe rather than written again.
 *
 * Everything in `RoomSpec` is optional because everything is merged over
 * `DEFAULT`: a room that says nothing is still a room.
 */

import type * as THREE from 'three';

/** A color the engine hands to three, so a hex number rather than a string. */
export type Hex = number;
/** `r,g,b` channels, because CSS wants them that way and so does canvas. */
export type Ink = string;
/** A point given in a spec, which is written as a plain triple. */
export type Triple = [number, number, number];

export interface Size {
  w: number;
  d: number;
  h: number;
}

/* Every color the room is built from. The seven the engine reads are named;
   a room may name as many more as it likes and read them back in `dress`,
   which is what keeps a room of one hue answerable in one place. */
export interface Palette {
  wall: Hex;
  floor: Hex;
  /** The figure on every surface, as channels: the lattice, the parquet, the rug. */
  ink: Ink;
  accent: Hex;
  warm: Hex;
  moon: Hex;
  void: Hex;
  /** What is set into the panelling, if the room wants something other than the accent. */
  gem?: Hex;
  [named: string]: Hex | Ink | undefined;
}

/** The joinery: stile and glazing bar widths, and how far it stands proud. */
export interface Frame {
  stile?: number;
  bar?: number;
  depth?: number;
}

/* The portal: the rectangle the conversation is written on. Every room has
   one, and almost everything else is worked out from it — where the light
   comes through, where the room gathers, where the camera stands. Which wall
   it is on, how big, how far along it, how high off the boards. For a side
   wall, +x is towards you; for the far wall, +x is to your right.

   The rest of the numbers here belong to whichever fitting is dressing it,
   and a fitting that has no use for one simply never reads it. */
export interface Portal {
  wall?: 'back' | 'left' | 'right';
  w?: number;
  h?: number;
  /** How high off the boards the foot of it is. */
  sill?: number;
  /** How far along the wall, from the middle of it. */
  x?: number;
  /** The share of the height the head takes. */
  arch?: number;
  head?: 'round' | 'diamond' | 'stepped' | 'square';
  margin?: number;
  /** The fanlight and its rose. */
  rose?: number;
  hub?: number;
  ribs?: number;
  spokes?: number;
  /** The mullions, and where they land. */
  sides?: number;
  low?: number;
  /** The hem. */
  lozenges?: number;
  tuck?: number;
  wide?: number;
  /** Set on its point in the rose. */
  stone?: Hex;
  /** Lifts the foot of the reading area. */
  read?: number;
  frame?: Frame;
  /** Whether the wall wants a hole in it; the fitting decides unless this says. */
  pierce?: boolean;
  /** Anything else the fitting dressing this portal reads: rain, shutters, rows. */
  [fitted: string]: unknown;
}

/* The one light that casts. It is never seen: what you get of it is what it
   does to the room. By default it stands outside the portal and shines in,
   which is a moon; give it `from` and it stands where it is told, which is a
   lamp hung over the middle of a room. `at` is what it aims at; null is the
   heart. `drift` and `period` are how far and how slowly it moves. */
export interface Light {
  intensity?: number;
  distance?: number;
  drift?: number;
  period?: number;
  from?: Triple | null;
  at?: Triple | null;
}

/* Where the room gathers: a golden section in from the window and aside along
   it, and how high above the boards the camera looks at that point. */
export interface Heart {
  into?: number;
  aside?: number;
  eye?: number;
}

/* How the camera is placed: by what it has to see rather than by a spot
   picked once on a wide screen. */
export interface Fit {
  /** How much of the screen the reading pane should take. */
  fill?: number;
  /** How far round from the portal's own normal the camera stands. */
  turn?: number;
  drop?: number;
  rise?: number;
  /** A little air around the words. */
  margin?: number;
  /** Where it starts walking from. */
  from?: number;
  /** 'glass' looks at the reading pane itself rather than at the heart. */
  aim?: 'glass';
  /** The picture slid across the screen, after the distance is settled. */
  nudge?: {x?: number; y?: number};
}

export interface View {
  fov: number;
  /** `look` may be left out: then the camera looks at the heart. */
  look?: Triple;
  fit: Fit;
}

/* And how much of the picture survives before the void takes it. `hold` is
   the share of the frame that stays clear, measured from the heart. */
export interface Vignette {
  hold?: number;
  wide?: number;
  tall?: number;
}

/* A phone is not the same room from closer in: it is the window, with a room
   around it. `fit` puts the camera wherever that turns out to be. */
export interface Portrait extends View {
  /** The chat's own width on a phone, in its own flat pixels. */
  page?: number;
  /** How square a screen may be and still get this view. */
  upto?: number;
  /** The same question asked in pixels. */
  narrow?: number;
  /** A slice of the reading pane rather than all of it. */
  read?: {w?: number; h?: number; x?: number; y?: number};
  vignette?: Vignette | null;
}

/** The warm light inside. `at` is where it stands; it casts no shadows. */
export interface Hearth {
  strength?: number;
  reach?: number;
  decay?: number;
  at?: Triple;
}

/* How much light there is before either of the two real ones: `ambient` is
   flat and cold, `sky` leans the accent color down onto the floor color. */
export interface Fill {
  ambient?: number;
  sky?: number;
}

/** What a fitting is handed, and what it may give back. */
export interface Fitting {
  (fit: FittingKit): FittingBuilt;
  /** Whether the wall wants a hole in it. A window is; a bookcase is not. */
  pierce?: boolean;
}

export interface FittingKit {
  THREE: typeof THREE;
  keep: Keep;
  carrier: THREE.Group;
  S: Readonly<RoomSpec>;
  P: Palette;
  portal: Portal;
  /** The hole this portal cuts, as a path, for a fitting that wants the shape. */
  opening: (w: number, h: number, sill: number, x: number, arch: number, head?: string) => THREE.Path;
  paint: Paint;
  /* A stick of wood: a box, added to a group, casting and receiving. The
     joinery in both fittings is built out of nothing else. */
  stick: (...args: never[]) => THREE.Mesh;
  pierce: boolean;
}

/* Textures are drawn rather than shipped: the game is offline, and a canvas
   costs less than a PNG anyway. */
export type Paint = (px: number, draw: (g: CanvasRenderingContext2D, px: number) => void) => THREE.CanvasTexture;

export interface FittingBuilt {
  /** Whatever the fitting left clear for the words, in the carrier's frame. */
  read?: {x: number; y: number; w: number; h: number; z: number};
  /** 0 open, 1 shut, for a fitting that has anything that shuts. */
  shutter?: (t: number) => void;
  /** Whichever of the things it built a hand can push something against.
   *
   * The fitting's to name rather than the engine's to guess: a leaded window
   * is two hundred came bars and what is solid about it is the sill; a case
   * of shelves is every board and every upright, because a book shoved at one
   * has to stop there. */
  solid?: THREE.Object3D[];
  /** Weather. Ambience only: it moves and decides nothing. */
  tick?: (t: number) => void;
}

/* What a room gets if nobody dressed it — and the shape of the object a
   game's own room file exports. Everything here may be overridden. */
export interface RoomSpec {
  size?: Partial<Size>;
  palette?: Partial<Palette>;
  portal?: Portal;
  /* What the portal is made of. A name out of fittings.js, or a function of
     the same shape written here — a room may build its own. `null` leaves the
     portal bare, which is a rectangle of words hanging on a wall. */
  fitting?: 'glazing' | 'shelves' | Fitting | null;
  light?: Light;
  heart?: Heart;
  camera?: View;
  portrait?: Portrait | null;
  /** The chat's own width, in its own flat pixels. */
  page?: {w?: number};
  /** What on the glass stands in the light's way. */
  casts?: string;
  /* And whether they stand in it at all. A room where the words are lit from
     behind them throws them across the floor; a room where they are thrown
     onto a surface has nothing to cast, and says `cast: false`. Either way
     they are drawn, because a mirror may still want them. */
  cast?: boolean;
  /** How much larger the words fall on the floor. */
  spill?: number;
  /* How far into the room you can see. This is depth: it is what makes the
     far side recede. Push it out, or say null, if the room should be crisp
     all the way back — the edges are the vignette's job, not this one. */
  fog?: [number, number] | null;
  vignette?: Vignette | null;
  hearth?: Hearth | false;
  fill?: Fill;
  /** There is no lid on this unless a room asks for one. */
  ceiling?: boolean;
  /* And what is underfoot. 'boards' is a floor; false is no floor at all —
     for a room that has something else down there, or nothing. */
  ground?: 'boards' | false;
  /** The share of the floor that stays solid, measured out from the middle. */
  hold?: number;
  /** The share of a wall's length that stays solid, measured from the corner. */
  reach?: number;
  /** How much of a wall's height goes at the top. */
  sky?: number;
  /** How deep the wall is, so the opening has a reveal. */
  thick?: number;
  /** How wide one bay of panelling is. */
  bay?: number;
  /** And how big a parquet block is. */
  block?: number;
  /** What is set into the panelling: the figure repeated along every bay. */
  figure?: string;
  /** Which wall stands beside the one carrying the portal. */
  corner?: 'back' | 'left' | 'right';

  /* ---- the four the room writes itself -----------------------------------
     `dress` builds the furniture, once, when the room is mounted. `tick` runs
     every frame and owns nothing. `said` is the count moving; `woke` is the
     page finally saying whose room this is. */
  dress?: ((room: Room) => void) | null;
  tick?: ((room: Room, t: number) => void) | null;
  said?: (room: Room, stats: Stats) => void;
  woke?: (room: Room, knows: Told) => void;
}

/* ---- what the engine hands back ------------------------------------------ */

/** Anything with a `dispose` the room should give back when it closes. */
export type Keep = <T>(o: T) => T;

/** What a game counts, as the room reads it off the page. A room seeds itself
    from these; see `mood`. `said` and the sizes are always there; the rest are
    a split into two sides and a count of questions, which not every game
    has. */
export interface Stats {
  said: number;
  theirs?: number;
  yours?: number;
  letters: number;
  words: number;
  asks?: number;
  last: {letters: number; words: number; asks: number};
}

/* What the page knows and the room does not: whose room this is, which run of
   it, and how it is set right now. Arrives after the page has found out, so it
   may well be after the room is built. */
export interface Told {
  /** Whoever the room belongs to. Half of `fate`. */
  who: string;
  /** Which run of it — the seed of what happened here. The other half. */
  take: string;
  temperature: number;
  top_p: number;
  /* Two numbers a game feeds the room, hot and cold: the slow one, and
     today's. Both -100..100, and 0 is a room exactly as it was painted. What
     they mean is the game's — in this checkout they come from
     app/packages/talk/src/conversation/relation.ts. */
  warmth: number;
  temper: number;
  did: ((text: string) => void) | null;
}

export interface Knows {
  who?: string;
  take?: string;
  /** Only the two heats; the rest of `Told` is the engine's own. */
  mood?: {warmth?: number; temper?: number};
  /** The last save of this room: a count per remembered name. */
  state?: Record<string, unknown> | null;
  /** The page's way of saving. */
  save?: (state: Record<string, unknown>) => void;
  /** How the room says what a hand has just done. */
  did?: (text: string) => void;
}

/* One of these per object that can be changed. `initial` is what a room that
   has never been touched looks like; `sane` drags anything out of a save into
   a value this room can actually use now; `apply` puts the object into that
   state, and is handed {instant: true} when it is being restored rather than
   done, so it can skip the animation. */
export interface How {
  instant?: boolean;
  quiet?: boolean;
}

export interface Mind<T = number> {
  name: string;
  initial: T;
  value: T;
  get(): T;
  set(v: T, how?: How): T;
}

/** A target: the box round a thing that a press is actually tested against. */
export interface Target {
  /** The first of its proxies, which carries the `pick:` name. */
  proxy: THREE.Mesh;
  /** What a ray is tested against: one box, or one copy of each mesh when
      the thing is its own target. */
  proxies: THREE.Mesh[];
  /** The box round the thing, grown -- what `reach()` samples across. */
  size: THREE.Vector3;
  target: THREE.Object3D;
  /** The name it answers to in `reach()`. */
  as: string;
  on: (it: Target, e: PointerEvent) => void;
  follow?: () => void;
  /* Not `on` and `off`, however much they want to be called that: `on` is
     already this record's word for what to do when the thing is pressed. */
  enable(): void;
  disable(): void;
}

/** What `reach()` reports for one target: itself, something else, or nothing. */
export interface Reached {
  name: string;
  /** null is "the question does not apply here" rather than a failure. */
  ok: boolean | null;
  why: string;
}

/** A job on the loop that is already running. */
export interface Job {
  stop(): void;
}

/** Where a thing has ended up after a shove — read off the body once it has
    come to rest, which is when the room gets to say what happened. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** It went past the bottom of the room and is out of it. It can come back:
      opening a conversation in which it was never touched puts it back. */
  gone: boolean;
}

/** The room's half of a shove: which way the nth one goes, in radians about
    the room's y, and how far it means to send the thing, in meters. Handed
    where the thing is standing now, so a room can aim away from a couch or in
    towards a drop. This is the one place a shove is decided, and it reads its
    numbers from `fate(name, n)`. */
export type Aim = (n: number, at: Pose) => {
  a?: number; far?: number; up?: number; spin?: number;
} | null | undefined;

/** What a hand can move: a real body, falling on real geometry. */
export interface Shoveable {
  /** How much bigger than itself the pick proxy is. */
  grow?: number;
  /** The most shoves that will ever be counted. */
  limit?: number;
  /** What the room says once it has come to rest. */
  says?: ((n: number, at: Pose) => string | null) | null;
  /** 'slides' keeps a thing flat — yaw and nothing else, which is what stops
      a box with corners rolling through the couch it is lying on. 'tumbles'
      turns about everything. */
  moves?: 'tumbles' | 'slides';
  aim?: Aim;
  /** How the collider is measured off the mesh. */
  shape?: 'box' | 'cylinder' | 'trimesh' | 'convex';
  /** Measure it off this part of the thing instead. */
  from?: THREE.Object3D;
  /** And draw it in from there, in meters, everywhere or per axis — for the
      soft thing composed inside a hard one, where the drawing is right and
      the overlap is a thing two solids cannot both be. */
  inset?: number | {x?: number; y?: number; z?: number};
  mass?: number;
  friction?: number;
  restitution?: number;
  /** How much of a shove goes upward, so a thing hops rather than grinds. */
  lift?: number;
  /** And how much of it is a twist, for something that goes end over end. */
  spin?: number;
  /** The y below which this room has nothing left to offer. */
  sink?: number;
}

/** Something the room is made of: it does not move and nothing moves it. The
    thing handed over need not be in the scene — a floor drawn as a fading
    texture is a slab nobody sees, and a lip that keeps a glass on a table is
    not meant to be seen at all. */
export interface Grounding {
  shape?: 'box' | 'cylinder' | 'trimesh' | 'convex';
  friction?: number;
  restitution?: number;
  /** Measure the collider off this part instead — for the thing drawn as a
      group that is not the shape of its own bounding box. */
  from?: THREE.Object3D;
  /** Drawn in from what it is measured off, in meters, everywhere or per
      axis. See the world package. */
  inset?: number | {x?: number; y?: number; z?: number};
}

/** A place on the spiral itself, by how far round it you are. */
export interface OnSpiral {
  x: number;
  y: number;
  z: number;
  a: number;
  rho: number;
  wide: number;
}

/** The ribbon a room with no floor stands on. */
export interface Spiral extends THREE.Mesh {
  at(rounds: number, across?: number): OnSpiral;
  /** How far down it goes before it is gone. */
  rounds: number;
  middle: [number, number];
  /** How close to the middle you can get before there is nothing under you. */
  eye: number;
  /** How high the ribbon is at a point on the ground, or null past the edge. */
  floor(x: number, z: number): number | null;
  /** The ribbon as something a solver can be trusted with: a chain of slabs
      along it, each with its top face on the drawn surface and real stone
      below. Not drawn — hand them to room.ground. */
  slabs(opts?: {over?: number; deep?: number}): THREE.Mesh[];
}

/* The object handed to `dress()`. Everything a room is built out of is here;
   nothing else in the engine is meant to be reached for. */
export interface Room {
  THREE: typeof THREE;
  scene: THREE.Scene;
  /** The wall carrying the portal, in its own frame: x across, y up, z in. */
  carrier: THREE.Group;
  /** The merged spec, after DEFAULT. */
  S: Readonly<RoomSpec>;
  size: Size;
  palette: Palette;
  portal: Portal;
  keep: Keep;
  /** The one light that casts. It is never seen. */
  light: THREE.DirectionalLight;
  /** The middle of the portal, in world terms. */
  middle: THREE.Vector3;
  /** Any point on the portal: u across it and v up it, each -1..1. */
  onPortal(u?: number, v?: number, out?: THREE.Vector3): THREE.Vector3;
  /** Where the room gathers. */
  heart: THREE.Vector3;
  /** 0 open, 1 shut. A room with no shutters answers to this and does nothing. */
  shutter(t: number): void;
  /** The warm light inside, or null for a room that has none. */
  hearth: THREE.PointLight | null;
  mirrors: {glass: THREE.Mesh; target: THREE.WebGLRenderTarget; w: number; h: number}[];

  matte(color: Hex, roughness?: number): THREE.MeshStandardMaterial;
  /** A bolster: a cylinder lying along one axis. */
  roll(
    len: number, r: number, x: number, y: number, z: number,
    mat: THREE.Material, along?: 'x' | 'y' | 'z', turn?: number,
  ): THREE.Mesh;
  /** A rug, round: the figure the room gathers on. */
  rug(radius: number, x: number, z: number, turn?: number, ink?: Ink): THREE.Mesh;
  box(
    bw: number, bh: number, bd: number, x: number, y: number, z: number,
    mat: THREE.Material, turn?: number,
  ): THREE.Mesh;
  /** A spiral, going down. For a room with no floor in it. */
  spiral(opts?: {
    r?: number; turns?: number; taper?: number; drop?: number; bend?: number;
    wide?: number; at?: [number, number]; top?: number; phase?: number;
    steps?: number; ink?: Ink; face?: Hex;
  }): Spiral;
  /** A mirror, and a real one: what is in it is the room, rendered again. */
  mirror(opts?: {
    w?: number; h?: number; shape?: THREE.Shape | null; at?: Triple;
    turn?: number; tilt?: number; px?: number; tint?: Hex; dim?: number;
  }): THREE.Mesh;
  /** Whether the room is being shown as a room at all, rather than as a window. */
  pressable(): boolean;
  /* Anything already in the scene can be touched. What is registered is a box
     round it, or -- `shape` -- its own meshes, for a thing whose box is
     mostly air. `loose` marks a thing a hand can shove, whose box is the
     small one lying on the furniture; see aim.js for which wins under a
     ray. Point at the thing, not at what it is standing on. */
  touch(
    target: THREE.Object3D,
    on: (it: Target, e: PointerEvent) => void,
    opts?: {grow?: number; as?: string; follows?: boolean; shape?: boolean; loose?: boolean},
  ): Target | null;
  /* Something the room is made of, for anything falling on it to land on. */
  ground(thing: THREE.Object3D, opts?: Grounding): THREE.Object3D;
  /* Something you can shove, and that remembers being shoved. What is kept is
     the count — how many times a hand has been put to this — and the shove
     itself in the room's one ordered log. Where it has got to is simulated
     from those every time the room opens. */
  pokes(name: string, thing: THREE.Object3D, opts?: Shoveable): Mind;
  /* Something you can try, that does not move. Nothing about the room
     changes, so there is nothing to restore — but the count is worth having. */
  handles(
    name: string,
    thing: THREE.Object3D,
    opts?: {
      says?: ((n: number) => string | null) | null;
      jog?: ((k: number, n: number) => void) | null;
      grow?: number; secs?: number; limit?: number;
    },
  ): Mind;
  /* After moving anything, ask. For each target, this points at where it
     actually is and reports what a press there would reach. */
  reach(): Reached[];
  /* A frame scheduler on the loop that is already running. `secs` of 0 runs
     the last frame and nothing else. Lamps, doors and mirrors; nothing that
     is shoved goes through this any more. */
  over(secs: number, step?: (k: number, dt: number) => void, done?: () => void): Job;
  /** What the last physics step cost, in milliseconds. */
  cost(): number;
  /** Every collider drawn over the room as lines, for working on one. */
  bodies(on?: boolean): {on: boolean; update(): void};
  stats: Stats;
  /** What happened: `who` and `take`, so it is the same every time. */
  fate(...key: unknown[]): number;
  /** How it looks today: the live temperature and what has been counted so
      far. */
  mood(...key: unknown[]): number;
  remembers<T = number>(
    name: string, initial: T,
    sane?: (v: unknown) => T,
    apply?: ((v: T, how: How) => void) | null,
  ): Mind<T>;
  knows(told?: Knows): Told;
  /** A room saying what has just been done in it. */
  says(line: string | null | undefined): void;
  /* And a press that reached nothing at all — which is not the same as a
     press that meant nothing. Where it would land on the floor plane, or null
     for a press aimed above the horizon. */
  nothing(fn: (at: {x: number; z: number} | null) => void): void;
  told: Told;
}

/** What `mount()` gives back. */
export interface RoomHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  room: Room;
  /** The flat page's own size, which the projection is struck from. */
  page: {w: number; h: number};
  /** Draw at most every `ms` milliseconds -- 0 is every frame -- while
      something else needs the GPU: a model writing a reply in this browser. */
  ease(ms: number): void;
  stop(): void;
}

export interface Mounted {
  stage: HTMLElement;
  glass: HTMLElement;
  /** What stands in front of the glass, so the last line can keep clear of it. */
  under?: HTMLElement | null;
}
