/* The conversation this page has open, and what it took to open it.
 *
 * Ported from session.py `_open_session` and the state the session carried
 * between turns: the pill, the transcript, what it remembers of you, where you
 * stand, where the two of you are, and how far the memory has already been
 * folded. One at a time, because a page is in one room.
 *
 * The reason this is not inside turn.ts, where it started: the turn, the loop
 * and everything that happens after a turn all read this record, and each of
 * them importing another to reach it would be a circle drawn around one
 * object.
 */
import {openVoice, shelf} from '@lucid/machine';
import type {Voice} from '@lucid/machine';
import {hatch, host, onHost} from '@lucid/shell';
import type {PersonaCard, RoomMood, RoomState} from '../link/shapes';
import {prompts} from './bundle';
import {surface} from './surface';
import type {Character} from './character';
import {card, openCharacter, refresh, touch} from './character';
import type {GameConfig} from './config';
import {DEFAULTS, gameConfig} from './config';
import * as F from './files';
import {clearFloor, cutReply} from './floor';
import {canOpen, namedWell} from './named';
import type {Kept} from './prompt';
import {decayed} from './relation';

/** Everything a room needs, read once when it opens.
 *
 * A room is a character with a conversation round it: the persona, the
 * prompts, what it remembers and where you stand are the character's -- see
 * character.ts, which a walk in another game opens the same way -- and the
 * rest is the evening. */
export interface Open extends Character {
  sessionId: string;
  /** What this game is tuned to: when to fold, whether to score, how often to
      write the room down, and the window all three are measured against. */
  cfg: GameConfig;
  /** Where the two of you are, as the transcript last had it. */
  scene: string;
  /** How many turns ago that was worked out. Left at whatever the previous
      conversation had reached, a shorter one resumed after a longer one had
      "no turns since" forever, and quietly stopped noticing where it had got
      to for the rest of the evening. */
  sceneAt: number;
  /** Whether the scene is still a guess -- the room's own description of
      itself, or wherever the two of them were when this was last put down. */
  sceneNew: boolean;
  /** The conversation, line by line: the words, and what the model was shown
      for each where that differs (see Kept). Not the same list as the
      transcript on screen: the nudge never goes in here. */
  history: Kept[];
  /** How much of the history has already been folded into memory. Anything
      already outside the window was folded in an earlier run; don't fold it
      twice. */
  foldedUpto: number;
  /** The line count of the file, as this page last read it. Every append says
      which version it expects to follow. */
  version: number;
  /** Every line this page has written into it, by `mark`. What a refused
      append is read against: a line in the file that is not in here was put
      there by somebody else. */
  wrote: Set<string>;
  /** Where the context window was last cut, as an index into `history`.
   *
   * Kept so that it does not move: a window recut every turn moves the first
   * token of the prompt every turn, and the model server's cache -- which is
   * a bet on the prefix holding still -- matches nothing from the seventh turn
   * on. See `windowCut` in prompt.ts. -1 is "not cut yet". */
  windowFrom: number;
  /** Whether the prefix has been pushed through the model this sitting. */
  warmed?: boolean;
  voice: Voice;
  /** Text only, whatever the mute switch says: nothing this room answers
      goes to the voice. A game that wants its character read and not
      heard for a while sets this and clears it; the voice stays open. */
  silent?: boolean;
}

/* When this page last wrote into a conversation, kept where a reload can find
   it and another tab cannot -- which is exactly the difference `recentSession`
   has to draw. sessionStorage is per tab and survives a reload of it; a second
   tab starts with none, and so is told it was not the one writing. */
const WROTE = 'lucid.talk.wrote';

/** This page just wrote into that conversation.
 *
 * Said by `write`, and by the beacon a page sends on its way out -- which is
 * still this page writing, and has to be noted as such: without it a reload
 * mid-reply came back to a file written a second ago by somebody it could not
 * recognise as itself, and started a new conversation instead of picking the
 * old one up. See `recentSession`. */
export function lastWrote(id: string): void {
  try {
    sessionStorage.setItem(WROTE, JSON.stringify({id, at: Date.now() / 1000}));
  } catch { /* a browser with no storage: the check below simply says no */ }
}

function wroteLast(): {id: string; at: number} | null {
  try {
    const raw = sessionStorage.getItem(WROTE);
    if (!raw) return null;
    const got = JSON.parse(raw) as {id?: string; at?: number};
    return got.id && typeof got.at === 'number' ? {id: got.id, at: got.at} : null;
  } catch {
    return null;
  }
}

/** Somebody said something in it this recently and it was not this page: it is
    a conversation with somebody in it. Seconds rather than minutes, because
    what this is separating is two tabs opened together from one tab reloaded. */
const BUSY_S = 10;
/** How far apart the file's last moment and this page's own note of it may be
    and still be the same write. The store stamps the line; we stamp the answer. */
const SAME_WRITE_S = 2;

/** The address names a conversation this room cannot open.
 *
 * Thrown rather than answered with a fresh one, because the address bar is the
 * request: told "no such session" and quietly handed a different evening, a
 * page goes on asking after the conversation it was promised. What it gets
 * instead is the `gone` banner and the way back to the box. See ownership.ts,
 * where `nowhere` lives, and Room.tsx, which lets this one through without a
 * second line about it.
 */
export class Nowhere extends Error {}

let here: Open | null = null;
/** The open room's ear on what can speak, let go of with the room. */
let unheed: (() => void) | null = null;
/* One open at a time. The room asks on its way in and the first turn asks
   again, and without this the second ask -- landing while the first is still
   in flight -- would name a second conversation and speak into it. */
let opening: {slug: string; work: Promise<Open>} | null = null;

/** The room this page has open, for the loop, the turn and the debug shelf. */
export const opened = (): Open | null => here;

/** Leaving the room takes the voice with it. */
export function leaveRoom(): void {
  clearFloor();
  /* And whatever was being worked out about this room is worked out about a
     room nobody is in. `still` already stops most of it at the door; the count
     is what stops the rest, which is anything holding this record rather than
     asking which room is open. */
  touched(here);
  here?.voice.close();
  unheed?.();
  unheed = null;
  here = null;
}

/** A hand has changed what this room derives.
 *
 * Said by everything a person does to a value the model also writes -- a
 * standing reset or set by hand, a memory saved on the sheet, the room closing.
 * See `epoch`: the work in flight compares itself against this and drops what
 * it was going to write. */
export function touched(room: Open | null): void {
  touch(room);
}

/** Everything the room reads once, and the conversation it is reading it for.
 *
 * `want` is the conversation in the address. Without one a name is asked for
 * and nothing is written: the file appears when something is actually said.
 */
/** Open a character's room, on a conversation of its own or one named.
 *
 * `mine` is a page that made the name itself and knows it is this
 * character's -- a walk, whose conversation is named for the walk and not
 * for the narrator -- so the name is not checked against the slug. Without
 * it a name is opened only if this room could have made it. */
export async function openRoom(slug: string, want = '', o: {mine?: boolean} = {}): Promise<Open> {
  if (here && here.slug === slug && (!want || here.sessionId === want)) return here;
  if (opening && opening.slug === slug) {
    const already = await opening.work;
    if (!want || already.sessionId === want) return already;
  }
  const work = open(slug, want, !!o.mine);
  opening = {slug, work};
  try {
    return await work;
  } catch (e) {
    /* Overtaken: another pill was opened while this one was still reading.
       The one that was asked for last is the room, and this call is given
       it rather than an error -- the caller that asked has moved on and
       ignores the answer either way. */
    if (e instanceof Overtaken && opening && opening.work !== work) return opening.work;
    throw e;
  } finally {
    if (opening?.work === work) opening = null;
  }
}

/** An open that a newer open passed on the way: it must plant nothing. */
class Overtaken extends Error {}
/* Counted up on every open, so an open still reading can tell it has been
   passed. The route is one component for every pill, so lover → thinker is
   two opens in flight at once, and the slower used to land last: the page
   showing one pill was handed the other's transcript, session and voice. */
let opens = 0;

/** This pill's last conversation, if it is still the same sitting.
 *
 * Ported from session.py `_recent_session`. A dose is a dream and each one
 * starts new -- what carries between them is what the pill remembers about you
 * and how it holds you, neither of which lives in the transcript. But a reload,
 * a dropped socket or a phone locking itself in a pocket are not new dreams,
 * and losing the thread to any of them is a bug wearing a design's clothes.
 *
 * The window is minutes rather than hours, and deliberately shorter than the
 * machine's own idle stop: coming back to a room that has put itself away is a
 * new conversation, and quiet for longer than an interruption lasts is quiet
 * somebody chose.
 *
 * A machine that will not answer is a fresh conversation rather than no room
 * at all -- the same trade gameConfig makes, and for the same reason.
 */
export async function recentSession(slug: string, cfg: GameConfig): Promise<string> {
  const minutes = cfg.resume_within_minutes;
  if (!(minutes > 0)) return '';
  /* One conversation, which is one listing and one read: what is asked is
     whether the last thing said was said recently, and every evening before it
     is beside the point. */
  const [last] = await F.sessions(slug, 1).catch(() => []);
  // Newest first, and the listing leaves out anything nobody ever said
  // anything in -- a name handed out and abandoned is not somewhere to return
  // to. `at` is when it was last spoken in; without one there is nothing to
  // measure, and this is measured or it is not done.
  if (!last || !last.turns || typeof last.at !== 'number') return '';
  const quiet = Date.now() / 1000 - last.at;
  if (quiet > minutes * 60) return '';
  /* Somebody was speaking in it a moment ago, and it was not this page. Two
     tabs opened on the same pill both resumed it, and from then on every
     append of theirs cost the other one a refusal -- so the file held two
     conversations interleaved and neither page had the other's half. A page
     arriving into a conversation somebody is in gets one of its own instead.
     Its own reload does not: sessionStorage came with it, and says the last
     line in there is ours. */
  const ours = wroteLast();
  const mine = !!ours && ours.id === last.id && last.at - ours.at < SAME_WRITE_S;
  if (quiet < BUSY_S && !mine) {
    hatch.say(`${last.id} was written in ${Math.max(1, Math.round(quiet))}s ago `
      + 'by another page — starting a conversation of this one\'s own', 'warn');
    return '';
  }
  hatch.say(`picking up where you left off, ${ago(quiet)}`);
  return last.id;
}

/** "a minute ago", "12 minutes ago", "3 hours ago": how long it has been. */
function ago(seconds: number): string {
  const m = Math.max(1, Math.trunc(seconds / 60));
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.trunc(m / 60);
  if (h < 48) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  return `${Math.trunc(h / 24)} days ago`;
}

/** Whether this machine can speak in the voice this pill names.
 *
 * Asked on the way in and never waited for: a voice is a clip under
 * `models/voices/`, and a checkout whose pack never downloaded has a pill that
 * opens, thinks, writes its reply and then falls silent with an error a
 * sentence deep. This is the line that says so first, in the console, by name.
 */
async function speakable(
  persona: PersonaCard, asked: Promise<{voices: string[]} | null>,
): Promise<void> {
  // Nothing speaks on a page with no machine, and that is not news per pill.
  if (!host().voice) return;
  const voices = (await asked)?.voices;
  // None is the machine not answering, which the lamps say louder than this could.
  if (voices && !voices.includes(persona.voice)) {
    hatch.say(`${persona.pill} speaks in "${persona.voice}" and `
      + `${host().machine ? 'this machine' : 'this browser'} `
      + `has ${voices.length ? voices.join(', ') : 'no voices at all'} — `
      + `the words will arrive, the sound will not${host().machine ? '. See setup.sh' : ''}`, 'warn');
  }
}

async function open(slug: string, want: string, named = false): Promise<Open> {
  leaveRoom();
  const token = ++opens;
  const passed = () => token !== opens;
  /* The machine's shelf, asked for while everything else is read: which
     voices it has, for the line below, and which tags its voice performs,
     for the prompt. */
  const asked = shelf().catch(() => null);

  /* The pill: what the game ships with this player's own two files over it.
     The words ship in the bundle, so a room reloaded straight into its address
     has a character whatever the machine is doing; the override is two values
     in the store, and a machine that will not hand them over is the shipped
     character rather than no room at all. See conversation/persona.ts. */
  const cfg = await gameConfig();
  const who = await openCharacter(slug, {cfg});
  const {persona, memory} = who;
  if (passed()) throw new Overtaken(slug);
  void speakable(persona, asked);
  /* A machine that will not say is a voice that performs nothing, and the
     prompt asks for no tags: they would only be stripped. */
  const tags = (await asked)?.tags ?? [];

  /* Which conversation, ported from `_open_session` and `can_open`. Three ways
     in, and they are the three things an address can say:

     A name -- deep-linked from History, a bookmark, or a code scanned onto a
     phone -- is opened if this room could have made it, and refused otherwise.
     No name is the ordinary way in, and picks the sitting back up if there is
     one to pick up. Otherwise a fresh one, named and not yet written: the file
     appears when something is actually said, which is what keeps History clear
     of empty evenings.

     What is gone from the Python is the boot persona (`_adopt_boot_persona`).
     It existed because one Session held one pill for every window at once, so
     a Start pressed in a room had to say which pill it meant before the shared
     conversation opened underneath it. There is no shared session now: the
     pill is in this page's address and this room is the only thing reading
     it. */
  let sessionId = want;
  if (want && !(named ? namedWell(want) : canOpen(want, slug))) {
    hatch.say(`there is no conversation called ${want} — nothing was opened`, 'warn');
    surface().nowhere(true, slug);
    throw new Nowhere(`no such conversation: ${want}`);
  }
  if (!sessionId) sessionId = await recentSession(slug, cfg);
  const resumed = !!sessionId;
  if (!resumed) sessionId = (await F.newSession(slug)).id;
  if (passed()) throw new Overtaken(slug);

  let history: Kept[] = [];
  let scene = '';
  let version = 0;
  if (resumed) {
    /* Nothing at that name is not a failure: a conversation somebody opened
       and said nothing in has no file at all, and this is what coming back to
       one looks like from here. */
    const kept = await F.readSession(sessionId).catch(() => null);
    if (kept) {
      history = kept.turns.map(keptLine);
      scene = kept.scenes[kept.scenes.length - 1]?.text ?? '';
      version = kept.version;
    }
  }

  /* Where this begins, if nothing has said otherwise yet. The persona
     describes the room it is in (conversation/bundle.ts, `place`) and that becomes the
     scene's first value — a seed, not a fact. From the next scene update on it
     is the conversation's own, so two people who talk themselves into a
     dressing room are in a dressing room and the library stops existing. That
     is the whole of how a room is overruled: there is nothing to detect,
     because the room only ever got to say the first line. */
  if (!scene) scene = persona.place || '';

  if (passed()) throw new Overtaken(slug);
  here = {
    ...who,
    tags,
    sessionId,
    cfg,
    scene,
    /* Where the scene was last written, counted in this conversation's turns. */
    sceneAt: history.length,
    /* Whatever the scene says now is a guess — the room's description of
       itself, or where the two of them were the last time this was put down —
       and the first note of this sitting replaces it early. */
    sceneNew: true,
    history,
    foldedUpto: Math.max(0, history.length - windowOf(cfg)),
    version,
    wrote: new Set<string>(),
    windowFrom: -1,
    voice: openVoice({voice: persona.voice}),
  };

  /* What the tick would have said, said to the page that now knows it. A
     room running its own loop opens no socket at all, so nothing is coming
     down one about this conversation. Which page is the surface's business:
     see surface.ts. */
  surface().opened({
    slug,
    sessionId,
    personaName: persona.pill || persona.name || slug,
    scene,
    standing: card(here),
    memory: {text: memory, off: !cfg.memory.enabled},
    transcript: history.map(onGlass),
  });

  /* And the room itself, which is what a hand has already done in this
     conversation plus how the persona is set right now. The two are kept
     apart on purpose: reopening an old conversation at a different
     temperature keeps its history and grows it in a different hand. Last,
     the way the socket sent it, and after the transcript rather than before
     -- most of what a room is made of is the talk. See rooms.py. */
  const mine = here;
  /* The voice's tags, asked again whenever what can speak moves: a voice
     brought down onto a Mac, an engine chosen in a browser (each is down,
     then up again: page/voice.ts). Not per turn: nothing else changes them.
     The next turn's prompt then follows the voice that will speak it; see
     heardTags in turn.ts. */
  /* And the prompts, where the model in use turns out to be censored, or no
     longer is -- a size chosen on the models panel, or the first one brought
     down into a browser after the room opened: its system prompt is its own
     (bundle.ts `prompts`). */
  let censored = host().censored;
  /* And the game's config, where the context the words were loaded with moves
     under an open room -- a browser's long context that would not load, and
     came up short: the window a reply is sent follows it (config.ts
     `defaults`), so a short context is never sent the long window. */
  let context = host().context;
  unheed = onHost(() => {
    if (host().censored !== censored) {
      censored = host().censored;
      if (opened() === mine) mine.prompts = prompts();
    }
    if (host().context !== context) {
      context = host().context;
      void gameConfig().then((c) => { if (opened() === mine) mine.cfg = c; }, () => {});
    }
    void shelf().then((s) => { if (opened() === mine) mine.tags = s.tags; }, () => {});
  });
  void F.roomState(sessionId).then((state) => {
    if (opened() !== mine) return;      // the room moved on while we asked
    surface().room(() => ({session: sessionId, persona: slug, state, mood: mood(mine)}));
  }, () => {});
  return here;
}

/** How the persona is set right now, and what the room is lit by. From
    server.py `room_payload`: the effective temperature is the persona's own if
    it sets one, otherwise whatever this machine is tuned to. */
function mood(room: Open): RoomMood {
  const state = room.relation ? decayed(room.relation) : null;
  return {
    temperature: typeof room.persona.temperature === 'number'
      ? room.persona.temperature : room.cfg.llm.temperature,
    top_p: typeof room.persona.top_p === 'number'
      ? room.persona.top_p : room.cfg.llm.top_p,
    warmth: room.cfg.relation.enabled && state ? state.warmth : 0,
    temper: room.cfg.relation.enabled && state ? state.mood : 0,
  };
}

/** Take the character again, after somebody has changed it.
 *
 * The room reads its persona once on the way in, which is what keeps the
 * system prompt -- and with it the cached prefix -- the same bytes turn after
 * turn. So a set, a tune or a reset has to say so, and this is where it lands:
 * the cache in persona.ts is dropped, the two files are read again, and the
 * next turn assembles with what came back. Exactly one prefix change per edit,
 * which is one missed cache and about two seconds, once.
 *
 * The voice is the part that is not only text. The machine remembers which
 * clip a socket has loaded, so a changed name is a socket to close and open
 * again -- and the next reply is spoken in the new one.
 */
export async function refreshPersona(): Promise<void> {
  const room = here;
  if (!room) return;
  const was = await refresh(room);
  if (here !== room) return;           // the room moved on while we asked
  const fresh = room.persona;
  if (fresh.voice !== was.voice) {
    /* Cut first. Closing the socket ends its chunks cleanly, and a reply
       half-way through would take that as spoken to the end: the rest of it
       would go into the transcript unheard. Cut, it keeps what was heard. */
    cutReply();
    room.voice.close();
    room.voice = openVoice({voice: fresh.voice});
    void speakable(fresh, shelf().catch(() => null));
  }
  // And the lamp on the deck, which is lit by how the persona is set.
  surface().room((now) => (now ? {...now, mood: mood(room)} : now));
}

/** How many messages the window holds -- pairs, counted as messages. */
export const windowOf = (cfg: GameConfig = DEFAULTS): number =>
  Math.max(0, Math.trunc(cfg.llm.context_turns)) * 2;

/** One line, as this page believes the file stands.
 *
 * `kind|role|text`, which is what tells a line this page wrote from a line it
 * did not. Not a hash and not the timestamp: two pages writing the same words
 * into one conversation is indistinguishable at any resolution, and the moment
 * is the machine's rather than ours. */
const mark = (l: F.Row | NonNullable<F.Line>): string => {
  const it = l as {kind?: string; role?: string; content?: string; text?: string;
                   persona?: string; persona_name?: string};
  /* The header has no words, so two pages opening one conversation in the
     same second wrote the same mark for it -- and the second read the
     first's header as its own lost append and carried on writing. Its
     persona is in the mark now; two tabs on one pill still share it, and
     that hole is the name's, not this line's. */
  return `${it.kind ?? ''}|${it.role ?? ''}|${(it.content ?? it.text ?? '').trim()}`
    + `|${it.persona ?? ''}|${it.persona_name ?? ''}`;
};

/** What became of a line handed to `write`: it is on disk, or the conversation
    is not this page's any more and nothing is. There is no third answer --
    anything else that can go wrong throws. */
export type Wrote = 'written' | 'nowhere';

/** Add one line to the conversation on disk, following the version this page
 *  believes it is at.
 *
 * A refusal means the file has grown since this page last read it, and there
 * are only two things that can be: a line of this page's own that landed
 * despite the answer going missing, or another page writing into the same
 * conversation.
 *
 * They are told apart by reading the file, and they have to be. The retry that
 * used to happen here adopted the count and wrote anyway -- so two tabs
 * alternating got exactly one refusal each and then succeeded, every time. The
 * file interleaved both conversations, each page's own history held only half
 * of it, and nothing anywhere said so: the banner needed two refusals in a row
 * and never saw them.
 *
 * So a stranger's line in the file ends this page's claim on the conversation
 * (see §2.3 of the plan: the machine queues, the files check versions, and
 * nothing else is locked). That is the `nowhere` banner, and the honest thing
 * to show somebody whose next line would land in a transcript that has moved
 * on without them.
 *
 * And it answers which of the two happened, because losing the conversation is
 * not an error and does not throw: a caller with more to do behind the line --
 * the turn, which asks the model next and has an answer to keep afterwards --
 * would otherwise carry on into work whose result has nowhere to go.
 */
export async function write(room: Open, row: F.Row): Promise<Wrote> {
  /* The header a transcript opens with, owed at the first line rather than
     when the name was handed out: a conversation nobody has said anything in
     has no file, which is what keeps History clear of empty evenings. The
     machine used to write it for us on the first append and has no idea whose
     a conversation is any more -- so it is written here, by the end that
     knows. */
  if (room.version === 0 && row.kind !== 'meta') {
    /* And a header that did not land takes the line with it. The header's own
       refusal is this conversation being somebody else's from its first line,
       and appending behind it wrote the turn into a file this page had just
       been told it does not own -- with the banner up over a line that went
       in anyway. */
    const game = surface().game();
    if (await write(room, {kind: 'meta', persona: room.slug,
                           persona_name: room.persona.pill || room.persona.name,
                           ...(game ? {game} : {})})
        !== 'written') return 'nowhere';
  }
  /* Where it was said, when the page has somewhere to say: a walk puts its
     step and its region on every turn, and a room puts nothing. The mark is
     the words, so a line is this page's whatever else rides on it. */
  const where = row.kind === 'turn' ? surface().where() : null;
  const line: F.Row = where ? {...row, ...where} : row;
  room.wrote.add(mark(row));
  let out = await F.append(room.sessionId, line, room.version);
  if (out.stale) {
    /* What is in there that this page did not put there. Read rather than
       assumed: the count alone cannot tell a stranger's line from one of
       ours. */
    const now = await F.lines(room.sessionId).catch(() => null);
    const strangers = (now?.lines ?? []).slice(room.version)
      .filter((l): l is NonNullable<F.Line> => !!l && !room.wrote.has(mark(l)));
    if (!now || strangers.length) {
      hatch.say(`${room.sessionId} has ${strangers.length || 'lines'} `
        + 'this page did not write — it is somebody else\'s conversation now, '
        + 'and nothing more will be written into it from here', 'warn');
      surface().nowhere(true);
      return 'nowhere';
    }
    // Ours after all: an append that landed with its answer lost. Follow the
    // count it actually is and write the line once.
    room.version = now.version;
    out = await F.append(room.sessionId, line, room.version);
  }
  room.version = out.version;
  if (!out.stale) {
    lastWrote(room.sessionId);
    return 'written';
  }
  // In the console rather than only in the banner: the banner says what is
  // wrong with the page, and this says which conversation and where it got to.
  hatch.say(`${room.sessionId} moved on without this page — `
    + `it is at ${out.version} now`, 'warn');
  surface().nowhere(true);
  return 'nowhere';
}

/** Read the conversation again, and stand this page on what is in the file.
 *
 * The one thing a page does that is neither a write nor an open: taking a turn
 * back out reads the file, finds a position and asks for that position to go,
 * and the store can refuse -- the file moved between the two requests, so the
 * position no longer names the line somebody meant. Nothing is spliced then;
 * this page is simply looking at a transcript that is out of date, and the
 * honest answer is to look again.
 *
 * The window is dropped because every index past the change has moved, and the
 * fold mark is only pulled back if the file is shorter than it: it counts
 * turns already folded into memory, and moving it forward would fold them
 * twice.
 */
/** One line of a transcript as the room keeps it, `sent` and all. */
const keptLine = (t: F.Transcript['turns'][number]): Kept => ({
  role: t.role === 'user' ? 'user' : 'assistant', content: t.content,
  ...(t.sent ? {sent: t.sent} : {}),
  ...(t.cut ? {cut: true} : {}),
});

/** One line of the conversation as the glass shows it: a reply that broke
    off says so when read back, as it did when it broke. */
const onGlass = (m: Kept) => ({role: m.role as 'user' | 'assistant', text: m.content,
                               ...(m.cut ? {cut: true} : {})});

export async function reread(room: Open): Promise<void> {
  const kept = await F.readSession(room.sessionId).catch(() => null);
  if (!kept) return;
  room.history = kept.turns.map(keptLine);
  room.version = kept.version;
  room.scene = kept.scenes[kept.scenes.length - 1]?.text ?? room.scene;
  room.foldedUpto = Math.min(room.foldedUpto, room.history.length);
  room.windowFrom = -1;
  if (opened() !== room) return;       // the room moved on while we read
  surface().scene(room.scene);
  surface().transcriptIs(room.history.map(onGlass));
}

/** Begin a fresh conversation with this pill.
 *
 * What `clear` was: a name and an empty transcript, and the room seeded again
 * from the persona's own description of where it stands. `fresh` is the
 * difference between "carry on" and "start again", and it has to be asked for
 * — asking for a new conversation and quietly being handed the old one leaves
 * somebody looking at a transcript they had just asked to be done with.
 */
export async function freshSession(): Promise<Open> {
  const room = here;
  if (!room) throw new Error('there is no room to start again in');
  const {id} = await F.newSession(room.slug);
  return openRoom(room.slug, id);
}

/** What hands have done in this conversation's room. Stored under the
    conversation, so reopening it stands in the room it left. */
export const loadRoomState = (): Promise<RoomState> =>
  here ? F.roomState(here.sessionId) : Promise.resolve({});

/* The store as well as the file. The page hands the room its state again
   whenever the room's record changes -- and it changes after every scored
   turn, when the mood lands. A record that still carried the state the room
   was opened with put every lamp and book back to how they were then, two
   turns after a hand had moved them, while the file on disk said otherwise;
   the room only ever looked right again after a reload. */
export async function saveRoomState(state: RoomState): Promise<RoomState> {
  const room = here;
  if (!room) return {};
  const saved = await F.saveRoomState(room.sessionId, state);
  /* Painted onto the record only if this is still that room: a save in
     flight across a switch to another conversation used to put one
     evening's furniture onto the next one's page. */
  if (opened() !== room) return saved;
  surface().room((now) => (now && now.session === room.sessionId ? {...now, state: saved} : now));
  return saved;
}

/** Put the room back to nothing without touching the conversation.
 *
 * An evening of pushing things about, undone: books back up the spiral,
 * cushions back onto the bed. The conversation is most of what a room is made
 * of and is left exactly as it was, so what this clears is only what a hand
 * did — which is the point, since the reason to reach for it is a redesign
 * that has made an old save absurd.
 *
 * The store is told as well as the file, because a room that was only cleared
 * on disk goes on showing every book you have ever shoved until the page is
 * reloaded — and the one person who found the command had no reason to
 * believe it had worked.
 */
export async function forgetRoomState(): Promise<void> {
  if (!here) return;
  const state = await F.forgetRoomState(here.sessionId);
  surface().room((now) => (now ? {...now, state} : now));
}
