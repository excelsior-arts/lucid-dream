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
import {NotAnswering, Told, VoiceFailed, VoiceRefused, awaitReady, models, runReply, streamChat, wholeSentences} from '@lucid/machine';
import type {Message, Reply} from '@lucid/machine';
import {hatch, host, sound} from '@lucid/shell';
import {afterTurn, sceneOpening} from './after';
import * as F from './files';
import {
  costOfTurn, current, generation, playback, remainingS, replying, takeFloor,
} from './floor';
import {take as takeHands} from './hands';
import {front, readAgain, voiceOf} from './character';
import {chat} from './refusal';
import {
  asSent, offersTags, placeLine, scenePress, soundPress, statePress, unstick, windowCut,
} from './prompt';
import type {Open} from './room';
import {Nowhere, lastWrote, openRoom, opened, write} from './room';
import {surface} from './surface';

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
  /* And where the page has its own words for what went wrong -- the GPU in
     this browser letting go of the pill, the pill stalling (Told) -- the
     banner says them rather than only that the pill did not answer. */
  if (adrift) surface().adrift(true, e instanceof Told ? e.message : '');
}

/* The pill stopped answering part-way: it stalled, the GPU let go of it, the
 * stream dropped (NotAnswering, stall.ts in @lucid/machine). Not the banner:
 * the reply is already finished on the glass, its last words fading where it
 * broke, and what is left to say is that the pill is being woken -- quietly,
 * over the deck, with nothing locked (Eugene, 10-10). Typing and Talk go on
 * working, and a line given meanwhile is answered once it is up. The label
 * goes the moment the pill is up again, nobody having to say anything to
 * find out (Eugene, 10-10) -- or, with a line waiting on it, with that
 * reply's first word. Woken here as well as by the machine itself (a Mac's
 * restarts its model server on a stall): a browser's starts again from its
 * cache only when asked, and this asks. One that never comes up leaves the
 * label where it is, which is true. */
function notAnswering(e: NotAnswering): void {
  hatch.say(`the pill stopped answering: ${e.message}`, 'warn');
  surface().waking('waking');
  void models.start()
    .then(() => awaitReady('llm'))
    .then((up) => { if (up && surface().isWaking() === 'waking') surface().waking(''); })
    .catch(() => {});
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
  /** Told the moment this turn has the floor and is about to be answered --
      after whatever was speaking has been cut and has written its half. A
      caller that wants the reply to *this* turn, and not the tail of the one
      before it, waits for this rather than for the next line to arrive. */
  onTaken?: () => void;
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
  /* A line somebody said that goes no further says so, at the quietest
     level there is: from the room, a turn that was heard and never shown is
     a microphone that stopped working. Never the words. */
  const dropped = (why: string) => {
    if (o.heard) hatch.say(`a heard line (${text.length} characters) dropped: ${why}`, 'debug');
  };
  if (!text) return;
  /* No words anywhere: a browser that cannot run the pill, stepped into to
     look around. Nothing is asked of a model that is not there, and nothing
     is said about it -- the line and the keys already say so. */
  if (host().llm === 'none') { dropped('there is no language model here'); return; }
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
    else dropped('this room is not one that can be opened');
    return;
  }

  /* Your turn on the screen first, and on disk second. The bubble is the answer
     to the key you pressed, and a page that waited for a file to be written
     before drawing it would feel like a page that had not heard you. */
  if (!o.hidden) surface().transcript({type: 'user', text, seconds: o.seconds ?? 0});

  /* Anything that takes the floor while we queue -- Stop, Skip, a cut-in --
     moves the number on, and an unprompted turn that wakes up behind one of
     those is no longer wanted: five Skips in one breath should take one step,
     not five. */
  const free = await takeFloor();
  try {
    if (opened() !== room) {            // the room changed while we queued
      dropped('the room changed while it waited its turn');
      return;
    }
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
    o.onTaken?.();
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

/** The tags the voice speaking this reply performs: the room's voice's, and
 * none when the reply will not be heard -- the sound off or the knob at zero,
 * a room told to be read and not heard, or nothing to speak with (a Mac
 * without its voice, a browser whose voice is not up). The same test that
 * decides whether the reply goes to the voice at all; see `voice:` in reply.
 *
 * Read per turn, so the prompt follows what will actually speak: a tagless
 * voice is asked for sounds as words (the `{if tags}` blocks, see ifTags in
 * prompt.ts) and a voice that performs tags is offered them. The front of
 * the prompt moves only when this does, so the server's cache misses once
 * on the turn after an engine change or after the sound goes off or comes
 * back, and holds for every turn in between. */
export function heardTags(room: Open): readonly string[] {
  return sound.silent || room.silent || !host().voice ? [] : room.tags ?? [];
}

/** Whether the room is said once, at the end of the system prompt, rather
 * than pressed onto his every line: with the scene off, where it is the
 * persona's place all evening and never moves -- a browser's default
 * (config.ts PAGE_DEFAULTS), and a player's choice anywhere. See placeLine.
 * With the scene on, it is pressed as it always was. */
const placedOnce = (room: Open): boolean => !room.cfg.scene.enabled;

/** The system prompt for a reply: the front, and the room where it is said
    once. The same bytes for the warm-up and every reply, or the cache misses. */
const systemOf = (room: Open, tags: readonly string[]): string =>
  front(room, tags) + (placedOnce(room) ? placeLine(room.scene, room.prompts, voiceOf(room)) : '');

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
  const tags = heardTags(room);
  const system = systemOf(room, tags);
  const cut = windowCut(room.history, {
    contextTurns: room.cfg.llm.context_turns,
    contextWords: room.cfg.llm.context_words,
    from: room.windowFrom,
  });
  room.windowFrom = cut.from;
  const messages: Message[] = [
    {role: 'system', content: system}, ...asSent(readAgain(cut.messages), offersTags(room.prompts, tags))];
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
  surface().state('idle');
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
      surface().transcript({type: 'user', text: hands, seconds: 0});
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

  surface().adrift(false);
  /* A line given while the pill is being woken: answered once it is up, and
     the label over the deck says so. */
  if (!hidden && surface().isWaking()) surface().waking('line');
  surface().state('thinking');

  const tags = heardTags(room);
  const system = systemOf(room, tags);
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
      soundPress(
        statePress(
          unstick([...asSent(readAgain(cut.messages), offersTags(room.prompts, tags)), ...extra]),
          room.relation, undefined, voiceOf(room)),
        room.prompts, tags, voiceOf(room)),
      placedOnce(room) ? '' : room.scene, room.prompts, voiceOf(room)),
  ];
  /* And his line is kept as it was sent, the room and the standing pressed on
     it and all, for the model to be shown again next turn.

     That is the prompt cache. mlx_lm can only go on from a point it saved --
     this model's cache cannot be cut back to a shorter prefix -- and the
     point it saves is the end of the prompt it was sent: this line with its
     presses on. Shown it bare next turn, the prompt parted from the saved one
     at the start of this line, and the only thing the server could use again
     was the system prompt: every turn read the whole conversation again.
     Measured over a ten-turn evening, at the median: 740-930 tokens read and
     2.1-3.3 s to the first token, against about 240 tokens and 1.0-1.4 s kept
     as sent; only a turn where the window is cut again reads it all. The
     window is still measured on the words (see windowCut above), or the
     presses would fill it and cut it every other turn. The words on screen
     and on disk are the same words they were; this is `sent`, which only the
     model is shown (see Kept). Not for a turn the room asked for itself: its
     nudge is not in the history to keep. */
  const his = room.history[room.history.length - 1];
  const sentLast = messages[messages.length - 1]!;
  if (!hidden && his?.role === 'user' && sentLast.role === 'user' && sentLast.content !== his.content) {
    his.sent = sentLast.content;
  }

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
  /* Down the page's lane, where the page has one: a walk puts the
     narrator's words ahead of the ground it is drawing and cuts a region
     short for them; a room runs it straight. */
  const ran = await surface().run('speech', async (signal) => {
  const it = runReply({
    signal,
    /* Through the refusal guard where the model in use is a censored one:
       see refusal.ts. Straight to the model otherwise. */
    chat,
    messages,
    temperature: num(room.persona.temperature),
    top_p: num(room.persona.top_p),
    max_tokens: num(room.persona.max_tokens),
    /* And whether it is spoken at all. Fully muted is a text-only evening:
       (muted, or the knob at zero: sound.silent)
       nothing goes to the voice, so no socket is opened and the machine loads
       no voice for words nobody is going to hear. Read here, once, at the top
       of the reply -- turning the sound back on lands on the next one, because
       this one's first half was never sent anywhere. And nothing to speak
       with at all -- a page with no machine behind it -- is the same. */
    voice: sound.silent || room.silent || !host().voice ? null : room.voice,
    playback: speaker,
    onDelta: (delta) => {
      // Answering again: whatever was being woken is up.
      surface().waking('');
      surface().transcript({type: 'assistant_delta', text: delta});
    },
    onSpeaking: () => surface().state('speaking'),
    /* What went to the voice, in counts: how the reply was cut, and what the
       queue was when each cut was made. For reading a session back against
       the splitter's rule -- see mergeFor -- without a word of it in the log. */
    onChunk: (c) => hatch.say(
      `voice chunk ${c.n}: ${c.words} words, ${c.chars} chars — ${c.queuedS}s queued, cap ${c.merge}`
      + (c.paragraph ? ', ends a paragraph' : ''), 'debug'),
    onDone: (text, _spoken, written, cut) => {
      /* A reply that broke off -- a stall, a GPU letting go, a stream
         dropped (notAnswering above) -- is finished here like any other: it stays on
         the glass and on disk as far as it got, marked cut, with no caret.
         The model is shown only its whole sentences (asSent in prompt.ts),
         and so is the judgement. */
      answered = cut ? wholeSentences(text) : text;
      surface().transcript({type: 'assistant_done', text, ...(cut ? {cut} : {})});
      /* Nothing heard: the page has been told to take its caret down, and
         there is no line to keep or write. */
      if (!text) return;
      // Unless the page already left with it: a bfcache restore comes back to
      // the same reply, and its line is on disk and in this history already.
      if (mine && kept.has(mine)) return;
      /* The words, and -- where its voice made a sound in them -- the reply
         as it was written, for the model to be shown next turn. See Kept. */
      const sent = written && written !== text ? {sent: written} : {};
      const broke = cut ? {cut: true} : {};
      room.history.push({role: 'assistant', content: text, ...sent, ...broke});
      stored = write(room, {kind: 'turn', role: 'assistant', content: text, ...sent, ...broke})
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
      if (e instanceof NotAnswering) {
        notAnswering(e);
        return;
      }
      /* The voice could not say a chunk: the words are there, at the
         reading pace. The console's, not the banner's. */
      if (e instanceof VoiceFailed) {
        hatch.say(`the voice could not say that — ${e.message}; the words go on`, 'warn');
        return;
      }
      trouble(e, 'the pill did not answer');
    },
  });
  mine = it;
  replying(it);
  await it.done;
  replying(null);
  return true;
  }, 'reply');
  if (ran === undefined) hatch.say('the reply was not asked for: the lane was taken', 'debug');
  await stored;

  if (!answered) {
    // Cut off before a single token arrived: an empty turn would go into the
    // transcript and back to the model as context.
    surface().state('idle');
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
  surface().state('idle');
}
