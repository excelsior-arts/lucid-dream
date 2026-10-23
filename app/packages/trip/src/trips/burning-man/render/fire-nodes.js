// TSL port of the original shader, generated with Three's GLSL transpiler.
import {
  varying,
  vec2,
  vec4,
  normalize,
  step,
  sub,
  add,
  mix,
  length,
  min,
  Fn,
  sin,
  Discard,
  If,
  clamp,
  smoothstep,
  pow,
  max,
  vec3,
  mul,
  texture,
  attribute,
  cameraViewMatrix,
  cameraProjectionMatrix,
} from 'three/tsl';
export function createNodes(uniforms) {
  const viewMatrix = cameraViewMatrix,
    projectionMatrix = cameraProjectionMatrix;
  const plume = texture(uniforms['plume'].value);
  const position = attribute('position', 'vec3');
  const uv = attribute('uv', 'vec2');
  const center = attribute('center', 'vec3');
  const drift = attribute('drift', 'vec3');
  const state = attribute('state', 'vec4');

  // Three.js Transpiler r185

  const vUv = varying(vec2(), 'vUv');
  const vState = varying(vec4(), 'vState');

  const particleVertex = /*@__PURE__*/ Fn(() => {
    vUv.assign(uv);
    vState.assign(state);
    const viewCenter = viewMatrix.mul(vec4(center, 1.0)).toVar();
    const flow = viewMatrix.mul(vec4(drift, 0.0)).xy.toVar();
    const up = normalize(flow.add(vec2(0.0, 0.3))).toVar();
    const right = vec2(up.y, up.x.negate()).toVar();
    const smoke = step(1.5, state.w).toVar();
    const ember = step(0.5, state.w).mul(sub(1.0, smoke)).toVar();
    const width = state.y.mul(mix(add(1.0, state.x.mul(0.8)), 0.16, ember)).toVar();
    width.mulAssign(add(1.0, smoke.mul(add(0.5, state.x.mul(1.7)))));
    const height = width.mul(mix(add(1.7, min(length(flow), 3.0).mul(0.3)), 2.8, ember)).toVar();
    height.assign(mix(height, width.mul(1.1), smoke));
    viewCenter.xy.addAssign(right.mul(position.x).mul(width).add(up.mul(position.y).mul(height)));

    return projectionMatrix.mul(viewCenter);
  });

  const noise = /*@__PURE__*/ Fn(([p]) => {
    return sin(p.x.mul(8.3).add(sin(p.y.mul(5.7)))).mul(sin(p.y.mul(7.1).sub(p.x.mul(3.2))));
  });

  const particleFragment = /*@__PURE__*/ Fn(() => {
    If(vState.w.greaterThan(1.5), () => {
      Discard();
    });

    const age = vState.x.toVar();
    const ember = step(0.5, vState.w).toVar();
    const uv = vUv.toVar();
    const t = age.mul(3.0).add(vState.z.mul(6.28)).toVar();
    uv.x.addAssign(sin(uv.y.mul(8.0).sub(t)).mul(0.09).mul(sub(1.0, ember)));
    const baked = plume.sample(clamp(uv, 0.0, 1.0)).toVar();
    const edge = sub(1.0, smoothstep(0.12, 0.5, length(uv.sub(0.5).mul(vec2(1.1, 0.95))))).toVar();
    const filaments = smoothstep(
      -0.2,
      0.65,
      noise(uv.mul(2.0).add(vec2(t.mul(0.3), t.negate()))),
    ).toVar();
    const fade = smoothstep(0.0, 0.09, age)
      .mul(pow(sub(1.0, age), 1.5))
      .toVar();
    const flame = baked.a
      .mul(edge)
      .mul(mix(0.08, 1.0, filaments))
      .toVar();
    const spark = pow(max(0.0, sub(1.0, length(vUv.sub(0.5).mul(2.0)))), 2.0).toVar();
    const alpha = mix(flame.mul(0.58), spark.mul(0.9), ember).mul(fade).toVar();
    const hot = vec3(2.0, 0.46, 0.015).toVar();
    const cool = vec3(0.8, 0.035, 0.002).toVar();
    const color = mix(hot, cool, smoothstep(0.1, 0.95, age)).toVar();
    color.mulAssign(mix(0.65, 1.2, baked.r));

    If(alpha.lessThan(0.002), () => {
      Discard();
    });

    return vec4(color, alpha);
  });

  const smokeFragment = /*@__PURE__*/ Fn(() => {
    If(vState.w.lessThan(1.5), () => {
      Discard();
    });

    const age = vState.x.toVar();
    const uv = vUv.toVar();
    const phase = vState.z.mul(6.28).add(age.mul(2.0)).toVar();
    uv.x.addAssign(sin(uv.y.mul(7.0).add(phase)).mul(0.07));
    const density = plume.sample(clamp(uv, 0.0, 1.0)).a.toVar();
    const edge = sub(1.0, smoothstep(0.1, 0.5, length(uv.sub(0.5)))).toVar();
    const eddies = add(
      0.65,
      mul(0.35, sin(uv.x.mul(13.0).add(sin(uv.y.mul(12.0).add(phase))))),
    ).toVar();
    const fade = smoothstep(0.0, 0.16, age)
      .mul(sub(1.0, smoothstep(0.45, 1.0, age)))
      .toVar();
    const alpha = density.mul(edge).mul(eddies).mul(fade).mul(0.22).toVar();

    If(alpha.lessThan(0.002), () => {
      Discard();
    });

    const color = mix(vec3(0.09, 0.075, 0.065), vec3(0.045, 0.05, 0.065), age).toVar();

    return vec4(color, alpha);
  });

  return {particleVertex, noise, particleFragment, smokeFragment};
}
