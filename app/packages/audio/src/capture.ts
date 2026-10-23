/* ---- capture: this device's microphone ------------------------------------
 *
 * The only microphone there is: the machine behind this page never opens one,
 * so a refusal here is the answer rather than the first of two attempts. What
 * it hears is cut into 32 ms blocks of 16 kHz and handed to the detector next
 * door — nothing leaves the page until a whole turn has been heard. Echo
 * cancellation is the browser's, which is most of why it must be this device
 * that listens: the same device is playing the voice.
 */
import {host} from '@lucid/shell';
import {BLOCK, RATE} from './vad';

/** What the microphone does when you leave the window: close on a blur, close
    when the page is hidden, or stay open through both. Whoever is holding the
    page decides which, and says so with follow(). */
export type MicFollow = 'focus' | 'hidden' | 'never';

export interface Capture {
  /** getUserMedia and the graph. Throws with the page's own words on failure. */
  start(): Promise<void>;
  stop(): void;
  /** The window lost the mic without the person turning it off. */
  suspend(): void;
  resume(): void;
  readonly on: boolean;
  status(): {aec: boolean | null; lying: boolean; canBeHeard: boolean};
  /** The mic-follows-window policy, as the tick has it. */
  follow(mode: MicFollow): void;
  onChange(fn: () => void): () => void;
  /** Beyond the contract: the room takes its listeners off the window. */
  dispose(): void;
}

export interface Options {
  /** Where the sound goes: 512 samples of 16 kHz, which is a block of the
      voice detector's. Absent, this is a microphone nobody is listening to. */
  hear?: (block: Float32Array) => void;
  /** The window took the microphone away, or gave it back.
   *
   *  Only that: pressing Talk and pressing it again are the caller's own doing
   *  and it does not need telling about them. This is the one that happens
   *  behind anybody's back -- a tab switched, a phone pocketed, a window
   *  clicked out of -- and it is the reason anything downstream has to be told
   *  that a page which was the microphone a moment ago is now only a page. */
  onMic?: (open: boolean) => void;
  /** The console. Every one of these lines is the answer to a bad evening. */
  say?: (line: string, level?: string) => void;
}

/* On an address a browser does not trust -- which for this program means a
 * phone reaching the Mac over plain http -- getUserMedia is not merely
 * refused, it is absent. There is nothing to press and no way to make it work
 * from this side, so the key goes rather than sitting there grayed or, worse,
 * lighting up and doing nothing.
 *
 * Everything else on the page still works: the voice plays, the room is there,
 * the line at the bottom sends. It is a remote, and a remote is a perfectly
 * good thing to be. */
export function canBeHeard(): boolean {
  /* And nothing to hear with: a page with no machine behind it has no
     recognizer, so a microphone it could open would be a key that listens to
     nobody. See host.ts in @lucid/shell. */
  if (!host().ear) return false;
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

const LOCAL = () =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

/* The one browser whose report cannot be taken at its word.
   getSettings() says echoCancellation: true, the console says "microphone:
   echo canceled", and the reply still hears itself and stops mid-sentence --
   with an echo canceller that never converges rather than one that takes a
   moment to. Two things follow from it and both are here.

   Named rather than sniffed for a feature, because there is no feature to
   ask: a browser that answers this question wrongly will answer every version
   of it wrongly. Wrong in the safe direction if it is ever fixed -- barge-in
   off, which /mic_barge on turns back on.

   ---- what to try, when there is time for it ----------------------------

   Two candidates, one of them ruled out. macOS lends its own voice processing
   to getUserMedia and Firefox takes it (bug 1404972), which broke exactly this
   for built-in speaker and mic in 128 (bug 1908539). Not it: the pref that
   turns it off, media.getusermedia.audio.processing.platform.enabled, is true
   in 154 and turning it off changes nothing here -- the mic meter still moves
   while the reply is playing, where Safari's sits still.

   The other is the shape of the graph. Firefox cancels against the audio
   played out in the same MediaTrackGraph as the capture (bug 1849108), and
   this page plays the voice through an <audio> element while the microphone
   lives in an AudioContext of its own -- so there may be nothing in the
   canceller's reference to subtract. Worth measuring: play a burst three ways
   -- that element, a second AudioContext, and the microphone's own -- and
   watch which of them the mic stops hearing. If it is the third, the fix is
   to play the voice through the mic's own context and this whole constant
   goes away.

   And the honest replacement for a browser name is measurement anyway: we
   know when the voice is playing and how loud, so mic energy that rises with
   it is cancellation that is not happening, whoever is at fault. */
export const saysSoAnyway = (): boolean => /\bFirefox\//.test(navigator.userAgent);

/** 4096 frames at whatever the device runs at: about eleven of them a second. */
const BUF = 4096;

export {RATE};

/* Linear interpolation, and deliberately nothing cleverer. What reads this is
   a voice detector and a speech model, both of which were trained on worse
   than this, and a resampler with a window on it would cost a filter running
   on the thread that draws the room. */
export function toRate(input: Float32Array, from: number, to = RATE): Float32Array {
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    out[i] = (input[i0] || 0) * (1 - f) + (input[i0 + 1] || 0) * f;
  }
  return out;
}

/** Full scale to signed 16-bit, which is what the recognizer is posted. */
export function toPcm(input: Float32Array): Int16Array<ArrayBuffer> {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, (input[i] || 0) * 32768));
  }
  return pcm;
}

export function createCapture(o: Options): Capture {
  const say = o.say ?? (() => {});
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let node: ScriptProcessorNode | null = null;
  let mute: GainNode | null = null;
  /* The one gesture listener a refused context is waiting on, so that it
     can be taken down again: a stop, a dispose, or the next refusal. */
  const GESTURES = ['pointerdown', 'keydown'] as const;
  let touch: (() => void) | null = null;
  const untouch = () => {
    if (!touch) return;
    for (const ev of GESTURES) document.removeEventListener(ev, touch, {capture: true});
    touch = null;
  };
  let src: MediaStreamAudioSourceNode | null = null;
  /* What is left of the last callback. A device's buffer is not a whole number
     of blocks at 16 kHz -- 4096 frames at 48 kHz is two and two thirds -- and
     the detector is written against a block of exactly 32 ms. */
  let spare = new Float32Array(0);
  /* null = no microphone at all; nothing here is listening. undefined = the
     track did not say, which is not the same as a track that said no. */
  let aec: boolean | null | undefined = null;
  let lying = false;
  let lastNote = '';
  let mode: MicFollow = 'hidden';
  /* Was it open when the window went away. If you turned it off yourself,
     nothing here touches it. */
  let wasOn = false, switching = false;
  const ears = new Set<() => void>();
  const changed = () => { for (const fn of [...ears]) fn(); };

  function micStatus(got: boolean | null | undefined): void {
    aec = got;
    /* Said once, into the console, rather than parked in a corner of the
       panel. "No echo cancellation" is exactly the kind of thing that explains
       a bad evening an hour later, and exactly the kind of thing nobody reads
       while it is only a small gray line under a conversation. */
    // Reported true and demonstrably false is a third answer, not the first one.
    lying = saysSoAnyway() && got === true;
    const note = lying
      ? 'microphone: this browser reports echo cancellation it does not do — ' +
        'talking over the reply is off. Headphones, or /mic_barge on to insist'
      : got === true ? 'microphone: echo canceled'
      : got === false ? 'microphone: no echo cancellation — use headphones'
      : got === undefined ? 'microphone: echo cancellation not reported'
      /* null: there is no microphone. This page is the only one there is, so
         there is nothing else to try and nothing to fall back to. */
      : 'no microphone — this page was not given one';
    if (note !== lastNote) {
      lastNote = note;
      say(note, got === true && !lying ? 'info' : 'warn');
    }
    /* And barge-in follows it -- see bargeAllowed, which is where this answer
       and the machine's standing order are weighed against each other. Without
       cancellation the reply is the loudest thing in the room and talking over
       it is what barge-in is for: it hears itself, decides somebody
       interrupted, and stops mid-sentence. Told no, it finishes the line and
       the page's own controls are the way in -- which is a worse way to
       interrupt and a great deal better than a voice that cuts itself off
       every second sentence. */
    changed();
  }

  /** Said to the console, and thrown, because the key must stay off. */
  function refuse(line: string, tone = 'warn'): never {
    say(line, tone);
    throw new Error(line);
  }

  /* One attempt at a time, whoever asks. A key pressed while the window is
     also taking focus is one gesture on a desktop, and it used to be two
     opens: the press went through one guard and the window's return through
     none, and the browser answered both. Two streams, two nodes on the one
     context, every block heard twice -- and the stream the second answer
     overwrote was never stopped, so the microphone light stayed on. */
  let opening: Promise<void> | null = null;
  /* Bumped by every stop, so an open still waiting on the browser can tell
     that nobody wants what it is about to be given. The permission prompt is
     the case: Talk pressed, the prompt up, Talk pressed again to think
     better of it -- stop() found no stream and did nothing, the prompt was
     answered, and the microphone came up live under a key that said off. */
  let asked = 0;
  function open(): Promise<void> {
    if (stream) return Promise.resolve();
    opening ??= reallyOpen().finally(() => { opening = null; });
    return opening;
  }

  async function reallyOpen(): Promise<void> {
    if (stream) return;
    if (!canBeHeard()) refuse('microphone needs https — see AGENTS.md');
    const mine = asked;
    /* Answered after a stop: given back at once, and no graph built on it. */
    const stale = (got: MediaStream | null): boolean => {
      if (mine === asked) return false;
      got?.getTracks().forEach((t) => t.stop());
      return true;
    };
    /* InvalidStateError is two different answers wearing one name.

       Safari says it when the certificate does not verify. It will load the
       page and play the voice on an exception clicked through once, and still
       refuse a microphone, because an exception is not a trusted chain -- no
       warning anywhere, and the only symptom is a key that does nothing.

       Every browser says it when the page is not fully active, which happens
       on the way back from another app, in the moment between the window
       taking focus and the document being ready to be asked. That one passes
       in a fraction of a second, so it is worth asking twice before believing
       it. */
    /* Tell Safari this page does both.
     *
     * WebKit keeps an audio session for the page, the way an iOS app has one,
     * and picks a category from what the page has been doing. This page plays
     * a voice, so by the time anybody presses Talk the session is `playback`
     * -- and a microphone cannot be opened in `playback`. It refuses with
     * InvalidStateError and the words "AudioSession category is not compatible
     * with audio capture", which is the only clue there is.
     *
     * `play-and-record` is what this program actually is: a voice coming out
     * while a room is listened to. Set before asking, because after the
     * refusal is too late. Safari only -- elsewhere navigator.audioSession
     * does not exist, and the category was never the problem. */
    try {
      const session = navigator.audioSession;
      if (session && session.type !== 'play-and-record') session.type = 'play-and-record';
    } catch (e) {
      say('could not set the audio session: ' + ((e as Error)?.name || e), 'warn');
    }
    const ask = () =>
      navigator.mediaDevices.getUserMedia({
        audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
      });
    let got: MediaStream;
    try {
      try {
        got = await ask();
      } catch (e) {
        if ((e as Error)?.name === 'InvalidStateError') {
          await new Promise((r) => setTimeout(r, 350));
          if (mine !== asked) return;
          got = await ask();
        } else {
          throw e;
        }
      }
    } catch (e) {
      if (mine !== asked) return;         // refused after a stop: nobody's business
      /* Named so it can be acted on. These are the three that happen, and each
         wants a different thing done about it -- on a phone, where the only
         way to see the console is to know it is there, the difference between
         "say yes to the browser" and "the certificate is not trusted" is the
         whole of whether the evening happens. */
      const why = (e as Error)?.name;
      const line =
        why === 'NotAllowedError'
          ? 'microphone refused — allow it for this page in the browser'
        : why === 'NotFoundError'
          ? 'no microphone on this device'
        : why === 'InvalidStateError'
          /* Two things say this, and blaming the wrong one sends somebody off
             for an afternoon. On an address a browser already trusts, the
             address is not the fault: it is the page's audio session, set
             above, or a page that was not ready to be asked. Anywhere else it
             is worth naming the address, because that is both the fault and
             the fix. */
          ? (LOCAL()
              ? 'microphone refused — press Talk once more; if it keeps ' +
                'refusing, the line below is the reason.'
              : 'microphone refused — this address is not one a browser will ' +
                'open a microphone on. On the computer itself, open ' +
                `https://localhost:${location.port || 6969} instead.`)
          : 'microphone refused: ' + (why || e);
      say(line, 'warn');
      /* And the browser's own words, which are the only thing that says which
         of the several reasons this actually was. Every guess above is a guess
         until somebody has read this line. */
      const said = (e as Error)?.message;
      if (said) say('the browser said: ' + said, 'warn');
      micStatus(null);
      changed();
      throw new Error(line);
    }
    // echoCancellation is asked for above, but asking is not getting: report
    // what the track actually granted. With it, its voice is subtracted from
    // what the mic hears and speakers are fine; without it, an open mic
    // answers itself.
    /* A browser that answers with a word rather than a flag is answering yes:
       the words name which canceller, not whether there is one. */
    if (stale(got)) return;
    stream = got;
    const aecSaid = stream.getAudioTracks()[0]!.getSettings().echoCancellation;
    micStatus(typeof aecSaid === 'string' ? aecSaid !== 'none' : aecSaid);
    /* One context for the life of this capture, made in the gesture that
       opened the microphone and kept across every close and reopen. Safari
       lets a page run an AudioContext it made in a gesture, and lets that
       one resume when the tab is seen again; a *new* one made on the way
       back from another window, with no gesture behind it, is refused --
       it stays suspended, silently, and the microphone that had just said
       "open again" heard nothing until the page was reloaded. */
    const AC = window.AudioContext || window.webkitAudioContext!;
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (mine !== asked) { stop(); return; }   // stopped while the context came up
    if (ctx.state !== 'running') {
      /* Refused. The stream is live and the context is not, so nothing will
         be heard: say so, and arm the next press or key to try again -- a
         gesture is what the browser wants, and the person is about to make
         one. */
      say('the browser has paused the microphone until you touch the page', 'warn');
      untouch();
      touch = () => { untouch(); void ctx?.resume().then(() => { if (ctx?.state === 'running') { say('microphone running'); changed(); } }).catch(() => {}); };
      for (const ev of GESTURES) document.addEventListener(ev, touch, {capture: true});
    }
    src = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(BUF, 1, 1);
    node.onaudioprocess = (ev) => {
      if (!o.hear) return;
      const at = toRate(ev.inputBuffer.getChannelData(0), ctx!.sampleRate);
      const all = new Float32Array(spare.length + at.length);
      all.set(spare);
      all.set(at, spare.length);
      let i = 0;
      for (; i + BLOCK <= all.length; i += BLOCK) o.hear(all.slice(i, i + BLOCK));
      spare = all.slice(i);
    };
    src.connect(node);
    /* Safari will not run a processor that goes nowhere, so it goes to the
       output -- through a gain of nothing. The spec leaves a processor's
       output silent by default and does not promise it; a browser that
       copied the input through would put the microphone in the speakers,
       which is a loop, and the canceller learning its own echo. */
    mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    changed();
  }

  function stop(): void {
    asked += 1;                      // an open still waiting is an open nobody wants
    untouch();
    lastNote = '';                   // says it again next time it is opened
    if (mute) { mute.disconnect(); mute = null; }
    if (node) { node.onaudioprocess = null; node.disconnect(); node = null; }
    if (src) { src.disconnect(); src = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    // The context stays: see open(). It goes with the capture, in dispose().
    spare = new Float32Array(0);
    changed();
  }

  /* Walk away from the page and the microphone should not stay open behind
     you: switch tab, switch app, lock the phone, and it closes. Come back and
     it opens again, but only if it was open when you left. */
  function suspendFor(why: string): void {
    if (!stream || switching) return;
    wasOn = true;
    switching = true;
    stop();
    o.onMic?.(false);
    say('mic closed — ' + why);
    switching = false;
  }

  async function resume(): Promise<void> {
    if (!wasOn || stream || switching) return;
    switching = true;
    try {
      await open();
      o.onMic?.(true);
      wasOn = false;
      say('mic open again');
    } catch {
      say('mic did not reopen — press Talk when you are back');
      wasOn = false;
    } finally {
      switching = false;
    }
  }

  /* Hidden is normally the honest signal -- another tab, another app, a locked
     phone -- and it closes the mic at once, because a phone going into a
     pocket should not take an open microphone with it.

     Except in the browser above, which reports the menu bar taking over as the
     page being hidden rather than merely unfocused. So the gesture that
     "hidden" exists to survive -- opening the microphone's own menu to reach
     Voice Isolation -- closed the mic there anyway, six times in the forty
     seconds it took to find that out.

     The wait is Gecko's alone, and desktop is where it happens: elsewhere a
     hidden page can be frozen outright, its timers with it, and a close that
     waits for a timer is a close that never comes. */
  let hiding: ReturnType<typeof setTimeout> | null = null;
  const onVisibility = () => {
    if (mode === 'never') return;
    if (hiding) clearTimeout(hiding);
    hiding = null;
    if (!document.hidden) { void resume(); return; }
    if (!saysSoAnyway()) { suspendFor('page hidden'); return; }
    hiding = setTimeout(() => suspendFor('page hidden'), 700);
  };

  /* Leaving is not the same as glancing away.
   *
   * Clicking the microphone in the menu bar -- to see who has it, or to turn
   * Voice Isolation on -- takes focus off the window for as long as it takes
   * to read it. Some browsers report that as blur and some do not, so on one
   * the mic closed under you the moment you went to look at it, and on the
   * others it did not. Neither is a page anybody can predict.
   *
   * So a blur waits half a second to see whether it meant anything. Come back
   * and nothing happened; stay away and the mic closes as it always did. Half
   * a second is longer than any round trip to the menu bar and shorter than
   * anybody's idea of having left the room.
   *
   * Focus as well as visibility, but only under "focus": on a desktop the
   * window can be fully visible on another screen while you type somewhere
   * else, and whether that should close the mic is a matter of taste. */
  let leaving: ReturnType<typeof setTimeout> | null = null;
  const onBlur = () => {
    if (mode !== 'focus') return;
    if (leaving) clearTimeout(leaving);
    leaving = setTimeout(() => suspendFor('window not in front'), 500);
  };
  const onFocus = () => {
    if (leaving) clearTimeout(leaving);
    leaving = null;
    if (mode === 'focus') void resume();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);

  return {
    start() { return open(); },
    stop() {
      wasOn = false;               // turned off by hand; nothing reopens it
      stop();
    },
    suspend() { suspendFor('the window went away'); },
    resume() { void resume(); },
    get on() { return !!stream; },
    status() {
      return {aec: aec === undefined ? null : aec, lying, canBeHeard: canBeHeard()};
    },
    follow(next: MicFollow) { mode = next; },
    onChange(fn: () => void) { ears.add(fn); return () => { ears.delete(fn); }; },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      if (hiding) clearTimeout(hiding);
      if (leaving) clearTimeout(leaving);
      stop();
      if (ctx) { void ctx.close().catch(() => {}); ctx = null; }
      ears.clear();
    },
  };
}
