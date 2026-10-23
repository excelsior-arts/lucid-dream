import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import type {
  InputMode,
  LedgerPill,
  LogMsg,
  MemoryUse,
  MicBarge,
  MicFollow,
  ModelStatus,
  PersonaCard,
  RelationMsg,
  RoomView,
  SessionCard,
  Standing,
  TalkState,
} from './shapes';

/** One bubble. `text` is what was said; the rest is how it is being shown. */
export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** How long the microphone heard, or 0 for anything not spoken. */
  seconds?: number;
  /** Still being written: the caret blinks under it. */
  streaming?: boolean;
  /** Its voice never played -- interrupted, or the page was not listening. */
  unheard?: boolean;
  /** It broke off part-way -- the GPU let go, the stream dropped -- and says
      so at its end. Finished all the same: no caret. */
  cut?: boolean;
}

/** Whether the pill is being woken, and whether a line waits on it. */
export type Waking = '' | 'waking' | 'line';

export interface LinkState {
  // ---- the socket
  connected: boolean;
  /** The delay of the reconnect that is pending, in ms; 0 when none is. */
  retry: number;

  // ---- whose conversation this is
  /** The pill this page came for, off its address. */
  slug: string;
  /** And which of its conversations, once we know the name. */
  sid: string;
  /** There is no conversation by the name in our address -- or the one we are
      in has moved on without us. The machine is shared and conversations are
      not, so these two are all that is left of what can be wrong with a page:
      the claim, and the window that had taken it, went with the wire. */
  nowhere: boolean;
  /** Nothing on the other end of the machine. */
  adrift: boolean;
  /** Why, where the page has its own words for it (Told, in @lucid/machine):
      the GPU in this browser letting go of the pill, the pill stalling. ''
      for the banner's own. */
  adrift_said: string;
  /** The pill stopped answering part-way -- it stalled, the GPU let go of
      it, the stream dropped -- and is being woken: said quietly over the
      deck, not as a banner, and nothing is locked. `line` is a line given
      meanwhile, answered once it is up. Gone with the next reply's first
      word. '' when it is answering. */
  waking: Waking;

  // ---- what this page's conversation is doing
  //
  // A tick carried all of it, five times a second, from the one conversation
  // Python held. The loop is the page's and so is every one of these: written
  // by the loop and by what comes after a turn, and read by the deck.
  state: TalkState;
  running: boolean;
  input_mode: InputMode;
  continuous: boolean;
  continuous_min: number;
  persona: string;
  persona_name: string;
  session_id: string;
  standing: Standing;

  // ---- and what the machine is doing, from GET /machine
  //
  // Not the page's to know: which of three models are loaded, what they cost,
  // and the two standing orders about the microphone. Polled while a room is
  // open rather than pushed, because none of it changes on the timescale a
  // tick was written for.
  status: Partial<Record<'llm' | 'stt' | 'tts', ModelStatus>>;
  /** What the machine is costing, in GB. */
  memory: MemoryUse;
  /** What the mic does when you leave the window. See /mic_follow. */
  mic_follow: MicFollow;
  /** Whether talking over the pill stops it, as the machine has been told.
      What the microphone granted is the page's own — see vad.ts in @lucid/audio. */
  mic_barge: MicBarge;

  // ---- what the sheets and the room read, over HTTP
  /** How long a dose lasts, off the game's config. */
  minutes: number;
  ledger: {doses: number; pills: LedgerPill[]} | null;
  personas: PersonaCard[];
  sessions: SessionCard[];
  /** What a pill remembers, off its memory bag. Named apart from `memory`
      above, which is RAM: the machine gives both the same word. */
  remembered: {slug: string; text: string; off: boolean} | null;
  relation: Pick<RelationMsg, 'slug' | 'state' | 'text'> | null;
  room: RoomView | null;
  /** Where the two of you are, in a sentence. Nothing draws it yet. */
  scene: string;

  // ---- the conversation
  transcript: Turn[];
}

export const EMPTY: LinkState = {
  connected: false,
  retry: 0,
  slug: '',
  sid: '',
  nowhere: false,
  adrift: false,
  adrift_said: '',
  waking: '',
  state: 'stopped',
  running: false,
  input_mode: 'type',
  continuous: false,
  continuous_min: 0,
  mic_follow: 'hidden',
  mic_barge: 'auto',
  persona: '',
  persona_name: '',
  session_id: '',
  status: {},
  memory: {llm_gb: 0, app_gb: 0, voice_gb: 0, total_gb: 0},
  standing: {},
  minutes: 15,
  ledger: null,
  personas: [],
  sessions: [],
  remembered: null,
  relation: null,
  room: null,
  scene: '',
  transcript: [],
};

/* Vanilla, so the socket client and the 3D engine can read and write it from
   outside React -- neither of them is a component, and neither should have to
   pretend to be one to reach the conversation. */
export const link = createStore<LinkState>()(() => ({...EMPTY}));

/** For components. `useLink(s => s.running)` and nothing else re-renders. */
export function useLink<T>(select: (s: LinkState) => T): T {
  return useStore(link, select);
}

/* The console does not belong in a store: a line happens once, and keeping the
   last one as a field means a re-render can say it twice. It is handed straight
   to whoever asked for it. */
type Listener<T> = (msg: T) => void;

function emitter<T>() {
  const ears = new Set<Listener<T>>();
  return {
    on(fn: Listener<T>) {
      ears.add(fn);
      return () => {
        ears.delete(fn);
      };
    },
    say(msg: T) {
      for (const fn of [...ears]) fn(msg);
    },
  };
}

const logged = emitter<LogMsg>();

/** What the loop said about a turn, for anything that has to follow it rather
    than read it: the dots under a bubble go down on "no usable speech" the
    same way they go down on the words arriving. The console has already been
    told (see `say` in routes/room/audio.ts), so nothing here echoes it back. */
export const onLog = logged.on;
export const sayLog = logged.say;
