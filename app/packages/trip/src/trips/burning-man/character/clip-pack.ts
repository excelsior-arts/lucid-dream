import * as THREE from 'three/webgpu';

type PackedTrack = {name: string; type: string; times: number; values: number};
type PackedHeader = {mappedBones: number; clips: {name: string; duration: number; tracks: PackedTrack[]}[]};

/**
 * The authored knee and stand-up clips, as float32 views over one buffer rather
 * than two megabytes of JSON the browser has to parse before the body can move.
 * `scripts/pack-animations.mjs` writes it; names and keyframes are unchanged.
 */
export function decodeClips(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BMAN')
    throw new Error('Animation pack is not in the expected format');
  const headerBytes = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerBytes)),
  ) as PackedHeader;
  let at = 8 + headerBytes;
  at += (4 - (at % 4)) % 4;
  const floats = new Float32Array(buffer, at);
  let cursor = 0;
  const clips = header.clips.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      const times = floats.subarray(cursor, cursor + track.times);
      cursor += track.times;
      const values = floats.subarray(cursor, cursor + track.values);
      cursor += track.values;
      if (track.type === 'quaternion')
        return new THREE.QuaternionKeyframeTrack(track.name, times, values);
      return new THREE.VectorKeyframeTrack(track.name, times, values);
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
  return {clips, mappedBones: header.mappedBones};
}
