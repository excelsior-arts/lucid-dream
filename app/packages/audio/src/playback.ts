/* ---- iOS path: play through <audio> ---------------------------------------
 *
 * Web Audio on iOS is silenced by the ringer switch and refuses buffers whose
 * rate differs from the context's. An <audio> element counts as media, so it
 * ignores the switch and decodes a WAV on its own terms.
 *
 * One element, for the life of the document. The iOS unlock buys the right to
 * play on *this* element, and a chunk in flight carries its `onended` on it --
 * so it is made once, outside React, and every Playback that comes and goes
 * with a room borrows the same one.
 */
import {sound} from '@lucid/shell';
import type {Lift} from './normalize';
import {normalize} from './normalize';

export interface Playback {
  /** An `audio` message: base64 signed 16-bit PCM at `rate`. */
  enqueue(pcmBase64: string, rate: number): void;
  /** An `audio_chars` message: how many characters that chunk speaks. */
  credit(chars: number): void;
  /** An `audio_stop` message. Soft lets the chunk in hand finish. */
  stop(soft: boolean): void;
  /** Down to nothing over `seconds`, then a hard stop, and the level put
      back for whatever speaks next. A walk that is over does not cut its
      voice off mid-word; it lets it go. */
  fade(seconds: number): void;
  /** Pause, or let it go on. */
  hold(on: boolean): void;
  readonly queuedS: number;
  readonly playingS: number;
  readonly playedS: number;
  readonly spokenChars: number;
  /** Characters credited to the chunk in hand -- not yet banked, but being
      said right now. With `spokenChars`, how far the voice has actually got. */
  readonly playingChars: number;
  /** A chunk is in hand -- playing, or paused where a hold left it. */
  readonly playing: boolean;
  readonly held: boolean;
  /** More is coming: a reply is being made, and the gap between two of its
      sentences is not the room going quiet. Set by whoever is making the
      sound, for the detector, which must not open the microphone into the
      pill's next sentence; and for the stretch, which spans the holes. */
  readonly expecting: boolean;
  expect(on: boolean): void;
  /** The browser has paused the chunk in hand and nobody here asked it to --
      a tab put in the background, a phone locked. It is still in hand, but it
      is not sound, and nothing should be waiting on it or listening over it. */
  readonly stalled: boolean;
  /** How long this stretch of speech has been going, 0 when there is none.
   *
   * The gaps inside a reply are part of the same stretch: the next sentence is
   * still being made while the last one plays, and a grace that started again
   * on every chunk would be a grace that never elapsed. What the detector
   * measures against it is the moment the room started hearing the pill. */
  readonly sinceStartMs: number;
  /** Seconds into the chunk in hand, 0 when there is none. */
  position(): number;
  onChange(fn: () => void): () => void;
  onUnheard(fn: () => void): () => void;
  unlockOnce(): () => void;
  dispose(): void;
}

export interface Options {
  /** Held, or let go again — whenever this end changes its mind about it.
   *
   * Said rather than asked, because a pause is not only a pause: whoever is
   * making the sound is usually also making more of it, and only they know
   * what else a hold should stop. Sent on the way out of a hold as well as
   * into one, including the release a stop does on its own. */
  onHold?: (on: boolean) => void;
  /** How many seconds of speech this page still has to play: the chunk in
   *  hand plus everything queued behind it.
   *
   *  Said on every change, so whoever is feeding it can pace itself against
   *  what has actually been heard rather than against its own estimate. */
  onQueued?: (queuedS: number) => void;
  /** The console. What audio has to say is said once per run of trouble. */
  say?: (line: string, level?: string) => void;
}

/* The element, keyed to the document it belongs to: one per page, made on
   demand and never replaced. See unlockOnce for what replacing it cost. */
const elements = new WeakMap<Document, HTMLAudioElement>();

function voice(doc: Document): HTMLAudioElement {
  let el = elements.get(doc);
  if (!el) {
    el = new Audio();
    // Safari's, and only Safari's: an inline element does not take a phone's
    // whole screen the moment it is given something to play.
    (el as HTMLMediaElement & {playsInline?: boolean}).playsInline = true;
    el.preload = 'auto';
    // Its voice answers to the same knob as the latches and the ticks -- one
    // level for the whole thing, kept in this browser.
    el.volume = sound.level;
    elements.set(doc, el);
  }
  return el;
}

/** A sentence, waiting its turn. `chars` is banked when it finishes playing. */
interface Chunk {
  blob: Blob;
  secs: number;
  chars: number;
}

/** The 44 bytes a browser needs in front of raw PCM, and then the PCM. */
export function wavBytes(bytes: Uint8Array, rate: number): Uint8Array<ArrayBuffer> {
  const n = bytes.length, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const put = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
  };
  put(0, 'RIFF'); v.setUint32(4, 36 + n, true); put(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).set(bytes);
  return new Uint8Array(buf);
}

export function wavBlob(bytes: Uint8Array, rate: number): Blob {
  return new Blob([wavBytes(bytes, rate)], {type: 'audio/wav'});
}

/* What the first gesture plays: real silence, not a header with no samples in
   it. A zero-length wav cannot be decoded -- Firefox says so out loud -- and a
   play() that fails to decode is a poor way to ask for the right to play.
   Fifty milliseconds at 16 kHz, made by the same header the voice uses rather
   than pasted in as two thousand characters of base64. */
function silence(): string {
  const wav = wavBytes(new Uint8Array(1600), 16000);
  let bin = '';
  for (let i = 0; i < wav.length; i++) bin += String.fromCharCode(wav[i]!);
  return 'data:audio/wav;base64,' + btoa(bin);
}

export function createPlayback(o: Options): Playback {
  const doc = document;
  const say = o.say ?? (() => {});
  const queue: Chunk[] = [];
  const lift: Lift = {voiceLift: 0};
  let el: HTMLAudioElement | null = null;
  let fading: ReturnType<typeof setInterval> | null = null;
  // busy means "a chunk is playing right now". It is cleared only when that
  // chunk ends, errors, or is stopped -- never merely because the queue is
  // empty, which used to let the next chunk cut off the one still playing.
  let busy = false;
  let stalled = false;
  let expecting = false;
  let drop: (() => void) | null = null;   // let the chunk in hand go, uncredited
  let inHand: Chunk | null = null;
  let url = '';        // the chunk in hand, so stopping can give it back
  let queuedS = 0, playingS = 0, playedS = 0, spokenChars = 0;
  /* What is waiting, added up from what is waiting -- never kept as a running
     total. It was one: each chunk's seconds added on the way in and taken off
     on the way out, and floating point does not give back what it was given.
     Half the replies of a long answer ended on 2e-15 seconds "queued" behind
     an empty queue, and the detector read that as a reply still going out:
     nothing playing, nothing started, so no grace had passed and nothing
     anybody said was taken -- every word after the reply dropped without a
     line, the meter moving, until something stopped the queue by hand. An
     empty queue is zero because it is empty. */
  const requeue = () => {
    let s = 0;
    for (const c of queue) s += c.secs;
    queuedS = s;
  };
  let startedAt = 0;
  let held = false, dead = false;
  /* The chunk in hand, watched. A browser drops events: Safari has ended a
     chunk in a page it put away and said nothing, and has left one that
     neither ended nor paused. Every reader of this object -- the floor, the
     pacer, the detector -- believed the chunk for the rest of the evening.
     So the position is read once a second, and a chunk that is not
     advancing is not sound: stalled after three seconds, and let go of after
     six if the page is in view and it still will not move. */
  let watch: ReturnType<typeof setInterval> | null = null;
  let audioErr = '', complaining = false;
  const ears = new Set<() => void>();
  const unheardEars = new Set<() => void>();

  const changed = () => { for (const fn of [...ears]) fn(); };
  /* Anything the room can still hear coming: the chunk in hand, the queue
     behind it, and one paused where a hold left it. */
  const airborne = () => busy || queue.length > 0 || held;
  const WATCH_MS = 1000, STALL_MS = 3000, LET_GO_MS = 6000;
  const unwatch = () => { if (watch) { clearInterval(watch); watch = null; } };
  const unheard = () => { for (const fn of [...unheardEars]) fn(); };

  // What is still unheard: the chunk playing plus everything behind it.
  const report = () => o.onQueued?.(queuedS + playingS);

  /* Once per run of trouble, not once per sentence.

     It said something whenever the message changed, which sounds like the same
     thing and is not: a page that cannot play at all fails twice per chunk in
     two different ways -- the browser refusing to start, then the element
     giving up on the clip -- and the two take turns, so every message was a
     new message and a reply put twenty lines in the console. Which is one
     page's stuck audio drowning the log everybody else's trouble goes to.

     The whole of it is one fact anyway: this page is not making any sound.
     Said once, and again only once it has made some and stopped. */
  const status = () => {
    if (!audioErr) { complaining = false; return; }
    if (complaining) return;
    complaining = true;
    /* Waiting for a first click is not a fault. Every browser refuses to play
       until the page has been touched, the next press anywhere clears it, and
       the deck cannot be used without pressing something -- so it is a note
       about the state of the room, not something to be raised on the console's
       knob. Anything else audio says is a real one: it means this page cannot
       make a sound and nobody outside it can tell. */
    const waiting = /NotAllowed/.test(audioErr);
    say(
      waiting
        ? 'audio: this browser will not play until the page has been clicked'
        : 'audio: ' + audioErr,
      waiting ? 'warn' : 'error',
    );
  };

  function playNext(): void {
    // Nothing to play it with yet: enqueue makes the element, and only it
    // fills the queue, so this cannot happen in the ordinary run of things --
    // but a resume that arrives first should do nothing rather than throw.
    if (dead || held || busy || !el || !queue.length) return;
    busy = true;
    const chunk = queue.shift()!;
    inHand = chunk;
    playingS = chunk.secs;
    requeue();
    /* Held where stopping can reach it. A chunk that is cut off never runs
       done(), so the browser was left holding the decoded audio for every
       sentence anybody ever interrupted -- one per barge-in, per Skip, per
       hush, all evening, and only a reload gave them back. */
    const mine = (url = URL.createObjectURL(chunk.blob));
    /* Over, and whether it was heard. Only a chunk the browser played to the
       end is banked as said: one that would not decode, one let go of for
       not moving, one superseded before it started -- those were not heard,
       and crediting them put sentences nobody heard into the transcript. */
    const done = (heard: boolean) => {
      unwatch();
      drop = null;
      stalled = false;
      URL.revokeObjectURL(mine);
      if (url === mine) url = '';
      busy = false;
      if (heard) {
        playedS += playingS;
        spokenChars += inHand ? inHand.chars : 0;
      }
      inHand = null;
      playingS = 0;
      if (!queue.length && !held && !expecting) startedAt = 0;
      status();
      report();
      changed();
      playNext();
    };
    el.onended = () => done(true);
    el.onerror = () => { audioErr = 'decode'; done(false); };
    drop = () => done(false);
    /* Paused by the browser, not by a hold. Safari stops media in a tab it has
       put in the background and does not say `ended`, so the chunk stayed in
       hand for the rest of the evening: the room believed the pill was still
       speaking, the detector waited for somebody to talk *over* it -- six
       times the floor and a voiced onset -- and a person back at the window
       talking normally lit the meter and was never heard. The chunk is marked
       stalled here, and picked up or let go when the page is seen again. */
    const here = el;
    el.onpause = () => { if (busy && !held && !here.ended) { stalled = true; changed(); } };
    el.onplay = () => { if (stalled) { stalled = false; changed(); } };
    unwatch();
    let lastPos = -1, still = 0;
    watch = setInterval(() => {
      if (!busy || held || url !== mine) return;
      if (here.ended) { done(true); return; }      // the `ended` the browser dropped
      const pos = here.currentTime || 0;
      still = pos === lastPos ? still + WATCH_MS : 0;
      lastPos = pos;
      if (still < STALL_MS) return;
      if (!stalled) { stalled = true; changed(); seen(); return; }
      // Marked, and given a chance to play on; in view and still not moving,
      // it is let go of so what is behind it can be heard.
      if (still >= LET_GO_MS && !doc.hidden) done(false);
    }, WATCH_MS);
    el.src = mine;
    void el
      .play()
      .then(() => { audioErr = ''; status(); changed(); })
      .catch((e: DOMException) => {
        /* Pausing a chunk whose play() has not settled yet rejects it with
           AbortError. That is us, doing what we were asked, and treating it as
           a failure threw the sentence away: done() revokes the object URL and
           moves on, so the chunk you paused was gone before you pressed
           resume. Which is most of why pausing took more than one press to
           work -- half the time it was not a pause, it was a skip. */
        if (e && e.name === 'AbortError' && held) return;
        /* An abort that was not a hold is still not a fault: it is the
           browser saying this play was superseded -- a skip, a stop, a stalled
           chunk let go of, the tab put away -- and every one of those is
           something this page did or knew about. The queue moves; nobody is
           told. Naming it in the console taught people to read "AbortError"
           as the sound being broken, which it never was. */
        if (e && e.name === 'AbortError') { done(false); return; }
        audioErr = 'play: ' + e.name;
        done(false);
      });
    changed();
  }

  /* Letting a pause go without picking up what it paused.

     A hold is never only this flag: there is a clock drawn from it, and
     whatever the caller stopped along with the sound. Stop and Skip throw the
     queue away, so there is nothing to resume -- and they used to clear the
     flag alone. Everything hanging off it stayed held: the counter read the
     same number for the rest of the evening, and what onHold had paused was
     never let go. Releasing is always safe, whether or not anything is
     held. */
  function letGo(): void {
    if (!held) return;
    held = false;
    o.onHold?.(false);
  }

  function stopWav(): void {
    letGo();
    queue.length = 0;
    queuedS = 0; playingS = 0;
    startedAt = 0;
    report();                        // say the queue is gone, or whoever is
                                     // pacing paces against audio we dropped
    if (el) {
      el.onended = null;             // pausing must not chain into the next chunk
      el.onerror = null;             // and neither must the old chunk's failure
      el.onpause = null;             // and a pause of nothing is not a stall
      el.onplay = null;
      try { el.pause(); } catch { /* nothing was playing */ }
    }
    if (url) { URL.revokeObjectURL(url); url = ''; }
    unwatch();
    drop = null;
    busy = false;
    stalled = false;                 // nothing is in hand to have stalled
    inHand = null;                   // dropped, so its characters were never said
    status();
    changed();
  }

  /* Not now, said in the corner. The shell owns the switch -- it is the same
     one that silences the interface -- and this is the half of it the shell
     cannot do: the pill's voice is an audio element on this page and nothing
     outside knows about it. Muted, the words still arrive and are still read;
     they are simply not spoken, which is the whole of what anybody means by
     turning a conversation down while somebody else is in the room.

     (The server goes on making the voice. Not making it at all is the better
     answer and a bigger one -- it would want telling the machine that nobody
     is listening, and then unloading the voice model when that stays true.) */
  /* Silent rather than hushed since 10-08: the knob at zero is the same
     "nothing heard" and lands the same way (sound.silent, lucid:silent). */
  const onHush = (e: Event) => {
    if ((e as CustomEvent<boolean>).detail) {
      const airborne = busy || queue.length > 0;
      stopWav();                     // drop what was in the air
      if (airborne) unheard();       // and say so on the line it belonged to
    }
    changed();
  };
  const onVolume = (e: Event) => {
    if (el) el.volume = (e as CustomEvent<number>).detail;
  };
  /* And picked up again when the page is seen. A chunk the browser paused is
     played on from where it stopped if the browser will let it, and let go
     of -- through `ended`, so the queue moves -- if it will not. */
  const seen = () => {
    if (doc.hidden || !stalled || !el || held) return;
    const it = el;
    void it.play().catch(() => { if (stalled) drop?.(); });
  };
  doc.addEventListener('visibilitychange', seen);
  doc.addEventListener('lucid:silent', onHush);
  doc.addEventListener('lucid:volume', onVolume);

  return {
    enqueue(pcmBase64: string, rate: number) {
      if (dead) return;
      // Muted, the words still arrive and are still read; they are simply not
      // spoken, and the line they belonged to says so.
      if (sound.silent) { unheard(); return; }
      // A new stretch, unless this is the next sentence of one still going.
      if (!airborne() && !(expecting && startedAt)) startedAt = Date.now();
      el = voice(doc);
      const raw = atob(pcmBase64), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const secs = bytes.length / 2 / rate;
      queue.push({blob: wavBlob(normalize(bytes, lift), rate), secs, chars: 0});
      requeue();
      playNext();
      report();
      status();
      changed();                     // a voice arrived; the key is a pause now
    },

    /* Characters of reply that the audio just queued will speak. It arrives
       after its audio, so it lands on the last chunk queued -- and is banked
       only when that chunk finishes playing, since a chunk that is queued has
       not been said yet. */
    credit(chars: number) {
      const last = queue.length ? queue[queue.length - 1]! : inHand;
      if (last) last.chars += chars || 0;
    },

    /* Steering rather than stopping: soft lets the line being spoken land and
       drops what was queued behind it. Cutting a voice off mid-word to answer
       somebody reads as a machine glitching; the half second it costs to let
       the sentence finish is the difference between being interrupted and
       being listened to. */
    fade(seconds: number) {
      if (fading) clearInterval(fading);
      fading = null;
      if (!el || (!airborne() && !queue.length)) { stopWav(); return; }
      const from = el.volume;
      const began = Date.now();
      const ms = Math.max(1, seconds * 1000);
      fading = setInterval(() => {
        const t = Math.min(1, (Date.now() - began) / ms);
        if (el) el.volume = from * (1 - t);
        if (t < 1) return;
        clearInterval(fading!);
        fading = null;
        stopWav();
        if (el) el.volume = sound.level;
      }, 40);
    },

    stop(soft: boolean) {
      if (!soft) { stopWav(); return; }
      letGo();
      queue.length = 0;
      queuedS = 0;
      if (!airborne()) startedAt = 0;
      report();        // whoever is pacing on this: it is nearly empty now
      status();
      changed();
    },

    /* Held, not cut. You were distracted halfway through something long and
       you do not want it gone -- you want it to wait. The chunk that is
       playing is paused where it is and the rest of the queue stays where it
       is, so pressing play again picks the sentence up mid-word.

       It also stops the pill running ahead while you are away, for free: the
       server paces itself on how much audio the page still has to play, and
       while this is held that number does not go down. Nothing is generated
       into a room nobody is listening to. */
    hold(on: boolean) {
      held = on;
      /* And whatever else is behind the voice. Said every time, and without
         asking whether there is anything to stop: what a hold means beyond
         the sound is the caller's, and this end guessing wrong is how a thing
         stayed held for the rest of an evening. */
      o.onHold?.(on);
      if (on) {
        // Whatever is playing stops where it is; what is behind it stays
        // behind it, because playNext will not start anything while this is
        // set.
        if (el) { try { el.pause(); } catch { /* nothing was playing */ } }
      } else if (busy && el) {
        /* Two ways to come back, and picking the wrong one is why resuming
           took more than one press. A voice arrives a sentence at a time:
           pause during a sentence and there is a part-played chunk to pick up;
           pause in the gap between two and there is nothing playing at all,
           only a queue waiting -- and calling play() on the element then does
           nothing, so the press appeared to be ignored.

           If a chunk is loaded -- playing, part-played, or paused before it
           ever started -- it is the one to pick up, from wherever it got to.
           Only when there is no chunk in hand does the next one come off the
           queue. */
        void el.play().catch((e: DOMException) => {
          if (e && e.name === 'AbortError') return;
          audioErr = 'resume: ' + e.name;
          status();
        });
      } else {
        playNext();
      }
      changed();
    },

    get queuedS() { return queuedS; },
    get playingS() { return playingS; },
    get playedS() { return playedS; },
    get spokenChars() { return spokenChars; },
    get playingChars() { return inHand ? inHand.chars : 0; },
    get playing() { return busy; },
    get held() { return held; },
    get stalled() { return stalled; },
    get expecting() { return expecting; },
    expect(on: boolean) {
      if (expecting === on) return;
      expecting = on;
      if (!on && !airborne()) startedAt = 0;
      changed();
    },
    get sinceStartMs() { return (airborne() || expecting) && startedAt ? Date.now() - startedAt : 0; },

    position() { return busy && el ? el.currentTime || 0 : 0; },

    onChange(fn: () => void) { ears.add(fn); return () => { ears.delete(fn); }; },
    onUnheard(fn: () => void) {
      unheardEars.add(fn);
      return () => { unheardEars.delete(fn); };
    },

    /* A phone is here to be talked to, so it claims the audio on its own. Both
       Web Audio and an <audio> element need a gesture before they will make a
       sound, so the first tap anywhere buys the right to play later.

       On the element we already have, never a new one. This used to build a
       fresh Audio and assign it over the top, and if the first press of the
       evening landed while something was playing -- which it does the moment
       you reload a page mid-reply, or press a key to answer -- the element
       carrying that chunk was thrown away with its onended handler still on
       it. The chunk never ended, so `busy` never cleared, so nothing behind it
       in the queue ever played. Silence, with nothing in the console: the
       failure was the absence of an event rather than an error. */
    unlockOnce() {
      let unlocked = false;
      const once = () => {
        if (unlocked) return;
        unlocked = true;
        el = voice(doc);
        if (!busy) {
          el.src = silence();
          void el.play().catch((e: DOMException) => {
            if (e && e.name === 'AbortError') return;   // superseded, not refused
            audioErr = 'unlock: ' + e.name;
            status();
          });
        }
        status();
      };
      const GESTURES = ['pointerdown', 'touchstart', 'keydown'] as const;
      for (const ev of GESTURES) window.addEventListener(ev, once, {passive: true});
      return () => {
        for (const ev of GESTURES) window.removeEventListener(ev, once);
      };
    },

    /* The room went away. The element stays -- it belongs to the page, and the
       next room will want the unlock it is carrying -- but nothing of this
       conversation may still be coming out of it. */
    dispose() {
      if (fading) { clearInterval(fading); fading = null; if (el) el.volume = sound.level; }
      dead = true;
      doc.removeEventListener('lucid:silent', onHush);
      doc.removeEventListener('visibilitychange', seen);
      doc.removeEventListener('lucid:volume', onVolume);
      stopWav();
      ears.clear();
      unheardEars.clear();
    },
  };
}
