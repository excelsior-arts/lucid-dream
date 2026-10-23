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
import {awaitReady, createVoiceLoop, models, status} from '@lucid/machine';
import type {Capture, Pacer, Playback, Vad} from '@lucid/audio';
import {cutIn, holdContinuous, putItBack} from '../../conversation/loop';
import {current, runTurn} from '../../conversation/turn';
import type {InputMode} from '../../link/shapes';
import {link, sayLog} from '../../link/store';
import type {Level} from '@lucid/shell';
import {askForCard, hatch, host} from '@lucid/shell';

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
  if (mode === 'mic') void models.want('stt', true).then((got) => { seen = got.status; }, () => {});
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

/* ---- the recognizer stays wanted while the microphone is open -----------
 *
 * Asked for once, on the press, and after that only by a turn reaching it --
 * while the machine's grace is armed by any page that says it is done, over
 * every other page's microphone, and by an off whose answer lands after the
 * next on's. On 10-12 the machine put the recognizer away with a room open
 * ("nothing has wanted the recognizer for 90 seconds"), and nothing on the
 * page could say whether its microphone was on. So while it is, the page says
 * it still wants the recognizer, well inside the grace: a lookup on a machine
 * that has it, and on one that put it away the load a turn would otherwise
 * have waited fifteen seconds for -- said in the console when that happens. */
export const KEEP_MS = 30_000;
/** What the machine last said of the recognizer to this page. */
let seen = '';

export function keepWanting(): void {
  if (!kit?.capture.on) return;
  void models.want('stt', true).then((got) => {
    if (seen === 'ready' && got.status !== 'ready') {
      say('the recognizer had been put away under an open microphone — it is loading again', 'warn');
    }
    seen = got.status;
  }, () => {});
}

/** Turn the microphone on, loading the ear if it is not there.
 *
 * Settles when the key has finished changing its mind: armed, or off again
 * with a line in the console saying why. Nothing here throws -- it is a press,
 * and a press that failed has already been explained to somebody. */
export async function micOn(): Promise<void> {
  const {capture} = audio();
  /* A machine set up text-only has no ear on its shelf: the key says so and
     opens the first-open card at its ear section, rather than asking the
     machine for a recognizer it cannot load. Asked of the machine each press
     -- a local GET, well inside the press's moment -- so an ear brought down
     a minute ago is heard at once. */
  if (host().machine) {
    const ear = await status().then((f) => f.shelf?.ear?.[0], () => undefined);
    if (ear && !ear.here) {
      say(`the ear (${ear.name}) is not on this Mac — the card brings it down`, 'warn');
      askForCard('ear');
      return;
    }
  } else {
    /* And a browser, whose ear is a download somebody chooses: none chosen,
       or the one chosen not in this browser's cache, is the models panel at
       its microphone section, as the voice's switch opens it at the voice. */
    const ears = await status().then((f) => f.shelf?.ear ?? [], () => []);
    const ear = ears.find((p) => p.using);
    if (!ear?.here) {
      say(ear ? `the ear (${ear.name}) is not in this browser — the models panel brings it down`
        : 'no ear in this browser yet — the models panel brings one down', 'warn');
      askForCard('ear');
      return;
    }
  }
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
  seen = said?.status ?? '';
  if (said?.status === 'ready') {                // it was already there
    say('mic on — the recognizer is up', 'debug');
    return;
  }
  say('warming the recognizer — the key arms when it can hear you');
  setWarming(true);
  const ready = await awaitReady('stt');
  if (ready) seen = 'ready';
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
  setInterval(keepWanting, KEEP_MS);             // for the page's life, as the kit is
  return kit;
}
