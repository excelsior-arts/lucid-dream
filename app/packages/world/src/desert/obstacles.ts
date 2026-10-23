/** A horizontal capsule around a low object. Coordinates and radius are metres. */
export interface WalkObstacle {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
}

/** Includes the forward swing of a foot, not just the width of the standing hips. */
export const WALKER_CLEARANCE = 0.42;
const SKIN = 0.0001;

export function obstacleDistance(x: number, z: number, o: WalkObstacle) {
  const dx = o.bx - o.ax, dz = o.bz - o.az;
  const length2 = dx * dx + dz * dz;
  const f = length2 ? Math.max(0, Math.min(1, ((x - o.ax) * dx + (z - o.az) * dz) / length2)) : 0;
  return Math.hypot(x - o.ax - f * dx, z - o.az - f * dz) - o.radius;
}

/** Sweep the whole requested move, then keep only its tangential remainder.
 * This also handles a long frame crossing the entire obstacle in one step. */
export function moveAroundObstacles(
  x: number, z: number, toX: number, toZ: number,
  obstacles: readonly WalkObstacle[], clearance = WALKER_CLEARANCE,
) {
  let dx = toX - x, dz = toZ - z;
  // A retuned spawn may already overlap an object. Resolve it before sweeping,
  // including a zero-length move, so it cannot start on the wrong side of a wall.
  for (const o of obstacles) {
    const ax = o.bx - o.ax, az = o.bz - o.az, length2 = ax * ax + az * az;
    const f = length2 ? Math.max(0, Math.min(1, ((x - o.ax) * ax + (z - o.az) * az) / length2)) : 0;
    const cx = o.ax + f * ax, cz = o.az + f * az;
    let nx = x - cx, nz = z - cz, distance = Math.hypot(nx, nz);
    const radius = o.radius + clearance + SKIN;
    if (distance >= radius) continue;
    if (distance < 1e-10) {
      const length = Math.sqrt(length2);
      nx = length ? -az / length : 1;
      nz = length ? ax / length : 0;
      distance = 1;
    }
    x = cx + nx / distance * radius;
    z = cz + nz / distance * radius;
  }

  for (let pass = 0; pass < 4 && Math.hypot(dx, dz) > 1e-10; pass++) {
    let hit = 1, normalX = 0, normalZ = 0, collided = false;
    const consider = (time: number, nx: number, nz: number) => {
      if (time < -1e-9 || time > hit || dx * nx + dz * nz >= -1e-10) return;
      hit = Math.max(0, time);
      normalX = nx; normalZ = nz; collided = true;
    };
    for (const o of obstacles) {
      const radius = o.radius + clearance;
      if (Math.max(x, x + dx) < Math.min(o.ax, o.bx) - radius ||
          Math.min(x, x + dx) > Math.max(o.ax, o.bx) + radius ||
          Math.max(z, z + dz) < Math.min(o.az, o.bz) - radius ||
          Math.min(z, z + dz) > Math.max(o.az, o.bz) + radius) continue;
      const length = Math.hypot(o.bx - o.ax, o.bz - o.az);
      if (length > 0) {
        const ux = (o.bx - o.ax) / length, uz = (o.bz - o.az) / length;
        const nx = -uz, nz = ux;
        const side = (x - o.ax) * nx + (z - o.az) * nz;
        const across = dx * nx + dz * nz;
        if (Math.abs(across) > 1e-10) for (const sign of [-1, 1]) {
          const time = (sign * radius - side) / across;
          const along = (x + dx * time - o.ax) * ux + (z + dz * time - o.az) * uz;
          if (along >= 0 && along <= length) consider(time, sign * nx, sign * nz);
        }
      }
      for (const [cx, cz] of [[o.ax, o.az], [o.bx, o.bz]] as const) {
        const px = x - cx, pz = z - cz, a = dx * dx + dz * dz;
        const b = px * dx + pz * dz;
        const disc = b * b - a * (px * px + pz * pz - radius * radius);
        if (disc < 0 || b >= 0) continue;
        const time = (-b - Math.sqrt(disc)) / a;
        consider(time, (px + dx * time) / radius, (pz + dz * time) / radius);
      }
    }
    if (!collided) { x += dx; z += dz; break; }
    const travel = Math.max(0, hit - SKIN / Math.hypot(dx, dz));
    x += dx * travel; z += dz * travel;
    dx *= 1 - hit; dz *= 1 - hit;
    const inward = Math.min(0, dx * normalX + dz * normalZ);
    dx -= inward * normalX; dz -= inward * normalZ;
  }
  return {x, z};
}
