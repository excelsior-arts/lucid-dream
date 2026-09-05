/* One turn, run by the page.
 *
 * What Python's Session did between somebody speaking and the pill answering:
 * take the floor, work out what the model should be shown, get the words, speak
 * them, and write both halves down. The pieces are all elsewhere -- room.ts
 * holds the conversation, prompt.ts assembles, @lucid/machine streams and
 * speaks, files.ts persists, after.ts does what a turn owes once it is said --
 * and this is the order they go in.
 *
 * Ported from session.py `reply_to`, `_keep_unanswered` and `_reply`.
 */
import {VoiceRefused, runReply, streamChat} from '@lucid/machine';
import type {Message, Reply} from '@lucid/machine';
import {hatch, sound} from '@lucid/shell';
import {apply as applyMsg} from '../link/reduce';
import {link} from '../link/store';
import {afterTurn, sceneOpening} from './after';
import * as F from './files';
import {
  costOfTurn, current, generation, playback, remainingS, replying, takeFloor,
} from './floor';
import {take as takeHands} from './hands';
import {scenePress, statePress, systemFor, unstick, windowCut} from './prompt';
import type {Open} from './room';
import {Nowhere, lastWrote, openRoom, opened, write} from './room';

export type {Open} from './room';
export {leaveRoom, openRoom, opened} from './room';
export {current, playInto} from './floor';

/* Something went wrong in the middle of a turn.
 *
 * Said rather than swallowed: a turn that vanished looks, from the room, like a
 * pill that has stopped answering, and there is nothing on the screen to tell
 * one from the other.
 *
 * `adrift` is the amber banner and the locked keys, and it says one thing --
 * the machine is not answering. So it is asked for rather than assumed. A line
 * that could not be put on disk is not that: the machine answered, the words
 * are on the glass, and something further down refused. It used to raise the
 * banner all the same, which watchMachine then cleared on its next poll a few
 * seconds later -- so a write error flashed "not answering" over a machine that
 * was answering and locked Talk and Type on the way past.
 */
function trouble(e: unknown, what: string, {adrift = true} = {}): void {
  const why = e instanceof Error ? e.message : String(e);
  hatch.say(`${what}: ${why}`, 'error');
  if (adrift) link.setState({adrift: true, state: 'idle'});
}

export interface TurnRequest {
  slug: string;
  sessionId: string;
  text: string;
  /** Spoken rather than typed. */
  heard?: boolean;
  /** How long the microphone heard, for the mark on the bubble. */
  seconds?: number;
  /** Machinery rather than somebody's words: a continuous nudge, or the turn
      Skip takes at rest. Prompts the model without recording a user turn, so
      the transcript stays a conversation rather than filling with
      machine-generated "keep going" lines. */
  hidden?: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const sleep = (ms: number) => new Promise((go) => setTimeout(go, ms));

/** A fingerprint of the prompt's front, for the console.
 *
 * Not the text: what a pill is told is what a conversation is made of, and the
 * log rule is that none of that is ever written down. A hash and a length say
 * the two things anybody debugging actually asks -- did the prefix change, and
 * by how much -- and say nothing about what is in it. Which is also how you
 * see an override land: set one, take a turn, and this line is different.
 *
 * FNV-1a, because it is eight lines and this is a debug line rather than a
 * checksum. */
/* The front of the prompt as it was last sent, so the line can say the one
   thing that matters about it: whether the server has it cached. One page,
   one room at a time, so one value. */
let lastFront = '';

/** The console line for the front of the prompt: what changed, in terms of
    what it costs. See fingerprint. */
function frontLine(system: string, how: 'sent' | 'warmed'): string {
  const fp = fingerprint(system);
  const same = fp === lastFront;
  lastFront = fp;
  const size = `${system.length} chars`;
  if (how === 'warmed') return `prompt front ${fp}, ${size} — read ahead, so the first word comes quicker`;
  return same
    ? `prompt front unchanged (${fp}, ${size}) — the server has it cached`
    : `prompt front ${fp}, ${size} — new to the server, so the first word takes a moment longer`;
}

function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, '0');
}

/** Say something, and be answered. */
export async function runTurn(o: TurnRequest): Promise<void> {
  const text = (o.text || '').trim();
  if (!text) return;
  /* Whose turn this was meant to be, and taken here rather than at the floor:
     everything below is a promise away, so five Skips in one breath would all
     read the number after the last of their silences and all five would still
     be wanted. Read at the moment the turn was asked for, only one of them is. */
  const gen = generation();
  let room: Open;
  try {
    room = await openRoom(o.slug, o.sessionId);
  } catch (e) {
    /* Except an address pointing at a conversation this room cannot open,
       which has said so and put the banner up. It is not the machine being
       unreachable and must not be reported as it. */
    if (!(e instanceof Nowhere)) trouble(e, 'could not open this room');
    return;
  }

  /* Your turn on the screen first, and on disk second. The bubble is the answer
     to the key you pressed, and a page that waited for a file to be written
     before drawing it would feel like a page that had not heard you. */
  if (!o.hidden) {
    link.setState(applyMsg(link.getState(), {
      type: 'user', text, seconds: o.seconds ?? 0,
    }));
  }

  /* Anything that takes the floor while we queue -- Stop, Skip, a cut-in --
     moves the number on, and an unprompted turn that wakes up behind one of
     those is no longer wanted: five Skips in one breath should take one step,
     not five. */
  const free = await takeFloor();
  try {
    if (opened() !== room) return;      // the room changed while we queued
    if (gen !== generation()) {
      if (o.hidden) return;             // silenced, or superseded, while queued
      /* Somebody's own words, and Stop pressed while they waited their turn.
         Stop has to mean stop: with a long reply being spoken and two things
         typed behind it, pressing it and then hearing the machine work through
         the queue anyway is a key that does not do what it says.

         But the words are not the answer to them, and they are the part with
         nowhere else to live. So they go into the transcript, where they were
         always going, and no reply is made to them. Say it again and it is
         answered. */
      await keepUnanswered(room, text);
      return;
    }
    await reply(room, text, !!o.hidden);
  } finally {
    free();
  }
}

/** The page is going away in the middle of a reply: keep what was spoken.
 *
 * His line is on disk -- it is written before the model is asked -- and the
 * answer is not, so a reload mid-reply left a conversation whose last turn was
 * a question nobody answered, and resuming showed it that way. The Python this
 * replaced stored what had been heard, and this is that: the spoken prefix, as
 * the interrupt path would have kept it, sent by beacon because a fetch does
 * not outlive the document that started it.
 *
 * Nothing comes back and nothing waits: this runs inside a `pagehide`, where
 * the page has one synchronous moment and no more. Answers whether a line was
 * handed over, for the test and for the console.
 */
export function keepOnLeaving(): boolean {
  const room = opened();
  const it = current();
  const said = it?.snapshot().trim() ?? '';
  if (!room || !it || !said) return false;
  /* And this reply is spoken for. `pagehide` fires for a page going into the
     back/forward cache as well as for one being closed, and a page that comes
     back from it comes back to this same reply -- which then finished, pushed
     its line into the transcript and wrote it again. Resume showed two
     assistant turns for one reply, and the file held both the prefix this
     beacon sends and the whole line after it. */
  kept.add(it);
  // Straight into this page's own copy too, in case it is only being hidden:
  // a bfcache restore comes back to the same objects.
  room.history.push({role: 'assistant', content: said});
  const sent = F.beaconAppend(room.sessionId, {kind: 'turn', role: 'assistant', content: said},
                              room.version);
  if (sent) {
    room.version += 1;
    /* And noted as this page's own writing. A reload is the ordinary reason to
       be here, and without this the page came back to a conversation written
       into a second ago by somebody it could not tell from another tab -- and
       started a fresh one rather than picking this up. */
    lastWrote(room.sessionId);
  }
  return sent;
}

/** Replies whose spoken half is already on disk, put there by the beacon
    above. Weak, because what it is remembering is one page's worth of replies
    and the answer stops mattering the moment the reply is collected. */
const kept = new WeakSet<Reply>();

/** Push the conversation's prefix through the model once, so the first reply
 * of the evening is not the one that pays for it.
 *
 * The prefix -- the system prompt, the memory, the standing, the window of
 * what was said -- is the same bytes the next turn will send, and a model
 * server that keeps what it has already read answers the next turn from the
 * second token. Measured when this lived in Python: 3.4 s to the first token
 * cold, 1.2 s warm. One token is asked for and thrown away; what was bought
 * is the cache. Once per room, and only once the model is up, which is the
 * room's to arrange: see Room.tsx. */
export async function warmPrefix(room: Open): Promise<boolean> {
  if (room.warmed || opened() !== room) return false;
  room.warmed = true;
  const system = systemFor(room.persona, room.prompts, room.memory, room.relation);
  const cut = windowCut(room.history, {
    contextTurns: room.cfg.llm.context_turns,
    contextWords: room.cfg.llm.context_words,
    from: room.windowFrom,
  });
  room.windowFrom = cut.from;
  const messages: Message[] = [{role: 'system', content: system}, ...cut.messages];
  /* A chat has to end with somebody's line for the model's template to accept
     it -- a system prompt alone was refused -- and what is being bought here is
     the prefix in front of that line, which is the same bytes whatever the line
     says. So a fresh room is warmed with a stand-in that is never answered and
     never kept. */
  if (messages[messages.length - 1]!.role !== 'user') messages.push({role: 'user', content: '…'});
  try {
    for await (const _ of streamChat({messages, max_tokens: 1,
                                      temperature: num(room.persona.temperature),
                                      top_p: num(room.persona.top_p)})) { void _; }
    if (opened() === room) hatch.say(frontLine(system, 'warmed'), 'debug');
    return true;
  } catch {
    room.warmed = false;            // a machine that was not there yet; asked again next time
    return false;
  }
}

/** Write down what somebody said, without answering it. */
async function keepUnanswered(room: Open, text: string): Promise<void> {
  room.history.push({role: 'user', content: text});
  try {
    await write(room, {kind: 'turn', role: 'user', content: text});
  } catch (e) {
    hatch.say(`could not keep that line: ${e instanceof Error ? e.message : e}`, 'warn');
  }
}

/** Write his line down, and say whether the turn may go on from it.
 *
 * A write that threw may: the machine answered, the words are on the glass,
 * and one line the store would not take is a console line rather than the end
 * of the evening. A write that came back `nowhere` may not -- the conversation
 * belongs to another page now, and every line this one writes into it from
 * here is refused. See write() in room.ts.
 */
async function keptHisLine(room: Open, row: F.Row): Promise<boolean> {
  try {
    return (await write(room, row)) === 'written';
  } catch (e) {
    trouble(e, 'could not write that down', {adrift: false});
    return true;
  }
}

/** His line went nowhere, so the turn stops before it costs anything.
 *
 * The banner is already up -- write() puts it there, and it carries the one
 * thing that still works -- and this is what does not happen behind it. The
 * reply that used to be generated anyway was the most convincing thing on the
 * page and the least real: a whole exchange, spoken, drawn, and gone at the
 * next reload, because the file it belonged to had moved on before the model
 * was ever asked.
 */
function lostIt(): void {
  hatch.say('the pill was not asked: that line is not on disk', 'warn');
  link.setState({state: 'idle'});
}

async function reply(room: Open, said: string, hidden: boolean): Promise<void> {
  const started = performance.now();
  /* Whatever was pressed while this turn was being got ready goes in with it
     rather than waiting for one of its own — which is what makes pressing
     during a reply feel like being noticed rather than queued. */
  const hands = takeHands();
  let userText = said;
  const extra: Message[] = [];
  if (hidden) {
    /* A nudge is machinery and stays out of the transcript; hands are not, and
       go in as the turn they are. So a run the pill is doing on its own can
       still be interrupted by somebody quietly pushing things off a shelf, and
       the record afterwards shows who did what. */
    extra.push({role: 'user', content: said});
    if (hands) {
      room.history.push({role: 'user', content: hands});
      link.setState(applyMsg(link.getState(), {type: 'user', text: hands, seconds: 0}));
      if (!await keptHisLine(room, {kind: 'turn', role: 'user', content: hands})) {
        lostIt();
        return;
      }
    }
  } else {
    if (hands && !userText.includes(hands)) userText = `${userText} ${hands}`.trim();
    room.history.push({role: 'user', content: userText});
    if (!await keptHisLine(room, {kind: 'turn', role: 'user', content: userText})) {
      lostIt();
      return;
    }
    // Before the reply is built, and from his turn alone: see sceneOpening.
    await sceneOpening(room);
  }

  link.setState({state: 'thinking', adrift: false});

  const system = systemFor(room.persona, room.prompts, room.memory, room.relation);
  // The prefix, named rather than quoted. See fingerprint.
  hatch.say(frontLine(system, 'sent'), 'debug');

  /* The window, and where it was cut -- kept on the room so that the next turn
     can be cut at the same place. That is the whole of the prompt cache: the
     messages in front of the last one are the same bytes, turn after turn,
     until the window has overrun far enough to be worth moving. */
  const cut = windowCut(room.history, {
    contextTurns: room.cfg.llm.context_turns,
    contextWords: room.cfg.llm.context_words,
    from: room.windowFrom,
  });
  room.windowFrom = cut.from;
  const messages: Message[] = [
    {role: 'system', content: system},
    ...scenePress(
      statePress(
        unstick([...cut.messages, ...extra]),
        room.relation),
      room.scene, room.prompts),
  ];

  const speaker = playback();
  if (!speaker) {
    trouble(new Error('this room has no speaker'), 'the pill could not be heard');
    return;
  }
  let answered = '';
  /* The assistant's half, on its way to disk. Awaited before the floor is let
     go of: it used to be started and forgotten, so a hands or continuous turn
     -- which writes its user line within microseconds of this one returning --
     raced it. Both appends carried the same version, whichever the store saw
     first won, and the loser's one retry (see room.ts) hid it: on disk the two
     halves came out swapped, and the conversation read backwards on resume. */
  let stored: Promise<unknown> = Promise.resolve();
  /* This reply, for the one thing that has to be able to name it: a page that
     left in the middle of it and wrote down what had been spoken. Held in a
     variable of its own rather than read off the call below, which has not
     returned yet the first time the reply says anything. */
  let mine: Reply | null = null;
  const it = runReply({
    messages,
    temperature: num(room.persona.temperature),
    top_p: num(room.persona.top_p),
    max_tokens: num(room.persona.max_tokens),
    /* And whether it is spoken at all. Fully muted is a text-only evening:
       nothing goes to the voice, so no socket is opened and the machine loads
       no voice for words nobody is going to hear. Read here, once, at the top
       of the reply -- turning the sound back on lands on the next one, because
       this one's first half was never sent anywhere. */
    voice: sound.hush ? null : room.voice,
    playback: speaker,
    onDelta: (delta) => {
      link.setState(applyMsg(link.getState(), {type: 'assistant_delta', text: delta}));
    },
    onSpeaking: () => link.setState({state: 'speaking'}),
    /* What went to the voice, in counts: how the reply was cut, and what the
       queue was when each cut was made. For reading a session back against
       the splitter's rule -- see mergeFor -- without a word of it in the log. */
    onChunk: (c) => hatch.say(
      `voice chunk ${c.n}: ${c.words} words, ${c.chars} chars — ${c.queuedS}s queued, cap ${c.merge}`
      + (c.paragraph ? ', ends a paragraph' : ''), 'debug'),
    onDone: (text) => {
      answered = text;
      link.setState(applyMsg(link.getState(), {type: 'assistant_done', text}));
      // Unless the page already left with it: a bfcache restore comes back to
      // the same reply, and its line is on disk and in this history already.
      if (mine && kept.has(mine)) return;
      room.history.push({role: 'assistant', content: text});
      stored = write(room, {kind: 'turn', role: 'assistant', content: text})
        .catch((e: unknown) => trouble(e, 'could not write that down', {adrift: false}));
    },
    onTrouble: (e) => {
      /* A voice this machine has not got is not a machine that is down. It is
         one line of a tunables.json, the words arrive as they always did, and
         the amber "not answering" banner flashing once per sentence over a
         perfectly healthy machine sends whoever sees it looking in the wrong
         place. Said once, in the console, where the answer is. */
      if (e instanceof VoiceRefused) {
        hatch.say(`${e.message} — /persona_tune voice <name> sets it`, 'warn');
        return;
      }
      trouble(e, 'the pill did not answer');
    },
  });
  mine = it;
  replying(it);
  await it.done;
  replying(null);
  await stored;

  if (!answered) {
    // Cut off before a single token arrived: an empty turn would go into the
    // transcript and back to the model as context.
    link.setState({state: 'idle'});
    return;
  }

  /* Everything a turn owes, off the critical path of the next one. Never
     awaited: the fold, the room and the judgement all run while this reply's
     audio is still draining, and the next turn must not queue behind them. */
  void afterTurn(room, {him: userText, her: answered, hidden});

  if (hidden) {
    /* Remember what this cost, so the next turn can be started early enough to
       land before the audio runs out. And return without waiting: the queue is
       the page's own, so the next turn can be generated while this one is still
       playing and its audio lands behind it. Otherwise every gap in a run is
       generation time end to end. */
    costOfTurn((performance.now() - started) / 1000);
    return;
  }
  /* Hold "speaking" until the queue actually drains, so nothing reads the room
     as quiet in the middle of a reply -- and let go of it if somebody pauses
     the sound, which is not the same thing as a reply going on. A queue
     nobody is playing never empties, and a turn that waited for it would hold
     the floor until they came back: no press answered, no run resumed, and no
     way to see why. */
  while (remainingS() > 0.05 && !playback()?.held && opened() === room) await sleep(100);
  link.setState({state: 'idle'});
}
