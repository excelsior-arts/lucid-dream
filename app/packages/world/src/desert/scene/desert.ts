import {createNodes as skyNodes} from '../render/sky-nodes.js';
import {
  positionGeometry,
  fog,
  smoothstep,
  length,
  max,
  cameraPosition,
  positionWorld,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import {SandField} from '../sand/field';
import {SandTerrain} from '../sand/terrain';
import {SandGrains} from '../sand/grains';
import {shadowAnchor} from './shadow-anchor';
import {shadowStrength} from './shadow-strength';
import {MountainRange} from './mountains';
import type {Geography} from '../landscape';

/** Something a trip stands in its desert: a monument, a building, a wreck.
    Added to the scene by the trip; the desert moves it with the wind and the
    hour and takes it down with the rest. */
export interface Landmark {
  object: THREE.Object3D;
  update(time: number, wind: {x: number; z: number}): void;
  dispose(): void;
}

export function createDesert(scene: THREE.Scene, geo: Geography) {
  const field = new SandField(geo);
  const terrain = new SandTerrain(field),
    grains = new SandGrains(field, terrain.surfaceMaterial.color);
  const mountains = new MountainRange(geo, terrain.surfaceMaterial.color);
  const landmarks: Landmark[] = [];
  scene.add(terrain.object, grains.object, mountains.object);

  const hemi = new THREE.HemisphereLight('#bacbde', '#967049', 0.65);
  let sun = new THREE.DirectionalLight('#ffe3ba', 3.0);
  let moon = new THREE.DirectionalLight('#709fff', 0);
  /**
   * A light this low over ground this flat makes the percentage-closer footprint
   * far wider than the depth it is testing, and the terrain shadows itself in a
   * regular grid of the shadow map's own texels. A narrow filter and a bias that
   * follows the texel keep the bed clean; the dune shadows stay soft because a
   * texel at this coverage is still nearly ten centimetres across.
   */
  function tuneShadow(light: THREE.DirectionalLight) {
    const texel = 192 / light.shadow.mapSize.x;
    light.shadow.bias = -0.00015;
    // The bias follows the texel, so a finer map buys a smaller push off the
    // surface as well as a sharper edge, and the contact stays under the foot.
    light.shadow.normalBias = Math.min(texel * 1.7, 0.2);
    light.shadow.radius = 1.0;
  }
  const sunDirection = new THREE.Vector3();
  const moonDirection = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  for (const light of [sun, moon]) {
    light.shadow.mapSize.set(4096, 4096);
    Object.assign(light.shadow.camera, {
      left: -96,
      right: 96,
      top: 96,
      bottom: -96,
      near: 0.5,
      far: 420,
    });
    // The sea capture and final pass share the same light maps for this scene frame.
    light.shadow.autoUpdate = false;
    // Keep both shader graphs compiled. Only their uniform strength and map
    // refresh change at dusk, avoiding a material rebuild in the middle of the song.
    light.castShadow = true;
    tuneShadow(light);
  }
  const palette = {
    nightHorizon: new THREE.Color('#182c4c'),
    dayHorizon: new THREE.Color('#d4bf9d'),
    // The sunset runs pale gold to orange and then to coral at the skyline. No
    // ochre anywhere in it: the fire is the warmest thing in the frame and the
    // sky must not compete with it, only sit beside the deep blue opposite.
    twilight: new THREE.Color('#ffa877'),
    twilightSkyline: new THREE.Color('#ff6b5c'),
    twilightVeil: new THREE.Color('#9c6f92'),
    oppositeTwilight: new THREE.Color('#414d70'),
    nightZenith: new THREE.Color('#091329'),
    dayZenith: new THREE.Color('#6199c5'),
    lowSun: new THREE.Color('#ff9959'),
    highSun: new THREE.Color('#fff2dd'),
    nightSky: new THREE.Color('#709cff'),
    daySky: new THREE.Color('#bacbde'),
    nightGround: new THREE.Color('#304773'),
    dayGround: new THREE.Color('#967049'),
  };
  const skyGeo = new THREE.SphereGeometry(2000, 32, 16);
  const skyUniforms = {
    sunDirection: {value: sunDirection},
    moonDirection: {value: moonDirection},
    horizon: {value: new THREE.Color()},
    sunSkyline: {value: new THREE.Color()},
    sunHorizon: {value: new THREE.Color()},
    sunZenith: {value: new THREE.Color()},
    zenith: {value: new THREE.Color()},
    sunColor: {value: sun.color},
    daylight: {value: 1},
    sunVisible: {value: 1},
    dusk: {value: 0},
    moonPhase: {value: 0.75},
  };
  const skyMat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const atmosphere = skyNodes(skyUniforms);
  skyMat.fragmentNode = atmosphere.skyFragment(positionGeometry);
  const range = length(cameraPosition.sub(positionWorld));
  // The desert owns scene.fogNode, including after water initialization.
  // Haze approaches the sky along the same ray: eastern mountains must not
  // inherit the western sunset tint. Keep the clear 500 m playa view.
  scene.fogNode = fog(
    atmosphere.skyAtmosphere(positionWorld.sub(cameraPosition)),
    max(smoothstep(200, 1400, range).mul(0.18), smoothstep(1500, 1850, range)),
  );
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -100;
  scene.add(hemi, sun, sun.target, moon, moon.target, sky);
  let shadowsInitialized = false;
  let hour = 17.65;
  let moonElevation = 35,
    moonAzimuth = -35,
    moonLight = 0.75;

  const snapShadow = shadowAnchor();
  function placeLights() {
    for (const [light, direction] of [
      [sun, sunDirection],
      [moon, moonDirection],
    ] as const) {
      snapShadow(anchor, direction, 192 / light.shadow.mapSize.x, light.target.position);
      light.position.copy(light.target.position).addScaledVector(direction, 200);
    }
  }

  function setTimeOfDay(value: number) {
    if (!Number.isFinite(value)) return;
    // Wrapped, not clamped: the arc below is continuous, so a sky left turning
    // past midnight goes on into the next day instead of stopping at the edge.
    hour = ((value % 24) + 24) % 24;
    // An artistic 24h arc: sunrise 06:00, sunset 18:00, tilted to avoid a
    // singular straight-down shadow camera at noon. Not a geographic ephemeris.
    const angle = ((hour - 6) / 12) * Math.PI;
    sunDirection.set(Math.cos(angle), Math.sin(angle) * 0.9, -Math.sin(angle) * 0.42).normalize();
    const elevationRad = (moonElevation * Math.PI) / 180,
      azimuthRad = (moonAzimuth * Math.PI) / 180;
    moonDirection.set(
      Math.sin(azimuthRad) * Math.cos(elevationRad),
      Math.sin(elevationRad),
      Math.cos(azimuthRad) * Math.cos(elevationRad),
    );
    const elevation = sunDirection.y;
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.12, 0.22);
    const visibility = THREE.MathUtils.smoothstep(elevation, -0.018, 0.065);
    const warmth =
      Math.exp(-Math.pow((elevation - 0.015) / 0.19, 2)) *
      THREE.MathUtils.smoothstep(elevation, -0.23, -0.06);
    skyUniforms.daylight!.value = daylight;
    skyUniforms.sunVisible!.value = visibility;
    skyUniforms.dusk!.value = warmth;
    (skyUniforms.horizon!.value as THREE.Color)
      .copy(palette.nightHorizon)
      .lerp(palette.dayHorizon, daylight)
      .lerp(palette.oppositeTwilight, warmth * 0.8);
    // Take the warm band all the way to the authored colours at full dusk, so no
    // daytime tan is left in it to turn the coral brown.
    skyUniforms.sunHorizon.value.copy(skyUniforms.horizon.value).lerp(palette.twilight, warmth);
    skyUniforms.sunSkyline.value
      .copy(skyUniforms.horizon.value)
      .lerp(palette.twilightSkyline, warmth);
    (skyUniforms.zenith!.value as THREE.Color)
      .copy(palette.nightZenith)
      .lerp(palette.dayZenith, daylight);
    skyUniforms.sunZenith.value
      .copy(skyUniforms.zenith.value as THREE.Color)
      .lerp(palette.twilightVeil, warmth * 0.72);
    terrain.setShoreSky(skyUniforms.sunSkyline.value);
    sun.color
      .copy(palette.lowSun)
      .lerp(palette.highSun, THREE.MathUtils.smoothstep(elevation, 0.06, 0.65));
    sun.intensity = 3.4 * visibility * (0.25 + 0.75 * Math.sqrt(Math.max(0, elevation)));
    moon.intensity =
      (0.12 + 0.85 * (1 - daylight)) *
      moonLight *
      THREE.MathUtils.smoothstep(moonDirection.y, 0, 0.3);
    sun.shadow.intensity = shadowStrength(sun.intensity, moon.intensity);
    moon.shadow.intensity = shadowStrength(moon.intensity, sun.intensity);
    // The leading light's elevation sets how much relief the sand ripples show:
    // full under a high sun, easing to a quarter under a moon near the horizon.
    const lead = moon.intensity > sun.intensity ? moonDirection.y : sunDirection.y;
    terrain.setRippleRelief(0.25 + 0.75 * THREE.MathUtils.smoothstep(lead, 0.2, 0.65));
    hemi.color.copy(palette.nightSky).lerp(palette.daySky, daylight);
    hemi.groundColor.copy(palette.nightGround).lerp(palette.dayGround, daylight);
    hemi.intensity = 0.3 + daylight * 0.47;
    // Reduce neutral studio fill at night so moonlight controls the sand color.
    scene.environmentIntensity = 0.008 + daylight * 0.292;
    placeLights();
  }
  setTimeOfDay(hour);

  return {
    field,
    /** What the trip has stood in the desert. Push before the first frame. */
    landmarks,
    sandMaterial: terrain.surfaceMaterial,
    setContacts: (points: readonly {x: number; y: number; z: number; radius: number}[]) =>
      terrain.setContacts(points),
    setTimeOfDay,
    setShadowResolution(sunSize: number, moonSize: number) {
      // r185 caches shadow texture bindings by light identity. A fresh light
      // rebuilds those bindings along with its map, including the water capture.
      // This happens only on a quality change; dusk uses stable uniform strengths.
      function resizeLight(light: THREE.DirectionalLight, size: number) {
        if (light.shadow.mapSize.x === size) return light;
        const replacement = light.clone();
        replacement.color = light.color; // The sky shares this color uniform.
        replacement.target = light.target;
        replacement.shadow.mapSize.set(size, size);
        tuneShadow(replacement);
        replacement.shadow.autoUpdate = false;
        replacement.shadow.needsUpdate = true;
        scene.remove(light);
        light.dispose();
        scene.add(replacement);
        shadowsInitialized = false;
        return replacement;
      }
      sun = resizeLight(sun, sunSize);
      moon = resizeLight(moon, moonSize);
    },
    setCelestial(phase: number, elevation: number, azimuth: number, strength = phase) {
      skyUniforms.moonPhase.value = phase;
      moonLight = THREE.MathUtils.clamp(strength, 0, 4);
      moonElevation = elevation;
      moonAzimuth = azimuth;
      setTimeOfDay(hour);
    },
    resetSand() {
      field.reset();
      grains.clear();
    },
    inspectSand() {
      return {
        ...field.inspect(),
        ...grains.inspect(),
        terrain: terrain.inspect(),
      };
    },
    get seaLight() {
      return {
        hour,
        daylight: Number(skyUniforms.daylight!.value),
        sunDirection: sunDirection.toArray(),
        sunIntensity: sun.intensity,
        moonDirection: moonDirection.toArray(),
        moonIntensity: moon.intensity,
        moonPhase: skyUniforms.moonPhase.value,
        horizon: skyUniforms.horizon.value,
        sunSkyline: skyUniforms.sunSkyline.value,
        sunHorizon: skyUniforms.sunHorizon.value,
        sunZenith: skyUniforms.sunZenith.value,
        zenith: skyUniforms.zenith!.value as THREE.Color,
      };
    },
    get lighting() {
      return {
        hour,
        fogNear: 200,
        fogFar: 1850,
        shadowMapSize: sun.shadow.mapSize.x,
        shadowStrength: {sun: sun.shadow.intensity, moon: moon.shadow.intensity},
        sunDirection: sunDirection.toArray(),
        sunPosition: sun.position.toArray(),
        sunIntensity: sun.intensity,
        moonIntensity: moon.intensity,
        moonPhase: skyUniforms.moonPhase.value,
        moonLight,
        moonDirection: moonDirection.toArray(),
        moonColor: moon.color.toArray(),
        daylight: skyUniforms.daylight!.value,
      };
    },
    update(dt: number, at: THREE.Vector3, visualTime = field.time) {
      for (const light of [sun, moon])
        light.shadow.needsUpdate = !shadowsInitialized || light.shadow.intensity > 0;
      shadowsInitialized = true;
      terrain.update(at.x, at.z, dt);
      for (const landmark of landmarks) landmark.update(visualTime, field.wind);
      grains.update(dt, at.x, at.z);
      sky.position.copy(at);
      anchor.copy(at);
      placeLights();
    },
    dispose() {
      terrain.dispose();
      mountains.dispose();
      for (const landmark of landmarks) landmark.dispose();
      grains.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      sun.dispose();
      moon.dispose();
      scene.remove(hemi, sun, sun.target, moon, moon.target, sky);
    },
  };
}
