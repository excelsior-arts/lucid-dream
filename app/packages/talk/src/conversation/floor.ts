/* Who has the floor, and what it costs to take it.
 *
 * Ported from the parts of session.py that are not about a conversation at
 * all: `_speech_gen`, the `_replying` lock, `silence`, `steer`, and the two
 * facts about the speaker everything else paces itself against. They live
 * apart from both the turn and the loop because both of them are about this
 * one piece of state, and either importing the other to reach it would be a
 * circle drawn around a number.
 */
import type {Playback} from '@lucid/audio';
import type {Reply} from '@lucid/machine';
import {surface} from './surface';

/* Bumped every time the floor is taken. Anything queued behind that moment
   checks it and gives up rather than starting to talk into a silence you
   asked for. */
let gen = 0;

/** Whose turn a queued reply was meant to be. */
export const generation = (): number => gen;

/* One reply at a time, and in the order they asked. Python's `_replying` is a
   lock a worker thread blocks on; here it is a queue of waiters, which is the
   same promise with the same guarantee -- five Skips in one breath still take
   one turn, because only the last of them was queued after the last silence. */
let held = false;
const waiting: Array<(free: () => void) => void> = [];
const freed = new Set<() => void>();

/** Whether a turn has the floor right now. */
export const floorHeld = (): boolean => held;

function letGo(): void {
  const next = waiting.shift();
  if (next) {
    next(letGo);
    return;
  }
  held = false;
  // Anything that was waiting for the room to go quiet is owed a look now:
  // presses pooled during a reply, and a run waiting to write the next turn.
  for (const fn of [...freed]) fn();
}

/** Take the floor, waiting for whoever has it. The call hands back the way to
    give it up, which is the only way it is ever given up. */
export function takeFloor(): Promise<() => void> {
  if (!held) {
    held = true;
    return Promise.resolve(letGo);
  }
  return new Promise<() => void>((go) => waiting.push(go));
}

/** Or not, if somebody has it. For the things that exist to be free -- a warm,
    a look at the pool -- where waiting would put them behind the very thing
    they are meant to be ahead of. */
export function tryFloor(): (() => void) | null {
  if (held) return null;
  held = true;
  return letGo;
}

/** Told when the floor goes quiet. */
export function onFloorFree(fn: () => void): () => void {
  freed.add(fn);
  return () => { freed.delete(fn); };
}

/* The reply being spoken, and the queue it is being spoken into. Both belong
   to the page rather than to a conversation: the <audio> element outlives
   every room -- see routes/room/audio.ts, which makes exactly one. */
let reply: Reply | null = null;
let speaker: Playback | null = null;

/** The reply in flight, for the keys that act on one. */
export const current = (): Reply | null => reply;

export function replying(now: Reply | null): void {
  reply = now;
}

let unwatch: (() => void) | null = null;

/** Where a reply is to be played. Said once, by the room, on its way in. */
export function playInto(into: Playback): void {
  if (speaker === into) return;      // the same page's own queue, said again
  unwatch?.();
  speaker = into;
  // The state is derived from the queue as well as set by a turn -- see
  // `settleState`, which is why this is worth a subscription.
  unwatch = into.onChange(settleState);
}

/** The queue, for whoever is putting sound into it. */
export const playback = (): Playback | null => speaker;

/** Seconds of speech still to be heard: what is queued, plus what is left of
 *  the chunk in hand.
 *
 * Python estimated this from the audio it had sent and then preferred what the
 * page reported, aged by however long ago the page said so -- because the
 * browser did the playing and the machine never heard back. The page holds the
 * queue now, so this is simply true.
 */
export function remainingS(): number {
  /* A chunk the browser has stopped is not sound, and nothing may wait on
     it: a turn that did held the floor for as long as the page was away, and
     the line said on coming back was heard, transcribed and never answered. */
  if (!speaker || speaker.stalled) return 0;
  return Math.max(0, speaker.queuedS + speaker.playingS - speaker.position());
}

/** Is a voice actually coming out of the speaker right now?
 *
 * Not the same question as "is a turn in progress": a reply spends its first
 * seconds being written, and a press made in that window is picked up by the
 * hands and goes in with the turn it interrupted, which is better than taking
 * the floor from a turn that has not used it yet. This is only about sound,
 * because sound is the thing a press would talk over.
 */
export const speaking = (): boolean => remainingS() > 0.35;

/** Stop what is speaking, and cancel what is waiting to speak.
 *
 * Returns the new generation. A queued turn compares it with the one it
 * started with: if the floor has been taken since, it never begins. Stop used
 * to kill exactly one queued line, because the next one along woke up, cleared
 * the stop flag and carried on.
 */
export function silence(): number {
  gen += 1;
  reply?.interrupt();
  /* And the queue, whether or not there is a reply holding it: a replay has no
     reply object behind it, and Stop has to mean stop for that too. */
  speaker?.stop(false);
  settleState();
  return gen;
}

/** You said something while the pill was carrying the evening.
 *
 * Not an interruption and not nothing, which were the only two things this
 * could do before. During a run, talking over the pill did nothing at all: it
 * finished its line, and then the loop asked it to carry on being told, in so
 * many words, that you had not spoken -- so the next reply arrived with its own
 * agenda and read as though you were not in the room.
 *
 * So it lets the line it is on land, drops the rest of what was queued, and
 * stops generating more. What comes next is the answer to you, which is the
 * ordinary reply your words already asked for.
 */
export function steer(): boolean {
  if (reply) reply.steer();
  else speaker?.stop(true);
  return true;
}

/* What producing one turn has been costing, lately. Measured rather than
   guessed: it depends on the model, the machine and how much the pill has to
   say, and a run starts its next turn early enough for the two to overlap. */
let genSecs = 2.5;

export const turnCost = (): number => genSecs;

export function costOfTurn(seconds: number): void {
  genSecs = 0.7 * genSecs + 0.3 * seconds;
}

/** Derive the state rather than trust it.
 *
 * A hidden turn returns before the audio has drained -- that is what lets the
 * next one overlap it -- so nothing resets the state afterwards and the page
 * would say "speaking" for good. Python's `snapshot` worked this out five
 * times a second; here the queue says when it has changed. See Session.snapshot.
 */
export function settleState(): void {
  const state = surface().stateIs();
  if (state !== 'speaking' && state !== 'thinking') return;
  if (held || remainingS() > 0.05) return;
  surface().state('idle');
}

/** Cut the reply that is being spoken, and keep the floor as it is. For a
    voice that changed under it: the socket it was speaking through is closed,
    and a chunk ended by a closing socket reads, to the reply, as a chunk
    spoken to the end -- the rest of it would go into the transcript as said
    and never be heard. Cut, it keeps what was heard. */
export function cutReply(): void {
  reply?.interrupt();
}

/** Leaving the room: nothing here belongs to the next one. */
export function clearFloor(): void {
  reply?.interrupt();
  reply = null;
}
