/* What the eight keys mean right now.
 *
 * This is paintPlay(), lockDeck() and the two lines of paintCounter() that
 * touched a key, with the DOM taken out of them. They were three painters
 * writing to the same elements and the order they ran in was load-bearing:
 * lockDeck had to run *last*, because everything above it says what a key
 * would mean if this page held the machine and it says whether it does. As
 * one function of one state that ordering is the last two lines instead of a
 * convention nobody can see.
 */
import type {InputMode, TalkState} from '../../link/shapes';

export type KeyId = 'back' | 'play' | 'pause' | 'stop' | 'skip' | 'rec' | 'type' | 'eject';

/** Everything a key reads. Nothing here is the deck's own; it is all
    somewhere else — the store, the playback, this page's own preference. */
export interface Machine {
  state: TalkState;
  running: boolean;
  continuous: boolean;
  inputMode: InputMode;
  /** There is no conversation to press anything into. */
  nowhere: boolean;
  adrift: boolean;
  /** Anything still to be heard: the chunk playing plus what is behind it. */
  sounding: boolean;
  /** The sound is paused where it is. */
  held: boolean;
  /** Something has been said, and by you: the first word on a tape is always
      the one somebody recorded. */
  seeded: boolean;
  /** There is a line of the pill's to say again. */
  lastSaid: boolean;
  /** This page's microphone is actually capturing. */
  captureOn: boolean;
  /** And the recognizer is still coming up under a press that has already
      happened. The device is open in this stretch — what is not there yet is
      the model that turns what it hears into words. See routes/room/audio.ts. */
  micWarming: boolean;
  /** The line to write in is open. */
  typing: boolean;
  /** Nothing here can write the pill's words: a browser that cannot run a
      model, stepped into to look around (the 'pill' limit). */
  noWords?: boolean;
}

export interface Key {
  disabled: boolean;
  /** Pressed, and staying down while what it started is happening. */
  down: boolean;
  /** Lit green: the tape is running. */
  playing: boolean;
  /** A record key that is live. */
  armed: boolean;
  /** Pressed, and waiting on something it started. */
  busy?: boolean;
  label: string;
  title: string;
  /** A switch rather than a button, to a screen reader and to the ear both. */
  pressed?: boolean;
}

export type Deck = Record<KeyId, Key>;

const NO_WORDS = 'this browser can’t run the pill';

const SAY_FIRST = 'say something first — a tape has to be recorded before it plays';

/** A reply is happening, gaps and all. */
export function talking(m: Machine): boolean {
  return m.state === 'speaking' || m.state === 'thinking';
}

export function deck(m: Machine): Deck {
  /* Anything still to be heard, including the gaps. A reply is a run of
     chunks with silence between them, and for a moment at each join nothing
     is playing — which used to turn Pause back into Play mid-sentence, so a
     press in the wrong twentieth of a second started a run instead of
     stopping one. That is the "press it three times" of it. */
  const voice = m.sounding || talking(m);
  /* The microphone is a machine that is on, not a key that is lit: the key is
     armed when frames are actually arriving, which is this page capturing
     into a machine that is running. The label follows what the server was
     told instead, so a mic that is opening still reads as Talking.
     And not while the recognizer is still coming: the device is open in that
     stretch and what it hears is answered late, so a key that said "listening"
     would be claiming something it cannot do yet. It says it is working, which
     is the truth, and arms the moment the ear is there. */
  const live = m.running && m.inputMode === 'mic' && m.captureOn && !m.micWarming;
  const mic = m.inputMode === 'mic';

  const keys: Deck = {
    /* Again lives on the counter's paint, not the deck's, because what it
       says again is the last bubble on the glass. */
    back: {
      disabled: !m.lastSaid,
      down: false, playing: false, armed: false,
      label: 'Again',
      title: 'say the last line again — useful when a cough cut it off',
    },
    /* Play says one thing: whether the tape is running. It stays down while
       it is, the way a Play key on a cassette player does, and pressing it
       again lets it up. A blank tape cannot be played. */
    play: {
      disabled: !m.seeded,
      down: m.continuous,
      playing: m.continuous,
      armed: false,
      label: 'Play',
      title: !m.seeded ? SAY_FIRST
        : m.continuous ? 'let the tape go — it stops after this line'
        : 'play: it takes a turn now and carries on until the tape runs out',
    },
    /* And Pause says the other thing: whether the sound is moving. It means
       nothing when there is no sound to hold, so it is dark then rather than
       lit and inert. */
    pause: {
      disabled: !(voice || m.held),
      down: m.held,
      playing: false, armed: false,
      label: m.held ? 'Resume' : 'Pause',
      title: m.held ? 'pick it up where you paused it'
                    : 'hold the sound where it is — the tape waits for you',
    },
    // Stop means something only while there is something to cut.
    stop: {
      disabled: !(talking(m) || m.continuous || voice || m.held),
      down: false, playing: false, armed: false,
      label: 'Stop',
      title: 'cut it off and end the run',
    },
    /* Skip is two things wearing one key, and they are the same thing: with a
       voice going it cuts this line and takes the next, and with nothing
       going it takes the next. So it is lit whenever there is a next to take
       — which needs the tape to have been started, exactly as Play does. */
    skip: {
      disabled: !(voice || m.held || m.seeded),
      down: false, playing: false, armed: false,
      label: 'Skip',
      title: voice || m.held ? 'enough of this one — on to the next'
        : m.seeded ? 'let it take another turn, without typing anything'
        : SAY_FIRST,
    },
    /* Talk is three things and not two, because the recognizer is not there
       until somebody asks for it: off, working, and armed. The middle one is
       the fifteen seconds a cold ear takes to load, and a key that sat silent
       through them read as a key that had not registered the press. It is not
       disabled while it works: pressing it again is how somebody changes
       their mind, and that has to keep working. */
    rec: {
      disabled: false,
      down: false, playing: false,
      armed: live,
      busy: m.micWarming,
      pressed: mic,
      label: mic ? 'Talking' : 'Talk',
      title: m.micWarming ? 'warming the recognizer — it arms when it can hear you'
        : live ? 'listening — press to stop'
        : 'talk to it — the mic listens until you press it again',
    },
    type: {
      disabled: false,
      down: false, playing: false,
      armed: m.typing,
      pressed: m.typing,
      label: m.typing ? 'Typing' : 'Type',
      title: m.typing ? 'put the line away'
        : 'write instead — return sends it, shift-return is a new line',
    },
    // Leaving is this page's own business and works from anywhere.
    eject: {
      disabled: false,
      down: false, playing: false, armed: false,
      label: 'Eject',
      title: 'close the room and go back to the box',
    },
  };

  /* Nothing on the deck means anything from a window that has lost the
     machine. Left lit they are a row of keys that do nothing — or worse, that
     do something in the room next door: Play started a run in somebody else's
     conversation, and a line typed here arrived in it. The banner above them
     is already saying why, so the keys only have to stop pretending.
     Applied last, because the keys that have reasons of their own to be dark
     get those reasons worked out above. Eject is in none of these lists: it
     is the one key that still means something, and a room with no working key
     at all is a room somebody has to close the tab to leave. */
  const dark = (ids: KeyId[]) => { for (const id of ids) keys[id].disabled = true; };
  /* A room with no pill in it, looked around: the keys that would ask it
     for a turn are dark and say why, and the line is always open, marked,
     its key the way to the note (see Room.tsx). Eject still leaves. */
  if (m.noWords) {
    for (const id of ['back', 'play', 'skip', 'rec'] as const) keys[id].title = NO_WORDS;
    dark(['back', 'play', 'skip', 'rec']);
    keys.type = {...keys.type, armed: true, pressed: true, label: 'Typing',
                 title: 'this browser can’t run the pill — press to see why'};
  }
  if (m.nowhere) dark(['play', 'pause', 'stop', 'skip', 'back', 'rec', 'type']);
  // Everything the machine has to answer. Pause is not in this list: the
  // sound it holds is already in this browser.
  else if (m.adrift) dark(['play', 'stop', 'skip', 'back', 'rec', 'type']);
  return keys;
}

/** The line to write in goes with the two record keys. */
export function lineDisabled(m: Machine): boolean {
  return m.nowhere || m.adrift;
}

/* The waiting pulse, and the whole of when it is allowed to play.
 *
 * It answers exactly one question — does the sound work at all — and that
 * question is asked once, by somebody who has never heard this voice and is
 * watching words scroll past in silence. `heardAnything` is false until this
 * page has played something. After that it is the same sound at the same
 * interval with nothing left to explain, ticking under a conversation. */
export function waiting(m: Machine, heardAnything: boolean): boolean {
  return !heardAnything && talking(m) && !m.sounding && !m.held;
}
