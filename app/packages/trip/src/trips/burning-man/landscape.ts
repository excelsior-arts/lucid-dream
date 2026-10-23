/* Burning Man's landscape: the numbers the desert is made of here.
 *
 * The author's sketch in metres: west = -X, north = -Z, Y is height. The map
 * -- where he starts, the coast, the playa floor, the gates and passages and
 * where the three monuments stand -- and the twenty-odd dune crests drawn over
 * it, the Black Rock peaks beyond the eastern flats, and the far dune chains
 * round the basin. All of it was constants inside the sand engine before the
 * engine became the platform's (@lucid/world/desert); it is the same numbers,
 * handed in, and lab/ground-identity.test.ts holds every height to the double
 * it was.
 *
 * The functions at the foot are the geography those numbers make, bound so
 * the rest of this trip imports them by the names it always did.
 */
import {Geography} from '@lucid/world/desert';
import type {DuneRidge, Landscape, MapPoint} from '@lucid/world/desert';

export type {DuneRidge, MapPoint} from '@lucid/world/desert';

const passagePoint = (distance: number, offset: number, sign: number): MapPoint => {
  const length = Math.hypot(39, 101);
  return [
    (-39 * distance + 101 * offset) / length,
    (sign * (101 * distance + 39 * offset)) / length,
  ];
};
const passagePath = (sign: number): readonly MapPoint[] =>
  [
    [72, -4],
    [80, -5.5],
    [109, 5.5],
    [113, 3],
  ].map(([s, n]) => passagePoint(s!, n!, sign));
/** How far out the monuments stand. A viewer who takes the walk over skips every
 * scripted stop and so covers about 156 m before the knee fall, and the piece
 * wants the best possible approach to end just short of an altar rather than at
 * one. The dunes and the hidden playas do not move with this. */
const ALTAR_REACH = 161;
// The monuments occupy the clear centers, not the inner toes of the entrance horns.
const hiddenPlayas = {
  air: {center: passagePoint(121, 1, -1), clearRadius: 5.5},
  fire: {center: passagePoint(121, 1, 1), clearRadius: 5.5},
};
export const MAP = {
  spawn: [0, 0] as MapPoint,
  coast: -118.3,
  floor: 0.85,
  mountainFoot: 610,
  altarGap: 10,
  gates: {
    air: passagePoint(109, 5, -1),
    fire: passagePoint(109, 5, 1),
    earth: [96, 0] as MapPoint,
    sea: [-76, 0] as MapPoint,
  },
  passages: {air: passagePath(-1), fire: passagePath(1)},
  hiddenPlayas,
  altars: {
    // Each stands on level playa along its own bearing, past the dunes rather
    // than on one, and close enough that the best a viewer can walk ends just
    // short of it. The two beyond the horns are the ones the ground argues
    // with: nearer is reachable, further is better hidden, and reach wins.
    air: passagePoint(165, 6, -1),
    fire: passagePoint(166, 30, 1),
    earth: [ALTAR_REACH, 0] as MapPoint,
  },
};

// Crest polylines follow the drawn layout. Overlapping tips form the concealed
// north/south passages; the low humps leave the middle predominantly flat.
export const DUNE_RIDGES: readonly DuneRidge[] = [
  {
    name: 'Starting ridge',
    points: [
      [14, -88],
      [4, -62],
      [-9, -36],
      [-3, -13],
      [0, 0],
      [4, 13],
      [10, 27],
      [3, 50],
      [-10, 76],
    ],
    curve: true,
    // Sixty centimetres taller for the opening, which is well under the five
    // and a bit metres at which the sea would show over the coastal screen.
    height: 3.75,
    windward: 15,
    leeward: 9,
    // The curve is in the drawn line here rather than added across it, so the
    // control point he stands on cannot move and the opening frame is unchanged.
    swell: 0.34,
    phase: 5.071,
    tip: 18,
  },
  {
    name: 'Coastal screen',
    points: [
      [-74, -170],
      [-92, -138],
      [-92, -110],
      [-80, -78],
      [-67, -55],
      [-77, -28],
      [-76, -8],
      [-76, 0],
      [-76, 8],
      [-78, 28],
      [-90, 53],
      [-87, 79],
      [-84, 111],
      [-64, 146],
      [-78, 181],
    ],
    curve: true,
    height: 6.0,
    windward: 34,
    leeward: 32,
    // Undulating rather than flat topped, and phased so the route crosses it
    // through a low of the wave instead of over a high.
    wander: 3.0,
    swell: 0.55,
    phase: 1.5,
    tip: 20,
  },
  {
    name: 'North west arm',
    curve: true,
    points: [[-84, -33], [-73, -57], passagePoint(83, -24, -1)],
    height: 4.8,
    windward: 17,
    leeward: 10,
    tip: 9,
  },
  {
    name: 'North east arm',
    curve: true,
    points: [[3, -35], [-6, -64], passagePoint(76, 22, -1)],
    height: 4.15,
    windward: 13,
    leeward: 9,
    tip: 10,
  },
  {
    name: 'South west arm',
    curve: true,
    points: [[-84, 33], [-73, 57], passagePoint(83, -24, 1)],
    height: 4.8,
    windward: 17,
    leeward: 10,
    tip: 9,
  },
  {
    name: 'South east arm',
    curve: true,
    points: [[3, 35], [-6, 64], passagePoint(76, 22, 1)],
    height: 4.8,
    windward: 13,
    leeward: 9,
    tip: 10,
  },
  {
    name: 'Central north hump',
    curve: true,
    points: [
      [-22, -24],
      [-20, -13],
      [-22, 0],
    ],
    height: 1,
    windward: 8,
    leeward: 4,
    tip: 10,
  },
  {
    name: 'Central south hump',
    curve: true,
    points: [
      [-34, 7],
      [-30, 19],
      [-33, 29],
    ],
    height: 0.95,
    windward: 8,
    leeward: 4,
    tip: 10,
  },
  {
    name: 'Eastern near hump',
    curve: true,
    points: [
      [26, -33],
      [30, -22],
      [27, -11],
    ],
    height: 1.05,
    windward: 8,
    leeward: 4,
    tip: 10,
  },
  {
    name: 'Eastern mid hump',
    curve: true,
    points: [
      [44, 12],
      [48, 23],
      [45, 35],
    ],
    height: 0.9,
    windward: 8,
    leeward: 4,
    tip: 10,
  },
  {
    name: 'Eastern far hump',
    curve: true,
    points: [
      [58, -19],
      [62, -8],
      [59, 3],
    ],
    height: 0.8,
    windward: 8,
    leeward: 4,
    tip: 10,
  },
  // The eastern playa is a scatter of humps rather than a ridge across it, so the
  // floor reads through to the foot of the range between them. One of them, sized
  // and placed for the job, stands between the earth altar and everywhere the walk
  // and the opening shot can see it from.
  {
    name: 'Eastern scatter far north',
    curve: true,
    points: [
      [84, -94],
      [88, -83],
      [85, -72],
    ],
    height: 2.0,
    windward: 11,
    leeward: 6,
    tip: 11,
  },
  {
    name: 'Eastern scatter north',
    curve: true,
    points: [
      [73, -57],
      [78, -47],
      [75, -37],
    ],
    height: 2.2,
    windward: 12,
    leeward: 6,
    tip: 11,
  },
  {
    name: 'Eastern scatter north inner',
    curve: true,
    points: [
      [93, -31],
      [97, -22],
      [94, -13],
    ],
    height: 1.7,
    windward: 10,
    leeward: 6,
    tip: 10,
  },
  {
    name: 'Earth altar blocker',
    curve: true,
    points: [
      [101, -16],
      [107, -7],
      [108, 3],
      [103, 14],
    ],
    height: 3.9,
    windward: 14,
    leeward: 10,
    tip: 9,
  },
  {
    name: 'Eastern scatter south inner',
    curve: true,
    points: [
      [93, 15],
      [97, 24],
      [94, 33],
    ],
    height: 1.65,
    windward: 10,
    leeward: 6,
    tip: 10,
  },
  {
    name: 'Eastern scatter south',
    curve: true,
    points: [
      [75, 43],
      [80, 53],
      [77, 63],
    ],
    height: 2.3,
    windward: 12,
    leeward: 6,
    tip: 11,
  },
  {
    name: 'Eastern scatter far south',
    curve: true,
    points: [
      [82, 79],
      [86, 90],
      [83, 101],
    ],
    height: 2.1,
    windward: 11,
    leeward: 6,
    tip: 11,
  },
  {
    name: 'Northern starting horn',
    points: [
      [6, -64],
      [25, -95],
      [16, -135],
      [-5, -169],
    ],
    height: 3.9,
    windward: 19,
    leeward: 11,
    tip: 25,
    curve: true,
  },
  {
    name: 'Southern starting horn',
    points: [
      [2, 46],
      [21, 87],
      [14, 128],
      [-10, 163],
    ],
    height: 4.3,
    windward: 19,
    leeward: 12,
    tip: 26,
    curve: true,
  },
  {
    name: 'Northern eastern branch',
    points: [
      [92, -48],
      [74, -77],
      [59, -119],
      [76, -173],
    ],
    height: 3.1,
    windward: 18,
    leeward: 11,
    tip: 30,
    curve: true,
  },
  {
    name: 'Southern eastern branch',
    points: [
      [86, 113],
      [114, 175],
      [94, 213],
    ],
    height: 3.5,
    windward: 18,
    leeward: 10,
    tip: 35,
    curve: true,
  },
  {
    name: 'North inner west curl',
    points: [
      [83, -24],
      [100, -10],
      [109, -0.5],
      [111, -13],
      [116, -25],
    ].map(([s, n]) => passagePoint(s!, n!, -1)),
    curve: true,
    height: 3.6,
    windward: 8,
    leeward: 8,
    tip: 14,
  },
  {
    name: 'North inner east curl',
    points: [
      [70, 22],
      [75, 9],
      [80, 0.5],
      [86, 8],
      [92, 17],
    ].map(([s, n]) => passagePoint(s!, n!, -1)),
    curve: true,
    height: 3.6,
    windward: 8,
    leeward: 8,
    tip: 13,
  },
  {
    name: 'South inner west curl',
    points: [
      [83, -24],
      [100, -10],
      [109, -0.5],
      [111, -13],
      [116, -25],
    ].map(([s, n]) => passagePoint(s!, n!, 1)),
    curve: true,
    height: 3.6,
    windward: 8,
    leeward: 8,
    tip: 14,
  },
  {
    name: 'South inner east curl',
    points: [
      [70, 22],
      [75, 9],
      [80, 0.5],
      [86, 8],
      [92, 17],
    ].map(([s, n]) => passagePoint(s!, n!, 1)),
    curve: true,
    height: 3.6,
    windward: 8,
    leeward: 8,
    tip: 13,
  },
];

/** Shared by the horizon mesh and the Earth altar's perspective study. */
export const BLACK_ROCK_PEAKS = [
  {x: 713, z: -181, radiusX: 100, radiusZ: 184, height: 42},
  {x: 718, z: -35, radiusX: 108, radiusZ: 180, height: 78},
  {x: 699, z: 112, radiusX: 86, radiusZ: 155, height: 50},
] as const;

/** The numbers, in the shape the desert takes them. The coast meanders by
    two sines; the beach is ten metres of flat sand and seven more of
    transition; the horizon field and the range are as the standalone piece
    had them written in. */
export const LANDSCAPE: Landscape = {
  floor: MAP.floor,
  coast: {x: MAP.coast, meander: [[1.2, 0.014], [0.5, 0.047]]},
  beach: {width: 10, transition: 17, slope: 0.045, seabedSlope: 0.075},
  ridges: DUNE_RIDGES,
  horizon: {
    basin: {halfWidth: 160, growth: 0.0008},
    seeds: {rows: 16, columns: [-1, 12], pitch: [87, 137], jitter: [104, 160], west: -80, east: 1060, drop: 0.13},
    clear: {radius: [130, 174], west: [-110, -78], corridor: {from: [100, 120], halfWidth: [120, 154]}},
  },
  mountains: {
    foot: MAP.mountainFoot,
    peaks: BLACK_ROCK_PEAKS,
    ridge: {x: 835, sway: [[38, 0.003], [14, 0.009]], width: 150, height: 28, swell: [[9, 0.014, 0], [5, 0.031, 1.3]]},
  },
};

/** The ground those numbers make, surveyed once for the whole trip. */
export const geo = new Geography(LANDSCAPE);

export const {coastX, coastalDuneWeight, landHeight, duneRelief, coastalCrest, mountainHeight, surveyedHeight} = geo;
export const horizonDuneHeight = geo.horizon.height;
export const basinHalfWidth = geo.horizon.basinHalfWidth;
/** The displayed surface and foot contact sample the same survey. */
export const duneHeight = geo.surveyedHeight;

/** Metres of approach over which the camera turns forward onto the last climb. */
export const COASTAL_CLIMB = 25;
