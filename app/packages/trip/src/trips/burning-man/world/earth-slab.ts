import {BufferGeometry, Float32BufferAttribute, Vector3} from 'three/webgpu';

/** A grounded, hewn slab. The summit stays on the mountain-alignment plane. */
export function earthSlab(points: readonly Vector3[], index: number) {
  const [left, peak, right] = points as [Vector3, Vector3, Vector3];
  const along = (a: Vector3, b: Vector3, t: number) => a.clone().lerp(b, t);
  const foot = (z: number, y: number) => new Vector3(0, y, z);
  const lowLeft = foot(left.z, 0.18),
    lowRight = foot(right.z, 0.26);
  const outline = [
    foot(left.z + 0.18, -0.12),
    lowLeft,
    along(lowLeft, peak, 0.47).add(new Vector3(0, -0.08, 0.12)),
    peak.clone(),
    along(peak, lowRight, 0.43).add(new Vector3(0, -0.1, -0.08)),
    lowRight,
    foot(right.z - 0.12, -0.12),
  ];
  const center = foot(peak.z + (index - 1) * 0.28, peak.y * 0.38);
  center.x = -0.24 - index * 0.06;
  // Broad fractured faces and a chipped rim, with real depth visible in orbit.
  const inset = outline.map((point, i) => {
    const p = point.clone().lerp(center, 0.085);
    p.x = -0.09 - Math.sin(i * 2.4 + index) * 0.035;
    return p;
  });
  const back = outline.map((point, i) => {
    const p = point.clone();
    p.x = 1.15 + index * 0.12 + Math.sin(i * 1.9 + index) * 0.08;
    return p;
  });
  const backCenter = center.clone();
  backCenter.x = 1.3 + index * 0.12;
  const positions: number[] = [],
    colors: number[] = [];
  const frontNormal = new Vector3(-1, 0, 0),
    backNormal = new Vector3(1, 0, 0);
  const triangle = (a: Vector3, b: Vector3, c: Vector3, outward: Vector3, shade: number) => {
    if (b.clone().sub(a).cross(c.clone().sub(a)).dot(outward) < 0) [b, c] = [c, b];
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    for (let i = 0; i < 3; i++) colors.push(shade, shade * 0.98, shade * 0.94);
  };
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    const a = outline[i]!,
      b = outline[next]!,
      c = inset[i]!,
      d = inset[next]!;
    const shade = 0.86 + Math.sin(i * 4.7 + index * 2.1) * 0.06;
    triangle(center, c, d, frontNormal, shade);
    triangle(a, b, d, frontNormal, shade * 1.04);
    triangle(a, d, c, frontNormal, shade * 1.04);
    triangle(backCenter, back[next]!, back[i]!, backNormal, shade);
    const sideNormal = a.clone().add(b).multiplyScalar(0.5).sub(center);
    sideNormal.x = 0;
    triangle(a, back[i]!, back[next]!, sideNormal, shade * 0.95);
    triangle(a, back[next]!, b, sideNormal, shade * 0.95);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
