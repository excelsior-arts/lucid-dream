import {Geography} from '../landscape';
import type {Landscape} from '../landscape';
import {buildAtlasRows} from './atlas-build';

export type SurveyJob = {
  /** The numbers the ground is made of. A function cannot be posted to a
      worker, so the worker builds the same geography from the same numbers. */
  landscape: Landscape;
  id: number;
  min: number;
  step: number;
  size: number;
  range: number;
  from: number;
  to: number;
};

// One band of one survey per message. The whole survey is split across as many
// workers as the machine will give, so the ridges are evaluated while the body
// downloads rather than on the thread that has to draw the first frame.
//
// The geography is built once per landscape and kept: the bands of one survey
// all arrive with the same numbers, and compiling the ridges per band would
// cost more than the band.
let known: {key: string; geo: Geography} | undefined;
const geographyOf = (landscape: Landscape) => {
  const key = JSON.stringify(landscape);
  if (known?.key !== key) known = {key, geo: new Geography(landscape, {survey: false})};
  return known.geo;
};

self.onmessage = (event: MessageEvent<SurveyJob>) => {
  const {landscape, id, min, step, size, range, from, to} = event.data;
  const rows = buildAtlasRows(geographyOf(landscape).landHeight, min, step, size, range, from, to);
  (self as unknown as {postMessage: (d: unknown, t: Transferable[]) => void}).postMessage(
    {id, from, rows: rows.buffer},
    [rows.buffer],
  );
};
