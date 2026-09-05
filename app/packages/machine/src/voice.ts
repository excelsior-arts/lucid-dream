/* The loop between a microphone and a reply.
 *
 * A speaker, a microphone, a voice detector and a pacer, made once for a page
 * and wired to each other: the mic hears, the detector says where a turn began
 * and ended, the machine turns it into words, and the words are handed on. A
 * voice over the top of a reply stops it. A noise too short to be a turn says
 * what it cost. The window taking the microphone away is reported as what the
 * page has become — a keyboard.
 *
 * None of that is about a persona, a pill, a dose or a room, which is why it
 * is here rather than in a game: any game with a speaking character wants
 * exactly this, and what it does with a line of text is its own.
 *
 * ---- why these four are made together --------------------------------------
 *
 * The <audio> element has to outlive every render: the right to play at all is
 * bought once, inside the first gesture anybody makes, and an element replaced
 * after that is an element with no such right — silence, with nothing in the
 * console, because the failure is the absence of an event rather than an
 * error. The microphone is the same argument from the other side: a device
 * that is open should not be closed and reopened because a component
 * re-rendered. And the detector reads the speaker directly — how much is left
 * to play, how long this stretch of speech has been going — so the pair have
 * to be one another's, not two things a route holds.
 *
 * The whole of what used to sit between a microphone and a reply,
 * by way of packages/talk/src/routes/room/audio.ts, which is what is left of
 * this once the generic half moved: naming the persona, and which loop answers.
 */
import {
  bargeAllowed, createCapture, createPacer, createPlayback, createVad, isJunk,
  transcribe as transcribeIt, tuning,
} from '@lucid/audio';
import type {
  Capture, MicBarge, MicFollow, Pacer, Playback, Vad, VadConfig, VadEvent,
} from '@lucid/audio';
import type {Reply} from './reply';
import {status} from './status';

/** Whether the page is the microphone or only the keyboard. */
export type InputMode = 'mic' | 'type';

export interface VoiceLoopOptions {
  /** A whole turn, heard and made into words. `seconds` is how long the room
      was listening, which only this end knows and which a page draws a spoken
      bubble differently for. */
  onHeard(text: string, seconds: number): void;
  /** The room has a voice in it, or has stopped having one. */
  onListening?(active: boolean): void;
  /** A noise too short to be a turn, and what it cost: `barged` means it
      stopped a reply and put nothing in its place. */
  onDropped?(ms: number, barged: boolean): void;
  /** The window took the microphone, or gave it back — and so what this page
      now is. Not pressing the key: that is the caller's own doing. */
  onInput?(mode: InputMode): void;
  /** The reply being spoken right now, for a voice over the top of it to cut
      off. Asked for rather than held, because the reply changes every turn and
      the loop is made once — and narrowed to the one thing ever asked of it,
      so a caller whose reply is being spoken somewhere else can answer with
      whatever handle it has on it. */
  reply?(): Pick<Reply, 'interrupt'> | null;
  /** How much this page still has to play, on every change. */
  onQueued?(queuedS: number): void;
  /** The sound was paused, or let go again. A pause is not only a pause:
      whatever is producing the speech should usually stop producing it. */
  onHold?(on: boolean): void;
  /** The console. */
  say(line: string, level?: string): void;
  /** A whole utterance into its words. The machine's recognizer unless a test
      says otherwise. */
  transcribe?(samples: Float32Array): Promise<string>;
  /** What the machine is set to hear by, and its standing order about talking
      over a reply. Read once: a page that is listening is a page whose
      thresholds should not change under it. Defaults to GET /machine. */
  tunables?(): Promise<{vad?: VadConfig; mic_barge?: MicBarge}>;
}

export interface VoiceLoop {
  /** Open the microphone. Rejects with the page's own words if it will not. */
  start(): Promise<void>;
  /** Close it. */
  stop(): void;
  /** The window lost the mic without anybody turning it off, and got it back. */
  suspend(): void;
  resume(): void;
  /** What the mic does when you leave the window, as the machine has it. */
  follow(mode: MicFollow): void;
  /** The machine's standing order about talking over a reply. Set it and the
      question is asked again against what this browser's microphone granted. */
  micBarge: MicBarge;
  readonly capture: Capture;
  readonly playback: Playback;
  readonly vad: Vad;
  readonly pacer: Pacer;
  dispose(): void;
}

/** Everything audible, wired to everything that answers. */
export function createVoiceLoop(o: VoiceLoopOptions): VoiceLoop {
  const say = (line: string, level = 'info') => o.say(line, level);
  const hear = o.transcribe ?? transcribeIt;

  const playback = createPlayback({
    say,
    onQueued: o.onQueued,
    onHold: o.onHold,
  });
  const vad = createVad({speaker: playback});
  const capture = createCapture({
    say,
    hear: (block) => vad.feed(block),
    /* The window took the microphone, or gave it back. Whoever is listening is
       told the same thing it would be told if somebody had pressed the key:
       what this page is, a microphone or only a keyboard. */
    onMic: (open) => o.onInput?.(open ? 'mic' : 'type'),
  });
  const pacer = createPacer(playback);

  /* The turn, from a voice stopping to a line somebody can answer.
   *
   * Everything the machine used to do between the microphone and `say`
   * happens in these few lines: the recognizer, the junk filter, and the
   * seconds. */
  /* Gone. A turn is transcribed by a request that cannot be taken back, and
     a recognizer still loading answers it fifteen seconds later -- into a
     room that has been left, where it opened the conversation again from the
     shelf and answered it there. Nothing heard by a loop that has been
     disposed of is anybody's turn. */
  let dead = false;
  const offVad = vad.on((e: VadEvent) => {
    switch (e.type) {
      case 'listening':
        o.onListening?.(e.active);
        break;
      case 'barge':
        /* Locally first, and locally at all: the queue that has to stop is on
           this page, and waiting for anything else to say so is a sentence and
           a half of somebody talking over it. */
        playback.stop(false);
        // And a key that took the floor is not an interruption of anything.
        if (e.spoken) o.reply?.()?.interrupt();
        break;
      case 'dropped':
        o.onDropped?.(e.ms, e.barged);
        break;
      case 'log':
        say(e.text, 'warn');
        break;
      case 'utterance':
        void (async () => {
          try {
            const text = await hear(e.samples);
            if (dead) return;
            if (isJunk(text)) {
              /* Said rather than dropped in silence: from the page a turn that
                 was heard and then quietly lost looks like a machine that has
                 stopped listening. */
              say(`heard ${e.seconds.toFixed(1)}s but no usable speech — `
                + 'say it again, or type below');
              return;
            }
            o.onHeard(text, Math.round(e.seconds * 10) / 10);
          } catch (err) {
            say('could not make out that turn: '
              + ((err as Error)?.message || String(err)), 'warn');
          }
        })();
        break;
    }
  });

  /* Who decides whether talking over it stops it: what this browser's
     microphone actually granted, weighed against whatever the machine was
     told. Re-asked whenever either of them moves — the mic is re-read every
     time it is opened, and the order can be given at the console. */
  let order: MicBarge = 'auto';
  const decide = () => { vad.barge = bargeAllowed(order, capture.status()); };
  const offCapture = capture.onChange(() => {
    decide();
    // A microphone that closed takes the half-heard turn with it, and the next
    // one it opens is a canceller with nothing learned. See Vad.reset.
    if (!capture.on) vad.reset();
  });
  decide();

  /* And the numbers it hears by, which are the machine's: they live in its
     config, where the console can reach them and where they outlive a reload.
     A machine that will not answer leaves the defaults, which are the same
     numbers. */
  const ask = o.tunables ?? (() => status().then((f) => f));
  void ask().then((facts) => {
    vad.tune(tuning(facts.vad ?? {}));
    if (facts.mic_barge) { order = facts.mic_barge; decide(); }
  }, () => {});

  return {
    start: () => capture.start(),
    stop: () => capture.stop(),
    suspend: () => capture.suspend(),
    resume: () => capture.resume(),
    follow: (mode) => capture.follow(mode),
    get micBarge() { return order; },
    set micBarge(next: MicBarge) { order = next; decide(); },
    capture,
    playback,
    vad,
    pacer,
    dispose() {
      dead = true;
      offVad();
      offCapture();
      pacer.dispose();
      capture.dispose();
      playback.dispose();
    },
  };
}
