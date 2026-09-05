/* The two pieces of arithmetic that make a replay the run it replays.
 *
 * A room is a pure function of the clicks with a solver in the middle of it,
 * and that holds only while the live run and the replay do the same things in
 * the same order. Both of the things below used to be written twice — once in
 * the frame loop and once in the settle — and both of them drifted, in ways
 * nobody could see until an evening was reopened and half the room was
 * somewhere else. So each is one function now, and the loop and the replay
 * both run it.
 *
 * They live here rather than in room3d.js because a frame loop cannot be
 * tested and this can: it is a world, a handful of counters and nothing else.
 * See log.test.ts beside it, which reopens a run and asks for the same poses.
 */
import {isAsleep, rerun} from '@lucid/world';

/* ---- when each shove happened ---------------------------------------------
 *
 * The whole of what a save is: the shoves in the order a hand made them, each
 * with how many fixed steps of the world ran between the one before it and
 * it. The same shoves after the same steps against the same build is the same
 * room, bit for bit — so nothing here is ever a clock, which is a different
 * number on every machine, and always the world's own counter.
 */
export function ledger() {
  const shoves = [];
  let at = 0;                    // the world's step count at the last shove
  return {
    /** The log itself, which is what a save is written from. */
    shoves,
    /** Where the counting starts, in a world that has just been built.
        `hush` has taken its one step by then, and every `steps` written down
        or read back is measured from after it. */
    start(world) { at = world.steps; },
    /** One shove, written down before it is done — and written down as
        *when*, because that integer is the whole of the promise. */
    mark(world, name) {
      shoves.push({name, steps: world.steps - at});
      at = world.steps;
    },
    /** The counting forgotten along with the world it was counted against. */
    reset() { at = 0; },
    /** A log a save handed over, taken whole. */
    adopt(log) { shoves.length = 0; shoves.push(...log); },
    /** Do it all again, at no speed, and stand ready for the next press.
     *
     * `apply` is the room's own: the nth shove of a thing, by name. What
     * comes back is `rerun`'s answer — one longer than the log, because the
     * last of it is the settle at the end that nothing follows.
     */
    again(world, apply, opts) {
      const took = rerun(world, shoves, apply, opts);
      // What an old save could not say, now said.
      for (let i = 0; i < shoves.length; i++) shoves[i].steps = took[i];
      /* And that trailing settle is charged to nobody.
       *
       * It ran *after* the last shove, so the world's counter is past it by
       * the whole length of it. Counted from there, the next press was
       * written down as having happened a settle later than it did — and the
       * second time the evening was opened, that press landed while the one
       * before it was still in the air, and the room came back rearranged.
       * Something nobody could catch by watching: it took two reloads. */
      at = world.steps - (took[took.length - 1] ?? 0);
      return took;
    },
  };
}

/* ---- and what counts as having stopped ------------------------------------
 *
 * Rapier puts a body to sleep once it has been slow for long enough, and
 * there are two things in a room it will not say that about.
 *
 * A thin thing lying on a floor — the blanket's plate is four centimeters of
 * cloth — can sit in a contact that never quite settles, a hair of speed
 * either way for as long as anybody watches. To the eye it stopped half a
 * second ago; to the room it was still on its way, so its target stayed off
 * and nothing could press it again.
 *
 * And nothing rolls forever. A cylinder on a flat floor has no rolling
 * resistance the solver knows of, and a bolster that landed on its side went
 * on across the room past any patience. Damping is the first answer — see the
 * rooms — and this is the last one: a thing still going after this long is
 * put down where it is.
 *
 * Counted per fixed step and never per frame, which is the whole reason this
 * is a function rather than three lines in the loop. A frame is worth
 * anywhere from one to six steps depending on how fast the machine is drawing,
 * so a count kept per frame made the same shove sleep at step 57 on one
 * machine and step 86 on another — and the replay, which draws nothing and
 * only ever asked Rapier, agreed with neither. The room somebody watched was
 * not the room they came back to, and which room they got depended on their
 * frame rate.
 */
const QUIET_SPEED = .01;
/** Half a second of going nowhere is rest. */
const QUIET_STEPS = 30;
/** Twelve seconds, and it is put down where it is. */
const AWAKE_STEPS = 60 * 12;

/** One body, one fixed step: has it earned its sleep yet. `it` carries the
    two counters, which are the room's per-thing bookkeeping and are reset
    with the world. */
export function lull(it) {
  if (isAsleep(it.bound)) { it.quiet = 0; it.awake = 0; return; }
  it.awake = (it.awake || 0) + 1;
  if (it.awake >= AWAKE_STEPS) { it.bound.body.sleep(); return; }
  const v = it.bound.body.linvel(), w = it.bound.body.angvel();
  const speed = Math.hypot(v.x, v.y, v.z) + Math.hypot(w.x, w.y, w.z);
  it.quiet = speed < QUIET_SPEED ? (it.quiet || 0) + 1 : 0;
  if (it.quiet >= QUIET_STEPS) it.bound.body.sleep();
}
