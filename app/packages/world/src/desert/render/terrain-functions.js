// TSL port of the original shader, generated with Three's GLSL transpiler.
import {
  sin,
  mul,
  add,
  Fn,
  abs,
  sub,
  max,
  smoothstep,
  select,
  mix,
  fract,
  vec2,
  greaterThanEqual,
  all,
  lessThanEqual,
  min,
  If,
  floor,
  float,
  vec3,
  normalize,
  dot,
  lessThan,
  any,
  greaterThan,
  vec4,
  length,
  atan,
  texture,
  reference,
  attribute,
} from 'three/tsl';
import {
  ATLAS_MIN,
  ATLAS_SIZE,
  ATLAS_STEP,
  HEIGHT_MIN,
  HEIGHT_RANGE,
  FAR_ATLAS_MIN,
  FAR_ATLAS_SIZE,
  FAR_ATLAS_STEP,
  FAR_HEIGHT_RANGE,
} from '../sand/atlas-build';

const hashSand = /*@__PURE__*/ Fn(([p]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

export const sandNoise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p);
  const f = fract(p).toVar();
  f.assign(f.mul(f).mul(sub(3.0, mul(2.0, f))));

  return mix(
    mix(hashSand(i), hashSand(i.add(vec2(1, 0))), f.x),
    mix(hashSand(i.add(vec2(0, 1))), hashSand(i.add(1.0)), f.x),
    f.y,
  );
});

/** The slope of sandNoise, in noise units per unit of p, from the same lattice
 * and fade. One evaluation replaces three offset samples, and it keeps the
 * value and its slope in one expression: WebKit's WGSL compiler turned a shared
 * sample reused by two differences into a lattice of flat-shaded cells. */
export const sandNoiseSlope = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p);
  const t = fract(p).toVar();
  const f = t.mul(t).mul(sub(3.0, mul(2.0, t))).toVar();
  const df = t.mul(sub(1.0, t)).mul(6.0).toVar();
  const a = hashSand(i).toVar();
  const b = hashSand(i.add(vec2(1, 0))).toVar();
  const c = hashSand(i.add(vec2(0, 1))).toVar();
  const d = hashSand(i.add(1.0)).toVar();

  return vec2(
    mix(b.sub(a), d.sub(c), f.y).mul(df.x),
    mix(c.sub(a), d.sub(b), f.x).mul(df.y),
  );
});

/** The nodes, over the landscape's own shoreline: the same sines the CPU
 * sums, so the GPU's beach is the CPU's beach. */
export function createNodes(uniforms, landscape) {
  const sandWind = reference('value', 'vec2', uniforms['sandWind']);
  const sandTime = reference('value', 'float', uniforms['sandTime']);
  const sandMap = texture(uniforms['sandMap'].value);
  const sandOrigin = reference('value', 'vec2', uniforms['sandOrigin']);
  const terrainCenter = reference('value', 'vec2', uniforms['terrainCenter']);
  const terrainLod = attribute('terrainLod', 'vec2');

  const survey = texture(uniforms['heightAtlas'].value);
  const horizon = texture(uniforms['horizonAtlas'].value);
  const coastX = Fn(([z]) => {
    let x = float(landscape.coast.x);
    for (const [amplitude, frequency] of landscape.coast.meander)
      x = x.add(sin(z.mul(frequency)).mul(amplitude));
    return x;
  });
  const coastalDuneWeight = Fn(([p]) =>
    smoothstep(landscape.beach.width, landscape.beach.transition, p.x.sub(coastX(p.y))),
  );
  // One filtered RGBA8 lookup replaces a separate procedural world in every
  // vertex/normal/shadow pass. Decode is linear, just like the CPU survey.
  const landHeight = Fn(([p]) => {
    const uv = p.sub(ATLAS_MIN).div(ATLAS_STEP).add(0.5).div(ATLAS_SIZE);
    const packed = survey.sample(uv).rg;
    const h = packed.x
      .mul(256)
      .add(packed.y)
      .mul((255 / 65535) * HEIGHT_RANGE)
      .add(HEIGHT_MIN)
      .toVar();
    const edge = float(-ATLAS_MIN).sub(max(abs(p.x), abs(p.y)));
    If(edge.lessThan(8), () => {
      const farUV = p.sub(FAR_ATLAS_MIN).div(FAR_ATLAS_STEP).add(0.5).div(FAR_ATLAS_SIZE);
      const far = horizon.sample(farUV).rg;
      const height = far.x
        .mul(256)
        .add(far.y)
        .mul((255 / 65535) * FAR_HEIGHT_RANGE)
        .add(HEIGHT_MIN);
      h.assign(mix(height, h, smoothstep(0, 8, edge)));
    });
    return h;
  });

  const terrainHeight = /*@__PURE__*/ Fn(([p]) => {
    const h = landHeight(p).toVar();
    const uv = p.sub(sandOrigin).div(32.0).toVar();

    If(all(greaterThanEqual(uv, vec2(0.0))).and(all(lessThanEqual(uv, vec2(1.0)))), () => {
      const edge = min(min(uv.x, uv.y), min(sub(1.0, uv.x), sub(1.0, uv.y))).toVar();
      h.addAssign(
        sandMap
          .sample(uv)
          .r.mul(255.0)
          .sub(128.0)
          .mul(0.01)
          .mul(smoothstep(0.0, 0.035, edge)),
      );
    });

    return h;
  });

  const terrainVertexHeight = /*@__PURE__*/ Fn(([p]) => {
    const h = terrainHeight(p);

    const distance = max(abs(p.x.sub(terrainCenter.x)), abs(p.y.sub(terrainCenter.y))).toVar();
    If(terrainLod.y.greaterThan(0.0).and(distance.greaterThan(terrainLod.y.sub(3.0))), () => {
      // The fine ring becomes the next ring's exact triangle surface before
      // crossing its boundary. Both grids stay aligned to world coordinates.

      const spacing = terrainLod.x.mul(2.0).toVar();
      const origin = floor(p.div(spacing)).mul(spacing).toVar();
      const f = p.sub(origin).div(spacing).toVar();
      const a = terrainHeight(origin).toVar();
      const b = terrainHeight(origin.add(vec2(spacing, 0.0))).toVar();
      const c = terrainHeight(origin.add(vec2(0.0, spacing))).toVar();
      const d = terrainHeight(origin.add(spacing)).toVar();
      const coarse = select(
        f.x.add(f.y).lessThanEqual(1.0),
        a.add(b.sub(a).mul(f.x)).add(c.sub(a).mul(f.y)),
        d.add(c.sub(d).mul(sub(1.0, f.x))).add(b.sub(d).mul(sub(1.0, f.y))),
      ).toVar();
      h.assign(mix(h, coarse, smoothstep(terrainLod.y.sub(3.0), terrainLod.y.sub(1.0), distance)));
    });

    return h;
  });

  const terrainNormal = /*@__PURE__*/ Fn(([p]) => {
    const reach = float(0.125);

    return normalize(
      vec3(
        terrainHeight(p.sub(vec2(reach, 0))).sub(terrainHeight(p.add(vec2(reach, 0)))),
        reach.mul(2.0),
        terrainHeight(p.sub(vec2(0, reach))).sub(terrainHeight(p.add(vec2(0, reach)))),
      ),
    );
  });

  const marks = /*@__PURE__*/ Fn(([p]) => {
    const uv = p.sub(sandOrigin).div(32.0);

    return select(
      any(lessThan(uv, vec2(0))).or(any(greaterThan(uv, vec2(1)))),
      vec4(0.5, 0, 0, 0),
      sandMap.sample(uv),
    );
  });

  const ripple = /*@__PURE__*/ Fn(([p]) => {
    const dir = normalize(sandWind.add(vec2(0.001, 0)));
    const across = vec2(dir.y.negate(), dir.x).toVar();
    const q = vec2(dot(p, dir), dot(p, across)).toVar();

    // Slow domain warping bends the trains without intersecting two uniform
    // gratings. It varies mostly across the crests rather than along them: a
    // warp that runs along the train changes its spacing, and enough of it
    // drives the phase backwards, folding the train into bunched bands. Down a
    // long face at a grazing light those bands are read as terraced shelves, so
    // the along-crest rates are held well inside the fold. Smaller disturbances
    // roughen individual ridges.

    // Varying the warp along a train changes its spacing, which is what bunches
    // and branches the ripples and makes them read as sand rather than a grating.
    // It also folds them into bands at enough strength, which under a grazing
    // moon once looked like terraced shelves. That turned out to be the crest
    // curvature and the ripple relief, both fixed at their own source, so the
    // warp is back to bending the trains along their length.
    const warp = sandNoise(q.mul(vec2(0.28, 0.19)))
      .sub(0.5)
      .mul(1.25)
      .toVar();
    warp.addAssign(
      sandNoise(q.mul(vec2(0.65, 0.48)).add(17.3))
        .sub(0.5)
        .mul(0.23),
    );
    const phase = q.x.add(warp).mul(21.0).toVar();
    phase.addAssign(
      sandNoise(q.mul(vec2(1.7, 1.1)).add(4.7))
        .sub(0.5)
        .mul(0.65),
    );
    phase.subAssign(sandTime.mul(length(sandWind)).mul(0.07));

    // Paired phase defects insert short branches/terminations. The patch
    // blends wave heights, not angles, to keep atan's branch cut invisible.

    const cell = floor(q.add(vec2(1.9, 0.7)).div(vec2(3.2, 2.6))).toVar();
    const local = fract(q.add(vec2(1.9, 0.7)).div(vec2(3.2, 2.6))).toVar();
    const jitter = vec2(hashSand(cell), hashSand(cell.add(8.7))).toVar();
    const center = vec2(0.35).add(jitter.mul(0.3)).toVar();
    const a = local.sub(center).mul(vec2(3.2, 2.6)).toVar();
    const b = a.sub(vec2(0.22, add(0.45, jitter.x.mul(0.55)))).toVar();
    const defect = atan(a.y, a.x).sub(atan(b.y, b.x)).toVar();
    const border = smoothstep(vec2(0.0), vec2(0.22), local)
      .mul(sub(1.0, smoothstep(vec2(0.78), vec2(1.0), local)))
      .toVar();
    const branchBlend = border.x.mul(border.y).toVar();
    const wave = mix(
      sin(phase).add(mul(0.17, sin(mul(2.0, phase).add(0.8)))),
      sin(phase.add(defect)).add(mul(0.17, sin(mul(2.0, phase.add(defect)).add(0.8)))),
      branchBlend,
    ).toVar();

    // Defect cores die away instead of becoming bright pinwheel spikes.

    const core = smoothstep(0.03, 0.22, min(length(a), length(b))).toVar();
    const strength = add(0.55, mul(0.45, sandNoise(q.mul(vec2(0.34, 0.25)).add(31.0)))).toVar();

    return wave
      .mul(0.01)
      .mul(strength)
      .mul(mix(1.0, core, branchBlend));
  });

  return {
    coastX,
    coastalDuneWeight,
    landHeight,
    terrainHeight,
    terrainVertexHeight,
    terrainNormal,
    hashSand,
    sandNoise,
    sandNoiseSlope,
    marks,
    ripple,
  };
}
