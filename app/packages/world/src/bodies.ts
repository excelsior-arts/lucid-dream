/* A thing in the scene, and the same thing in the simulation.
 *
 * A `Bound` is the pair: a mesh somebody composed by hand, and the body and
 * collider that stand for it. The collider is measured off the mesh rather
 * than written down twice — a room is furniture, and furniture that has to be
 * described a second time in numbers is furniture that will disagree with
 * itself the first time anybody moves it.
 *
 * Measured in the mesh's *own* frame and not in the world's. A world-axis box
 * round a book lying at an angle is bigger than the book, by a lot, and a
 * shelf full of those is a shelf whose books cannot be pushed past each other.
 * So the local bounds are taken, scaled by whatever scale the mesh carries,
 * and the body is put at the mesh's world position and rotation.
 */
import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type {Vec3, World} from './world';

export type Shape = 'box' | 'cylinder' | 'trimesh' | 'convex';

export interface Bound {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D;
}

export interface Pose {
  position: Vec3;
  quaternion: {x: number; y: number; z: number; w: number};
}

export interface StaticOpts {
  shape?: Shape;
  friction?: number;
  restitution?: number;
  /** Measure the collider off this instead, in the body's own frame.
   *
   * For the thing that is drawn as a group and is not the shape of its own
   * bounding box: a blanket is a panel lying on a bed with a fold hanging
   * over the front of it, and one box round the two of them is a slab that
   * cuts eight centimeters into the mattress. Point at the part that is
   * actually resting on something. */
  from?: THREE.Object3D;
  /** Drawn in from what it is measured off, in meters, per axis of the thing's
   * own frame.
   *
   * For the soft thing composed inside a hard one. A cushion is drawn tucked
   * into the arm of a couch by a hand's width, because that is what a cushion
   * on a couch looks like, and it is a thing two solids cannot both be: told
   * about it, a solver spends the first step it is ever given throwing them
   * apart. The couch is the honest shape — it is what everything else in the
   * room is measured against — so it is the cushion that gives, and it gives
   * here rather than in the drawing. What is lost is a few centimeters of
   * cushion nobody can see the edge of anyway.
   *
   * A number is every axis at once; `{x, y, z}` is per axis, which is usually
   * what is wanted — a cushion tucked sideways into an arm must keep the
   * underside it is resting on. */
  inset?: number | {x?: number; y?: number; z?: number};
  /** Put the body where this matrix says, rather than where the mesh is now.
   *
   * For the caller whose meshes move for reasons that are not the simulation.
   * A room jogs its own furniture when a hand is put on it — a couch gives, a
   * door leans, a chair turns — and a collider measured off a mesh in the
   * middle of one of those is a collider cut from a squashed couch. Which
   * room you got then depended on what was mid-animation when the world
   * happened to be built. So the caller writes the rest pose down once, when
   * the scene is composed, and hands it back here.
   *
   * The mesh's *world* matrix and nothing else. What the collider is measured
   * from — the geometry of the thing and of its parts — is taken in the
   * mesh's own frame, which is a fact about the drawing and not about
   * anything above it in the scene. */
  at?: THREE.Matrix4;
}

export interface DynamicOpts extends StaticOpts {
  /** Kilograms. Left out, Rapier works it out from the shape's density. */
  mass?: number;
  /** Made asleep, which is what everything in a room starts as: an untouched
      room is not a simulation running, it is a picture. */
  sleeping?: boolean;
  /** Which axes it may turn about. A cushion, a blanket, a glass — anything
      whose whole idea is that it lies flat — is given yaw and nothing else,
      which is what stops a box with corners rolling through a couch. */
  turns?: {x: boolean; y: boolean; z: boolean};
  /** How fast it stops. A room is not a bowling alley. */
  damping?: {linear?: number; angular?: number};
}

const V = new THREE.Vector3();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const M = new THREE.Matrix4();
const INTO = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/** Everything `what` is made of, measured in the mesh's own frame. */
function localBounds(mesh: THREE.Object3D, what = mesh): THREE.Box3 {
  mesh.updateWorldMatrix(true, true);
  what.updateWorldMatrix(true, true);
  const inv = M.copy(mesh.matrixWorld).invert().clone();
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  const into = new THREE.Matrix4();
  what.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return;
    one.copy(geo.boundingBox);
    one.applyMatrix4(into.multiplyMatrices(inv, o.matrixWorld));
    box.union(one);
  });
  return box;
}

/** Every vertex the mesh is made of, in the mesh's own frame and to scale. */
function localPoints(
  mesh: THREE.Object3D, scale: THREE.Vector3, what = mesh,
): Float32Array {
  mesh.updateWorldMatrix(true, true);
  what.updateWorldMatrix(true, true);
  const inv = M.copy(mesh.matrixWorld).invert().clone();
  const into = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const out: number[] = [];
  what.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry;
    const pos = geo?.getAttribute('position');
    if (!pos) return;
    into.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      at.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(into);
      out.push(at.x * scale.x, at.y * scale.y, at.z * scale.z);
    }
  });
  return new Float32Array(out);
}

/** And the triangles between them, renumbered as one run. */
function localIndex(what: THREE.Object3D): Uint32Array {
  const out: number[] = [];
  let base = 0;
  what.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry;
    const pos = geo?.getAttribute('position');
    if (!pos) return;
    const idx = geo.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) out.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) out.push(base + i);
    base += pos.count;
  });
  return new Uint32Array(out);
}

/** The mesh's world pose, and its scale, taken apart. `at` stands in for it
    when the mesh is not where it was composed: see `StaticOpts.at`. */
function world(mesh: THREE.Object3D, at?: THREE.Matrix4) {
  mesh.updateWorldMatrix(true, true);
  (at ?? mesh.matrixWorld).decompose(V, Q, S);
  return {
    at: {x: V.x, y: V.y, z: V.z},
    turned: {x: Q.x, y: Q.y, z: Q.z, w: Q.w},
    scale: S.clone(),
  };
}

function describe(
  w: World, mesh: THREE.Object3D, shape: Shape, scale: THREE.Vector3,
  what: THREE.Object3D = mesh, inset: StaticOpts['inset'] = 0,
): {desc: RAPIER.ColliderDesc; offset: Vec3} {
  const R = w.RAPIER;
  /* Twice, because it comes off both ends of each axis: `inset` is how far
     the collider's face is drawn in from the drawing's, and a size is two
     faces. Never past nothing. */
  const drawIn = (size: THREE.Vector3) => {
    const by = typeof inset === 'number'
      ? {x: inset, y: inset, z: inset}
      : {x: inset?.x ?? 0, y: inset?.y ?? 0, z: inset?.z ?? 0};
    size.set(Math.max(size.x - by.x * 2, .004),
             Math.max(size.y - by.y * 2, .004),
             Math.max(size.z - by.z * 2, .004));
    return size;
  };
  if (shape === 'box') {
    const box = localBounds(mesh, what);
    const size = drawIn(box.getSize(new THREE.Vector3()).multiply(scale));
    const mid = box.getCenter(new THREE.Vector3()).multiply(scale);
    /* Never quite nothing. A panel four hundredths of a meter thick is a
       blanket; a panel of zero is a collider Rapier cannot build, and the
       first thing anybody tries it on is a rug. */
    const half = (n: number) => Math.max(n / 2, .002);
    return {
      desc: R.ColliderDesc.cuboid(half(size.x), half(size.y), half(size.z)),
      offset: {x: mid.x, y: mid.y, z: mid.z},
    };
  }
  if (shape === 'cylinder') {
    /* A round table, a drum, a bottle. Standing on its own y, which is what
       every turned thing in these rooms is: `roll(..., 'y')` and
       CylinderGeometry both make their axis the mesh's own up. */
    const box = localBounds(mesh, what);
    const size = drawIn(box.getSize(new THREE.Vector3()).multiply(scale));
    const mid = box.getCenter(new THREE.Vector3()).multiply(scale);
    return {
      desc: R.ColliderDesc.cylinder(
        Math.max(size.y / 2, .002), Math.max(size.x, size.z) / 2),
      offset: {x: mid.x, y: mid.y, z: mid.z},
    };
  }
  const points = localPoints(mesh, scale, what);
  if (shape === 'convex') {
    const hull = R.ColliderDesc.convexHull(points);
    if (!hull) throw new Error('no convex hull in that mesh');
    return {desc: hull, offset: {x: 0, y: 0, z: 0}};
  }
  return {
    desc: R.ColliderDesc.trimesh(points, localIndex(what)),
    offset: {x: 0, y: 0, z: 0},
  };
}

/** Something the room is made of: it does not move and nothing moves it. */
export function staticFromMesh(
  w: World, mesh: THREE.Object3D, opts: StaticOpts = {},
): Bound {
  const R = w.RAPIER;
  const {at, turned, scale} = world(mesh, opts.at);
  const body = w.world.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z)
      .setRotation(turned));
  const {desc, offset} = describe(
    w, mesh, opts.shape ?? 'box', scale, opts.from, opts.inset);
  desc.setTranslation(offset.x, offset.y, offset.z);
  if (opts.friction !== undefined) desc.setFriction(opts.friction);
  if (opts.restitution !== undefined) desc.setRestitution(opts.restitution);
  return {body, collider: w.world.createCollider(desc, body), mesh};
}

/** And something a hand can move. Asleep by default: see `sleeping`. */
export function dynamicFromMesh(
  w: World, mesh: THREE.Object3D, opts: DynamicOpts = {},
): Bound {
  const R = w.RAPIER;
  const {at, turned, scale} = world(mesh, opts.at);
  const desc = R.RigidBodyDesc.dynamic()
    .setTranslation(at.x, at.y, at.z)
    .setRotation(turned)
    .setCanSleep(true)
    .setLinearDamping(opts.damping?.linear ?? .4)
    .setAngularDamping(opts.damping?.angular ?? .6);
  if (opts.turns) desc.enabledRotations(opts.turns.x, opts.turns.y, opts.turns.z);
  if (opts.sleeping !== false) desc.setSleeping(true);
  const body = w.world.createRigidBody(desc);
  const built = describe(
    w, mesh, opts.shape ?? 'box', scale, opts.from, opts.inset);
  built.desc.setTranslation(built.offset.x, built.offset.y, built.offset.z);
  built.desc.setFriction(opts.friction ?? .8);
  built.desc.setRestitution(opts.restitution ?? .04);
  if (opts.mass !== undefined) built.desc.setMass(opts.mass);
  const collider = w.world.createCollider(built.desc, body);
  /* And asleep after the collider, not before it: hanging one on a body wakes
     it, so a room built and never touched would have spent its first second
     settling furniture that was already exactly where it was drawn. */
  if (opts.sleeping !== false) body.sleep();
  return {body, collider, mesh};
}

/** Where the body has got to, written back onto the mesh. The one direction
    this ever goes while the simulation is running: the body decides. */
export function sync({body, mesh}: Bound): void {
  const t = body.translation();
  const r = body.rotation();
  const parent = mesh.parent;
  if (!parent) {
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
    return;
  }
  /* Into the mesh's own frame. Almost everything a hand can shove is hung off
     the scene, so the parent is the identity and this is a copy; a thing
     still inside a group is not, and writing a world position into
     `position` without asking would put it wherever the group happens to be.
     The scale falls out into a scratch and is dropped: what the body knows is
     where and which way, and the mesh keeps whatever size it was drawn. */
  parent.updateWorldMatrix(true, false);
  M.compose(V.set(t.x, t.y, t.z), Q.set(r.x, r.y, r.z, r.w), ONE)
    .premultiply(INTO.copy(parent.matrixWorld).invert());
  M.decompose(mesh.position, mesh.quaternion, S);
}

/** Where it is, as two plain objects. */
export function pose({body}: Bound): Pose {
  const t = body.translation();
  const r = body.rotation();
  return {
    position: {x: t.x, y: t.y, z: t.z},
    quaternion: {x: r.x, y: r.y, z: r.z, w: r.w},
  };
}

/** And putting it back. Everything it was doing is forgotten with it: this is
    how a room is put back to how it was left, or to how it was drawn. */
export function setPose(b: Bound, p: Pose, {asleep = true} = {}): void {
  b.body.setTranslation(p.position, true);
  b.body.setRotation(p.quaternion, true);
  b.body.setLinvel({x: 0, y: 0, z: 0}, true);
  b.body.setAngvel({x: 0, y: 0, z: 0}, true);
  if (asleep) b.body.sleep();
}

/** Out of the simulation but not out of the world.
 *
 * It stops being stepped and stops being hit, and `isAsleep` counts it as
 * still. This is what a room does with something that has fallen out of it —
 * freeing the body instead would be a use-after-free across the wasm boundary
 * the moment a settle that is still holding it asks whether it has stopped,
 * which is exactly what a book going over an edge does. */
export function park({body}: Bound): void {
  body.setEnabled(false);
}

/** Out of the simulation altogether, and freed with it. Only safe when
    nothing is holding the Bound: see `park`. */
export function remove(w: World, b: Bound): void {
  w.world.removeRigidBody(b.body);
}

/** A fixed body let go: dynamic from now on, awake, with `mass` if given.
 *
 * What a standing thing becomes when it is broken. A monolith is built as the
 * room is built — fixed, so a figure can lean on it and the solver never
 * spends a step on it — and the moment it comes apart every piece of it has to
 * fall, be shoved, and land on the ground like anything else. Rebuilding the
 * bodies would be the same shapes at the same places with new handles, which
 * is a new set of colliders in the middle of the step that is judging the old
 * ones; changing the type is the same body, still where it was, now with mass.
 *
 * Awake on purpose: a dynamic body inherits the sleep of the fixed one it was,
 * and a piece of a broken thing that is asleep is a piece hanging in the air.
 */
export function release(w: World, b: Bound, o: {mass?: number} = {}): void {
  b.body.setBodyType(w.RAPIER.RigidBodyType.Dynamic, true);
  /* On the collider rather than the body: Rapier works a body's mass out from
     what is hung on it, so a mass written on the body is overwritten the next
     time its colliders are looked at. And then asked for again by hand,
     because otherwise it is not the body's until the next step — a caller that
     released a thing and immediately shoved it would be shoving the density's
     mass, and a piece of a monolith weighs what the game said it weighs. */
  if (o.mass !== undefined) {
    b.collider.setMass(o.mass);
    b.body.recomputeMassPropertiesFromColliders();
  }
  b.body.wakeUp();
}
