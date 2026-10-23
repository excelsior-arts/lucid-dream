// Directional twilight atmosphere, with a phase-shaped moon and stars.
import {HORIZON_BLEND, SKYLINE_BLEND, SOLAR_BLEND, VEIL_BLEND} from '../scene/sky-gradient';
import {
  vec2,
  dot,
  sin,
  fract,
  Fn,
  normalize,
  smoothstep,
  mix,
  max,
  pow,
  vec3,
  abs,
  exp,
  sub,
  atan,
  clamp,
  asin,
  floor,
  step,
  vec4,
  reference,
  float,
  length,
  cross,
  sqrt,
  fwidth,
  If,
} from 'three/tsl';

/** The drawn disc. The real moon spans 0.52 degrees, a radius of 0.00454 rad;
 * this piece has always drawn it larger, and that authored size is kept. */
const MOON_RADIUS = 0.013;
/** Maria as seen from Earth, in projected disc coordinates: x right, y up,
 * the familiar near side. Centre, radii, edge softness, depth. */
const MARIA = [
  [-0.56, 0.06, 0.35, 0.53, 0.28, 0.92], // Oceanus Procellarum
  [-0.26, 0.44, 0.31, 0.26, 0.16, 1.0], // Mare Imbrium
  [-0.12, 0.7, 0.42, 0.08, 0.3, 0.6], // Mare Frigoris
  [0.08, 0.38, 0.18, 0.17, 0.14, 1.0], // Mare Serenitatis
  [0.27, 0.19, 0.21, 0.2, 0.18, 1.0], // Mare Tranquillitatis
  [0.62, 0.28, 0.1, 0.085, 0.13, 1.0], // Mare Crisium
  [0.44, -0.06, 0.13, 0.18, 0.2, 0.9], // Mare Fecunditatis
  [0.29, -0.24, 0.1, 0.11, 0.16, 0.95], // Mare Nectaris
  [-0.2, -0.36, 0.18, 0.14, 0.24, 0.9], // Mare Nubium
  [-0.4, -0.28, 0.1, 0.11, 0.16, 0.9], // Mare Humorum
];
/** The bright young craters that actually read at this size. */
const CRATERS = [
  [-0.1, -0.62, 0.05, 0.34], // Tycho
  [-0.29, 0.13, 0.038, 0.22], // Copernicus
  [-0.55, 0.3, 0.024, 0.26], // Aristarchus
];
export function createNodes(uniforms) {
  const sunDirection = reference('value', 'vec3', uniforms['sunDirection']);
  const moonDirection = reference('value', 'vec3', uniforms['moonDirection']);
  const horizon = reference('value', 'color', uniforms['horizon']);
  const sunSkyline = reference('value', 'color', uniforms['sunSkyline']);
  const sunHorizon = reference('value', 'color', uniforms['sunHorizon']);
  const sunZenith = reference('value', 'color', uniforms['sunZenith']);
  const zenith = reference('value', 'color', uniforms['zenith']);
  const sunColor = reference('value', 'color', uniforms['sunColor']);
  const daylight = reference('value', 'float', uniforms['daylight']);
  const sunVisible = reference('value', 'float', uniforms['sunVisible']);
  const moonPhase = reference('value', 'float', uniforms['moonPhase']);
  const dusk = reference('value', 'float', uniforms['dusk']);

  // Three.js Transpiler r185

  const starHash = /*@__PURE__*/ Fn(([p]) => {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  });

  /** Smooth value noise, so the surface is grain rather than square cells. */
  const valueNoise = /*@__PURE__*/ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(sub(3.0, f.mul(2.0)));
    return mix(
      mix(starHash(i), starHash(i.add(vec2(1, 0))), u.x),
      mix(starHash(i.add(vec2(0, 1))), starHash(i.add(vec2(1, 1))), u.x),
      u.y,
    );
  });

  const skyAtmosphere = /*@__PURE__*/ Fn(([direction]) => {
    const d = normalize(direction);
    const solar = sunDirection.xz.div(max(length(sunDirection.xz), 0.0001));
    const sector = smoothstep(SOLAR_BLEND[0], SOLAR_BLEND[1], dot(d.xz, solar));
    const h = smoothstep(HORIZON_BLEND[0], HORIZON_BLEND[1], d.y);
    // Coral at the skyline, the gold band above it, and a pink-violet lift into
    // the blue, so the warm side and the cold side never meet through brown.
    const warm = mix(sunSkyline, sunHorizon, smoothstep(SKYLINE_BLEND[0], SKYLINE_BLEND[1], d.y));
    const veil = mix(sunZenith, zenith, smoothstep(VEIL_BLEND[0], VEIL_BLEND[1], d.y));
    return mix(mix(horizon, warm, sector), mix(zenith, veil, sector), h);
  });

  const skyFragment = /*@__PURE__*/ Fn(([direction]) => {
    const d = normalize(direction);
    const color = skyAtmosphere(d).toVar();
    const alignment = max(0.0, dot(d, sunDirection)).toVar();
    color.addAssign(
      sunColor
        .mul(
          pow(alignment, 35.0)
            .mul(0.24)
            .add(smoothstep(0.9993, 0.9998, alignment).mul(3.0)),
        )
        .mul(sunVisible),
    );

    // The warm horizon glow follows the sun instead of tinting the whole sky.

    color.addAssign(
      vec3(0.33, 0.115, 0.092)
        .mul(dusk)
        .mul(pow(alignment, 5.0))
        .mul(exp(abs(d.y).negate().mul(7.0))),
    );
    const night = sub(1.0, daylight).toVar();
    const moonRight = normalize(cross(moonDirection, vec3(0, 1, 0)));
    const moonUp = normalize(cross(moonRight, moonDirection));
    const facing = dot(d, moonDirection).toVar();
    const moonUV = vec2(dot(d, moonRight), dot(d, moonUp)).div(MOON_RADIUS).toVar();
    const radius = length(moonUV).toVar();
    // Derivatives must be taken and used in uniform control flow, so the limb's
    // pixel width and the disc it antialiases are both resolved before the
    // branch. The clamp keeps a stray derivative from painting at the guard.
    const limb = clamp(fwidth(radius), 0.0015, 0.2).toVar();
    const disk = float(1)
      .sub(smoothstep(float(1).sub(limb), float(1).add(limb), radius))
      .toVar();
    // The moon is lit by the same sun the sky uses, so the bright limb points at
    // it. The authored phase still sets how much of the disc that light reaches.
    const sunLocal = vec2(dot(sunDirection, moonRight), dot(sunDirection, moonUp)).toVar();
    const bearing = sunLocal.div(max(length(sunLocal), 0.0001)).toVar();
    const phaseCos = moonPhase.mul(2).sub(1).toVar();
    const phaseSin = sqrt(max(0, float(1).sub(phaseCos.mul(phaseCos))));
    const phaseLight = vec3(bearing.mul(phaseSin), phaseCos).toVar();
    const moonlit = vec3(0).toVar();
    If(disk.greaterThan(0.0), () => {
      const faceNormal = vec3(moonUV, sqrt(max(0, float(1).sub(dot(moonUV, moonUV))))).toVar();
      const incidence = dot(faceNormal, phaseLight).toVar();
      // A rough surface softens the terminator over a few percent of the disc.
      const soft = smoothstep(-0.07, 0.07, incidence).toVar();
      const shadeMu = max(incidence, 0);
      // Lommel-Seeliger. The real moon backscatters, so the lit face reads flat
      // and pasted on rather than shaded like a ball, and only the maria and the
      // terminator give it form.
      const lit = shadeMu.div(shadeMu.add(faceNormal.z).add(0.05)).mul(2).mul(soft).toVar();
      const shade = float(0).toVar();
      for (const [cx, cy, rx, ry, edge, depth] of MARIA)
        shade.addAssign(
          float(1)
            .sub(
              smoothstep(
                1 - edge,
                1 + edge,
                length(moonUV.sub(vec2(cx, cy)).div(vec2(rx, ry))),
              ),
            )
            .mul(depth),
        );
      const albedo = mix(1.02, 0.42, clamp(shade, 0, 1)).toVar();
      albedo.addAssign(valueNoise(moonUV.mul(7.0)).sub(0.5).mul(0.075));
      albedo.addAssign(valueNoise(moonUV.mul(23.0).add(vec2(5.2, 1.7))).sub(0.5).mul(0.045));
      for (const [cx, cy, r, gain] of CRATERS)
        albedo.addAssign(
          float(1).sub(smoothstep(r * 0.4, r, length(moonUV.sub(vec2(cx, cy))))).mul(gain),
        );
      // Tycho's rays, which are most of what a small bright moon shows.
      const toTycho = moonUV.sub(vec2(CRATERS[0][0], CRATERS[0][1])).toVar();
      albedo.addAssign(
        smoothstep(0.62, 0.08, length(toTycho))
          .mul(sin(atan(toTycho.y, toTycho.x).mul(13.0)).mul(0.45).add(0.55))
          .mul(0.085),
      );
      const surface = clamp(albedo, 0.3, 1.4).toVar();
      // Earthshine only: a trace of cooler light, never a grey disc, and gone
      // long before the sky is bright enough to show it.
      const earthshine = vec3(0.5, 0.6, 0.82)
        .mul(0.013)
        .mul(float(1).sub(soft))
        .mul(night.mul(night));
      moonlit.assign(
        vec3(0.95, 0.93, 0.88).mul(0.86).mul(lit).add(earthshine).mul(surface).mul(disk),
      );
    });
    color.addAssign(moonlit.mul(mix(0.4, 1, night)));
    // The halo that keeps a moon from looking pasted on: a tight aureole and a
    // broad lift of the sky around it, both stronger through the thicker air a
    // low moon is seen through.
    const haze = mix(1.0, 0.42, smoothstep(0.0, 0.55, moonDirection.y));
    const aureole = pow(max(facing, 0.0), 2200.0).mul(0.105);
    const glow = pow(max(facing, 0.0), 120.0).mul(0.016);
    color.addAssign(
      vec3(0.74, 0.79, 0.92)
        .mul(aureole.add(glow))
        .mul(haze)
        .mul(moonPhase)
        .mul(night),
    );
    // Not a grid of identical dots. Brightness follows a steep roll, so most of
    // what is up there is barely there and a handful carry the sky; a bright one
    // is a little wider and keeps some glare around it; colour shows only in the
    // bright ones, because the dark-adapted eye reads faint light as grey; and a
    // faint one needs a darker sky than a bright one before it appears at all.
    // Cells widen toward the zenith so they stay equal area and nothing crowds
    // overhead.
    const lat = asin(clamp(d.y, -1.0, 1.0)).toVar();
    const spread = sqrt(max(sub(1.0, d.y.mul(d.y)), 0.0001)).toVar();
    const starUV = vec2(atan(d.z, d.x).mul(spread), lat).mul(150.0).toVar();
    const starCell = floor(starUV).toVar();
    const seed = vec2(starHash(starCell), starHash(starCell.add(8.3))).toVar();
    const offset = fract(starUV).sub(seed).toVar();
    const falloff = dot(offset, offset).negate().toVar();
    const magnitude = pow(starHash(starCell.add(57.1)), 3.2).toVar();
    const present = step(0.94, starHash(starCell.add(31.7))).toVar();
    // A star is seen only where the sky behind it is darker than the star itself.
    // The sunset holds a bright band long after the sun has gone, so the test is
    // the glow in this direction rather than the hour: they come out on the night
    // side first and the warm side stays empty until it has cooled.
    const skyGlow = dot(color, vec3(0.2126, 0.7152, 0.0722)).toVar();
    const wash = smoothstep(0.02, 0.18, skyGlow).toVar();
    const seen = smoothstep(wash.mul(0.92), wash.mul(0.92).add(0.22), magnitude)
      .mul(mix(1.0, 0.06, wash))
      .toVar();
    const core = exp(falloff.mul(mix(460.0, 130.0, magnitude))).toVar();
    const glare = exp(falloff.mul(28.0)).mul(0.18).mul(magnitude).toVar();
    const star = core.add(glare).mul(present).mul(seen).toVar();
    const tint = mix(
      vec3(0.72, 0.82, 1.0),
      vec3(1.0, 0.82, 0.64),
      pow(starHash(starCell.add(91.3)), 1.5),
    ).toVar();
    color.addAssign(
      mix(vec3(0.84, 0.88, 0.96), tint, magnitude)
        .mul(star)
        .mul(mix(0.3, 1.8, magnitude))
        .mul(night)
        .mul(smoothstep(0.0, 0.25, d.y)),
    );

    return vec4(color, 1.0);
  });

  return {starHash, skyAtmosphere, skyFragment};
}
