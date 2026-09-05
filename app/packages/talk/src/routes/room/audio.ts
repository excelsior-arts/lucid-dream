/* The sound, made once and outside React — and who answers what it hears.
 *
 * The loop itself is @lucid/machine's `createVoiceLoop`: one speaker, one
 * microphone, one detector and one pacer, made the first time a room asks and
 * kept for the page, with the microphone wired through the recognizer and the
 * junk filter to a line of text. None of that is Lucid Talk's — any game with
 * a speaking character wants the same four things wired the same way.
 *
 * What is Lucid Talk's is what a line of text becomes, and that is the whole of
 * this file. It becomes a turn in this page, answered here: there is nothing
 * else to hand it to, and no wire left to hand it down.
 */
import {awaitReady, createVoiceLoop, models} from '@lucid/machine';
import type {Capture, Pacer, Playback, Vad} from '@lucid/audio';
import {cutIn, holdContinuous, putItBack} from '../../conversation/loop';
import {current, runTurn} from '../../conversation/turn';
import type {InputMode} from '../../link/shapes';
import {link, sayLog} from '../../link/store';
import type {Level} from '@lucid/shell';
import {hatch} from '@lucid/shell';

export interface Kit {
  playback: Playback;
  capture: Capture;
  pacer: Pacer;
  vad: Vad;
}

/** Which way somebody is talking to the pill. Kept for the deck, which is the
    only thing that ever drew it. */
export function inputMode(mode: InputMode): void {
  link.setState({input_mode: mode});
}

/** The microphone changed on its own -- closed when the page was hidden, open
    again when it was seen. A microphone that opened again wants the recognizer
    again too: it was let go of when the page went, and if the page was away
    longer than the grace it is gone. The ask is free when it is already up. */
export function reopened(mode: InputMode): void {
  inputMode(mode);
  if (mode === 'mic') void models.want('stt', true).catch(() => {});
}

/** What the loop says about itself, said twice.
 *
 * Once into the console, where somebody reads it, and once to whoever is
 * following this turn rather than reading about it: the dots under a bubble go
 * down on "no usable speech" the same way they go down on the words arriving.
 * See dots.ts, and onLog in link/store.ts.
 */
export function say(line: string, level: Level = 'info'): void {
  hatch.say(line, level);
  sayLog({type: 'log', text: line, level});
}

/** What a heard turn becomes. Answered here, in this page, on this page's own
    conversation — which is the whole of what Phases C and D moved. */
export function answering() {
  return {
    onHeard(text: string, seconds: number) {
      /* Take the floor first. A line said over a reply is a line said instead
         of the rest of it: what was being spoken stops, what was queued
         behind it is kept and not answered, and this is answered now --
         which is what speaking over somebody means. Without it every line
         said during a long reply waited for the reply to end and was then
         answered in turn, the pill going on with what it had in mind and
         then working through the pile. */
      cutIn();
      const now = link.getState();
      void runTurn({slug: now.slug, sessionId: now.sid, text, heard: true, seconds});
    },
    onListening(active: boolean) {
      // Don't let a mic event stomp on an in-flight reply.
      const state = link.getState().state;
      if (!active && (state === 'thinking' || state === 'speaking')) return;
      link.setState({state: active ? 'listening' : 'idle'});
    },
    onDropped(ms: number, barged: boolean) {
      say(`that was ${ms}ms — too short to hear`);
      // It stopped a reply and put nothing in its place. See putItBack.
      if (barged) putItBack();
    },
    /** The reply this page is speaking, for a voice over the top of it to cut
        off. It is this page's own: there is nowhere else it could be. */
    reply() {
      return current();
    },
    onHold(on: boolean) {
      /* And the run behind the voice, if there is one. A pause that stops only
         the sound leaves the loop writing turns nobody is listening to and the
         dose spending itself against a silence. */
      holdContinuous(on);
    },
  };
}

/* ---- the microphone, and what it costs ------------------------------------
 *
 * The recognizer is not loaded until somebody turns the microphone on. A new
 * player's mic is off, so a new player never pays for it -- which is the whole
 * of the rule; everything below is what that looks like on a key.
 *
 * One press asks for the model and opens the device in the same breath: the
 * ask is started and not waited on, so getUserMedia is still called inside the
 * gesture a browser insists on granting it in. Waiting for the model first
 * would put the permission prompt fifteen seconds after the press, which is a
 * browser refusing it.
 *
 * So the microphone is live before the recognizer is, and that is deliberate
 * rather than tolerated: anything said in that window is still heard, because
 * the utterance goes to /machine/stt and that loads on demand and answers when
 * it can. It answers late. Nothing is lost, and the key says it is working
 * rather than saying it is armed.
 */

/** Whether the recognizer is still coming up under a press that has already
    happened. Its own little store, because it moves twice a press and the deck
    is the only thing that draws it. */
const ears = new Set<() => void>();
let warming = false;

function setWarming(on: boolean): void {
  if (warming === on) return;
  warming = on;
  for (const fn of [...ears]) fn();
}

export const recognizer = {
  get warming() { return warming; },
  onChange(fn: () => void) { ears.add(fn); return () => { ears.delete(fn); }; },
};

/** Turn the microphone on, loading the ear if it is not there.
 *
 * Settles when the key has finished changing its mind: armed, or off again
 * with a line in the console saying why. Nothing here throws -- it is a press,
 * and a press that failed has already been explained to somebody. */
export async function micOn(): Promise<void> {
  const {capture} = audio();
  /* Asked for before the device is opened, so the load and the permission
     prompt run side by side rather than one after the other. */
  const asked = models.want('stt', true).catch(() => null);
  try {
    await capture.start();
  } catch {
    // It said why. The key stays off, and nothing is left loading for a
    // microphone that never opened.
    void models.want('stt', false).catch(() => {});
    return;
  }
  inputMode('mic');
  const said = await asked;
  if (said?.status === 'ready') return;          // it was already there
  say('warming the recognizer — the key arms when it can hear you');
  setWarming(true);
  const ready = await awaitReady('stt');
  setWarming(false);
  // Turned off again while it warmed: that press is the answer, not this one.
  if (!capture.on || ready) return;
  say('the recognizer would not load — the microphone is off', 'warn');
  micOff();
}

/** And off, which is where the grace begins. The machine keeps the recognizer
    for a minute and a half in case the mic comes back, which is what the gap
    between two things somebody says looks like from here. */
export function micOff(): void {
  const {capture} = audio();
  capture.stop();
  inputMode('type');
  setWarming(false);
  void models.want('stt', false).catch(() => {});
}

let kit: (Kit & {loop: ReturnType<typeof createVoiceLoop>}) | null = null;

/** Everything audible, made on the first ask and kept for the page. */
export function audio(): Kit {
  if (kit) return kit;
  const loop = createVoiceLoop({
    say: (line, level = 'info') => say(line, level as Level),
    onInput: reopened,
    ...answering(),
  });
  /* And whatever the machine has been told about talking over a reply. The
     loop asks once when it is made; this follows the console afterwards, since
     /mic_barge writes it while a room is open. */
  link.subscribe((now, was) => {
    if (now.mic_barge !== was.mic_barge) loop.micBarge = now.mic_barge;
  });
  kit = {loop, playback: loop.playback, capture: loop.capture,
         pacer: loop.pacer, vad: loop.vad};
  return kit;
}
