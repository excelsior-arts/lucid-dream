/* The evening, run by the page.
 *
 * Everything between one turn and the next: who takes the floor from whom, the
 * tape and how it paces itself, and what a hand put to something in the room
 * becomes. Ported from session.py -- `silence`, `steer`, `cut_in`,
 * `speak_again`, `_put_it_back`, `one_more`, `start_continuous`,
 * `stop_continuous`, `hold_continuous`, `_continuous_loop`, `did`,
 * `_hands_soon`, `_hands_turn`, `delete_turn` and what `open_session(fresh)`
 * meant -- with the two facts it used to guess at read directly: this page
 * holds the queue, so how much is left to be heard is not an estimate any
 * more.
 */
import {splitForSpeech} from '@lucid/machine';
import {hatch, sound} from '@lucid/shell';
import {link} from '../link/store';
import {continuousNudge} from './arc';
import * as F from './files';
import {
  floorHeld, generation, onFloorFree, playback, remainingS, silence, speaking,
  steer, takeFloor, turnCost,
} from './floor';
import {pressed, press, settle, take} from './hands';
import type {Open} from './room';
import {freshSession, opened, reread} from './room';
import {runTurn} from './turn';

export {silence, steer} from './floor';

const sleep = (ms: number) => new Promise((go) => setTimeout(go, ms));
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/* ---- taking the floor ----------------------------------------------------- */

/** A new message takes the floor — unless the pill is running a scene.
 *
 * Talking over the pill should stop it, the way it would with a person. In
 * continuous mode the pill is carrying the session itself and what you say is a
 * steer, not an interruption, so it finishes the beat it is on and works it in
 * from the next one.
 */
export function cutIn(): boolean {
  // Held is paused, not carrying the session: nothing is talking, so typing
  // takes the floor the way it would with nothing running.
  if (continuousLeft() > 0 && !held) return steer();
  silence();
  return true;
}

/** Stop: cut this line off and end any run.
 *
 * Interrupt means silence, so it ends a continuous run too -- otherwise it
 * starts talking again a second later.
 */
export function stop(): void {
  stopContinuous();
  silence();
}

/** Enough of this one. Not enough of the evening.
 *
 * Stop is a full stop: it silences what is speaking and ends the run with it.
 * This is the other thing anybody wants of a long reply — the one where you
 * have got the idea and would like the next one — so it takes the floor away
 * from this line and leaves the tape running. In a continuous run the loop is
 * waiting for the audio to drain before it starts the next turn, so silencing
 * this one *is* asking for the next one, and nothing else is needed.
 *
 * With nothing running there is no next one waiting to happen, so it asks for
 * one: a single turn, taken without being typed.
 */
export function skip(): void {
  silence();
  if (continuousLeft() <= 0) oneMore();
}

/* ---- saying a line again -------------------------------------------------- */

/** Say a line again, because the mic cut it off or you missed it.
 *
 * Not a turn: nothing is written to the transcript, no memory is folded, and
 * where you stand with the pill does not move. Nor is anything credited to the
 * pacer -- the words are already on the glass, and paying for them twice would
 * run the transcript ahead of the voice for the rest of the evening.
 */
export async function speakAgain(text: string): Promise<void> {
  const line = (text || '').trim();
  if (!line) return;
  if (sound.hush) {
    /* Nothing is said into a muted room. The machine would load a voice and
       make a clip the speaker drops on arrival, which is fifteen seconds and
       several gigabytes for a silence. The mark on the bubble is the way back:
       pressing that turns the sound on and then says the line. */
    hatch.say('the sound is off — turn it back on to hear a line again', 'warn');
    return;
  }
  const room = opened();
  const speaker = playback();
  if (!room || !speaker) return;
  // Pressing play takes the floor from whatever is on it, including an earlier
  // replay: the second one you click is the one you want.
  const gen = silence();
  const free = await takeFloor();
  try {
    if (gen !== generation() || opened() !== room) return;  // silenced while queued
    link.setState({state: 'speaking'});
    for (const chunk of splitForSpeech(line)) {
      if (gen !== generation()) break;
      /* The paragraph marker, the way the splitter writes it: a trailing
         newline is a thought ending, and the machine puts a beat after it. */
      const endsParagraph = chunk.endsWith('\n');
      const say = endsParagraph ? chunk.slice(0, -1) : chunk;
      if (!say.trim()) continue;
      for await (const frame of room.voice.speak(say, endsParagraph)) {
        if (gen !== generation()) break;
        speaker.enqueue(frame.pcm, frame.rate);
      }
    }
    // Held through the draining, the way a turn is: a replay that let the
    // floor go the moment the last chunk was queued would be a replay another
    // turn could start talking over.
    // And let go of the way a turn lets go: a paused replay is not a replay
    // going on, and a room that was left is nobody's to hold.
    while (remainingS() > 0.05 && gen === generation() && !speaker.held
           && opened() === room) await sleep(100);
  } catch (e) {
    hatch.say(`replay failed: ${why(e)}`, 'warn');
  } finally {
    free();
  }
  if (gen === generation()) link.setState({state: 'idle'});
}

/** A noise stopped the pill and turned out to be nothing.
 *
 * Barge-in decides in about a tenth of a second, because waiting longer than
 * that to stop talking over somebody is worse than being wrong occasionally. A
 * chair moving is loud and has pitch in it, so it is wrong occasionally — and
 * the cost lands entirely on the person, who loses the end of a reply to a
 * sound they did not make and gets nothing in its place.
 *
 * So the line is said again. Not the whole turn: this is a replay, the way the
 * key on the deck is, so nothing is generated, nothing is written down, and
 * where you stand does not move. From the top of the line rather than from
 * where it was cut, because there is no knowing where that was -- what the page
 * has is a whole line, and hearing one sentence twice is a smaller wrong than
 * losing four.
 */
export function putItBack(): void {
  const room = opened();
  if (!room || remainingS() > 0.05) return;         // already talking again
  if (!floorHeld()) { again(room); return; }
  /* The floor is still held, and by the turn that is dying: the detector takes
     about a tenth of a second to stop a reply and the better part of another
     second to decide the noise was nothing, and the interrupted turn spends
     that window writing what it managed to say. So this was a no-op in exactly
     the case it exists for. Waited for instead -- the floor says when it is
     free -- and only for as long as a turn takes to land. */
  if (owed) return;                                 // one noise, one line back
  const gen = generation();
  const by = Date.now() + 4000;
  owed = onFloorFree(() => {
    forget();
    if (Date.now() > by || gen !== generation() || opened() !== room) return;
    if (remainingS() > 0.05) return;                // something newer is talking
    again(room);
  });
}

/* The wait putItBack is holding, if it is holding one. */
let owed: (() => void) | null = null;
function forget(): void {
  owed?.();
  owed = null;
}

/** Say the last line again, whatever it turned out to be.
 *
 * Read here rather than when the noise happened: the line the room stopped is
 * only in the transcript once the dying turn has written down what it spoke,
 * and that is the thing worth hearing again. Nothing to say if what is at the
 * end is his -- a turn landed while we waited, and it is being answered. */
function again(room: Open): void {
  const last = room.history[room.history.length - 1];
  if (!last || last.role !== 'assistant') return;   // nothing was being said
  hatch.say('that was the room — picking the line back up');
  void speakAgain(last.content);
}

/* ---- one turn, unasked ---------------------------------------------------- */

/* The same shape as a continuous nudge and none of its pacing: there is no time
   left to spend, because this is one turn and not a run. */
export const ONE_MORE = 'Go on from where you just were. He has not said '
  + 'anything; do not ask him to. One reply — take it a step further, and let '
  + 'it land.';

/** One turn, taken without being asked for in words.
 *
 * What Skip means when nothing is running. Play hands the pill the whole dose
 * and lets it go; this hands it one turn and stops — so a conversation can be
 * walked forward a step at a time by somebody who does not want to type and
 * does not want to hand over the evening either.
 *
 * The tape has to have been started, though. The first word is always
 * somebody's — see the note on the Play key — and a room where nothing has been
 * said has nothing for a pill to go on from.
 */
export function oneMore(): boolean {
  const room = opened();
  if (!room || !room.history.some((m) => m.role === 'user')) return false;
  void runTurn({slug: room.slug, sessionId: room.sessionId, text: ONE_MORE, hidden: true});
  return true;
}

/* ---- the tape ------------------------------------------------------------- */

/* When the run ends, in this page's own clock, and how long it was given. Kept
   as well as the deadline: where the run is in itself is what decides what it
   is told, and a deadline alone cannot say. */
let until = 0;
let span = 0;
/* A generation number: the previous loop can still be inside a reply when we
   start a new one, and without this it wakes up, sees the run active again and
   either doubles the turns or ends the new run. */
let runGen = 0;
let from = 0;
let stopped = true;
let held = false;
let saved = 0;
/** What the page was last told about the tape, so a clock that has not moved is
    not a re-render of the whole room five times a second. */
let shown = '';

const now = () => Date.now() / 1000;

/** How much of this dose is left, in seconds. */
export function continuousLeft(): number {
  if (held) return saved;              // the clock is stopped
  return Math.max(0, until - now());
}

/** Whether the tape is held where it is. */
export const continuousHeld = (): boolean => held;

/* What the `continuous` event said, said to the page's own store instead. The
   deck's clock counts the seconds off locally and is corrected by this -- see
   tape.ts -- so it is worth saying whenever the minute changes and never more
   often than that. */
function tell(): void {
  const left = continuousLeft();
  const on = left > 0;
  const minutes = Math.round((left / 60) * 10) / 10;
  const mark = `${on}:${minutes}`;
  if (mark === shown) return;
  shown = mark;
  link.setState({continuous: on, continuous_min: minutes});
}

/** Let the pill keep going on its own for a while.
 *
 * Two ways in, and they want different things. A checkbox was a mode: tick it
 * and nothing happens until the next reply ends, which is what "keep going"
 * says. A Play key is an action: press it and the tape runs, now — waiting for
 * something else to happen first is not what anybody means by Play. `atOnce` is
 * which of the two this is.
 *
 * Either way you stay in control: anything you say or type is an ordinary turn,
 * and the loop waits for it to finish before continuing, so you can steer
 * without stopping the session.
 */
export function startContinuous(minutes: number, atOnce = false): boolean {
  const room = opened();
  if (!room) return false;
  stopContinuous(false);
  held = false;
  const mins = Math.max(1, Math.min(120, Number(minutes) || 0));
  runGen += 1;
  const mine = runGen;
  /* Where the loop starts counting from. Marking the history here means "after
     the next reply"; marking it at zero means "there is already something on
     this tape, so go" — which is what a Play key is for. */
  from = atOnce ? 0 : room.history.length;
  until = now() + mins * 60;
  span = mins * 60;
  stopped = false;
  tell();
  hatch.say(atOnce
    ? `playing, ${mins.toFixed(0)} min of tape — talk any time to steer`
    : `keep going, ${mins.toFixed(0)} min — the pill carries on after its next `
      + 'reply; talk any time to steer');
  void run(mine);
  return true;
}

/** Stop producing new turns. The pill finishes the one it is on.
 *
 * Unticking the box means "no more after this", not "be quiet now" -- cutting
 * the pill off mid-sentence is what Stop and a new message are for, and both do
 * their own silencing. Callers tearing the room down pass `hush`.
 */
export function stopContinuous(hush = false): void {
  const wasRunning = until > 0;
  until = 0;
  held = false;
  stopped = true;
  if (hush && wasRunning) silence();
  /* Said out loud, because its opposite is: starting always writes "playing, N
     min of tape", and a run that ended left no line anywhere. A Play press
     arriving while the page thinks a tape is running is sent as a stop -- so
     the console showed nothing at the exact moment somebody was asking why
     nothing had happened. */
  if (wasRunning) hatch.say('tape stopped');
  tell();
}

/** Hold a run where it is, or let it go on.
 *
 * Pausing the voice has to pause the run behind it. The tape is a clock on the
 * wall and the loop paces itself on how much is left to be heard — so a paused
 * page reads as an emptying one, and the machine writes ahead into a silence
 * that is not coming: dose spent, six more turns waiting, none of them heard.
 *
 * So the clock stops too. What is left is kept and handed back when it goes on,
 * which is the only version of a pause anybody means when they press it because
 * somebody walked into the room.
 */
export function holdContinuous(on: boolean): boolean {
  if (on) {
    if (until <= 0 || held) return false;
    saved = Math.max(0, until - now());
    held = true;
  } else {
    if (!held) return false;
    held = false;
    until = now() + saved;
  }
  shown = '';                          // the clock moved; say so whichever way
  tell();
  return true;
}

/** An interruptible breath: a run that has been stopped should not sit out the
    rest of one before it notices. */
async function breathe(tenths: number): Promise<void> {
  for (let i = 0; i < tenths; i++) {
    if (stopped) return;
    await sleep(100);
  }
}

/** How long a run waits for a line of his to be answered before it gives up:
    tenths of a second, and only while nothing at all is happening. */
const STRANDED = 20;

async function run(mine: number): Promise<void> {
  let turns = 0;
  let pace = 0;        // seconds a turn has been taking, lately
  let stranded = 0;    // tenths spent waiting on a line nobody is answering
  while (!stopped && continuousLeft() > 0 && mine === runGen) {
    // What is left on the tape, as often as it changes and no oftener: the
    // clock on the deck counts the seconds off locally and is corrected by
    // this, so a run whose turns are three minutes apart is still a clock.
    tell();
    const room = opened();
    if (!room) break;                  // the room was left; the tape goes with it
    /* And a conversation this page is no longer the one in. Nothing it writes
       from here can land -- the file has moved on without it -- so a run that
       kept asking for turns was a dose spending itself against a banner. */
    if (link.getState().nowhere) {
      hatch.say('this page is not the one that conversation is in any more — '
        + 'the tape stops here', 'warn');
      stopped = true;
      break;
    }
    // Nothing has been said since you ticked it. Keep going is not a way to
    // make the pill speak first; it is a promise about what happens once it
    // has spoken.
    if (room.history.length <= from) { await sleep(200); continue; }
    /* Somebody has said something and has not been answered yet. The nudge
       below tells the pill "he has not said anything" -- which was true when
       it was written and is a lie the moment you type, and the model believes
       it: the reply that came back carried on with its own evening and read as
       though you had not spoken. Your line is answered by the ordinary path,
       as a turn; this waits. */
    if (room.history[room.history.length - 1]?.role === 'user') {
      /* Unless nothing is ever going to answer it. Skip pressed while a typed
         line was queued keeps that line without replying to it -- Stop has to
         mean stop -- and the line then sits at the end of the history with the
         floor free and the room quiet, which is a tape waiting for good on an
         answer nobody is writing. Two seconds of that is a run that is over,
         and it says so rather than sitting there looking busy. */
      if (!floorHeld() && !speaking() && ++stranded > STRANDED) {
        hatch.say('the last thing said is his and nothing is answering it — '
          + 'say it again to be answered; the tape stops here', 'warn');
        stopped = true;
        break;
      }
      await sleep(150);
      continue;
    }
    stranded = 0;
    if (held) { await sleep(200); continue; }     // no more turns until it goes on
    // Yield to the person: their turn is an ordinary one, and we wait for it
    // rather than talking over it.
    if (floorHeld()) { await sleep(100); continue; }
    /* Start the next turn while there is still enough audio queued to cover
       generating it, so the two overlap instead of alternating. Python asked
       the machine's estimate of the page's queue for this; the queue is right
       here. */
    const lead = Math.max(1.5, Math.min(8, turnCost() * 1.3));
    if (remainingS() > lead) { await sleep(100); continue; }

    const left = continuousLeft();
    if (left <= 0) break;
    const whole = span || left;
    const spent = Math.max(0, Math.min(1, 1 - left / whole));
    /* Whether there is room for another turn after this one. Measured rather
       than guessed: a turn is however long the last few took, which depends on
       the model, the machine and how much the pill has to say. Without this a
       short dose stops mid-push. */
    const last = pace > 0 && left <= pace * 1.25;
    const nudge = continuousNudge(spent, turns, last);
    turns += 1;
    const began = now();
    try {
      await runTurn({slug: room.slug, sessionId: room.sessionId,
                     text: nudge, hidden: true});
    } catch (e) {
      hatch.say(`continuous stopped: ${why(e)}`, 'error');
      break;
    }
    // What that cost, so the next turn knows whether it is the last one.
    const cost = now() - began;
    pace = pace === 0 ? cost : pace * 0.6 + cost * 0.4;
    /* A turn that produced nothing means something is wrong rather than that
       the pill had nothing to say -- most often a language model that has
       gone. Without this the loop simply asked again a third of a second
       later, and a dead model turned into six hundred identical lines in the
       console in four minutes. */
    const said = opened()?.history;
    if (said?.[said.length - 1]?.role !== 'assistant') await breathe(30);
    // A short breath, interruptible; the real spacing comes from the audio
    // still in the queue.
    await breathe(3);
  }
  if (mine !== runGen) return;         // superseded; the new run owns the state
  if (!stopped) hatch.say('continuous session finished');
  until = 0;
  stopped = true;
  tell();
}

/* ---- hands ---------------------------------------------------------------- */

/** The room reporting that a hand has been put to something. */
export function did(line: string): void {
  const text = (line || '').trim();
  if (!text) return;
  /* A dose that is playing is not asking to be poked. Somebody who set a scene
     and pressed Play is lying back for a quarter of an hour, and a hand
     brushing the screen should not take the floor away from the pill
     mid-sentence -- the room stays a room, and the press is scenery. The cost
     is that a cushion knocked over during a run is never remarked on, which is
     the right way round: an evening that cannot be interrupted by accident is
     worth more than a noticed cushion. */
  if (continuousLeft() > 0) return;
  /* Nothing is shown yet on purpose. The room has already answered the press —
     the book moved — and the line belongs in the conversation at the moment it
     becomes a turn, not a second and a half before it. */
  press(text);
  /* Nowhere to put it yet: the room is still opening, which is the press that
     starts an evening arriving before the transcript it belongs to. It waits,
     and the room asks for it as soon as it is there -- see handsSoon, which
     Room calls on its way in. */
  if (!opened()) return;
  /* Outside a run, a press takes the floor the way speaking does. It used to
     wait for the quiet instead, on the reasoning that answering while she talks
     is talking over her -- true, and it assumed the wait was a second and a
     half. Replies now run forty seconds and more, so the press landed a topic
     late, arrived out of order in the transcript, and read as the room having
     ignored it. Whoever is pressing things while it speaks is exploring the
     room rather than listening to the answer, and wants to be answered now:
     the same trade the microphone already makes. */
  if (speaking()) silence();
  handsSoon();
}

/** Come back to what hands have done, once there is a gap to do it in.
 *
 * Armed by a press, and again at the end of every reply — which is the half
 * that was missing. Presses made while the pill was speaking pooled correctly
 * and then sat there: nothing looked at the pool again until somebody pressed
 * something *else*, so four things done ten minutes apart arrived together, and
 * in between it read as being ignored.
 */
export function handsSoon(): void {
  if (!pressed().length) return;
  settle(handsTurn);
}

/** Answer what hands have done, if this is a moment to.
 *
 * Still writing, or still being heard? Then it is not: come back shortly. "When
 * it has finished" means the voice has, not the words — a turn that lands while
 * the last sentence is still coming out of the speaker is a turn talking over
 * it.
 */
function handsTurn(): void {
  const room = opened();
  if (!room) return;
  if (floorHeld() || speaking()) {
    handsSoon();
    return;
  }
  const text = take();
  if (!text) return;
  void runTurn({slug: room.slug, sessionId: room.sessionId, text});
}

/* Anything pressed while a reply was being said is owed an answer the moment
   the room goes quiet. Python said this in reply_to's `finally`; here the floor
   itself says when it is free, which is the same moment and one fewer thing for
   a turn to know about. */
onFloorFree(handsSoon);

/* ---- and the rest of what a room can ask for ------------------------------ */

/** Take a turn back: out of the context, out of the transcript.
 *
 * What it cannot reach is memory — anything already folded into the memory file
 * was written from this turn and stays there. Edit that by hand if the point
 * was to make the pill forget.
 */
export async function deleteTurn(role: 'user' | 'assistant', text: string): Promise<boolean> {
  const room = opened();
  const want = (text || '').trim();
  if (!room || !want) return false;
  for (let i = room.history.length - 1; i >= 0; i--) {
    const m = room.history[i]!;
    if (m.role !== role || (m.content || '').trim() !== want) continue;
    /* The file first, and this page's copy of it only once that has landed. It
       was the other way about, and a store that refused left the transcript
       short in memory with `version` a turn behind: the model was shown a
       conversation that is not on disk, and the next append answered a 409.
       Nothing is taken off anywhere until the line is off the file. */
    let out: F.Removed;
    try {
      out = await F.removeTurn(room.sessionId, role, want, room.version);
    } catch (e) {
      hatch.say(`could not delete that turn: ${why(e)}`, 'warn');
      return false;
    }
    room.version = out.version;
    if (out.stale) {
      /* The file grew between the read that found the line and the delete that
         named its position, so the position is not that line any more and the
         store refused it rather than taking whatever has slid into it. Nothing
         is spliced here either: the transcript is read again, and asking a
         second time asks about the file as it now is.

         A console line and not a banner. One command did not run; the page has
         not stopped meaning anything. */
      hatch.say(`${room.sessionId} changed while that turn was being taken back `
        + `— nothing was deleted; it is at ${out.version} now`, 'warn');
      await reread(room);
      return false;
    }
    /* Found again rather than spliced at `i`: the store is a promise away and
       whatever arrived while it was answering is in the list now. `removed`
       false means the file did not have it, which is the same page to be on. */
    const at = room.history.indexOf(m);
    if (at >= 0) {
      room.history.splice(at, 1);
      if (at < room.foldedUpto) room.foldedUpto -= 1;   // keep the fold where it was
      room.windowFrom = -1;              // every index past here has moved
    }
    hatch.say('deleted a turn');
    return true;
  }
  return false;
}

/** Begin a fresh conversation with this pill.
 *
 * The run stops and the voice is silenced first: a reply in flight is holding
 * the old transcript, and swapping the file underneath it splits that turn
 * across two conversations -- one with a question and no answer, one with an
 * answer and no question.
 */
export async function clearSession(): Promise<Open> {
  stopContinuous(true);
  /* Whatever was pressed a moment ago was pressed in another conversation. It
     is not this one's to answer: a cushion knocked onto a floor turned up in a
     library, because the presses were still pooled when the session changed
     under them. */
  take();
  const room = await freshSession();
  hatch.say(`new conversation with ${room.persona?.pill || room.persona?.name || room.slug} — ${room.sessionId}`);
  return room;
}

/** Leaving the room: the tape goes with it, and so does anything pooled. */
export function leaveLoop(): void {
  stopContinuous(true);
  take();
  forget();
  shown = '';
}
