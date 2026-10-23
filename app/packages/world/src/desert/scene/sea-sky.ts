import * as THREE from 'three/webgpu';
import {clamp, equirectUV, normalize, pmremTexture, texture} from 'three/tsl';
import type {SkyProvider} from 'threejs-water-pro';
import type {SeaLight} from './sea';
import {sampleSkyGradient} from './sky-gradient';

/** A small sky reflection probe whose texture identity survives the entire day.
 * Replacing this target makes the water integration rebuild every lit material.
 * Refilter into the existing target instead; only its pixels need to change.
 */
export class SeaSky implements SkyProvider {
  private readonly source: THREE.DataTexture;
  private readonly filter: THREE.PMREMGenerator;
  private readonly environment: THREE.RenderTarget;
  private readonly color = new THREE.Color();
  private readonly direction = new THREE.Vector3();
  private lastHour = NaN;

  private renderer: THREE.WebGPURenderer;

  constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;
    this.source = new THREE.DataTexture(new Uint8Array(64 * 32 * 4).fill(255), 64, 32);
    this.source.colorSpace = THREE.SRGBColorSpace;
    this.source.mapping = THREE.EquirectangularReflectionMapping;
    this.source.wrapS = THREE.RepeatWrapping;
    this.source.minFilter = this.source.magFilter = THREE.LinearFilter;
    this.source.needsUpdate = true;
    renderer.initTexture(this.source);
    this.filter = new THREE.PMREMGenerator(renderer);
    this.environment = this.filter.fromEquirectangular(this.source);
  }

  update(light: SeaLight) {
    if (Number.isFinite(this.lastHour) && Math.abs(light.hour - this.lastHour) <= 0.015) return;
    this.lastHour = light.hour;
    const pixels = this.source.image.data as Uint8Array;
    for (let y = 0; y < 32; y++) {
      const latitude = ((y + 0.5) / 32 - 0.5) * Math.PI;
      for (let x = 0; x < 64; x++) {
        // Inverse of Three's equirectUV, sampling each texel's centre.
        const longitude = ((x + 0.5) / 64 - 0.5) * Math.PI * 2;
        this.direction.set(
          Math.cos(latitude) * Math.cos(longitude),
          Math.sin(latitude),
          Math.cos(latitude) * Math.sin(longitude),
        );
        sampleSkyGradient(light, this.direction, this.color).convertLinearToSRGB();
        const i = (y * 64 + x) * 4;
        pixels[i] = Math.round(this.color.r * 255);
        pixels[i + 1] = Math.round(this.color.g * 255);
        pixels[i + 2] = Math.round(this.color.b * 255);
      }
    }
    this.source.needsUpdate = true;
    this.renderer.initTexture(this.source);
    this.filter.fromEquirectangular(this.source, this.environment);
  }

  createFogSampler(): ReturnType<SkyProvider['createFogSampler']> {
    return (direction) =>
      texture(this.source, equirectUV(normalize(direction as THREE.Node<'vec3'>))).rgb;
  }

  createReflectionSampler(): ReturnType<SkyProvider['createReflectionSampler']> {
    return (direction, roughness) =>
      pmremTexture(
        this.environment.texture,
        normalize(direction as THREE.Node<'vec3'>),
        clamp((roughness as THREE.Node<'float'>).add(0.22), 0, 1),
      ).rgb;
  }

  getEnvironmentTexture() {
    return this.environment.texture;
  }

  getMeshes(): THREE.Object3D[] {
    // The desert already owns the visible sky, sun and moon.
    return [];
  }

  followCamera() {}

  dispose() {
    this.environment.dispose();
    this.filter.dispose();
    this.source.dispose();
  }
}
