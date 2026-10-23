/* The room: a pill, one of its conversations, and everything you can press.
 *
 * The conversation is conversation/, the state it writes is link/store, the
 * sound is @lucid/audio, the interfaces are @lucid/ui, the deck's meaning is
 * ui/TapeDeck/deck.ts, the room is ../../room — what lives here is the
 * wiring between them, which is what a route is for: it opens the conversation
 * for as long as it is on screen, hands the room what the page knows, and gives
 * both back on the way out.
 */
import {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Navigate, useNavigate, useParams, useSearchParams} from 'react-router';
import {
  clearSession, deleteTurn, did as handMoved, handsSoon, leaveLoop, skip as skipOne,
  speakAgain, startContinuous, stop as stopEverything, stopContinuous,
  cutIn,
} from '../../conversation/loop';
import {setStanding} from '../../conversation/after';
import {personas} from '../../conversation/bundle';
import {describe, resetPersona, tune, tunedTo} from '../../conversation/persona';
import {AXES, decayed, standing} from '../../conversation/relation';
import {
  Nowhere, forgetRoomState, opened, refreshPersona, saveRoomState,
} from '../../conversation/room';
import {keepOnLeaving, leaveRoom, openRoom, playInto, runTurn, warmPrefix} from '../../conversation/turn';
import {watchMachine} from '../../link/machine';
import {deliver} from '../../link/reduce';
import type {RoomShove, RoomState} from '../../link/shapes';
import {link, useLink} from '../../link/store';
import {useShallow} from 'zustand/react/shallow';
import type {Knows, Mounted, RoomHandle, RoomSpec} from '../../room';
import {canBeHeard} from '@lucid/audio';
import {awaitReady, models} from '@lucid/machine';
import {expose, hatch, host, onAskForCard, onHost, sound, useLimited, usePage} from '@lucid/shell';
import {UNSENT, ask, openLimit, store, stored} from '@lucid/ui';
import ConfirmDialog from '@lucid/ui/ConfirmDialog/ConfirmDialog';
import Glass from '@lucid/ui/Glass/Glass';
import Sheet from '@lucid/ui/Sheet/Sheet';
import Stage from '@lucid/ui/Stage/Stage';
import TypeLine from '@lucid/ui/TypeLine/TypeLine';
import Banners from '../../ui/Banners/Banners';
import {modelWanted, openModelCard} from '../../ui/ModelCard/open';
import {openCharacter, openForget, openMemory, openSessions} from '../../ui/Sheets/sheets';
import TapeDeck from '../../ui/TapeDeck/TapeDeck';
import Transcript from '../../ui/Transcript/Transcript';
import {audio, micOff, micOn, recognizer} from './audio';
import {onReplayState, replay, replayState} from './replay';
import {useDots} from './dots';
import {FIGURE, TYPING} from './kept';
import type {KeyId, Machine} from '../../ui/TapeDeck/deck';
import {waiting} from '../../ui/TapeDeck/deck';
import './Room.css';
/* And the rooms' own dressing, eagerly — after this page's stylesheet, so a
   persona's file still wins. ../../rooms imports these too, and that is where
   they came from on a machine that can draw; but the room is only fetched
   when there is WebGL to run it, and a machine with none still stands in a
   room whose panel is its own color. Without this the flat page was the one
   place in the app painted in nobody's colors. */
import '../../rooms/lover.css';
import '../../rooms/thinker.css';

/* Which room this pill stands in, and the machine that builds it — both
   fetched only when there is WebGL to run them. A room is furniture for a
   persona, so the stage is handed the two ways to ask rather than the
   answers: it knows a scene can be stopped and nothing else about this one.
   At module scope because the stage tears its room down and builds it again
   whenever either changes, and a function written in a render is a different
   function every time. */
/* How often the room is drawn while a model in this browser writes: a few
   frames a second, enough that the moon and the rain do not stop. */
const EASED_MS = 125;

const roomOf = (slug: string) => import('../../rooms').then((m) => m.roomOf(slug));
const build = (spec: RoomSpec, into: Mounted) =>
  import('../../rooms').then((m) => m.build(spec, into));
// The same chunk, asked for ahead of the patience: see Stage's `fetch`.
const arrive = () => import('../../rooms');

/* `canBeHeard` is the microphone's own question — see capture.ts in
   @lucid/audio. It is
   asked twice here: the Talk key goes rather than sitting there grayed, and a
   room with no way to talk into it opens with the line to write in already
   waiting. */

/* What the room hands back, filtered to what the protocol says.
   A count per remembered name and the shoves in the order they were made,
   which is the whole of a room's state: the engine hands back whatever its
   minds hold plus that list. Anything else a room invents is dropped here
   rather than at the other end, where it would be written to disk. */
const shoved = (v: unknown): v is RoomShove[] =>
  Array.isArray(v) && v.every((s) => s && typeof s === 'object'
    && typeof (s as RoomShove).name === 'string'
    && typeof (s as RoomShove).steps === 'number');
const counted = (state: Record<string, unknown>): RoomState =>
  Object.fromEntries(Object.entries(state).filter(
    ([k, v]) => typeof v === 'number' || (k === 'shoves' && shoved(v)))) as RoomState;

export default function Room() {
  const {slug = ''} = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const glass = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const room = useRef<RoomHandle | null>(null);

  /* What this route draws, and nothing else in the store.
   *
   * It used to take the whole state -- `useLink(x => x)` -- so every write
   * anywhere re-rendered the room: the machine poll's fresh `status` and
   * `memory` objects every five seconds, every delta of a reply, every scored
   * turn. With the Stage, the glass, the deck and the typing line all under
   * it, that is the most expensive render in the app run for things it does
   * not draw. Shallow, and by name: a field added below is a field this list
   * has to be told about, which is the trade -- one line here against a room
   * that redraws for the memory meter. */
  const s = useLink(useShallow((x) => ({
    personas: x.personas,
    slug: x.slug,
    state: x.state,
    running: x.running,
    continuous: x.continuous,
    continuous_min: x.continuous_min,
    input_mode: x.input_mode,
    nowhere: x.nowhere,
    adrift: x.adrift,
    adrift_said: x.adrift_said,
    waking: x.waking,
    minutes: x.minutes,
    mic_follow: x.mic_follow,
    persona_name: x.persona_name,
    transcript: x.transcript,
    relation: x.relation,
    room: x.room,
  })));
  const [typing, setTyping] = useState(() => {
    /* Shut, unless you left it open.
     *
     * It used to be the other way about — open unless you had shut it, and
     * open regardless in a room where nothing had been said yet — which meant
     * a line to type into was waiting every time anybody walked into a room,
     * whatever they had come for. The microphone does not do that, and this is
     * the same kind of thing: a way in that you choose. Unless there is no
     * microphone on this address, where typing is the only way in and a line
     * waiting is the kindest thing there is. And in a browser, whose ear is a
     * download most visitors never make: typing is its way in, and speaking
     * the one somebody chooses. Either way a choice, once made, outranks
     * them. */
    const saved = stored(TYPING);
    return saved ? saved === '1' : !canBeHeard() || !host().machine;
  });
  const [unheard, setUnheard] = useState<ReadonlySet<number>>(new Set());

  // ---- the address ---------------------------------------------------------
  /* The conversation belongs in the address: a conversation opened without one
     is still a conversation somebody may want to come back to, send to their
     phone, or open beside another. The router owns it now, and writes it back
     without a navigation — the same thing history.replaceState did, said to
     the thing that also knows about the back button. */
  const put = useRef<(sid: string) => void>(() => {});
  /** The last conversation this room wrote into the address itself. What tells
      its own writing back from somebody asking for a different one. */
  const mine = useRef('');
  useEffect(() => {
    put.current = (sid) => {
      mine.current = sid;
      setParams((was) => {
        const next = new URLSearchParams(was);
        next.set('session', sid);
        return next;
      }, {replace: true});
    };
  }, [setParams]);

  /* Which conversation the address is asking for -- including when it changes
     while this room is already on screen, which is what opening a row of
     History from inside a room does. The route element is keyed by path, so
     nothing remounts and the room went on showing the conversation it had:
     the sheet closed, the address changed, and the transcript sat there until
     a reload. Its own writing back is not an ask, hence `mine`. */
  const [want, setWant] = useState(() => params.get('session') || '');
  useEffect(() => {
    const asked = params.get('session') || '';
    if (asked && asked !== mine.current) setWant(asked);
  }, [params]);

  // ---- what the page is, said on <html> ------------------------------------
  /* Three marks and three classes, and every one of them is read by CSS that
     was written when this was a document of its own: the page's own stylesheet
     is under [data-page], the persona's dressing is under [data-room], the
     figure shown while a room builds is under [data-figure], and `waking` and
     `flat` are the two states the room can be in before there is one. Set in a
     layout effect, so the first paint of the route is already the room's. */
  usePage('room');
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.room = slug;
    root.classList.add('waking');
    return () => {
      delete root.dataset.room;
      delete root.dataset.figure;
      root.classList.remove('waking', 'flat');
      // The room's own void, painted onto the page behind everything by
      // Stage. Off again: the shelf is not in this room.
      root.style.background = '';
    };
  }, [slug]);

  /* Which figure this pill is backed with — a diamond, a spiral — so the mark
     shown while the room builds is the one on the card you pressed.

     It comes from the list of pills, which is a request now and used to be a
     message a page could not ask for. Either way it is not there on the first
     paint, and the shape shown while a room builds is the shape it should
     already have been.

     So it is written down the first time it is seen, per pill. The second
     visit to a room shows the right mark before anything has come back, and
     the first gets the house shape, which is no worse than a room nobody has
     dressed. */
  const figure = s.personas.find((p) => p.slug === slug)?.figure ?? stored(FIGURE + slug);
  useEffect(() => {
    if (!figure) return;
    document.documentElement.dataset.figure = figure;
    store(FIGURE + slug, figure);
  }, [figure, slug]);

  /* And what the tab says. One document now, so the name of the page is
     something a route puts on and takes off again — the shelf is not this. */
  useLayoutEffect(() => {
    const was = document.title;
    document.title = 'Lucid Talk';
    return () => { document.title = was; };
  }, []);

  // ---- the pills, and the machine ------------------------------------------
  /* Which pills there are. It arrived in the socket's handshake, stamped with
     whichever conversation happened to be live — so a page that walked into a
     room while the machine was on another pill turned the list away with
     everything else addressed elsewhere, and had no figure at all. It is the
     package's own content now (conversation/bundle.ts), so a room reloaded
     into directly has it before it has asked anybody anything. */
  useEffect(() => {
    if (link.getState().personas.length) return;   // the box already read them
    link.setState({personas: personas()});
  }, []);

  /* A pill that is not in the box. The route answers the way a server would
     answer a bad address, by going back to where the pills are — and opens
     nothing on the way, because there is nothing there to open. Only once the
     list has arrived: before that, every slug is unknown. */
  const listed = s.personas.length > 0;
  const unknown = listed && !s.personas.some((p) => p.slug === slug);

  /* What the machine is doing, while this room is open: the three lamps, what
     they cost, and the two standing orders about the microphone. Five seconds
     rather than the tick's fifth of one — none of it moves at the speed of a
     conversation. See link/machine.ts. */
  useEffect(() => (unknown ? undefined : watchMachine()), [unknown]);

  /* The one door into the page's state that is not the loop itself.
     There is no socket: what one carried is either the page's own now or a
     route, so opening one would be a connection with nothing on it. The
     simulated-state pictures still need a way in, and the reducer is it. See
     `deliver`, and app/tests/browser/states.mjs. */
  useEffect(() => expose('receive', deliver), []);

  // ---- the room ------------------------------------------------------------
  /* What the page knows and the room does not, and the two things the room
     says back. What is kept of what it hands back is `counted`, above. */
  const told = useCallback((): Knows => {
    const now = link.getState();
    return {
      who: now.room?.persona,
      take: now.room?.session,
      mood: now.room?.mood,
      state: now.room?.state,
      save(state) {
        /* The bag under this conversation, written straight to the machine's
           files. Python broadcast it back to every screen watching; there is
           one screen here, and it is the one that just moved the book. */
        void saveRoomState(counted(state));
      },
      /* And a hand put to something is a turn. The room writes the sentence —
         it is the only part of this that knows a book from a cushion — and it
         is answered the way anything typed is. Which makes touching the room a
         third way of talking to a pill, beside the microphone and the line at
         the bottom of the screen. */
      did(text) {
        handMoved(text);
      },
    };
  }, []);

  const onRoom = useCallback((handle: RoomHandle | null) => {
    room.current = handle;
    expose('room', handle);
  }, []);

  /* The room, as the page has it: who, which conversation, how the persona is
     set now, and what hands have done in here. It is read from the machine's
     files, possibly long after the room was built — and again whenever the
     conversation changes under us, which is why the state is re-applied rather
     than merged: opening a second conversation must not leave the first one's
     lamp burning in it. */
  const known = s.room;
  useEffect(() => {
    if (known) room.current?.room.knows(told());
  }, [known, told]);

  /* Where the pill is holding you, which is what the room is lit by. It lands
     after every turn that had you in it, so the room warms up or grays out
     around somebody who is sitting in it. Only what actually arrived: an
     undefined assigned over a good value reads as a pill with no opinion of
     you, and the room goes flat. */
  const relation = s.relation;
  useEffect(() => {
    const st = relation?.state;
    if (!st) return;
    const heat: {warmth?: number; temper?: number} = {};
    if (typeof st.warmth === 'number') heat.warmth = st.warmth;
    if (typeof st.mood === 'number') heat.temper = st.mood;
    if ('warmth' in heat || 'temper' in heat) room.current?.room.knows({mood: heat});
  }, [relation]);

  // ---- the sound -----------------------------------------------------------
  /* One playback, one microphone, one pacer, made outside React and kept for
     the page — see audio.ts. What the route does with them is start them, read
     them, and stop what is coming out on the way to the box. */
  const {playback, capture, pacer, vad} = audio();
  const sounding = useSyncExternalStore(playback.onChange,
    () => playback.playing || playback.queuedS > 0);
  const heldSound = useSyncExternalStore(playback.onChange, () => playback.held);
  const captureOn = useSyncExternalStore(capture.onChange, () => capture.on);
  /* And whether the recognizer is still coming up under a press that has
     already happened, which is what the Talk key wears while it loads. The
     model is not loaded until somebody asks to be heard — see audio.ts. */
  const micWarming = useSyncExternalStore(recognizer.onChange, () => recognizer.warming);
  /* The meter under the Talk key is the deck's own subscription now, not this
     route's: it moves about thirty times a second while the microphone is
     open, and read here it re-rendered the Stage, the glass, the transcript
     and the typing line at that rate for a bar two hundred pixels wide. The
     ear is handed down instead -- see TapeDeck. */
  /* What the transcript should show of the reply still arriving, and whether
     it is still arriving. The model writes faster than anyone speaks — 119
     words in 13.4s against 30.0s of audio, measured — so the words are
     released against the voice rather than as they are written. */
  const visible = useSyncExternalStore(pacer.onChange, () => pacer.visible);
  const settled = useSyncExternalStore(pacer.onChange, () => pacer.settled);
  const [heardAnything, setHeardAnything] = useState(false);

  /* The persona, the conversation and everything in it. Read once, and held
     for as long as the room is on screen. */
  useEffect(() => {
    /* Nothing is opened for a pill the box has never heard of. It used to run
       once before the redirect below took the page away, which was a red line
       in the console about a room nobody asked for. */
    if (unknown || !listed) return;
    playInto(playback);
    let gone = false;
    void openRoom(slug, want)
      .then((room) => {
        if (gone) return;
        put.current(room.sessionId);
        /* How long a dose lasts, off the same config the loop is tuned by. It
           used to arrive in `setup` on the socket; it is a number in the
           game's file, and this is the room that presses Play with it. */
        link.setState({minutes: room.cfg.ui.continuous_minutes});
        /* The language model, asked for by the room and not only by the box:
           a page refreshed in a room, or one opened by its address, never went
           through the box, and the first reply paid the cold start. And once
           it is up, the conversation's prefix pushed through it, so the first
           reply answers from the second token -- see warmPrefix. */
        const begin = () => void models.start()
          .then(() => awaitReady('llm'))
          /* Not where the words come from this browser: its engine keeps one
             conversation, and a warm would be the conversation the first turn
             then finds is not its own. */
          .then((up) => { if (up && !gone && host().llm === 'machine') return warmPrefix(room); return false; })
          .catch(() => {});
        /* Unless there is nothing to start: a Mac with no model on its shelf,
           or a page with no machine that has not chosen one for this browser.
           The first time a pill is opened there, it asks which -- and the room
           carries on from whatever it was given. See ModelCard. */
        void modelWanted().then((wanted) => {
          if (gone) return;
          /* Where no model can run here at all, the card says so and offers
             the room anyway, to look around; its other way is the box. */
          if (wanted) openModelCard({onReady: begin, onLeave: () => {}, onBox: () => navigate('/talk')});
          else begin();
        });
        /* And the voice, once it is up: its kernels, its buffers and the
           speaker conditioning for this pill's clip, paid for while somebody
           is still looking at the room rather than on the first sentence of
           the first reply (measured in machine/models.py, Voice.warm: 1.36s
           against 0.82s for the same line). Nobody hears it. The voice is
           asked for by the mute effect below; this waits for it, and a room
           that is silent (muted, or the knob at zero) or left meanwhile
           warms nothing. */
        if (!sound.silent && host().voice) {
          void awaitReady('tts')
            .then((up) => (up && !gone && opened() === room && !sound.silent
              ? models.warm({kind: 'voice', voice: room.persona.voice}) : null))
            .catch(() => {});
        }
        /* And anything a hand did on the way in. A press is the usual way an
           evening starts, and it arrives before there is a transcript for it
           to be a turn in -- so it waits, and this is what asks for it. */
        handsSoon();
      },
            (e: unknown) => {
              /* Except an address pointing at a conversation this room cannot
                 open, which has already said so and put the banner up. A
                 second line in red about the same thing is one thing wrong
                 said twice. */
              if (e instanceof Nowhere) return;
              hatch.say('could not open this room: '
                + ((e as Error)?.message || String(e)), 'error');
            });
    return () => {
      gone = true;
      leaveLoop();
      leaveRoom();
      /* And the sound: this cleanup is the one that runs when the room stays
         mounted and only the conversation changes -- a row of History opened
         from in here -- and the voice of the old conversation went on playing
         into the new one until its queue ran out. */
      playback.stop(false);
    };
    /* The pill and the conversation asked for: `want` moves when somebody
       opens a row of History from in here, and this room is then that
       conversation's -- the old one is given back the way leaving gives it
       back. What it does not move for is this room writing its own name into
       the address. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, unknown, listed, want]);


  useEffect(() => {
    // Every browser refuses to play until the page has been touched. The next
    // press anywhere buys the right, and the deck cannot be used without
    // pressing something.
    const off = [
      playback.unlockOnce(),
      playback.onChange(() => { if (playback.playing) setHeardAnything(true); }),
      /* The line that is being spoken right now, or the last one there was:
         what the mark goes on. A line that arrived while the sound was off is
         indistinguishable, from in here, from one that was simply quiet. */
      playback.onUnheard(() => {
        const said = link.getState().transcript;
        for (let i = said.length - 1; i >= 0; i--) {
          if (said[i]?.role === 'assistant') {
            const at = i;
            setUnheard((was) => new Set(was).add(at));
            return;
          }
        }
      }),
    ];
    return () => {
      for (const stop of off) stop();
      /* Leaving the room takes the voice with it, and tells the machine.
         The machinery stays; the models are given back -- through the key's
         own off, so the recognizer's grace is armed, and the voice's the
         same way. Left without a word, both stayed resident until the
         half-hour watchdog, which with a second tab open is for ever. */
      playback.stop(false);
      micOff();
      pacer.reset();
      void models.want('tts', false).catch(() => {});
    };
  }, [playback, capture, pacer]);

  /* The words of a reply, handed to the pacer as they arrive. It is fed from
     the transcript rather than from the socket because the store is where a
     delta has already been decided to be ours — and because a reply that was
     settled by a socket going away must settle here too. */
  useEffect(() => link.subscribe((now, was) => {
    if (now.transcript === was.transcript) return;
    const b = now.transcript[now.transcript.length - 1];
    const a = was.transcript[was.transcript.length - 1];
    if (!b) return;
    if (b.role === 'user') { pacer.reset(); return; }      // your turn ends its
    const growing = a?.role === 'assistant' && a.streaming;
    if (b.streaming) {
      pacer.feed(growing && b.text.startsWith(a.text) ? b.text.slice(a.text.length) : b.text);
    } else if (growing) {
      // Broken off: over on the glass now, not when its voice runs out.
      if (b.cut) pacer.cut(b.text);
      else pacer.done(b.text);
    }
  }), [pacer]);

  // What the mic does when you leave the window: the machine's own standing
  // order, read every few seconds while a room is open. See link/machine.ts.
  const follow = s.mic_follow;
  useEffect(() => capture.follow(follow), [capture, follow]);

  // ---- it is hearing you, and it is thinking -------------------------------
  const dots = useDots();
  const turns = s.transcript;

  /* Two things that follow what arrives rather than what is drawn, and so are
     answered where messages land rather than in a render: the copy of a line
     kept against the socket losing it, and the marks on lines whose voice was
     never heard, which are about a conversation and go when it does. */
  useEffect(() => link.subscribe((now, was) => {
    if (now.sid !== was.sid) setUnheard(new Set());
    if (now.transcript === was.transcript) return;
    const said = now.transcript[now.transcript.length - 1];
    // It arrived. Stop holding a copy of it.
    if (said?.role === 'user' && said.text.trim() === stored(UNSENT)) store(UNSENT, '');
  }), []);

  // ---- what the keys mean --------------------------------------------------
  /* A browser that cannot run the pill at all, stepped into anyway. */
  const noWords = useLimited('pill');
  const machine: Machine = {
    state: s.state,
    running: s.running,
    continuous: s.continuous,
    inputMode: s.input_mode,
    nowhere: s.nowhere,
    adrift: s.adrift,
    sounding,
    held: heldSound,
    seeded: turns.some((t) => t.role === 'user'),
    lastSaid: turns.some((t) => t.role === 'assistant'),
    captureOn,
    micWarming,
    typing,
    noWords: !!noWords,
  };

  /* Once an evening, and only the first time. The pulse answers exactly one
     question — does the sound work at all — and that question is asked once,
     by somebody who has never heard this voice and is watching words scroll
     past in silence. */
  useEffect(() => {
    sound.waiting(waiting(machine, heardAnything));
    // What it reads is named below; the rest of `machine` is rebuilt on every
    // render and would ask this again on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.state, machine.sounding, machine.held, heardAnything]);

  /* And it stops with the room, whatever it was doing. Ejecting during the
     first "thinking" left the pulse beating on the box -- bounded at twenty
     beats, which is still twenty beats about a reply nobody is waiting for.
     On the way out only: the beat keeps its own "I have given up" between
     asks, and clearing it whenever the state moved would start it again. */
  useEffect(() => () => sound.waiting(false), []);

  const showType = useCallback((on: boolean) => {
    setTyping(on);
    store(TYPING, on ? '1' : '0');
  }, []);

  const press = useCallback((key: KeyId) => {
    const now = link.getState();
    switch (key) {
      case 'back': {
        // The last thing the pill said, which is what Again says again.
        const said = [...now.transcript].reverse().find((t) => t.role === 'assistant');
        if (!said) break;
        replay(said.text, speakAgain);
        break;
      }
      case 'play':
        if (now.continuous) {
          stopContinuous();
        } else {
          // Held when you press Play: you meant go, so let the sound go too.
          if (playback.held) playback.hold(false);
          startContinuous(now.minutes, true);
        }
        break;
      case 'pause':
        /* And Pause is about the sound in the room, not about the tape. It
           stops what is being said where it is and holds the run behind it: a
           pause that stopped only the sound left the machine writing turns
           nobody was listening to and the dose spending itself against a
           silence. */
        playback.hold(!playback.held);
        break;
      case 'stop':
        /* And stop is the hard one: cut this line off and end any run. Pause
           waits for you; stop does not — the queue goes first, so that the
           silence starts on the press. */
        playback.stop(false);
        stopEverything();
        break;
      case 'skip':
        /* Skip is Stop for one line rather than for the evening. The queue
           goes with it: the sentences already in hand are the ones you are
           trying to get past. */
        playback.stop(false);
        skipOne();
        break;
      case 'rec':
        /* This page is the microphone. There is nowhere else to ask: the
           machine behind it never opens a device, so a refusal here is the
           answer and not the first of two attempts — which is why the key
           stays off when it fails rather than coming on over a microphone
           that is not there. And the recognizer behind it is asked for here
           too, because until somebody presses this nobody is being listened
           to and nothing should be loaded to listen with. See audio.ts. */
        /* Nothing to hear with in a browser: the key says so, and how
           to run it on your Mac, rather than asking for a device. */
        if (openLimit('ear')) break;
        if (capture.on) micOff();
        else void micOn();
        break;
      case 'type':
        /* Held open where the pill cannot run: the key is the way to why. */
        if (openLimit('pill')) break;
        showType(!typing);
        break;
      case 'eject':
        navigate('/talk');
        break;
    }
  }, [capture, navigate, playback, showType, typing]);

  const onSend = useCallback((text: string) => {
    /* You paused because you stepped away; saying something is coming back.
       Leaving it held here is the one way this can go quiet with nothing
       visibly wrong — everything after would queue behind a paused element and
       never be heard. */
    if (playback.held) playback.hold(false);
    // And the floor: a line typed over a reply is a line typed instead of the
    // rest of it. See onHeard in audio.ts, which says why.
    if (host().llm === 'none') return false;
    cutIn();
    const now = link.getState();
    void runTurn({slug: now.slug || slug, sessionId: now.sid, text});
    return true;
  }, [playback, slug]);

  const onDelete = useCallback((role: 'user' | 'assistant', text: string) => {
    /* Off the glass once it is off the file, and not before: the press used to
       take the bubble away while the store was still being asked, so a refusal
       left a conversation that was whole on disk and short on screen. By the
       same rule the file is edited by -- the last turn of that role with those
       words -- because nothing comes back to say which line it was. */
    void deleteTurn(role, text).then((gone) => {
      if (!gone) return;
      const all = [...link.getState().transcript];
      for (let i = all.length - 1; i >= 0; i--) {
        const t = all[i];
        if (t && t.role === role && t.text.trim() === text.trim()) {
          all.splice(i, 1);
          link.setState({transcript: all});
          /* And the marks, which are places in that list: without this the
             "never spoken" mark on every line after the one that went slid up
             onto its neighbour. */
          setUnheard((was) => {
            if (!was.size) return was;
            const next = new Set<number>();
            for (const at of was) if (at !== i) next.add(at > i ? at - 1 : at);
            return next;
          });
          break;
        }
      }
    });
  }, []);

  /* The page going away in the middle of a reply.
   *
   * His line is on disk before the model is asked; the answer is written when
   * it finishes. Close the tab or reload between the two and the conversation
   * keeps a question nobody answered -- and resuming shows it that way, with
   * the reply that was actually spoken gone. So what was spoken is written on
   * the way out, by beacon, which is the one kind of request that outlives the
   * document that started it.
   *
   * `pagehide` rather than `beforeunload`: it is the event mobile Safari
   * actually fires, and it fires for a page going into the back/forward cache
   * as well as one being closed. */
  useEffect(() => {
    const going = () => {
      if (keepOnLeaving()) hatch.say('kept what had been spoken of that reply');
    };
    addEventListener('pagehide', going);
    return () => removeEventListener('pagehide', going);
  }, []);

  /* The mute switch, and the several gigabytes standing behind it.
   *
   * Fully muted is a text-only evening: the reply is not handed to a voice at
   * all (see turn.ts), so no socket is opened and the machine is left holding
   * nothing on this page's account. Which makes muting the moment to say the
   * voice is not wanted — the machine keeps it a while in case the switch was
   * a flinch — and unmuting the moment to ask for it back, before the reply
   * that will want it rather than in front of it.
   *
   * And the words: with no voice to pace them against they are let out at a
   * reading pace instead, which is the pacer's other mode.
   *
   * The knob at zero is the same evening as the switch (sound.silent, said
   * as lucid:silent): nothing heard, so nothing spoken and no voice held.
   * A knob dragged through zero asks and un-asks within a second, which the
   * grace on the other side absorbs; nothing is debounced here. */
  useEffect(() => {
    const told = (silent: boolean) => {
      /* Nothing to speak with at all -- a page with no machine and no voice
         in it -- is the same evening as the sound off: the words at a
         reading pace. */
      pacer.reading(silent || !host().voice);
      /* A Mac without its voice on the shelf has nothing to load: it says
         so on the rail, and the card brings it down. A page asks either way:
         its voice is not up until it is wanted (page/voice.ts). */
      void models.want('tts', !silent && (!host().machine || host().voice)).catch(() => {});
    };
    told(sound.silent);
    const back = (e: Event) => {
      const silent = !!(e as CustomEvent<boolean>).detail;
      // Nothing on the glass is unheard once the sound is back.
      if (!silent) setUnheard(new Set());
      told(silent);
    };
    document.addEventListener('lucid:silent', back);
    /* And a voice that arrives after the room did -- one fetched in this
       browser, up a minute into the evening: the pace is the voice's from
       then on. */
    let had = host().voice;
    const moved = onHost(() => {
      if (host().voice === had) return;
      had = host().voice;
      pacer.reading(sound.silent || !had);
    });
    return () => {
      document.removeEventListener('lucid:silent', back);
      moved();
    };
  }, [pacer]);

  /* The first-open card, at its voice or ear section, for the voice's switch
     and the microphone when they find their part not downloaded: the card is
     this game's, so a room is where it can be opened from. */
  useEffect(() => onAskForCard((section) => openModelCard({onReady: () => {}, onLeave: () => {}, focus: section})), []);

  /* A model writing a reply on this GPU -- a page with no machine, whose
     words come from the browser -- and the room eases off its frames while
     it does, so the browser's own paint is not starved: typing into the line
     during a reply lagged two to three frames behind the keys. Nothing says
     this on the machine, whose model has a GPU process of its own to queue
     in, and the room draws as it always has there. */
  useEffect(() => {
    const busy = (e: Event) => {
      room.current?.ease((e as CustomEvent<boolean>).detail ? EASED_MS : 0);
    };
    document.addEventListener('lucid:generating', busy);
    return () => document.removeEventListener('lucid:generating', busy);
  }, []);

  /* The play key on a bubble: whatever stands between the press and the
     sound, undone once -- the sound off, the voice off, or no voice at all,
     which opens the panel at it. See replay.ts. */
  const onReplay = useCallback((text: string) => {
    replay(text, speakAgain);
  }, []);
  const replaying = useSyncExternalStore(onReplayState, replayState);

  const onUnheard = useCallback((text: string) => {
    /* Pressing it turns the sound back on and says the line — both halves,
       because a mark that only explains itself sends somebody hunting for a
       switch on another screen. The same press as the play key's. */
    setUnheard(new Set());
    replay(text, speakAgain);
  }, []);

  // ---- the console's own commands ------------------------------------------
  /* Whether this room is still the room. The console keeps a command for as
     long as the page is open, and a route is not a page — so without this, the four commands below would still be offered
     from the shelf, pointed at a conversation nobody is in. */
  const here = useRef(false);
  /* The microphone meter, while it is on: a line a second, stopped with the
     room. See /mic_meter below. */
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
      if (meter.current) { clearInterval(meter.current); meter.current = null; }
    };
  }, []);

  useEffect(() => {
    /* Registered here, and taken off the list on the way out. The console
       keeps a command for as long as the page is open, and a route is not a
       page: after one visit to a pill these names went on being offered from
       the shelf, pointing at a conversation nobody is in. `here` still guards
       them, for the window between leaving and this cleanup. The list is
       written by the registering rather than by hand, so it cannot drift. */
    const mine: string[] = [];
    const command: typeof hatch.command = (name, about, run, opts) => {
      mine.push(name);
      hatch.command(name, about, run, opts);
    };

    /* Here rather than on the server, because they are about this room and not
       about the machine. One console serves every page, so a command answered
       on the server acts on whichever conversation is live — which is only
       this one while nothing else is open.

       The names are `<the thing>_<what about it>`, so that a list somebody
       reads down falls into families on its own. */
    command('room_reach', 'what in this room can still be pressed, and what is in the way',
      () => {
        const it = here.current && room.current;
        if (!it) return 'no room to look at';
        const all = it.room.reach();
        const bad = all.filter((r) => r.ok === false);
        const gone = all.filter((r) => r.ok === null);
        const lines = bad.map((r) => `  ✗ ${r.name} — ${r.why}`);
        return [`${all.length - bad.length - gone.length} of ${all.length} reach themselves`
                + (gone.length ? `, ${gone.length} out of the room` : ''),
                ...(lines.length ? lines : ['  nothing is in the way of anything'])].join('\n');
      });

    /* Numbers, once a second, for a microphone that looks dead. Twice a
       microphone that "did not work after coming back" turned out to be one
       that heard perfectly well and was being refused -- under a bar, or in a
       learn-window -- with nothing in the console to say so. This says so:
       what the mic hears, what it is measured against, what the page
       believes is playing. Only numbers, so it can go in a log; nothing
       anybody said is in it. Typed again, it stops. */
    command('mic_meter', 'what the microphone hears and is measured against, once a second',
      () => {
        if (!here.current) return 'this is not a room — open a pill first';
        if (meter.current) {
          clearInterval(meter.current);
          meter.current = null;
          return 'meter off';
        }
        const f = (n: number) => n.toFixed(4);
        meter.current = setInterval(() => {
          const {vad, playback, capture} = audio();
          const m = vad.meter;
          const st = capture.status();
          hatch.say(`mic ${f(m.rms)} floor ${f(m.floor)} gate ${f(m.gate)}`
            + ` · pill ${f(m.residual)} bar ${f(m.bar)} learned ${m.learnedMs.toFixed(0)}ms`
            + ` · out ${m.out ? 'yes' : 'no'} stuck ${m.stuck} ${m.speaking ? 'speaking' : 'quiet'}`
            + ` barge ${m.barge ? 'on' : 'off'}`
            + ` · playing ${playback.playing ? 'yes' : 'no'} queued ${playback.queuedS.toFixed(1)}s`
            + ` pos ${playback.position().toFixed(1)}s since ${(playback.sinceStartMs / 1000).toFixed(1)}s`
            + `${playback.stalled ? ' stalled' : ''}${playback.held ? ' held' : ''}`
            + ` · mic ${capture.on ? 'open' : 'closed'} aec ${st.aec === null ? '?' : st.aec ? 'yes' : 'no'}`,
            'info');
        }, 1000);
        return 'meter on — a line a second; /mic_meter again stops it';
      });

    /* The first-open card, on purpose: another size of the language model,
       from in a room. On a Mac it is the shelf's three, fetched if they are
       not there; in a browser, the builds that run in it. */
    command('model_choose', 'which language model this pill runs on — download another', () => {
      if (!here.current) return 'this is not a room — open a pill first';
      openModelCard({onReady: () => {}, onLeave: () => {}});
      return '';
    });

    command('session_new', 'begin a fresh conversation with this pill', () => {
      if (!here.current) return 'this is not a room — open a pill first';
      void clearSession().then((room) => put.current(room.sessionId),
                               (e: unknown) => hatch.say('could not start a new one: '
                                 + ((e as Error)?.message || String(e)), 'error'));
      return 'starting a new one…';
    });

    const name = () => link.getState().persona_name || 'the pill';
    const gone = 'this is not a room — open a pill first';
    command('memory_show', 'what this pill remembers about you',
      () => { if (!here.current) return gone; openMemory(slug, name()); });
    command('sessions_list', 'conversations you have already had',
      () => { if (!here.current) return gone; openSessions(slug, name()); });
    /* `standing_clear` rather than `forget_standing`, for the same reason
       /room_clear is not /tidy: the console is a list somebody reads down, and
       the names should fall into pairs on their own. What a thing is called
       first, what is being done to it second. */
    command('standing_clear', 'put how this pill is taking you back to nothing',
      () => { if (!here.current) return gone; openForget(slug, name()); });

    /* And the two pairs a room answers about itself. They were the server's
       while it held the conversation, and one console serves every page — so
       what they acted on was whichever room happened to be live. They belong
       to the room they are typed in. */
    command('room_state', 'what this conversation has done to its room', () => {
      if (!here.current) return gone;
      const state = link.getState().room?.state ?? {};
      const kept = Object.entries(state).filter(([k]) => k !== 'v');
      return kept.length ? kept.map(([k, v]) => `${k} ${v}`).join(' · ')
                         : 'nothing touched in here yet';
    });
    command('room_clear', 'put everything in the room back where it started',
      () => {
        if (!here.current) return gone;
        void forgetRoomState().then(() => room.current?.room.knows(told()),
                                    (e: unknown) => hatch.say('could not clear the '
                                      + `room: ${(e as Error)?.message || String(e)}`,
                                      'error'));
        return 'the room is as it was';
      });

    command('standing_state', 'where this pill is holding you, in numbers', () => {
      if (!here.current) return gone;
      const it = opened()?.relation;
      if (!it) return `${name()} has no standing yet`;
      const now = decayed(it);
      const [word, temper] = standing(now);
      return `${name()} is ${word}${temper ? ` and ${temper}` : ''} — `
        + AXES.map((a) => `${a} ${now[a] >= 0 ? '+' : ''}${now[a].toFixed(0)}`).join(' ');
    });
    command('standing_set', 'put this pill at a warmth, to see what it looks like',
      (rest) => {
        /* The far ends of the lighting, without an evening of earning them.
           Both axes: warmth is where you stand and moves over weeks, mood is
           today and is half of what makes a room look bright. */
        if (!here.current) return gone;
        const room = opened();
        if (!room) return gone;
        const bits = (rest || '').replace(/,/g, ' ').split(/\s+/).filter(Boolean);
        if (!bits.length) return 'standing_set <warmth -100..100> [mood -100..100]';
        const want = bits.slice(0, 2).map(Number);
        if (want.some((n) => !Number.isFinite(n))) return 'numbers, between -100 and 100';
        void setStanding(room, want[0] as number, want[1]).then((state) => {
          const [word, temper] = standing(state);
          hatch.say(`${name()} is ${word}${temper ? ` and ${temper}` : ''} — `
            + `warmth ${state.warmth.toFixed(0)}, mood ${state.mood.toFixed(0)}`);
        }, (e: unknown) => hatch.say('could not set that standing: '
          + ((e as Error)?.message || String(e)), 'error'));
        return '';
      }, {args: 'warmth [mood]'});

    /* ---- and the character itself ----------------------------------------
     *
     * The thread §2.5 of the plan is about: what a player changes about a pill
     * is theirs, kept in their own directory beside what it remembers of them,
     * and layered over the words the game ships — which are never edited. This
     * is the door, and in an Electron build it is the only door there is.
     *
     * `persona_show` says which parts are overridden and how the character is
     * set; it never puts the words themselves in the console, which is a log
     * and does not carry what is said. /persona_set is where they are read.
     */
    const trouble = (what: string) => (e: unknown) =>
      hatch.say(`${what}: ${(e as Error)?.message || String(e)}`, 'error');

    command('persona_show', 'which of this character is yours, and what it is set to',
      () => (here.current ? describe(slug) : gone));

    command('persona_set', 'edit the words this character speaks in',
      () => { if (!here.current) return gone; openCharacter(slug, name()); });

    command('persona_reset', 'put this character back to the one the game ships',
      () => {
        if (!here.current) return gone;
        void ask(`Put ${name()} back?`,
                 'The words you wrote and anything you have tuned are deleted, and the '
                 + 'shipped character speaks from the next turn. Your conversations, what '
                 + 'it remembers about you and where you stand are not touched.',
                 'Reset')
          .then(async (yes) => {
            if (!yes) return;
            const had = await resetPersona(slug);
            await refreshPersona();
            hatch.say(had ? `${name()} is the shipped character again`
                          : `${name()} was already the shipped character`);
          })
          .catch(trouble('could not put that character back'));
        return '';
      });

    command('persona_tune', 'one number, or the voice, over what this character ships with',
      (rest) => {
        if (!here.current) return gone;
        const bits = (rest || '').trim().split(/\s+/).filter(Boolean);
        if (!bits.length) return tunedTo(slug);
        void tune(slug, bits[0] as string, bits.slice(1).join(' '))
          .then((said) => refreshPersona().then(() => hatch.say(`${name()}: ${said}`)))
          .catch(trouble('could not tune that'));
        return '';
      }, {args: '<key> <value>'});

    return () => { for (const name of mine) hatch.forget(name); };
  }, [slug, told]);

  // ---- the debug shelf -----------------------------------------------------
  useEffect(() => {
    expose('store', link);
    /* Not only for a test. The engine is hand-set JavaScript a module away
       from the shell, and it has one line to say when an animation throws —
       so it reads the console off the shelf rather than importing it. See
       room3d.js, where it was window.Hatch. */
    expose('hatch', hatch);
    expose('audio', {playback, capture, pacer, vad});
  }, [playback, capture, pacer, vad]);

  if (unknown) return <Navigate to="/talk" replace />;

  return (
    <>
      <Stage slug={slug} spec={roomOf} mount={build} fetch={arrive} glass={glass} under={panel}
             told={told} onRoom={onRoom} />

      <Glass ref={glass}>
        <Transcript
          turns={turns}
          personaName={s.persona_name || 'the pill'}
          visible={settled ? null : visible}
          pacing={!settled}
          unheard={unheard}
          heard={dots.heard}
          musing={dots.musing}
          onReplay={onReplay}
          replay={replaying}
          onDelete={onDelete}
          onUnheard={onUnheard}
        />
      </Glass>

      {/* The panel: the one thing every room shares. Only its colors change.
          What is left of it is a microphone, whether the pill keeps going, a
          line to type, and a way to send it — everything that used to sit
          along its top is in the console now. */}
      <div id="panel" ref={panel}>
        <div id="controls">
          <Banners
            nowhere={s.nowhere}
            adrift={s.adrift}
            said={s.adrift_said}
            waking={s.waking}
            onBack={() => navigate('/talk')}
          />
          <TapeDeck
            machine={machine}
            minutes={s.minutes}
            continuousMin={s.continuous_min}
            ear={vad}
            canBeHeard={canBeHeard()}
            onPress={press}
          >
            <TypeLine
              open={typing}
              disabled={s.nowhere || s.adrift}
              onSubmit={onSend}
              onEscape={() => showType(false)}
              onRestored={() => hatch.say('restored what you had typed')}
              limit="pill"
            />
          </TapeDeck>
        </div>
      </div>

      <ConfirmDialog />
      <Sheet />
    </>
  );
}
