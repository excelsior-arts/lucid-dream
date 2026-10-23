import * as THREE from 'three/webgpu';
import {SandField} from './field';
import {ATLAS_SIZE, FAR_ATLAS_SIZE} from './height-atlas';
import {terrainMaterial} from './terrain-material';

const SIZE = 256;
const COVERAGE = 32;
/** Flow fades within a few seconds; the compaction heal only creeps after that. */
const FADING = 3;
const SETTLED_INTERVAL = 1;

/** World-aligned rings: 12.5 cm at the feet, 1 m out to 160 m, then a static 2 m survey. */
export class SandTerrain {
  readonly object = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private distant: THREE.Mesh[] = [];

  private survey: THREE.DataTexture;
  private horizon: THREE.DataTexture;
  private data = new Uint8Array(SIZE * SIZE * 4);
  private texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGBAFormat);
  private uniforms = {
    sandMap: {value: this.texture},
    heightAtlas: {value: null as unknown as THREE.DataTexture},
    horizonAtlas: {value: null as unknown as THREE.DataTexture},
    sandOrigin: {value: new THREE.Vector2()},
    sandTime: {value: 0},
    terrainCenter: {value: new THREE.Vector2()},
    sandWind: {value: new THREE.Vector2(2.5, 0.7)},
    // What the wet sand mirrors: the sky just above the sea, not the zenith.
    shoreSky: {value: new THREE.Color('#ff8c7a')},
    rippleRelief: {value: 1},
    // Where the body touches the sand: x, z, radius and strength per contact.
    contact0: {value: new THREE.Vector4(0, 0, 1, 0)},
    contact1: {value: new THREE.Vector4(0, 0, 1, 0)},
    contact2: {value: new THREE.Vector4(0, 0, 1, 0)},
    contact3: {value: new THREE.Vector4(0, 0, 1, 0)},
    contact4: {value: new THREE.Vector4(0, 0, 1, 0)},
    contact5: {value: new THREE.Vector4(0, 0, 1, 0)},
  };
  private material: THREE.MeshStandardNodeMaterial;
  private disposeMaterial: () => void;
  private center = new THREE.Vector2(Infinity, Infinity);
  private elapsed = 1;
  private revision = -1;
  private rebuilds = 0;

  /** A shadow map cannot hold the darkness right under a foot at a grazing light,
   * so the ground carries it: each contact darkens a small patch under itself,
   * widening and fading as it lifts away. No extra pass, six uniforms a frame. */
  setContacts(points: readonly {x: number; y: number; z: number; radius: number}[]) {
    const slots = [
      this.uniforms.contact0.value,
      this.uniforms.contact1.value,
      this.uniforms.contact2.value,
      this.uniforms.contact3.value,
      this.uniforms.contact4.value,
      this.uniforms.contact5.value,
    ] as THREE.Vector4[];
        for (let i = 0; i < slots.length; i++) {
      const point = points[i];
      const slot = slots[i]!;
      if (!point) {
        slot.set(0, 0, 1, 0);
        continue;
      }
      const lift = Math.max(0, point.y - this.field.height(point.x, point.z));
      const fade = Math.max(0, 1 - lift / 0.5);
      slot.set(point.x, point.z, point.radius * (1 + lift * 1.2), fade * fade * 0.3);
    }
  }

  /** How much relief the wind ripples show, 0 to 1. Under a grazing light a
   * full-relief ripple's back goes black and a slope of them reads as terraces,
   * so the desert lowers this as its leading light drops toward the horizon. */
  setRippleRelief(relief: number) {
    this.uniforms.rippleRelief.value = THREE.MathUtils.clamp(relief, 0, 1);
  }

  /** Follow the sky's own horizon colour, so the shore mirrors what is above it. */
  setShoreSky(color: THREE.Color) {
    (this.uniforms.shoreSky.value as THREE.Color).copy(color);
  }

  readonly field: SandField;

  constructor(field: SandField) {
    this.field = field;
    // The survey is the geography's; the textures wrap it without a copy.
    this.survey = new THREE.DataTexture(field.geo.heightAtlas(), ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
    this.horizon = new THREE.DataTexture(field.geo.horizonAtlas(), FAR_ATLAS_SIZE, FAR_ATLAS_SIZE, THREE.RGBAFormat);
    this.uniforms.heightAtlas.value = this.survey;
    this.uniforms.horizonAtlas.value = this.horizon;
    for (const texture of [this.survey, this.horizon]) {
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
    }
    for (let i = 0; i < this.data.length; i += 4) this.data[i] = 128;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    const surface = terrainMaterial(this.uniforms, field.geo.landscape);
    this.material = surface.material;
    this.disposeMaterial = surface.dispose;
    for (let level = 0; level < 4; level++) {
      const step = 0.125 * 2 ** level;
      const cells = level === 3 ? 320 : 128;
      const half = cells / 2;
      const positions: number[] = [],
        indices: number[] = [],
        lod: number[] = [];
      for (let z = 0; z <= cells; z++)
        for (let x = 0; x <= cells; x++) {
          positions.push((x - half) * step, 0, (z - half) * step);
          lod.push(step, half * step);
        }
      for (let z = 0; z < cells; z++)
        for (let x = 0; x < cells; x++) {
          if (level > 0 && x >= half - 32 && x < half + 32 && z >= half - 32 && z < half + 32)
            continue;
          const a = z * (cells + 1) + x,
            b = a + 1,
            c = a + cells + 1,
            d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('terrainLod', new THREE.Float32BufferAttribute(lod, 2));
      geo.setAttribute(
        'terrainDistant',
        new THREE.BufferAttribute(new Float32Array(positions.length / 3), 1),
      );
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.material);

      mesh.receiveShadow = mesh.castShadow = true;
      // Displacement happens on the GPU; CPU bounds describe the flat grid.
      mesh.frustumCulled = false;
      this.object.add(mesh);
      this.rings.push(mesh);
    }
    // Immutable two-metre survey around the full authored map. The fine rings
    // cover its inner part; the material discards the underlay around the walker.
    const distant = new THREE.Group();
    distant.name = 'Authored dunes beyond the walking rings';
    for (let z = -256; z < 256; z += 128)
      for (let x = -256; x < 256; x += 128) {
        const geometry = new THREE.PlaneGeometry(128, 128, 64, 64);
        geometry.rotateX(-Math.PI / 2);
        const count = geometry.getAttribute('position').count;
        const lod = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) lod[i * 2] = 2;
        geometry.setAttribute('terrainLod', new THREE.BufferAttribute(lod, 2));
        geometry.setAttribute(
          'terrainDistant',
          new THREE.BufferAttribute(new Float32Array(count).fill(1), 1),
        );
        geometry.boundingBox = new THREE.Box3(
          new THREE.Vector3(-64, -21, -64),
          new THREE.Vector3(64, 44, 64),
        );
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.position.set(x + 64, 0, z + 64);
        distant.add(mesh);
        this.distant.push(mesh);
      }
    this.object.add(distant);
  }

  /** The distant eastern extension uses the same shading and height function. */
  get surfaceMaterial() {
    return this.material;
  }

  update(x: number, z: number, dt: number) {
    this.uniforms.sandTime.value = this.field.time;
    this.uniforms.sandWind.value.set(this.field.wind.x, this.field.wind.z);
    this.uniforms.terrainCenter.value.set(x, z);
    // Entire static tiles under the fine rings cannot contribute a pixel in any pass.
    for (const mesh of this.distant)
      mesh.visible =
        Math.max(Math.abs(mesh.position.x - x), Math.abs(mesh.position.z - z)) + 64 >= 158.5;
    const cx = Math.round(x),
      cz = Math.round(z);
    const moved = cx !== this.center.x || cz !== this.center.y;
    if (moved) for (const mesh of this.rings) mesh.position.set(cx, 0, cz);
    this.elapsed += dt;
    // Settled sand still heals, but by well under one byte a second. Keep the
    // tenth-second cadence while anything is actually moving or fading, and
    // let an undisturbed field refresh once a second instead of ten times.
    const changed = this.field.revision !== this.revision;
    const fading = this.field.time - this.field.disturbedAt < FADING;
    if (!moved && this.elapsed < (changed || fading ? 0.1 : SETTLED_INTERVAL)) return;
    this.elapsed = 0;
    this.revision = this.field.revision;
    this.rebuilds++;
    this.center.set(cx, cz);

    const ox = cx - COVERAGE / 2,
      oz = cz - COVERAGE / 2;
    // Texel centres coincide with the simulation grid, including negative cells.
    this.uniforms.sandOrigin.value.set(ox - COVERAGE / SIZE / 2, oz - COVERAGE / SIZE / 2);
    for (let j = 0; j < SIZE; j++)
      for (let i = 0; i < SIZE; i++) {
        const state = this.field.surface(ox + (i * COVERAGE) / SIZE, oz + (j * COVERAGE) / SIZE);
        const k = (j * SIZE + i) * 4;
        this.data[k] = Math.max(0, Math.min(255, Math.round(128 + state.delta * 100)));
        this.data[k + 1] = Math.round(state.compact * 255);
        this.data[k + 2] = Math.round(state.flow * 255);
        this.data[k + 3] = Math.round(state.loose * 255);
      }
    this.texture.needsUpdate = true;
  }
  inspect() {
    return {rebuilds: this.rebuilds, revision: this.revision};
  }
  setDark(dark: boolean) {
    this.material.color.set(dark ? '#738095' : '#b99160');
  }
  dispose() {
    this.object.removeFromParent();
    this.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });

    this.disposeMaterial();
    this.texture.dispose();
    this.survey.dispose();
    this.horizon.dispose();
  }
}
