import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {
  positionGeometry,
  vec3,
  uniform,
  mix,
  smoothstep,
  mx_noise_float,
  float,
  texture,
  uv,
  abs,
  dot,
  normalView,
  pow,
} from 'three/tsl';
import {FireParticles} from '../runtime/fire-particles';
import {symmetricClip} from './stand';
import type {MotionState} from '@lucid/world/desert';
import {sampleScore, type Cue, type Score} from '../experience/score';
const scratch = new THREE.Vector3();
import {bodyDetailIndices, type BodyDetail} from './body-detail';
import {FootGrounding, type GroundSurface} from './foot-grounding';
import {WALK_STRIDE} from './walk-gait';
import {decodeClips} from './clip-pack';
import {angleDelta} from './manual-gait';
import {assetUrl} from '../assets';

type CharacterAssets = {
  gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  clips: THREE.AnimationClip[];
  detail?: ArrayBuffer;
  plume: THREE.Texture;
  relief: THREE.Texture;
  cavity: THREE.Texture;
};
let assets: {base: string; work: Promise<CharacterAssets>} | undefined;

/**
 * Ask for the body's files at once. Nothing here waits on
 * anything else: the eight-megabyte body downloads while the animations, the
 * detail indices and the flame texture are already in flight, and the host can
 * start all of it before it builds the desert.
 */
export function preloadCharacter(base: string) {
  if (assets?.base === base) return assets.work;
  // Named files on one shelf: see ../assets.ts. `base` is the shelf's name.
  const at = (path: string) => assetUrl(path);
  const work = (async (): Promise<CharacterAssets> => {
    const animations = async () => (await Promise.all(['clips', 'locomotion'].map(async name => {
      const response = await fetch(at(`animations/${name}.bin`));
      // Older consumers of the reusable body still have its original shelf.
      if (name === 'locomotion' && response.status === 404) return [];
      if (!response.ok) throw new Error('Animations unavailable');
      return decodeClips(await response.arrayBuffer()).clips;
    }))).flat();
    const body = async () => {
      const response = await fetch(at('character/body-detail.bin'));
      if (response.ok) return response.arrayBuffer();
      // A host without the optional detail file keeps the full mesh.
      if (response.status === 404) return undefined;
      throw new Error('Body detail unavailable');
    };
    // The body's own UVs, so both maps line up with the glTF convention.
    const surfaceMap = async (file: string) => {
      const map = await new THREE.TextureLoader().loadAsync(at(`character/${file}`));
      map.flipY = false;
      map.colorSpace = THREE.NoColorSpace;
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
      map.anisotropy = 4;
      return map;
    };
    const [gltf, clips, detail, plume, relief, cavity] = await Promise.all([
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(at('character/man.glb')),
      animations(),
      body(),
      new THREE.TextureLoader().loadAsync(at('character/flame.png')),
      surfaceMap('body-normal.png'),
      surfaceMap('body-cavity.png'),
    ]);
    return {gltf, clips, detail, plume, relief, cavity};
  })();
  assets = {base, work};
  // A failed load must be retryable, exactly as the loading screen offers.
  void work.catch(() => {
    if (assets?.work === work) assets = undefined;
  });
  return work;
}

/** One rig, one body, authored motion. The host owns the score and movement. */
export class BurningMan {
  readonly object = new THREE.Group();
  readonly ready: Promise<void>;
  private root?: THREE.Group;
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private active?: THREE.AnimationAction;
  private fire?: FireParticles;
  private grounding?: FootGrounding;
  private heat = uniform(0);
  private time = uniform(0);
  private previous = new THREE.Vector3();
  private poseBase = new Map<THREE.Object3D, THREE.Quaternion>();
  private lastFacing?: number;
  private lookYaw = 0;
  private lean = 0;
  private surface?: THREE.SkinnedMesh;
  private detail: BodyDetail = 'high';
  private appliedDetail?: BodyDetail;
  private detailIndices?: Record<BodyDetail, THREE.BufferAttribute>;
  animation = 'opening';
  private ground?: GroundSurface;
  constructor(baseUrl: string, ground?: GroundSurface) {
    this.ground = ground;
    this.object.name = 'Burning Man';
    this.ready = this.load(baseUrl);
  }
  /** The download this body was built from, to be forgotten with it. */
  private files?: Promise<CharacterAssets>;
  private async load(base: string) {
    this.files = preloadCharacter(base);
    const {gltf, clips: authored, detail, plume, relief, cavity} = await this.files;
    this.root = gltf.scene;
    this.object.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root);
    if (this.ground) this.grounding = new FootGrounding(this.object, this.root, this.ground);
    let surface: THREE.SkinnedMesh | undefined;
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const old = o.material as THREE.MeshStandardMaterial;
      if (old.name === 'Charcoal skin') {
        o.geometry.computeBoundingBox();
        const scale = 1.77 / o.geometry.boundingBox!.max.y;
        const p = positionGeometry.mul(scale),
          coarse = mx_noise_float(p.mul(22)).mul(0.5).add(0.5),
          fine = mx_noise_float(p.mul(130)).mul(0.5).add(0.5);
        const mat = new THREE.MeshStandardNodeMaterial({roughness: 0.88, metalness: 0.05});
        mat.name = 'Charcoal skin · amber burn';
        // Cracked-charcoal relief, baked from this mesh's own geometry and UVs.
        mat.normalMap = relief;
        mat.normalScale = new THREE.Vector2(1, 1);
        // Where the form creases and the fracture network cuts into it.
        const crease = texture(cavity, uv()).r;
        // Charcoal, but not so dark that nothing can light it. At four per cent
        // reflectance a low moon returns less than the eye can read, so he was a
        // flat cut-out wherever the fire did not reach; at ten he is still burnt
        // wood and the moon can model him as he turns and crosses a dune.
        mat.colorNode = mix(vec3(0.1, 0.078, 0.062), vec3(0.2, 0.15, 0.105), coarse)
          .mul(fine.mul(0.18).add(0.85))
          .mul(float(1).sub(crease.mul(0.42)));
        // The burn now follows the form: it collects in the creases and the
        // fracture valleys instead of floating on a field of noise.
        const fissure = smoothstep(0.66, 0.96, crease)
          .mul(smoothstep(0.42, 0.72, coarse))
          .mul(smoothstep(0.3, 0.62, fine));
        // A coal is lit from inside at its thin edges. This only ever shows where
        // the body turns away from the eye, so the silhouette stays charcoal in
        // daylight and the fire remains the light in the scene.
        const grazing = float(1).sub(abs(dot(normalView, vec3(0, 0, 1)))).toVar();
        const edge = pow(grazing, 3.5).mul(smoothstep(0.55, 0.95, grazing));
        mat.emissiveNode = vec3(0.007, 0.0055, 0.004)
          .add(
            vec3(1, 0.19, 0.012)
              .mul(fissure)
              .mul(this.heat)
              .mul(
                float(0.7).add(
                  mx_noise_float(p.mul(17).add(vec3(0, this.time.mul(0.8), 0))).mul(0.3),
                ),
              ),
          )
          .add(
            vec3(1, 0.32, 0.06)
              .mul(edge)
              .mul(this.heat)
              .mul(0.28)
              .mul(float(0.75).add(mx_noise_float(p.mul(9).add(vec3(0, this.time.mul(1.3), 0))).mul(0.5))),
          );
        o.material = mat;
        old.dispose();
        if (o instanceof THREE.SkinnedMesh) surface = o;
      } else {
        old.emissive.setRGB(0, 0, 0);
        old.roughness = 0.95;
      }
    });
    const opening: THREE.KeyframeTrack[] = [];
    this.root.traverse((o) => {
      if (o instanceof THREE.Bone) {
        opening.push(
          new THREE.QuaternionKeyframeTrack(
            `${o.name}.quaternion`,
            [0, 1],
            [...o.quaternion.toArray(), ...o.quaternion.toArray()],
          ),
        );
        if (o.name.endsWith('Hips'))
          opening.push(
            new THREE.VectorKeyframeTrack(
              `${o.name}.position`,
              [0, 1],
              [...o.position.toArray(), ...o.position.toArray()],
            ),
          );
      }
    });
    const clips = [...gltf.animations, new THREE.AnimationClip('opening', 1, opening)];
    for (const c of authored) clips.push(c);
    // He stands square: the Idle averaged with its mirror image (./stand.ts).
    const idle = clips.find((c) => c.name.toLowerCase() === 'idle');
    if (idle) clips.push(symmetricClip(idle, 'stand'));
    for (const clip of clips) {
      const name = clip.name.toLowerCase();
      if (!name.includes('rootmotion')) this.actions.set(name, this.mixer.clipAction(clip));
    }
    if (!surface) throw new Error('The charcoal body is missing.');
    this.surface = surface;
    // Older hosts of the reusable character can keep their original body asset shelf.
    if (detail)
      this.detailIndices = {
        high: surface.geometry.index!.clone(),
        ...bodyDetailIndices(detail, surface.geometry.getAttribute('position').count),
      };
    plume.colorSpace = THREE.SRGBColorSpace;
    this.fire = new FireParticles(surface, plume);
    this.object.add(this.fire.object);
    this.setDetail(this.detail);
  }
  setDetail(detail: BodyDetail) {
    this.detail = detail;
    if (this.surface && this.detailIndices && this.appliedDetail !== detail) {
      const index = this.surface.geometry.index!,
        selected = this.detailIndices[detail];
      index.array.set(selected.array);
      index.needsUpdate = true;
      this.surface.geometry.setDrawRange(0, selected.count);
      this.appliedDetail = detail;
    }
  }
  update(motion: MotionState, cue: Cue, score: Score, time: number, dt: number, supportDt = dt) {
    if (!this.mixer || !this.root || !this.fire) return;
    this.object.position.copy(motion.position);
    this.object.rotation.y = motion.facing;
    if (this.previous.distanceTo(this.object.position) > 3) this.grounding?.reset();
    this.heat.value = cue.burn * score.ember * 3.2;
    this.time.value = time;
    const gesture = cue.clip === 'locomotion' && motion.gesture && this.actions.has(motion.gesture.clip)
      ? motion.gesture : undefined;
    const name = cue.clip === 'locomotion'
      ? gesture?.clip ?? (motion.speed > 0.025 ? 'walk' : 'stand') : cue.clip;
    const next = this.actions.get(name)!;
    if (!next) throw new Error(`Missing authored action ${name}`);
    if (this.active !== next) {
      const previous = this.active;
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(0).play();
      next.setLoop(THREE.LoopRepeat, Infinity);
      if (previous) previous.crossFadeTo(next, 0.28, false);
      this.active = next;
    }
    this.animation = name;
    const duration = next.getClip().duration;
    next.time = gesture
      ? name === 'stand' ? gesture.time % duration : Math.min(gesture.time, duration - 0.00001)
      : name === 'opening'
        ? 0
        : name === 'walk'
          ? ((motion.distance / WALK_STRIDE) * duration) % duration
          : name === 'stand'
            ? time % duration
            : name === 'kneeling'
              ? cue.clipTime % duration
              : Math.min(cue.clipTime, duration - 0.001);
    for (const [bone, q] of this.poseBase) bone.quaternion.copy(q);
    this.mixer.update(dt);
    // Small, bounded final bow, evaluated fresh over the sampled authored pose.
    const head = this.root.getObjectByName('mixamorig1Head'),
      neck = this.root.getObjectByName('mixamorig1Neck'),
      chest = this.root.getObjectByName('mixamorig1Spine2');
    for (const bone of [head, neck, chest])
      if (bone) this.poseBase.set(bone, bone.quaternion.clone());
    // The head anticipates a requested direction; the chest carries a little
    // of a walking curve's weight. An orbit by itself never steers the man.
    const steering = cue.clip === 'locomotion' && motion.intent !== undefined;
    const follow = 1 - Math.exp(-dt * 8);
    const turnRate = this.lastFacing === undefined || dt <= 0 ? 0
      : angleDelta(motion.facing, this.lastFacing) / dt;
    this.lookYaw += ((steering ? Math.max(-0.5, Math.min(0.5, angleDelta(motion.intent!, motion.facing))) : 0) - this.lookYaw) * follow;
    this.lean += ((steering ? Math.max(-0.09, Math.min(0.09, -turnRate * motion.speed * 0.055)) : 0) - this.lean) * follow;
    this.lastFacing = motion.facing;
    if (head) head.rotateY(this.lookYaw * 0.65);
    if (neck) neck.rotateY(this.lookYaw * 0.15);
    if (chest) {
      chest.rotateY(this.lookYaw * 0.2);
      chest.rotateZ(this.lean);
    }
    if (head) head.rotateX(cue.bow * 0.68);
    if (neck) neck.rotateX(cue.bow * 0.12);
    if (chest) chest.rotateX(cue.bow * 0.1);
    this.object.updateWorldMatrix(true, true);
    if (this.grounding) {
      this.object.position.y += this.grounding.update(
        motion.position.y,
        supportDt,
        cue.clip === 'locomotion' || cue.clip === 'opening',
      );
      this.object.updateWorldMatrix(true, true);
    }
    this.readContacts();
    if (this.previous.distanceTo(this.object.position) > 3) this.fire.clear();
    this.previous.copy(this.object.position);
    this.fire.wind.set(score.wind, 0, 0);
    this.fire.legFire = score.legFire;
    this.fire.smokeAmount = score.smoke;
    this.fire.update(dt, cue.burn * score.flame, motion.velocity, false);
  }
  /** Where the body meets the ground, whatever the pose: the parts that take his
   * weight when he walks, falls, kneels and settles. Read straight off the rig
   * after grounding, so a contact is where the sand should darken under it. */
  readonly contacts: {x: number; y: number; z: number; radius: number}[] = [
    {x: 0, y: 0, z: 0, radius: 0.15},
    {x: 0, y: 0, z: 0, radius: 0.15},
    {x: 0, y: 0, z: 0, radius: 0.14},
    {x: 0, y: 0, z: 0, radius: 0.14},
    {x: 0, y: 0, z: 0, radius: 0.11},
    {x: 0, y: 0, z: 0, radius: 0.11},
  ];
  /** Sole centres and headings for the captured pivot/start/stop contacts. */
  readonly feet = Array.from({length: 2}, () => ({x: 0, y: 0, z: 0, facing: 0}));
  /** From each joint down to the skin that actually meets the sand. */
  private readonly contactDrop = [0.028, 0.028, 0.055, 0.055, 0.03, 0.03];
  private readonly contactBones = [
    'LeftToeBase',
    'RightToeBase',
    'LeftLeg',
    'RightLeg',
    'LeftHand',
    'RightHand',
  ];
  private readContacts() {
    if (!this.root) return;
    for (let i = 0; i < this.contactBones.length; i++) {
      const bone = this.root.getObjectByName(`mixamorig1${this.contactBones[i]!}`);
      const contact = this.contacts[i]!;
      if (!bone) continue;
      bone.getWorldPosition(scratch);
      contact.x = scratch.x;
      contact.y = scratch.y - this.contactDrop[i]!;
      contact.z = scratch.z;
      if (i < 2) {
        const ankle = this.root.getObjectByName(`mixamorig1${i === 0 ? 'Left' : 'Right'}Foot`);
        if (!ankle) continue;
        ankle.getWorldPosition(scratch);
        const foot = this.feet[i]!;
        foot.x = (scratch.x + contact.x) / 2;
        foot.z = (scratch.z + contact.z) / 2;
        foot.y = Math.min(scratch.y - 0.099, contact.y);
        foot.facing = Math.atan2(contact.x - scratch.x, contact.z - scratch.z);
      }
    }
  }

  /** Sample the authored pose and warm only the visible 1.8-second fire history. */
  seek(sample: (time: number) => MotionState, score: Score, time: number) {
    this.clear();
    const from = Math.max(0, time - 1.8);
    this.update(sample(from), sampleScore(from, score), score, from, 0);
    for (let at = from; at < time - 1e-8;) {
      const dt = Math.min(0.1, time - at);
      at += dt;
      this.update(sample(at), sampleScore(at, score), score, at, dt);
    }
    this.update(sample(time), sampleScore(time, score), score, time, 0);
  }
  clear() {
    this.fire?.clear();
    this.grounding?.reset();
    for (const [bone, q] of this.poseBase) bone.quaternion.copy(q);
    this.poseBase.clear();
    this.lastFacing = undefined;
    this.lookYaw = this.lean = 0;
    this.mixer?.stopAllAction();
    this.active = undefined;
  }
  inspect() {
    const point = new THREE.Vector3();
    return {
      animation: this.animation,
      detail: this.detailIndices ? this.detail : 'high',
      triangles:
        (this.detailIndices?.[this.detail].count ?? this.surface?.geometry.index?.count ?? 0) / 3,
      grounding: this.grounding?.inspect(),
      fire: this.fire?.inspect(),
      posture: Object.fromEntries(
        [
          'Hips',
          'Head',
          'LeftLeg',
          'RightLeg',
          'LeftFoot',
          'RightFoot',
          'LeftHand',
          'RightHand',
        ].map((n) => [
          n,
          this.root?.getObjectByName(`mixamorig1${n}`)?.getWorldPosition(point).toArray(),
        ]),
      ),
    };
  }
  dispose() {
    this.fire?.dispose();
    this.mixer?.stopAllAction();
    this.root?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    this.object.removeFromParent();
    // The body adopted the downloaded scene and has now taken it apart, so the
    // download is forgotten with it: a piece mounted again in the same page
    // asks for the files afresh (out of the browser's cache, which keeps them
    // for a year) rather than being handed a scene with no body in it.
    if (assets?.work === this.files) assets = undefined;
  }
}
