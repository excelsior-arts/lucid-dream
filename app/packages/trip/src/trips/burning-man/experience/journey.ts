import {MAP, type MapPoint} from '../landscape';
import {duneHeight} from '../landscape';
import {type Score, pace, sampleScore} from './score';
import {Walker} from './walker';
export type Journey = 'sea' | 'air' | 'fire' | 'earth';
export function journeyDirection(journey: Journey, score: Score): [number, number] {
  if (journey === 'sea') return [-1, 0];
  const gate = MAP.gates[journey];
  const x = gate[0] - score.spawnX,
    z = gate[1] - score.spawnZ;
  const length = Math.hypot(x, z);
  return length > 0 ? [x / length, z / length] : [0, 0];
}
/** Follow the level bend between overlapping horns in Studio and timeline rehearsals. */
export function journeyHeading(
  journey: Journey,
  score: Score,
  position: MapPoint,
): [number, number] {
  if (journey !== 'air' && journey !== 'fire') return journeyDirection(journey, score);
  const path: readonly MapPoint[] = [
    [score.spawnX, score.spawnZ],
    ...MAP.passages[journey],
    MAP.altars[journey],
  ];
  let nearest = Infinity,
    segment = 0,
    fraction = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!,
      b = path[i + 1]!;
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((position[0] - a[0]) * dx + (position[1] - a[1]) * dz) / (dx * dx + dz * dz)),
    );
    const distance = Math.hypot(position[0] - a[0] - dx * t, position[1] - a[1] - dz * t);
    if (distance < nearest) {
      nearest = distance;
      segment = i;
      fraction = t;
    }
  }
  // A short look-ahead rounds the turns without cutting across a dune's foot.
  let ahead = 0.6;
  for (let i = segment; i < path.length - 1; i++) {
    const a = path[i]!,
      b = path[i + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const start = i === segment ? fraction : 0;
    if (ahead <= length * (1 - start) || i === path.length - 2) {
      const t = Math.min(1, start + ahead / length);
      const dx = a[0] + (b[0] - a[0]) * t - position[0],
        dz = a[1] + (b[1] - a[1]) * t - position[1];
      const distance = Math.hypot(dx, dz);
      return distance > 0.00001 ? [dx / distance, dz / distance] : [0, 0];
    }
    ahead -= length * (1 - start);
  }
  return [0, 0];
}
/** Conservative distance bound: uphill effort never adds speed. */
export function travelBudget(score: Score) {
  let distance = 0;
  for (let t = 0; t < score.stage_08_kneel; t += 1 / 120)
    distance += (pace(score) * sampleScore(t, score).mobility) / 120;
  return distance;
}
/** Geometric visibility, including the top of an altar. No time-based reveal toggle. */
export function terrainOccludes(from: MapPoint, to: MapPoint, eye = 1.8, targetHeight = 2.2) {
  const startY = duneHeight(...from) + eye,
    endY = duneHeight(...to) + targetHeight;
  const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.25);
  for (let i = 1; i < steps; i++) {
    const f = i / steps,
      x = from[0] + (to[0] - from[0]) * f,
      z = from[1] + (to[1] - from[1]) * f;
    if (duneHeight(x, z) > startY + (endY - startY) * f) return true;
  }
  return false;
}
export function surveyJourney(journey: Journey, score: Score) {
  const walker = new Walker();
  walker.reset(score.spawnX, score.spawnZ);
  const direction = journeyDirection(journey, score),
    gate = MAP.gates[journey];
  let crossedAt: number | null = null;
  for (let t = 0; t < score.duration; t += 1 / 120) {
    walker.step(
      ...journeyHeading(journey, score, [walker.state.position.x, walker.state.position.z]),
      1 / 120,
      sampleScore(t, score).mobility,
      score,
    );
    const pos = walker.state.position;
    if (
      crossedAt === null &&
      (pos.x - gate[0]) * direction[0] + (pos.z - gate[1]) * direction[1] >= 0
    )
      crossedAt = t;
  }
  const {x, z} = walker.state.position;
  const altar = journey === 'sea' ? undefined : MAP.altars[journey];
  return {
    journey,
    crossedAt,
    end: [x, z] as MapPoint,
    distance: walker.state.distance,
    altarDistance: altar ? Math.hypot(x - altar[0], z - altar[1]) : null,
    altarVisible: altar ? !terrainOccludes([x, z], altar, 0.9) : null,
  };
}
