import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {mix, vec3, vec4, float, uniform, positionWorld, normalWorld, normalView,
  cameraViewMatrix, normalize, mx_noise_float, smoothstep, texture, uv} from 'three/tsl';
import {preloadCharacter} from '../character/man';
import {assetUrl} from '../assets';
import {MAP} from '../landscape';
import {FALLEN_ALTAR} from './fallen-site';
export {FALLEN_ALTAR} from './fallen-site';

// Wind catches in the armpits, beside the waist, and between the splayed legs.
// Centres and widths follow the baked pose; heights are a thin 1–2 inch deposit.
const SAND_POCKETS = [
  [0.28, -0.36, 0.10, 0.17, 0.043],
  [-0.07, -0.38, 0.10, 0.18, 0.045],
  [0.34, -0.10, 0.11, 0.28, 0.033],
  [-0.16, -0.20, 0.12, 0.25, 0.034],
  [0.035, 0.27, 0.15, 0.25, 0.047],
  [0.025, 0.59, 0.13, 0.26, 0.039],
  [0.20, 0.82, 0.13, 0.14, 0.027],
  [0.12, -0.62, 0.18, 0.10, 0.029],
] as const;

/** The drift fades below the surrounding bed, leaving no rectangular edge. */
export function tributeDrift(x: number, z: number) {
  const edge = Math.max(0, 1 - (x / 1.2) ** 2 - (z / 1.6) ** 2);
  let uncovered = 1;
  for (const [cx, cz, rx, rz, height] of SAND_POCKETS) {
    const pocket = Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
    uncovered *= 1 - pocket * height / 0.05;
  }
  return (1 - uncovered) * 0.05 * edge ** 0.5 + edge ** 2 * 0.002 - 0.001;
}

/** A dim, broad sky reflection gives metal and dead glass something to catch.
 * No scene capture, extra renderer, animation mixer, or per-frame readback. */
function agedReflection() {
  const width = 64, height = 32, pixels = new Uint8Array(width * height * 4);
  const sky = new THREE.Color('#839bad'), horizon = new THREE.Color('#d2b796');
  const ground = new THREE.Color('#554634'), color = new THREE.Color();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = y / (height - 1);
    if (t < 0.52) color.copy(sky).lerp(horizon, t / 0.52);
    else color.copy(horizon).lerp(ground, Math.min(1, (t - 0.52) / 0.28));
    const light = 0.85 + 0.15 * Math.cos(x / width * Math.PI * 2);
    color.multiplyScalar(light).convertLinearToSRGB();
    const i = (y * width + x) * 4;
    pixels[i] = color.r * 255; pixels[i+1] = color.g * 255; pixels[i+2] = color.b * 255; pixels[i+3] = 255;
  }
  const map = new THREE.DataTexture(pixels, width, height);
  map.colorSpace = THREE.SRGBColorSpace;
  map.mapping = THREE.EquirectangularReflectionMapping;
  map.needsUpdate = true;
  return map;
}

export class FallenAltar {
  readonly object = new THREE.Group();
  readonly ready: Promise<void>;
  private reflection = agedReflection();
  private disposed = false;
  private loaded = false;
  /** `after` holds the download back until the piece itself is up. Its place in
   * the world is known from the start, so nothing here waits on the file. */
  private ground: (x: number, z: number) => number;
  constructor(base: string, ground: (x: number, z: number) => number,
    sand: THREE.MeshStandardNodeMaterial, after?: Promise<unknown>) {
    this.ground = ground;
    this.object.name = 'The fallen one · a tribute';
    const [x, z] = FALLEN_ALTAR.position;
    this.object.position.set(x, ground(x, z), z);
    this.object.rotation.y = FALLEN_ALTAR.yaw;
    this.ready = this.load(base, sand, after);
  }
  private async load(base: string, sand: THREE.MeshStandardNodeMaterial,
    after?: Promise<unknown>) {
    // The body, the sea and the sand are what a viewer is waiting for. This one
    // is off the walk and behind a dune, so it takes the line only once they
    // have theirs, rather than competing for it on a slow connection.
    if (after) await after.catch(() => {});
    if (this.disposed) return;
    const [gltf, body] = await Promise.all([
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetUrl('character/fallen.glb')),
      preloadCharacter(base),
    ]);
    const p = positionWorld.sub(uniform(this.object.position));
    const noise = mx_noise_float(p.mul(27)).mul(0.5).add(0.5);
    const grit = mx_noise_float(p.mul(370)).mul(0.5).add(0.5);
    const dustColor = uniform(sand.color.clone().lerp(new THREE.Color('#c5b79c'), 0.25));
    const low = float(1).sub(smoothstep(0.035, 0.28, p.y));
    const dust = smoothstep(0.26, 0.72, noise.add(low.mul(0.7)))
      .mul(smoothstep(-0.1, 0.8, normalWorld.y)).mul(0.48);
    const charcoal = new THREE.MeshStandardNodeMaterial({roughness: 0.96, metalness: 0.025});
    charcoal.name = 'Aged charcoal · the same body';
    charcoal.normalMap = body.relief;
    const cavity = texture(body.cavity, uv()).r;
    const coal = mix(vec3(0.10, 0.078, 0.062), vec3(0.20, 0.15, 0.105), noise)
      .mul(grit.mul(0.12).add(0.86)).mul(float(1).sub(cavity.mul(0.48)));
    charcoal.colorNode = mix(coal, dustColor, dust);
    const gold = new THREE.MeshStandardNodeMaterial({metalness: 0.5, roughness: 0.86,
      envMap: this.reflection, envMapIntensity: 0.18});
    gold.name = 'Heat-stained gold with wind abrasion';
    const tarnish = mx_noise_float(p.mul(43)).mul(0.5).add(0.5);
    const soot = smoothstep(0.52, 0.83, noise.add(low.mul(0.2)));
    const brass = mix(vec3(0.38, 0.28, 0.15), vec3(0.52, 0.40, 0.24), tarnish);
    gold.colorNode = mix(mix(brass, vec3(0.042, 0.034, 0.025), soot.mul(0.57)), dustColor, dust.mul(0.7).add(0.08));
    gold.roughnessNode = float(0.76).add(soot.mul(0.16)).add(grit.mul(0.06));
    const visor = new THREE.MeshStandardNodeMaterial({color: '#101719', metalness: 0.10,
      roughness: 0.82, envMap: this.reflection, envMapIntensity: 0.10});
    visor.name = 'Dead, scratched visor';
    visor.colorNode = mix(vec3(.012,.018,.020), dustColor, dust.mul(.4));
    visor.roughnessNode = float(.70).add(noise.mul(.20));
    const seams = new THREE.MeshStandardNodeMaterial({color: '#30291d', roughness: 0.88, metalness: 0.25});
    const materials: Record<string, THREE.Material> = {
      'Charcoal remains': charcoal, 'Weathered gold': gold, 'Dead visor': visor, 'Soot seams': seams,
    };
    gltf.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const old = o.material as THREE.Material;
      o.material = materials[old.name] ?? seams;
      old.dispose();
      o.castShadow = o.receiveShadow = true;
    });
    gltf.scene.position.y -= FALLEN_ALTAR.burial;
    this.object.add(gltf.scene);
    const geometry = new THREE.PlaneGeometry(2.4, 3.2, 80, 104);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position!;
    const sin = Math.sin(FALLEN_ALTAR.yaw), cos = Math.cos(FALLEN_ALTAR.yaw);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const wx = this.object.position.x + x*cos + z*sin;
      const wz = this.object.position.z - x*sin + z*cos;
      positions.setY(i, this.ground(wx,wz) - this.object.position.y + tributeDrift(x,z));
    }
    geometry.computeVertexNormals();
    // Use the playa's world-aligned colour and relief, including its dust tile,
    // so the thin apron meets the surrounding bed without a visible seam.
    geometry.setAttribute('terrainDistant', new THREE.BufferAttribute(new Float32Array(positions.count), 1));
    const drift = sand.clone();
    drift.positionNode = null;
    // Keep the same fine crust relief while lighting the actual deposited slopes.
    const flatNormal = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    const bedNormal = sand.normalNode as THREE.Node<'vec3'>;
    drift.normalNode = normalize(bedNormal.add(normalView.sub(flatNormal)));
    // The wide landscape shadow map cannot resolve centimetres beneath a body.
    // A faint baked contact shade seats the back and heels in the fine dust.
    const lx = p.x.mul(cos).sub(p.z.mul(sin));
    const lz = p.x.mul(sin).add(p.z.mul(cos));
    const contact = (x: number, z: number, rx: number, rz: number) => {
      const u = lx.sub(x).div(rx), v = lz.sub(z).div(rz);
      return float(1).sub(smoothstep(.25, 1, u.mul(u).add(v.mul(v))));
    };
    const shade = contact(.12, -.28, .25, .4).mul(.24)
      .add(contact(.08, .02, .22, .23).mul(.18))
      .add(contact(.22, .82, .11, .14).mul(.2))
      .add(contact(-.22, .76, .11, .14).mul(.2));
    drift.colorNode = sand.colorNode!.mul(float(1).sub(shade));
    const dune = new THREE.Mesh(geometry, drift);
    dune.name = 'Wind-deposited sand over the limbs';
    dune.receiveShadow = true;
    this.object.add(dune);
    this.loaded = true;
    if (this.disposed) this.dispose();
  }
  inspect() {
    return {ready: this.loaded, position: this.object.position.toArray(), yaw: this.object.rotation.y,
      floor: MAP.floor, burial: FALLEN_ALTAR.burial, static: true};
  }
  dispose() {
    this.disposed = true;
    const geometry = new Set<THREE.BufferGeometry>(), material = new Set<THREE.Material>();
    this.object.traverse(o => {
      if (o instanceof THREE.Mesh) {
        geometry.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) material.add(m);
      }
    });
    for (const g of geometry) g.dispose();
    for (const m of material) m.dispose();
    this.reflection.dispose();
    this.object.clear();
    this.object.removeFromParent();
  }
}
