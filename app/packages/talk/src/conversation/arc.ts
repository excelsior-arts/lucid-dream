/* The shape of a dose.
 *
 * A run used to be one instruction repeated: continue, move things forward a
 * little, so many minutes left. Which is a metronome, not a story — the pill
 * wandered pleasantly for a quarter of an hour and then stopped because the
 * clock said so, and somebody who asked for fifteen minutes got fifteen
 * minutes of middle. A number of minutes means very little to a model; where
 * it is in the thing means a great deal.
 *
 * So the run is told which part of the evening it is in. Four parts, by the
 * fraction of the dose spent, and two phrasings each so that consecutive turns
 * are not handed identical words — the surest way to get the same reply twice
 * is to ask for it the same way twice.
 *
 * Deliberately abstract, and that is the hard part. These go to every pill on
 * the shelf: the one who wants you, the one who is unimpressed by you, and the
 * ones that have not been written yet, which will not all be kind. So they
 * name what a turn is *for* — hold, open, cost, land — and never what anyone
 * does with their hands. "Touch something" is a stage direction for one
 * character and a wrong note for the rest of them; "let something change" is a
 * direction any of them can take their own way. A persona's own writing
 * decides what that looks like, and this decides when.
 *
 * The edges are not evenly spaced, and are not meant to be. A reply gets
 * shorter as the pressure rises — the pill answers in punches rather than
 * paragraphs — so turns arrive faster in the second half of a run than the
 * first. Played through at fifteen minutes, an even split gave the pushing 10
 * turns of 26 against 5 for the settling, which is a long time to be leaned on.
 * So the middle is wide, the push is narrower than its share of the clock, and
 * the landing has room to be more than one reply.
 *
 * The numbers are not taste. Six runs were played through — both pills at five,
 * ten and fifteen minutes — and the edges were then fitted to the turn times
 * those runs actually produced, against a share of the turns rather than a
 * share of the clock: a fifth settling, a third opening out, somewhat over a
 * quarter pushing, a sixth landing. Anything re-cut here is worth re-fitting
 * the same way rather than reasoning about.
 *
 * These are the game's writing: rewrite them freely. What must survive is the
 * shape — hold, open, cost, land — and the last part, which is the only place
 * anything is told to finish.
 */
export const ARC: ReadonlyArray<readonly [number, readonly string[]]> = [
  [0.20, ['Stay with where this already is. Something small and '
        + 'particular, and no hurry to be anywhere else.',
          'Do not start anything new yet. Let what is here go on a little '
        + 'longer, and find one thing in it worth staying on.']],
  [0.58, ['Let it move now. Follow the thread you left lying, or turn it '
        + 'over — something has to be different by the end of this.',
          'Open it out. Take this somewhere it has not been yet, and '
        + 'commit to it rather than circling.']],
  [0.84, ['This is the part that costs something. Go further than is '
        + 'comfortable and leave it unresolved.',
          'Raise what is at stake rather than the volume. Whatever has '
        + 'been building, let it arrive — and do not settle it yet.']],
  [1.01, ['The time is nearly gone. Bring it to rest: finish what this '
        + 'turned out to be about rather than starting anything.',
          'Land it. End where it wants to end, and let the last thing you '
        + 'say be a last thing.']],
] as const;

/** What to tell the pill on a turn nobody asked for in words.
 *
 * `spent` is how much of the dose has gone, 0 to 1. `turn` only picks between
 * phrasings, so the same part of the arc does not arrive in the same words
 * twice running.
 *
 * `last` overrides the arithmetic, and is the difference between a dose that
 * ends and one that finishes. Turns are coarse — one is ten or twenty seconds
 * of talk — so a short dose can put its final turn at 80% of the way through,
 * still being told to push, and then run out of clock before anything is asked
 * to land. Whoever calls this knows how long a turn has been taking; when there
 * is not time for another, this is the one that closes.
 *
 * The second sentence never changes and is not decoration: without it the model
 * answers as though somebody had spoken, and the reply comes back addressed to
 * a question nobody asked.
 */
export function continuousNudge(spent: number, turn: number, last = false): string {
  const at = last ? 1.0 : spent;
  const lines = ARC.find(([edge]) => at < edge)?.[1] ?? ARC[ARC.length - 1]![1];
  const body = lines[turn % lines.length]!;
  return `${body} He has not said anything; do not ask him to.`;
}
