/* How he stands: square, both feet under him, and breathing.
 *
 * The captured idles are a person's. Mixamo's Idle sways his hips some 18 cm
 * from side to side, and the weight-shift idle that came with the footwork
 * cocks them -- a hip out, the pelvis rolled ten degrees and turned sixteen,
 * a relaxed man waiting. He is not that; he is a figure, generic and a little
 * abstract, and he stands straight.
 *
 * So the standing clip is the Idle made symmetrical: every frame averaged
 * with its own mirror image. A left bone takes the halfway rotation between
 * itself and its right twin reflected, a bone on the midline the halfway
 * between itself and its own reflection, and the hips lose their sideways
 * travel. What is left/right in the clip cancels -- the sway, the roll, the
 * twist, the weight on one leg -- and what is symmetric stays: the breath in
 * the chest, the small rise and fall of the hips, the arms hanging. The rig
 * is mirror-exact at rest (each left bone's rest rotation is its right twin's
 * reflected), which is what lets a reflection be taken bone by bone.
 */
import * as THREE from 'three/webgpu';

/** Reflection through the body's midline (the YZ plane, X across him). */
const reflect = (q: THREE.Quaternion) => q.set(q.x, -q.y, -q.z, q.w);
const twin = (bone: string) =>
  bone.includes('Left') ? bone.replace('Left', 'Right')
    : bone.includes('Right') ? bone.replace('Right', 'Left') : bone;

/** `clip`, averaged with its mirror image at `fps`, as a clip called `name`. */
export function symmetricClip(clip: THREE.AnimationClip, name = 'stand', fps = 30): THREE.AnimationClip {
  const tracks = new Map(clip.tracks.map((t) => [t.name, t]));
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = Float32Array.from({length: frames}, (_, i) => (i / (frames - 1)) * clip.duration);
  const sample = (track: THREE.KeyframeTrack) => {
    // Linear, which on a quaternion track is a slerp.
    const at = track.InterpolantFactoryMethodLinear();
    return (t: number) => Array.from(at.evaluate(t));
  };
  const out: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot), property = track.name.slice(dot + 1);
    const mirror = tracks.get(`${twin(bone)}.${property}`) ?? track;
    const own = sample(track), other = sample(mirror);
    if (property === 'quaternion') {
      const values = new Float32Array(frames * 4);
      const a = new THREE.Quaternion(), b = new THREE.Quaternion();
      times.forEach((t, i) => {
        a.fromArray(own(t));
        reflect(b.fromArray(other(t)));
        a.slerp(b, 0.5).normalize().toArray(values, i * 4);
      });
      out.push(new THREE.QuaternionKeyframeTrack(track.name, times, values));
    } else if (property === 'position') {
      const values = new Float32Array(frames * 3);
      times.forEach((t, i) => {
        const [x, y, z] = own(t), [mx, my, mz] = other(t);
        values.set([(x! - mx!) / 2, (y! + my!) / 2, (z! + mz!) / 2], i * 3);
      });
      out.push(new THREE.VectorKeyframeTrack(track.name, times, values));
    } else out.push(track.clone());
  }
  return new THREE.AnimationClip(name, clip.duration, out);
}
