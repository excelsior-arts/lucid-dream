import * as THREE from 'three/webgpu';
import {
  uv,
  float,
  vec3,
  mix,
  sin,
  pow,
  smoothstep,
  uniform,
  positionLocal,
  mx_noise_float,
  bumpMap,
} from 'three/tsl';
import {MAP} from '../landscape';
import {duneHeight} from '../landscape';
import {beamGeometry, dreamcatcher, joined, ring, sculpture} from './altar-geometry';
import {earthTriangles} from './earth-alignment';
import {earthSlab} from './earth-slab';

/** Three quiet objects beyond the life of the walker. Terrain supplies the
 * concealment; there are no proximity switches that pop an altar into view. */
export class ElementalAltars {
  readonly object = new THREE.Group();
  private time = uniform(0);
  private catcher: ReturnType<typeof dreamcatcher>;
  private air: THREE.Group;
  constructor() {
    this.object.name = 'The unreachable elements';
    const stone = new THREE.MeshStandardNodeMaterial({color: '#c5b99f', roughness: 0.82});
    const dark = new THREE.MeshStandardNodeMaterial({color: '#3b3530', roughness: 0.9});
    const make = (name: keyof typeof MAP.altars) => {
      const group = new THREE.Group(),
        [x, z] = MAP.altars[name];
      group.name = `${name} altar`;
      group.position.set(x, duneHeight(x, z), z);
      // Face the actual passage exit, including the bend around its final curl.
      const [gateX, gateZ] = MAP.gates[name];
      group.rotation.y = Math.atan2(gateX - x, gateZ - z);
      this.object.add(group);
      return group;
    };
    const box = (
      group: THREE.Group,
      size: [number, number, number],
      at: [number, number, number],
      material = stone,
    ) => {
      const geometry = new THREE.BoxGeometry(...size);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...at);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    // Air: a two-metre circle with a smaller woven hoop suspended inside it.
    const air = (this.air = make('air'));
    const cord = new THREE.MeshStandardNodeMaterial({
      color: '#d5c4a2',
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    sculpture(air, ring(0.925, 0.075, 1.04), stone);
    box(air, [1.2, 0.08, 0.55], [0, 0.04, 0]);
    this.catcher = dreamcatcher(air, stone, cord);
    // Fire: the upward triangle, open at its heart, with an ember bowl below.
    const fire = make('fire');
    box(fire, [2.3, 0.18, 1.35], [0, 0.09, 0], dark);
    const top = [0, 2.12, 0] as const,
      left = [-1, 0.22, 0] as const,
      right = [1, 0.22, 0] as const;
    sculpture(
      fire,
      joined([
        beamGeometry(left, top, 0.085),
        beamGeometry(top, right, 0.085),
        beamGeometry(right, left, 0.085),
      ]),
      stone,
    );
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.22, 0.22, 24), dark);
    bowl.position.y = 0.38;
    fire.add(bowl);
    // A handful of transparent flame sheets is enough for this small, distant fire.
    const flameMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const q = uv(),
      t = this.time;
    const sway = sin(q.y.mul(13).sub(t.mul(5)))
      .mul(0.09)
      .mul(q.y);
    const width = float(0.42).mul(float(1).sub(q.y)).add(0.025);
    const edge = smoothstep(width, width.add(0.12), q.x.sub(0.5).sub(sway).abs());
    const pulse = sin(
      q.y
        .mul(27)
        .sub(t.mul(8))
        .add(sin(q.x.mul(19).add(t))),
    )
      .mul(0.15)
      .add(0.85);
    flameMaterial.colorNode = mix(
      vec3(4.5, 0.24, 0.015),
      vec3(7, 3.4, 0.35),
      pow(float(1).sub(q.y), 2),
    );
    flameMaterial.opacityNode = float(1)
      .sub(edge)
      .mul(pulse)
      .mul(float(1).sub(smoothstep(0.65, 1, q.y)))
      .mul(smoothstep(0, 0.1, q.y))
      .mul(0.8);
    const flame = new THREE.Group();
    flame.name = 'Small wind-blown altar fire';
    flame.position.set(0, 0.91, 0);
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.05), flameMaterial);
      mesh.rotation.y = (i * Math.PI) / 3;
      flame.add(mesh);
    }
    fire.add(flame);
    // Three heavy stone slabs share the projected Black Rock summit positions.
    const earth = make('earth');
    earth.rotation.y = 0;
    const earthStone = new THREE.MeshStandardNodeMaterial({
      color: '#968975',
      roughness: 1,
      vertexColors: true,
      flatShading: true,
    });
    const grain = mx_noise_float(positionLocal.mul(22));
    const fracture = mx_noise_float(positionLocal.mul(3.5));
    earthStone.colorNode = uniform(earthStone.color).mul(
      grain.mul(0.12).add(fracture.mul(0.18)).add(1),
    );
    earthStone.normalNode = bumpMap(fracture.add(grain.mul(0.22)), float(0.065));
    for (const [index, triangle] of earthTriangles().entries()) {
      const points = triangle.frame.map((p) => p.clone().sub(earth.position));
      const slab = sculpture(earth, earthSlab(points, index), earthStone);
      slab.name = `Black Rock stone peak ${index + 1}`;
    }
  }
  update(time: number, wind = {x: 2.4, z: 0}) {
    this.time.value = time;
    const strength = Math.min(1, Math.hypot(wind.x, wind.z) / 4);
    // Convert sea-to-mountain wind into the hoop's local plane. Absolute time
    // makes paused scrubbing deterministic; only the suspended pieces move.
    const x = wind.x * Math.cos(this.air.rotation.y) - wind.z * Math.sin(this.air.rotation.y);
    const z = wind.x * Math.sin(this.air.rotation.y) + wind.z * Math.cos(this.air.rotation.y);
    const gust =
      strength * (0.12 + Math.sin(time * 1.7) * 0.045 + Math.sin(time * 2.9 + 0.8) * 0.025);
    // A hung thing leans downwind. Leaning toward +x is a positive turn about z,
    // and leaning toward +z is a negative turn about x; both were the wrong way
    // round, so the catcher swung into the wind that the fire was streaming from.
    this.catcher.pivot.rotation.set(-gust * z, Math.sin(time * 0.7) * strength * 0.1, gust * x);
    for (let i = 0; i < this.catcher.feathers.length; i++) {
      const feather = this.catcher.feathers[i]!;
      feather.rotation.x = Math.sin(time * (3.8 + i * 0.5) + i) * strength * 0.24;
      feather.rotation.z = Math.sin(time * 2.3 + i * 2) * strength * 0.12;
    }
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.object.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.object.removeFromParent();
  }
}
