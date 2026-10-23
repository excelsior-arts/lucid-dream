/* A small landscape for the platform's own tests: a shore, a floor, two
 * dunes, a thin horizon field and one peak. Not anybody's trip -- a trip's
 * numbers are tested in that trip -- only enough ground for the sand, the
 * terrain and the grains to stand on. */
import {Geography} from '../landscape';
import type {Landscape} from '../landscape';

export const TEST_LANDSCAPE: Landscape = {
  floor: 0.85,
  coast: {x: -118.3, meander: [[1.2, 0.014], [0.5, 0.047]]},
  beach: {width: 10, transition: 17, slope: 0.045, seabedSlope: 0.075},
  ridges: [
    {name: 'near', points: [[-40, -60], [-10, 0], [-30, 70]], height: 6, windward: 22, leeward: 12, tip: 14, curve: true, wander: 3, swell: 0.6},
    {name: 'far', points: [[60, -90], [80, -20], [70, 60]], height: 9, windward: 30, leeward: 16, tip: 18},
  ],
  horizon: {
    basin: {halfWidth: 160, growth: 0.0008},
    seeds: {rows: 4, columns: [-1, 4], pitch: [87, 137], jitter: [104, 160], west: -80, east: 600, drop: 0.13},
    clear: {radius: [130, 174], west: [-110, -78], corridor: {from: [100, 120], halfWidth: [120, 154]}},
  },
  mountains: {
    foot: 610,
    peaks: [{x: 718, z: -35, radiusX: 108, radiusZ: 180, height: 78}],
    ridge: {x: 835, sway: [[38, 0.003], [14, 0.009]], width: 150, height: 28, swell: [[9, 0.014, 0], [5, 0.031, 1.3]]},
  },
};

export const geo = new Geography(TEST_LANDSCAPE);
