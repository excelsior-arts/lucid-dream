import {smooth, type Score} from '../experience/score';

export interface VitalEvent {
  time: number;
  kind: 'heart';
  strength: number;
  duration: number;
}

/** Exhausted pulse after the slowdown; opening tempo is the song's `heartbeatBpm`. */
const END_BPM = 32;

/** An authored sound cue, not a physiological simulation. All times are song seconds. */
export function vitalCue(time: number, score: Score) {
  const stopAt = score.duration - score.heartbeatStopBeforeEnd;
  const slowAt = score.heartbeatSlowAt;
  const frailAt = Math.max(slowAt, Math.min(score.stage_08_kneel - 28, stopAt - 12));
  const slow = smooth(slowAt, stopAt, time);
  const irregularity = smooth(frailAt, Math.max(frailAt + 1, stopAt - 3), time);
  const stopped = time >= stopAt;
  const start = score.heartbeatBpm;
  return {
    bpm: stopped ? 0 : start + (END_BPM - start) * slow,
    strength: stopped ? 0 : 1 - 0.28 * slow,
    irregularity,
    stopped,
    stopAt,
  };
}

const variation = [0, 0.06, -0.09, 0.48, -0.17, 0.13, 0.72, -0.1];

/** Fixed cues make the same late missed/weak beats repeat after every seek. */
export function vitalEvents(score: Score): VitalEvent[] {
  const events: VitalEvent[] = [];
  const stopAt = vitalCue(0, score).stopAt;
  let index = 0;
  for (let time = 0; time < stopAt - 1.3; index++) {
    const cue = vitalCue(time, score);
    events.push({
      kind: 'heart',
      time,
      duration: 0.52,
      strength: cue.strength * (1 - (index % 5 === 3 ? 0.42 : 0) * cue.irregularity),
    });
    time += (60 / cue.bpm) * (1 + variation[index % variation.length]! * cue.irregularity);
  }
  // A final, isolated double thud, then a definite absence of a pulse at the cue.
  events.push({kind: 'heart', time: stopAt - 0.62, duration: 0.52, strength: 0.66});
  return events.sort((a, b) => a.time - b.time);
}

/** A low, padded lub-dub with upper harmonics that survive laptop speakers. */
export function heartbeatSamples(sampleRate: number, fundamental = 57): Float32Array {
  const pitchScale = Math.max(28, Math.min(65, fundamental)) / 57;
  const samples = new Float32Array(Math.ceil(0.52 * sampleRate));
  for (const [start, strength, pitch] of [
    [0, 1, 57],
    [0.21, 0.67, 65],
  ]) {
    let phase = 0;
    for (let i = 0; i < 0.26 * sampleRate; i++) {
      const time = i / sampleRate;
      phase += (Math.PI * 2 * (pitch! + 27 * Math.exp(-time * 28)) * pitchScale) / sampleRate;
      const envelope =
        (1 - Math.exp(-time * 240)) * Math.exp(-time * 26) * (1 - smooth(0.18, 0.26, time));
      const value = Math.sin(phase) + Math.sin(phase * 2.02) * 0.4 + Math.sin(phase * 3) * 0.12;
      const at = Math.round(start! * sampleRate) + i;
      samples[at] = samples[at]! + value * envelope * strength! * 0.75;
    }
  }
  return samples;
}
