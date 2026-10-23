/* The page, as the conversation engine sees it.
 *
 * The engine -- the room, the turn, the loop, the floor, what comes after a
 * turn -- used to write straight into this game's store: a bubble opening, the
 * state of the voice, the banner, the tape, where you stand. That is fine for
 * a room, and it is the one thing that stopped a walk in another game from
 * being run by the same engine: a walk has a pane and a deck of its own, and
 * its own store with its own words in it.
 *
 * So everything the engine tells a page goes through this one object, and a
 * page says which object that is. Talk's own binding is the default, written
 * below and attached until something else is: its Room page needs no line to
 * say so, and every test of the engine goes on reading the store it always
 * read. A page that is not Talk's attaches a surface of its own on the way
 * in and the quiet one on the way out. See `attach`.
 *
 * What is *not* here is anything the engine reads about a conversation --
 * the persona, the memory, the session -- because none of that is the
 * page's. And nothing that is said goes through here in any form a log could
 * keep: a surface is handed the words to draw, and the log rule is the
 * caller's to keep, as it always was.
 */
import type {RoomView} from '../link/shapes';
import {apply as applyMsg} from '../link/reduce';
import {link} from '../link/store';
import type {LinkState, Waking} from '../link/store';

type StandingCard = LinkState['standing'];

/** A bubble opening, growing, and settling. The same three rules the
    transcript reducer has, said by the turn. */
export type Said =
  | {type: 'user'; text: string; seconds: number}
  | {type: 'assistant_delta'; text: string}
  | {type: 'assistant_done'; text: string; cut?: boolean};

/** What a page is told when a room opens. */
export interface Opened {
  slug: string;
  sessionId: string;
  personaName: string;
  scene: string;
  standing: StandingCard;
  memory: {text: string; off: boolean};
  transcript: Array<{role: 'user' | 'assistant'; text: string; cut?: boolean}>;
}

export interface Surface {
  /** A room is open: who, which conversation, and everything it read. */
  opened(o: Opened): void;
  /** The transcript, one move at a time; and whole, after a re-read. */
  transcript(m: Said): void;
  transcriptIs(turns: Array<{role: 'user' | 'assistant'; text: string; cut?: boolean}>): void;
  /** The voice on the floor. `stateIs` is asked by the floor when it settles
      the state off the queue rather than trusting it. */
  state(s: 'idle' | 'thinking' | 'speaking'): void;
  stateIs(): string;
  /** The machine is not answering, or is again. On, the state goes idle
      with it: nothing is being thought. `said` is why, in the page's own
      words, where it has some (a Told); the banner's own otherwise. */
  adrift(on: boolean, said?: string): void;
  /** The pill stopped answering part-way and is being woken ('waking'), a
      line waits on it ('line'), or it answered again (''). Quiet: nothing
      is locked, and the state is left as it is. */
  waking(w: Waking): void;
  isWaking(): Waking;
  /** This conversation is not this page's any more -- or is, again, when a
      room opens. `slug` names whose it was when the address was refused. */
  nowhere(on: boolean, slug?: string): void;
  isNowhere(): boolean;
  /** The tape: whether a run is on, and minutes left. */
  tape(on: boolean, minutes: number): void;
  scene(text: string): void;
  remembered(r: {slug: string; text: string; off: boolean}): void;
  rememberedOff(): boolean;
  /** A standing that moved: the numbers, the sentence, and the card. */
  standing(o: {slug: string; state: {warmth: number; trust: number; mood: number};
               text: string; card: StandingCard}): void;
  standingCleared(slug: string): void;
  /** Whose page this is, by slug -- what a sheet open on another pill's
      memory is measured against. */
  slug(): string;
  /** The room's lamp: what hands did and how the persona is set. A page
      with no room to light ignores it. */
  room(update: (now: RoomView | null) => RoomView | null): void;
  /** Where a line is being said, for the file: a walk says a step and a
      region, a room says nothing. Put on every turn written. */
  where(): {step?: number; region?: string} | null;
  /** Whose evening a conversation is when it is not a room's, for the
      header of its file: a walk says its game, a room says nothing. */
  game(): string | null;
  /** The lane a model call goes down. A room runs it straight; a walk has
      a lane of its own with the narrator's speech ahead of the ground being
      drawn, and runs it there. Nothing back means the lane declined it. */
  run<T>(priority: 'speech' | 'background', job: (signal: AbortSignal) => Promise<T>,
         label: string): Promise<T | undefined>;
}

const straight = <T,>(_p: 'speech' | 'background', job: (signal: AbortSignal) => Promise<T>) =>
  job(new AbortController().signal);

/* ---- Talk's own ------------------------------------------------------------ */

/** The page this game has: its store, and the reducer the transcript has
    always gone through. */
export const talk: Surface = {
  opened(o) {
    link.setState({
      slug: o.slug,
      sid: o.sessionId,
      session_id: o.sessionId,
      persona: o.slug,
      persona_name: o.personaName,
      scene: o.scene,
      running: true,
      state: 'idle',
      adrift: false,
      adrift_said: '',
      waking: '',
      /* And whatever was wrong with the last address is not wrong with this
         one: a room that opens is a room that is there. */
      nowhere: false,
      /* And the tape, which is the page's own now: a room is opened with no
         run on it, whatever the last one was doing. */
      continuous: false,
      continuous_min: 0,
      standing: o.standing,
      remembered: {slug: o.slug, text: o.memory.text, off: o.memory.off},
      transcript: o.transcript,
      /* And the two records that belong to a conversation rather than to a
         page. They arrive a request later, and until they do, whatever is
         here is the last conversation's. */
      room: null,
      relation: null,
    });
  },
  transcript(m) { link.setState(applyMsg(link.getState(), m)); },
  transcriptIs(turns) { link.setState({transcript: turns}); },
  state(s) { link.setState({state: s}); },
  stateIs() { return link.getState().state; },
  adrift(on, said = '') {
    link.setState(on ? {adrift: true, adrift_said: said, state: 'idle'} : {adrift: false, adrift_said: ''});
  },
  waking(w) { if (link.getState().waking !== w) link.setState({waking: w}); },
  isWaking() { return link.getState().waking; },
  nowhere(on, slug) { link.setState(slug ? {nowhere: on, slug} : {nowhere: on}); },
  isNowhere() { return link.getState().nowhere; },
  tape(on, minutes) { link.setState({continuous: on, continuous_min: minutes}); },
  scene(text) { link.setState({scene: text}); },
  remembered(r) { link.setState({remembered: r}); },
  rememberedOff() { return link.getState().remembered?.off ?? false; },
  standing(o) {
    link.setState(applyMsg(link.getState(), {type: 'relation', slug: o.slug, state: o.state, text: o.text}));
    link.setState({standing: o.card});
  },
  standingCleared() { link.setState({standing: {}, relation: null}); },
  slug() { return link.getState().slug; },
  room(update) {
    const now = update(link.getState().room);
    if (now !== link.getState().room) link.setState({room: now});
  },
  where() { return null; },
  game() { return null; },
  run: straight,
};

/* ---- and nobody's --------------------------------------------------------- */

/** A surface that draws nothing: what a page attaches on its way out, and
    what another game's page builds its own on. */
export const quiet: Surface = {
  opened() {},
  transcript() {},
  transcriptIs() {},
  state() {},
  stateIs() { return 'idle'; },
  adrift() {},
  waking() {},
  isWaking() { return ''; },
  nowhere() {},
  isNowhere() { return false; },
  tape() {},
  scene() {},
  remembered() {},
  rememberedOff() { return false; },
  standing() {},
  standingCleared() {},
  slug() { return ''; },
  room() {},
  where() { return null; },
  game() { return null; },
  run: straight,
};

let here: Surface = talk;

/** The page the engine is talking to. */
export const surface = (): Surface => here;

/** Say which page this is. `null` puts Talk's own back. One at a time, the
    way there is one room at a time: a page attaches on the way in and
    detaches on the way out. */
export function attach(s: Surface | null): void {
  here = s ?? talk;
}

/** Put Talk's own back, if this is still the page that was attached. A page
    on its way out may be torn down after the next one has already opened
    -- a walk left for another walk, whose fold takes a moment -- and an
    unconditional put-back would take the new page's surface away from
    under it: every line then went to Talk's store and none to the pane. */
export function detach(s: Surface): void {
  if (here === s) here = talk;
}
