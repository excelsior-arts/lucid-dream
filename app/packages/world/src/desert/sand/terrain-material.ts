import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  attribute,
  abs,
  Discard,
  positionGeometry,
  positionWorld,
  modelWorldMatrix,
  cameraPosition,
  cameraViewMatrix,
  varying,
  mix,
  smoothstep,
  normalize,
  length,
  dot,
  max,
  cos,
  fwidth,
  If,
} from 'three/tsl';
import {reference} from 'three/tsl';
import {createNodes} from '../render/terrain-functions.js';
import {createPlayaNodes} from '../render/playa-nodes.js';
import type {Landscape} from '../landscape';
import {playaSurface} from './playa-surface';

export function terrainMaterial(uniforms: Record<string, {value: unknown}>, landscape: Landscape) {
  const f = createNodes(uniforms, landscape);
  const bedNodes = createPlayaNodes();
  const material = new THREE.MeshStandardNodeMaterial({color: '#b99160', roughness: 0.96});
  const shoreSky = reference('value', 'color', uniforms['shoreSky']);
  const rippleRelief = reference('value', 'float', uniforms['rippleRelief']);
  // Six patches of ground darkness, one per point of the body that takes weight.
  // A shadow map at a grazing moon cannot hold the contact itself; this can, and
  // it costs six distances a pixel rather than a pass.
  const contacts = [0, 1, 2, 3, 4, 5].map((i) =>
    reference('value', 'vec4', uniforms[`contact${i}`]!),
  );
  const worldXZ = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz;
  const distant = attribute<'float'>('terrainDistant', 'float');
  const worldNormal = varying(f.terrainNormal(worldXZ), 'sandNormal');
  // Per pixel, not per vertex: on a dune's shallow toe the sand-to-playa edge
  // crosses many metre quads, and a vertex-interpolated cover drew that edge as
  // a staircase of squares. One more filtered survey lookup per pixel is cheap.
  const duneCover = smoothstep(0.08, 0.7, f.landHeight(positionWorld.xz).sub(landscape.floor));
  material.positionNode = vec3(
    positionGeometry.x,
    f.terrainVertexHeight(worldXZ).sub(distant.mul(0.015)),
    positionGeometry.z,
  );
  const point = positionWorld;
  const marks = f.marks(point.xz);
  const groundNormal = normalize(worldNormal);
  const farFade = float(1).sub(smoothstep(12, 55, length(cameraPosition.sub(point))));
  const wind = uniform(uniforms.sandWind!.value as THREE.Vector2);
  const slope = groundNormal.xz.negate().div(max(groundNormal.y, 0.2));
  const rise = dot(slope, normalize(wind.add(vec2(0.001, 0))));
  const exposure = smoothstep(-0.24, 0.025, rise)
    .mul(float(1).sub(smoothstep(0.57, 0.8, length(slope))))
    .mul(mix(0.45, 1, smoothstep(0, 0.3, rise)));
  const cover = exposure
    .mul(duneCover)
    .mul(f.coastalDuneWeight(point.xz))
    .mul(float(1).sub(marks.g.mul(0.96)))
    .mul(float(1).sub(marks.b.mul(0.8)));
  const playa = float(1)
    .sub(duneCover)
    .mul(smoothstep(0.975, 0.997, groundNormal.y));
  const crust = playa.mul(f.coastalDuneWeight(point.xz)).toVar();
  // The beach: the strip the dune relief has not taken over yet.
  const beach = float(1).sub(f.coastalDuneWeight(point.xz)).toVar();
  const shore = point.x.sub(f.coastX(point.z)).toVar();
  // The swash line wanders along the shore rather than ruling a straight band.
  const swash = float(0.125)
    .add(f.sandNoise(vec2(point.z.mul(0.055), 4.1)).sub(0.5).mul(0.085))
    .toVar();
  // Saturated sand right at the water, drying out over the next few metres.
  const soaked = float(1).sub(smoothstep(float(0), swash, point.y)).mul(beach).toVar();
  const damp = float(1).sub(smoothstep(swash, swash.mul(3.4), point.y)).mul(beach).toVar();
  const dust = playaSurface(point, crust);
  // One evaluation of the crack network, shared by the colour and the normal.
  const bed = bedNodes.playaCracks(point.xz, bedNodes.plateFootprint(point.xz)).toVar();
  // Wet sand holds a sheen, not a highlight: rough enough that the sky it mirrors
  // arrives as a wash rather than as a reflected lamp at the waterline.
  material.roughnessNode = mix(dust.roughness, float(0.66), soaked.mul(0.55));
  const aa = float(1).sub(smoothstep(1, 2.8, length(fwidth(point.xz)).mul(21)));
  material.colorNode = Fn(() => {
    const offset = abs(point.xz.sub(uniform(uniforms.terrainCenter!.value as THREE.Vector2)));
    If(distant.greaterThan(0.5).and(max(offset.x, offset.y).lessThan(158.5)), () => Discard());
    const broad = f.sandNoise(point.xz.mul(0.18)),
      fine = f.sandNoise(point.xz.mul(180));
    const grainFade = float(1).sub(smoothstep(0.1, 0.6, length(fwidth(point.xz)).mul(180)));
    const base = uniform(material.color);
    const color = mix(base, vec3(0.62, 0.55, 0.43), playa.mul(0.48))
      .mul(float(0.91).add(broad.mul(0.16)).add(fine.sub(0.5).mul(0.15).mul(grainFade)))
      .mul(dust.tint)
      .mul(float(1).sub(marks.g.mul(0.26)))
      .toVar();
    // Crack shadow, per-plate tone, and metre-scale patches of pale silt and
    // darker damp ground, so no two square metres of the bed match. The cracks
    // are a hint over the ground colour, not lines drawn on it.
    const patch = f
      .sandNoise(point.xz.mul(0.31).add(11.7))
      .sub(0.5)
      .mul(0.2)
      .add(f.sandNoise(point.xz.mul(0.09).sub(4.3)).sub(0.5).mul(0.26));
    // A step on the crust is a scuff rather than a hole, so it has to read as a
    // mark: the crushed surface bruises a little darker and carries pale dust,
    // with the plates and their cracks still showing through it.
    const scuff = float(1)
      .sub(marks.g.mul(0.38))
      .mul(float(1).add(marks.a.mul(float(1).sub(marks.g)).mul(0.2)));
    color.mulAssign(
      mix(
        float(1),
        float(1)
          .add(bed.y.sub(0.5).mul(0.06))
          .add(patch)
          .mul(mix(float(1), float(0.9), bed.x))
          .mul(scuff),
        crust,
      ),
    );
    // Coarser grain than the playa's, and a darker wrack line where the swash
    // has last reached, so the beach is not one tone from the water up.
    const sandGrain = f.sandNoise(point.xz.mul(62)).sub(0.5);
    const grainWidth = float(1).sub(smoothstep(0.12, 0.65, length(fwidth(point.xz)).mul(62)));
    const wrack = smoothstep(0.55, 1, damp.mul(float(1).sub(soaked)).mul(2.2));
    color.mulAssign(
      mix(
        float(1),
        float(1)
          .add(sandGrain.mul(0.42).mul(grainWidth))
          .add(f.sandNoise(point.xz.mul(0.55).add(2.7)).sub(0.5).mul(0.14))
          .add(f.sandNoise(point.xz.mul(0.16).sub(7.3)).sub(0.5).mul(0.2))
          .mul(float(1).sub(wrack.mul(0.1))),
        beach,
      ),
    );
    // Saturated sand is much darker; damp sand less so. The cool cast it used to
    // take belongs to the sky it mirrors, and at this hour that sky is coral.
    color.mulAssign(
      mix(vec3(1), vec3(0.47, 0.46, 0.49), soaked.mul(0.92)).mul(
        float(1).sub(damp.mul(float(1).sub(soaked)).mul(0.16)),
      ),
    );
    // A wet beach mirrors the sky just above the sea, and only where the eye
    // grazes it, so the band brightens along the shore rather than in a patch.
    const grazing = float(1).sub(abs(dot(normalize(cameraPosition.sub(point)), groundNormal)));
    color.assign(mix(color, shoreSky, smoothstep(0.62, 0.985, grazing).mul(soaked).mul(0.34)));
    // Under a foot, a knee or a hand the sand goes dark, softening and spreading
    // as the contact lifts, so nothing the body rests on reads as floating.
    const grounded = float(1).toVar();
    for (const contact of contacts) {
      const reach = max(contact.z, 0.001);
      const near = float(1).sub(smoothstep(reach.mul(0.25), reach, length(point.xz.sub(contact.xy))));
      grounded.mulAssign(float(1).sub(near.mul(near).mul(contact.w)));
    }
    color.mulAssign(grounded);
    return mix(color, color.mul(vec3(1.08, 1.02, 0.94)), marks.b.mul(0.2));
  })();
  material.normalNode = Fn(() => {
    // Ripple relief follows the light: under a grazing moon a full-relief ripple's
    // back goes black and a slope of them reads as terraces. The seaward face of
    // the coastal dune, which the moon climbs straight up, keeps half of that.
    const seaward = float(1).sub(smoothstep(38, 47, shore));
    const weight = farFade
      .mul(cover)
      .mul(aa)
      .mul(rippleRelief)
      .mul(mix(float(1), float(0.5), seaward))
      .toVar();
    const normal = groundNormal.toVar();
    // Avoid three procedural ripple evaluations on distant, sheltered or smooth beach pixels.
    If(weight.greaterThan(0.0001), () => {
      const r = f.ripple(point.xz);
      const rx = f
        .ripple(point.xz.add(vec2(0.012, 0)))
        .sub(r)
        .div(0.012);
      const rz = f
        .ripple(point.xz.add(vec2(0, 0.012)))
        .sub(r)
        .div(0.012);
      normal.assign(normalize(groundNormal.sub(vec3(rx, 0, rz).mul(weight))));
    });
    // Millimetre-scale dust relief catches the light without changing foot support.
    normal.subAssign(
      vec3(dust.gradient.x, 0, dust.gradient.y).mul(float(1).sub(marks.g.mul(0.85))),
    );
    // The plate lip, so a low light finds one side of every plate, and a metre
    // scale undulation so the bed is never a plane.
    const loose = float(1).sub(marks.g.mul(0.9)).mul(crust).toVar();
    normal.subAssign(vec3(bed.z, 0, bed.w).mul(loose.mul(0.08)));
    // Ripples that run along the shore, left by the swash rather than the wind.
    const swashRipple = beach.mul(farFade).mul(aa).toVar();
    If(swashRipple.greaterThan(0.001), () => {
      // Curve and break the trains so they are not a corduroy of straight lines.
      const bend = f
        .sandNoise(point.xz.mul(vec2(0.23, 0.58)))
        .sub(0.5)
        .mul(5.5)
        .add(f.sandNoise(point.xz.mul(vec2(0.9, 2.4)).add(9.1)).sub(0.5).mul(1.4));
      const phase = shore.mul(16.0).add(bend);
      // Strongest across the swash zone, but the dry beach above keeps a weaker,
      // more broken set rather than going bare.
      const shaped = mix(
        float(0.42),
        float(1),
        float(1).sub(smoothstep(1.4, 9.0, abs(shore.sub(swash.div(0.045))))),
      ).mul(f.sandNoise(point.xz.mul(vec2(0.17, 0.31)).add(21.0)).mul(0.8).add(0.4));
      normal.subAssign(vec3(cos(phase).mul(0.052).mul(shaped), 0, 0).mul(swashRipple));
    });
    // The slope is analytic: three offset samples sharing one base sample
    // compiled to flat-shaded cells in WebKit, so the slabs Eugene saw on the
    // playa were this term. The 0.42 m difference it replaces is kept as a scale.
    const swell = f.sandNoiseSlope(point.xz.mul(0.26)).mul(0.42 * 0.26);
    normal.subAssign(vec3(swell.x, 0, swell.y).mul(crust.mul(0.55)));
    return normalize(cameraViewMatrix.mul(vec4(normalize(normal), 0)).xyz);
  })();
  // r185 runtime passes the sampled shadow; its declaration currently omits that argument.
  material.receivedShadowNode = Fn(([shadow]: [THREE.Node<'vec3'>]) =>
    mix(
      shadow,
      vec3(1),
      smoothstep(
        55,
        90,
        length(positionWorld.xz.sub(uniform(uniforms.terrainCenter!.value as THREE.Vector2))),
      ),
    ),
  ) as unknown as () => THREE.Node;
  // Scene fog is expressed in TSL by the host and shared with the sea.
  return {
    material,
    dispose() {
      material.dispose();
      dust.dispose();
    },
  };
}
