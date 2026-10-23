import * as THREE from 'three/webgpu';
import {WaterSystem, getPresetParams} from 'threejs-water-pro';
import {SeaSky} from './sea-sky';
import {WaveReadback} from './wave-readback';
import type {SkyGradient} from './sky-gradient';
export type SeaQuality = 'medium' | 'low';
export type SeaLight = SkyGradient & {
  hour: number;
  daylight: number;
  sunDirection: number[];
  sunIntensity: number;
  moonDirection: number[];
  moonIntensity: number;
};

/** The author's displaced water surface shares the scene, depth, and renderer. */
export class CoastalSea {
  status = 'loading';
  error = '';
  frames = 0;
  private time = 0;
  private water?: WaterSystem;
  private sky?: SeaSky;
  private readback?: WaveReadback;
  private readonly moonDirection = new THREE.Vector3();
  private readonly moonColor = new THREE.Color('#709fff');
  private disposed = false;
  private readonly params = getPresetParams('sunset');
  readonly ready: Promise<void>;
  private renderer: THREE.WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private quality: SeaQuality;
  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: SeaQuality = 'medium',
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    const p = this.params;
    // Host-authored overrides of the installed package preset; no vendor source is copied.
    Object.assign(p.waves.fft, {
      peakWavelength: 20,
      windSpeed: 6,
      windDirection: 0,
      amplitude: 0.75,
    });
    p.waves.fft.cascades.maxScale = 128;
    p.oceanFloor.enabled = false;
    p.ssr.enabled = false;
    p.spray.enabled = false;
    p.foam.surface.opacity = 0.18;
    p.foam.waves.opacity = 0.7;
    p.foam.waves.persistence.decayTime = 0.85;
    p.fog.fadeStart = 250;
    p.fog.fadeEnd = 1850;
    this.ready = this.initialize().catch((e) => {
      this.status = 'error';
      this.error = String(e);
      console.error('Sea initialization failed', e);
      throw e;
    });
  }
  private async initialize() {
    const fog = this.scene.fogNode;
    this.water = await WaterSystem.create(this.renderer, this.scene, this.camera, this.quality);
    const w = this.water;
    w.loadPreset(this.params);
    this.scene.fogNode = fog;
    this.shareLighting();
    this.sky = new SeaSky(this.renderer);
    w.setSky(this.sky);
    this.status = 'ready';
    if (this.disposed) this.dispose();
  }
  private shareLighting() {
    const water = this.water!;
    const sampler = water.buoyancy.getSampler();
    if (water.backend === 'webgpu' && sampler !== this.readback) {
      this.readback?.dispose();
      this.readback = new WaveReadback(sampler);
      water.buoyancy.setSampler(this.readback);
    }
    this.water!.wake.enabled = false;
    // The desert owns both the sun and moon, including the night-time blue fill.
    this.water!.lighting.sunLight.visible = false;
    this.water!.lighting.sunLight.castShadow = false;
    // The package fits fog to its infinite water ring when applying a preset.
    this.water!.fog.fadeStart = this.params.fog.fadeStart;
    this.water!.fog.fadeEnd = this.params.fog.fadeEnd;
  }

  /** Await between frames: the package rebuilds FFT/material resources in place. */
  async setQuality(quality: SeaQuality) {
    if (!this.water || this.disposed || quality === this.quality) return;
    const fog = this.scene.fogNode;
    try {
      await this.readback?.drain();
      await this.water.setQualityLevel(quality, this.params);
      this.quality = quality;
      this.shareLighting();
    } finally {
      this.scene.fogNode = fog;
    }
  }

  get system() {
    return this.water!;
  }
  async update(dt: number, _camera: THREE.PerspectiveCamera, light: SeaLight) {
    if (!this.water || this.disposed) return;
    const w = this.water;
    // The package has one specular light. Blend its direction and tint by
    // actual illumination so a brighter crescent does not act like a warm sun.
    const intensity = light.sunIntensity + light.moonIntensity;
    const direction = w.lighting.sun.direction.value;
    this.moonDirection.fromArray(light.moonDirection);
    direction
      .fromArray(light.sunDirection)
      .multiplyScalar(light.sunIntensity)
      .addScaledVector(this.moonDirection, light.moonIntensity);
    if (direction.lengthSq() < 0.000001) direction.copy(this.moonDirection);
    else direction.normalize();
    w.lighting.sun.intensity.value = intensity;
    w.lighting.sun.color
      .set('#fff0d5')
      .lerp(this.moonColor, light.moonIntensity / Math.max(0.0001, intensity));
    w.environment.intensity = 0.008 + light.daylight * 0.292;
    this.sky?.update(light);
    w.fog.color.copy(light.horizon);
    await w.update(dt);
    this.time += dt;
    this.frames++;
  }
  inspect() {
    return {
      status: this.status,
      error: this.error,
      frames: this.frames,
      simulationTime: this.time,
      backend: this.water?.backend,
      source: 'threejs-water-pro 3.5.1',
      quality: this.quality,
      cascades: this.water?.config.cascades.length,
      waveTime: this.water?.simulationTime,
      waveSettings: this.water
        ? {
            amplitude: this.water.waves.amplitude.value,
            peakWavelength: this.water.waves.peakWavelength.value,
            windSpeed: this.water.waves.windSpeed.value,
            windDirection: this.water.waves.windDirection.value,
            foam: this.water.foam.waves.opacity,
            wake: this.water.wake.enabled,
          }
        : undefined,
      visible: true,
      integration: 'shared-scene',
      renderers: 1,
    };
  }
  resize(w: number, h: number) {
    // Water resizes its render targets via renderer.setSize(), which also writes
    // fixed CSS dimensions. Keep the host canvas responsive to the viewport.
    const style = this.renderer.domElement.style;
    const width = style.width,
      height = style.height;
    this.water?.resize(w, h);
    style.width = width;
    style.height = height;
  }
  dispose() {
    this.disposed = true;
    this.water?.dispose();
    this.sky?.dispose();
  }
}
