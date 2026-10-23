import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  fwidth,
  length,
  mix,
  normalWorldGeometry,
  normalize,
  cameraViewMatrix,
  vec4,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import type {Geography} from '../landscape';
import {sandNoise} from '../render/terrain-functions.js';
import {playaSurface} from '../sand/playa-surface';

/** Immutable dunes open east onto five hundred metres of playa, then the
 * Black Rock silhouette. The sand shares the walking terrain's palette. */
export class MountainRange {
  readonly object = new THREE.Group();
  private material: THREE.MeshStandardNodeMaterial;
  private disposeDust: () => void;
  constructor(geo: Geography, sand = new THREE.Color('#b99160')) {
    const floor = geo.landscape.floor;
    this.object.name = 'Crescent dunes, eastern flats and Black Rock horizon';
    this.material = new THREE.MeshStandardNodeMaterial({roughness: 0.96});
    const point = positionWorld;
    const rockHeight = attribute<'float'>('rockHeight', 'float');
    const duneCover = smoothstep(0.08, 0.7, point.y.add(0.015).sub(rockHeight).sub(floor));
    const playa = float(1)
      .sub(duneCover)
      .mul(smoothstep(0.975, 0.997, normalWorldGeometry.y));
    const dust = playaSurface(
      point,
      playa
        .mul(smoothstep(0.65, floor, point.y.add(0.015)))
        .mul(float(1).sub(smoothstep(0, 5, rockHeight))),
    );
    this.disposeDust = dust.dispose;
    this.material.roughnessNode = dust.roughness;
    const surfaceNormal = normalize(
      normalWorldGeometry.sub(vec3(dust.gradient.x, 0, dust.gradient.y)),
    );
    this.material.normalNode = normalize(cameraViewMatrix.mul(vec4(surfaceNormal, 0)).xyz);
    const grainFade = float(1).sub(smoothstep(0.1, 0.6, length(fwidth(point.xz)).mul(180)));
    const color = mix(uniform(sand), vec3(0.62, 0.55, 0.43), playa.mul(0.48)).mul(
      float(0.91)
        .add(sandNoise(point.xz.mul(0.18)).mul(0.16))
        .add(sandNoise(point.xz.mul(180)).sub(0.5).mul(0.15).mul(grainFade)),
    );
    const wet = float(1)
      .sub(smoothstep(0.02, 0.65, point.y))
      .mul(float(1).sub(smoothstep(-70, -50, point.x)));
    this.material.colorNode = mix(
      color.mul(dust.tint).mul(float(1).sub(wet.mul(0.3))),
      uniform(new THREE.Color('#675e52')),
      smoothstep(0, 15, rockHeight),
    );
    const height = (x: number, z: number) => geo.surveyedHeight(x, z) + geo.mountainHeight(x, z);
    const normal = new THREE.Vector3();
    for (let z = -2048; z < 2048; z += 256)
      for (let x = -2048; x < 2048; x += 256) {
        // The detailed survey owns the central 512 m square. The shared 8 m
        // horizon grid keeps its boundary heights aligned with these meshes.
        if (x >= -256 && x < 256 && z >= -256 && z < 256) continue;
        const rockRange = x >= 512 && x < 1024;
        const coast = x >= -512 && x < 0;
        const dunes = geo.horizon.inTile(x, z, 256);
        const detail = rockRange || coast || dunes ? 8 : 128;
        const geometry = new THREE.PlaneGeometry(256, 256, 256 / detail, 256 / detail);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        const rockHeights = new Float32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
          const px = x + 128 + positions.getX(i),
            pz = z + 128 + positions.getZ(i);
          positions.setY(i, height(px, pz) - 0.015);
          rockHeights[i] = geo.mountainHeight(px, pz);
          // Sample the same surface normal as the detailed sand. Independent
          // per-mesh normal averaging would leave visible lighting seams.
          normal
            .set(
              height(px - 0.125, pz) - height(px + 0.125, pz),
              0.25,
              height(px, pz - 0.125) - height(px, pz + 0.125),
            )
            .normalize();
          normals.setXYZ(i, normal.x, normal.y, normal.z);
        }
        geometry.setAttribute('rockHeight', new THREE.BufferAttribute(rockHeights, 1));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.position.set(x + 128, 0, z + 128);
        this.object.add(mesh);
      }
  }
  dispose() {
    for (const child of this.object.children) (child as THREE.Mesh).geometry.dispose();
    this.material.dispose();
    this.disposeDust();
    this.object.removeFromParent();
  }
}
