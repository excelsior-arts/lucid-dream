/* The shapes: what the machine's routes answer with, and what the page says to
 * itself about a conversation.
 *
 * There is no protocol left. The websocket this file was written for is gone
 * with the Python that answered it -- the page runs the whole conversation, and
 * everything it needs of the machine is an address (see conversation/files.ts
 * and @lucid/machine). What is written down here is what survived that: the
 * shapes of the things those routes hand back, and the handful of messages the
 * page's own loop passes to its reducer.
 *
 * Those messages are kept as messages rather than folded into the store for two
 * reasons. `user`, `assistant_delta` and `assistant_done` are the transcript's
 * three rules about bubbles -- when one opens, when it grows, when it settles --
 * and they are worth having in one place with a test each. And the debug
 * shelf's `receive` hands one straight to the reducer, which is how every
 * picture in the simulated-state walk is taken (app/tests/browser/states.mjs).
 */

/** What the models are doing, one word each. Absent until a stack has run.
    The words are the machine's own -- see Stack.status in machine/machine.py,
    which is the one dict both `GET /machine` and the console's lamps read. */
export type ModelStatus = 'off' | 'starting' | 'loading' | 'ready' | 'error';

/** What this page's conversation is doing. */
export type TalkState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'stopped';

/** Whether the page is the microphone or only the keyboard. */
export type InputMode = 'mic' | 'type';

/** What the mic does when you leave the window. See /mic_follow. */
export type MicFollow = 'focus' | 'hidden' | 'never';

/** Whether the mic runs itself or waits for a key. See vad.ts in @lucid/audio. */
export type MicMode = 'hands_free' | 'push_to_talk';

/** The machine's standing order about talking over a reply. `auto` leaves it
    to what this page's microphone granted -- see bargeAllowed. */
export type MicBarge = 'auto' | 'on' | 'off';

/** How loud a log line is; the console colors by it. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** What the machine is costing, in GB. Measured on a thread; a few seconds
    old, which is what a number on a dial is allowed to be. */
export interface MemoryUse {
  llm_gb: number;
  app_gb: number;
  voice_gb: number;
  total_gb: number;
}

/** The last chunk the voice made: what it cost against what it produced. */
export interface TtsStats {
  gen_s?: number;
  audio_s?: number;
  /** Under 1 means sound came out faster than it plays. Null when too short. */
  rtf?: number | null;
  words?: number;
  mem_gb?: number;
}

/** Where the pill is holding you, in a word. Empty when relation is off, and
    made by the page: see standingCard in conversation/relation.ts. */
export interface Standing {
  word?: string;
  temper?: string;
  why?: string;
  cold?: boolean;
  warm?: boolean;
  /** Nothing has happened between you yet, so there is nothing to undo. */
  fresh?: boolean;
}

/** The three axes a relation is scored on. See conversation/relation.ts. */
export interface RelationState {
  warmth?: number;
  trust?: number;
  mood?: number;
}

/** One character, as conversation/bundle.ts reads it out of the package.
 *
 * The reader has an opinion about six keys and passes the rest through unread,
 * so everything else is optional here for the same reason it is optional
 * there: a character that says nothing about its colour is a character, not an
 * error, and a key invented tomorrow reaches whoever knows what it is for
 * without either end being edited. */
export interface PersonaCard {
  slug: string;
  draft: boolean;
  /** The character's own name -- the prompt's, never shown to a player. */
  name: string;
  /** What a player is handed: a colored pill in a box. */
  pill: string;
  /** Which voice on the machine's shelf it speaks in: its own name, unless its
      file says it borrows another character's. See GET /machine/voices. */
  voice: string;
  blurb?: string;
  place?: string;
  /** "r, g, b" -- the box is lit by these. */
  color?: string;
  figure?: string;
  temperature?: number | null;
  top_p?: number | null;
  prompt: string;
  [more: string]: unknown;
}

/** One conversation on disk, as the sessions listing offers it. */
export interface SessionCard {
  id: string;
  persona: string;
  persona_name: string;
  turns: number;
  /** When it was last spoken in, for reading. */
  when: string;
  /** And the same moment as seconds, for deciding: the one thing anybody
      decides from it is whether coming back to a room is the same sitting or
      a new one. See recentSession in conversation/room.ts. */
  at?: number;
  preview: string;
}

/** One pill's row on the sheet inside the lid. A record, not a score.
 *
 * `standing` is the state exactly as it is on disk, and nothing at all for a
 * pill nobody has taken. What word that comes out as is the page's -- the
 * arithmetic is in conversation/relation.ts and the machine has no opinion
 * about it. */
export interface LedgerPill {
  slug: string;
  name: string;
  color: string;
  doses: number;
  remembered: number;
  standing: unknown;
  last: string;
}

/** One shove, as it happened.
 *
 * `steps` is how many fixed simulation steps ran between the shove before
 * this one and this one — an integer off the world's own counter, never wall
 * time, which is a different number on every machine. Replaying the list
 * applies each shove after exactly that many steps, so what is opened is the
 * run somebody watched rather than a plausible reconstruction of it. */
export interface RoomShove {
  name: string;
  steps: number;
}

/** What hands have done in this conversation's room.
 *
 * A count per name — every lamp step, every time the door was tried, and how
 * many times each loose thing was pushed — plus, since `v` 2, the shoves in
 * the order they were made. The counts are what the room says its sentences
 * from; the order is what the physics is redone from. A save with no `v` and
 * no `shoves` is the older shape and still opens: the counts are redone in
 * the order the room's own file registered things in, and the file is written
 * back in the new shape the next time anything is saved. */
export interface RoomState {
  /** Which shape this is. 2 keeps the order; 1 or absent is counts only. */
  v?: number;
  /** Every shove in this room, in the order a hand made them. */
  shoves?: RoomShove[];
  [name: string]: number | RoomShove[] | undefined;
}

/** How the persona is set right now, and what the room is lit by. */
export interface RoomMood {
  temperature: number;
  top_p: number;
  warmth: number;
  /** Today's mood. Named `temper` here: `mood` was already taken. */
  temper: number;
}

/** Everything the room needs to build itself, and nothing it does not.
 *
 * `state` is what hands have done in this conversation. `mood` is what the
 * persona is set to *right now* -- which is deliberately not stored with the
 * state: reopening an old conversation at a different temperature is meant to
 * keep its history and grow it in a different hand. */
export interface RoomView {
  session: string;
  persona: string;
  state: RoomState;
  mood: RoomMood;
}

// ---- what the page's own loop says to its reducer --------------------------

/** Everything about the machine at once.
 *
 * Nothing sends this any more: the loop writes each of these as it goes, and
 * what the machine is doing is read from `GET /machine`. It is kept because it
 * is the one message that can put a page into any state at all in a single
 * move, which is exactly what the simulated-state walk needs of it. */
export interface Tick {
  type: 'tick';
  state: TalkState;
  status: Partial<Record<'llm' | 'stt' | 'tts', ModelStatus>>;
  tts: TtsStats;
  input_mode: InputMode;
  continuous: boolean;
  continuous_min: number;
  mic_barge: MicBarge;
  running: boolean;
  memory: MemoryUse;
  mic_follow: MicFollow;
  standing: Standing;
  persona: string;
  persona_name: string;
  session_id: string;
}

/** The conversation moved: idle, listening, thinking, speaking, stopped. */
export interface StateMsg {
  type: 'state';
  state: TalkState;
}

/** Something you said -- typed, spoken, or put into the room by hand. */
export interface UserMsg {
  type: 'user';
  text: string;
  /** How long the microphone heard, or 0 for anything not spoken. */
  seconds: number;
}

/** The next words of the reply being written. */
export interface AssistantDelta {
  type: 'assistant_delta';
  text: string;
}

/** The reply, whole, once it has stopped growing. */
export interface AssistantDone {
  type: 'assistant_done';
  text: string;
}

/** A line for the console, and for anything watching what was said about a
    turn -- see dots.ts, which takes its own marks down on one. */
export interface LogMsg {
  type: 'log';
  text: string;
  level?: LogLevel;
}

/** Where the pill is holding you now. Lands after a turn that had you in it,
    and is what the room is lit by. */
export interface RelationMsg {
  type: 'relation';
  slug: string;
  state: RelationState;
  text: string;
}

/** The tape started or stopped, and how many minutes are left on it. */
export interface ContinuousMsg {
  type: 'continuous';
  on: boolean;
  minutes: number;
}

/** Everything the reducer knows how to fold in. */
export type Inbound =
  | Tick
  | StateMsg
  | UserMsg
  | AssistantDelta
  | AssistantDone
  | LogMsg
  | RelationMsg
  | ContinuousMsg;

export type InboundType = Inbound['type'];
