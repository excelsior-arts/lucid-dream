/* What happens once a turn has been said, and none of it on the way to the
 * next one.
 *
 * Three small model calls, ported from session.py `_after_turn`, `_maybe_fold`,
 * `_maybe_scene`, `_scene_opening` and `_score_relation`, with the prompts they
 * send from memory.py, scene.py and relation.py. All of them run while the
 * audio of the reply is still draining -- that time is otherwise idle, so
 * memory, the room and where you stand cost no extra waiting before the next
 * answer.
 *
 * The order is the order Python ran them in and it matters for one reason: the
 * fold and the judgement share a language model that answers one request at a
 * time, so they take their turn rather than racing for it. Every token spent
 * here is a token the next reply waits for, if you answer before the pill has
 * finished speaking.
 */
import {streamChat} from '@lucid/machine';
import type {Message} from '@lucid/machine';
import {hatch} from '@lucid/shell';
import {apply as applyMsg} from '../link/reduce';
import {link} from '../link/store';
import * as F from './files';
import {clean} from './memory';
import type {Open} from './room';
import {opened, touched, windowOf, write} from './room';
import type {Standing} from './relation';
import {LIMIT, apply as applyDeltas, blank, decayed, describe, readDeltas, standing, standingCard} from './relation';
import {ASK_ALL, ASK_PLACE, GUESS, SETTLED, isNowhere, trim} from './scene';

/** Whether the room this work is for is still the room this page is in.
 *
 * Asked again before every write, and it has to be asked late rather than
 * once at the top: all of this runs while the reply's audio drains, each part
 * of it is a model call away, and a pill can be ejected or swapped in the
 * middle of one. The old room's fold then landed on the new room's memory, its
 * scene note went into the new conversation's file, and its standing card lit
 * up on a page belonging to somebody else. Nothing is half-written: the work
 * simply stops where it is, and the turns it was folding are folded again
 * after the next one, because `foldedUpto` only moves on a fold that wrote.
 */
const still = (room: Open): boolean => opened() === room;

/** Whether a hand has been on this room since this work read it.
 *
 * `still` asks whether the room is the room; this asks whether it is the room
 * it was. Both are needed and neither covers the other: the fold and the
 * judgement are each a model call long, and inside that minute somebody can
 * reset a standing from the console or rewrite a memory on the sheet. What
 * comes back is about the room as it was before they did, and writing it puts
 * their edit back the way it was -- silently, in a file nobody is looking at,
 * seconds after they made it.
 *
 * So the hand wins: the work drops what it was going to write, and the turns a
 * fold was folding are folded again after the next one. Not a queue, which
 * would make the edit wait behind the model -- the wrong way round.
 */
const handMoved = (room: Open, era: number): boolean => room.epoch !== era;

/** Fill a prompt's `{name}` slots.
 *
 * One pass, with the values handed in and never String.replace's own `$`
 * patterns: what goes in here is a memory, a transcript and a reply, all of
 * which are full of characters that would otherwise be read as instructions.
 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g,
                          (whole, name: string) => values[name] ?? whole);
}

/** One short call, whole. Nothing here streams to anybody: these are a
    handful of bullets, three lines of a room, or one line of JSON. */
async function ask(o: {
  system: string; user: string; temperature: number; max_tokens: number;
}): Promise<string> {
  const messages: Message[] = [
    {role: 'system', content: o.system},
    {role: 'user', content: o.user},
  ];
  let out = '';
  for await (const delta of streamChat({
    messages, temperature: o.temperature, max_tokens: o.max_tokens,
  })) out += delta;
  return out;
}

/* ---- memory ---------------------------------------------------------------
 *
 * Months of evenings, rewritten wholesale from the output of a language model
 * every time enough turns fall out of the window. There is no other copy of it
 * anywhere, which is why the mark below moves only on a fold that actually
 * wrote something.
 */

/** Fold what just fell out of the window into long-term memory. */
export async function maybeFold(room: Open): Promise<void> {
  const cfg = room.cfg.memory;
  if (!cfg.enabled) return;
  // Two folds running at once both read the same memory and both write: the
  // later one wins and the earlier fold's turns are lost for good, because
  // foldedUpto has already moved past them.
  if (room.folding) return;
  room.folding = true;
  try {
    const fellOut = room.history.length - windowOf(room.cfg);
    if (fellOut - room.foldedUpto < cfg.fold_after) return;
    const dropped = room.history.slice(room.foldedUpto, fellOut);
    if (!dropped.length) return;

    /* Taken before the model is asked and compared after: see `same`. */
    const era = room.epoch;
    const existing = room.memory || '(nothing yet)';
    /* Named, not roled. Handed "user:" and "assistant:", the folder wrote its
       memories about "the assistant" — and worse, read everything on a user:
       line as something he said about himself. He does not only speak as
       himself: he asks for a register and gives samples of it, writes lines
       for the pill to say, sets a scene to play in. All of that arrives in the
       first person on his turn, and has been folded into the memory as
       biography.

       A name on each turn is what makes the difference legible, and it costs
       nothing: the pill's own name is what the memory would call her anyway. */
    const hers = room.persona.name || room.persona.pill || 'you';
    const convo = dropped
      .map((m) => `${m.role === 'user' ? 'him' : hers}: ${m.content}`).join('\n');
    const raw = await ask({
      system: room.prompts.fold_system ?? '',
      user: fill(room.prompts.fold_user ?? '', {
        existing, dropped: convo, max_bullets: String(cfg.max_bullets),
      }),
      temperature: 0.3,
      max_tokens: 400,
    });
    const kept = clean(raw, cfg.max_bullets);
    if (!still(room)) return;          // the pill was ejected mid-fold
    if (handMoved(room, era)) {
      /* Somebody rewrote the memory while this was being folded. What they
         wrote is the memory; the mark stays where it is, so these turns are
         folded into it after the next one. */
      hatch.say('the memory was written by hand while it was being folded — '
        + 'the fold was dropped, and those turns are folded in after the next one',
                'warn');
      return;
    }
    if (!kept) {
      /* Nothing was written, so nothing has been remembered, and the mark
         stays where it is: these turns are folded again after the next one.
         Moving it first — which is what this did — meant a fold interrupted by
         a Stop, or one the model answered with preamble, dropped those turns
         out of the window and out of the memory both. Silently, and for good:
         nothing ever looks back past this mark. */
      hatch.say('memory fold came back empty — trying again after the next turn',
                'warn');
      return;
    }
    await F.saveMemory(room.slug, kept);
    room.memory = kept;
    room.foldedUpto = fellOut;
    /* And the window is re-cut on the next turn. A fold rewrites the memory
       block in the system prompt, so the prefix has changed whatever else
       happens -- which makes this the one moment where moving the window costs
       nothing. See windowCut in prompt.ts. */
    room.windowFrom = -1;
    hatch.say(`memory: ${dropped.length} older turn${dropped.length === 1 ? '' : 's'} folded in — `
      + 'what mattered is kept, the rest let go');
    link.setState({remembered: {slug: room.slug, text: kept, off: false}});
  } catch (e) {
    hatch.say(`memory fold failed: ${why(e)}`, 'warn');
  } finally {
    room.folding = false;
  }
}

/* ---- the scene ------------------------------------------------------------ */

/** Re-read where they are, from what was just said.
 *
 * Given the scene as it was and the last few turns, not the whole conversation:
 * the point is to carry a place forward, not to summarise. `settled` is false
 * while the place is still the room's own guess at itself — it changes one line
 * of the prompt rather than adding a rule to it: told that nothing is
 * confirmed, the writer takes what he named and keeps the room when he named
 * nothing, which is what the rule would have said.
 */
async function sceneUpdate(
  room: Open, recent: readonly Message[], settled: boolean, opening = false,
): Promise<string> {
  if (!recent.length) return room.scene;
  const convo = recent
    .map((m) => `${m.role === 'user' ? 'he' : 'she'}: ${m.content}`).join('\n');
  const text = await ask({
    system: room.prompts.scene_system ?? '',
    user: fill(room.prompts.scene_user ?? '', {
      heading: settled ? SETTLED : GUESS,
      ask: opening ? ASK_PLACE : ASK_ALL,
      previous: room.scene || '(nothing yet — this is the start)',
      recent: convo,
    }),
    temperature: 0.2,
    max_tokens: opening ? 40 : 120,
  });
  if (isNowhere(text)) return '';        // they are not anywhere; carry nothing
  return trim(text) || room.scene;
}

async function noteScene(room: Open, fresh: string): Promise<void> {
  if (!fresh || fresh === room.scene) return;
  if (!still(room)) return;            // this room was left while it was asked
  room.scene = fresh;
  link.setState({scene: fresh});
  await write(room, {kind: 'scene', text: fresh});
}

/* Opening turns long enough to be a scenario rather than a greeting. Set to 0
   to write the first note from anything at all. */
export const SCENE_OPENING_WORDS = 0;

/** Write down where he just said they are, before answering him.
 *
 * The first note used to wait for a reply to exist, which handed the seed one
 * uncontested turn -- and that is the turn where his scenario is newest and the
 * room's own description of itself is most wrong. Somebody opens by saying
 * where they are, and the pill answers from the room it arrived with, because
 * that is what the note still said. Measured: the reply hedges out loud, naming
 * the room's own weather and then correcting itself mid-sentence. The
 * correction does not help -- both halves are in the transcript now, the next
 * reply picks the wrong half back out of it, and the scene writer reads that
 * reply and writes it down as fact. The room nobody asked for is then part of
 * the place they chose, and it got there from a seed no one ever contested.
 *
 * So the note is written from his turn alone, before the reply is built. The
 * writer already knows what to do with it: being told is not inventing, and it
 * follows the person in the room over the room.
 *
 * Costs one small call on the first turn of a session and nothing after.
 */
export async function sceneOpening(room: Open): Promise<void> {
  if (!room.cfg.scene.enabled || !room.sceneNew) return;
  // The opening turn and only that: a resumed conversation has a scene of its
  // own and maybeScene replaces it early enough.
  if (room.history.length !== 1) return;
  const opening = (room.history[0]?.content ?? '').trim();
  if (opening.split(/\s+/).filter(Boolean).length < SCENE_OPENING_WORDS) return;
  /* Hands act inside a place and never declare one: the room wrote the
     sentence, about its own furniture, and "he puts his hand out over the
     edge" means nothing without the room still being there. So an evening that
     opens with a press keeps the seed -- which is the one thing that makes the
     press legible -- and the note waits for a word. */
  if (opening.startsWith('(') && opening.endsWith(')')) return;
  room.sceneNew = false;
  room.sceneAt = room.history.length;
  try {
    await noteScene(room, await sceneUpdate(room, room.history.slice(0, 1), false, true));
  } catch (e) {
    hatch.say(`scene note failed: ${why(e)}`, 'warn');
  }
}

/** Work out where the scene has got to, every few turns.
 *
 * Every turn would be wasteful and every ten would be too late: the window
 * holds about two of its replies, so the room has to be written down before it
 * falls out of it.
 */
export async function maybeScene(room: Open): Promise<void> {
  if (!room.cfg.scene.enabled || !room.history.length) return;
  // How much has been said since the last note, not how many turns — one of
  // its replies can be worth forty of yours.
  const freshTurns = room.history.slice(room.sceneAt);
  const said = freshTurns.reduce(
    (n, m) => n + (m.content || '').trim().split(/\s+/).filter(Boolean).length, 0);
  /* The first note after a conversation is opened comes early, whatever has
     been said. Two things are riding along in the prompt until it does, and
     both of them are guesses about a conversation that has not happened yet:
     in a new one, the room's own description of itself, put there so the pill
     knows where it is standing before anybody has spoken; in a resumed one,
     wherever the two of them were when it was last put down, which may be
     weeks ago.

     Waiting three hundred words to replace either of those meant the note
     pulled the conversation back to a place it had already left. Say "forget
     this room, we are on a ship" and it goes — and then on the third turn the
     note still says the room with the open window, and back it comes to the
     window. Two turns is enough to know better, and the note is one small
     call. */
  const first = room.sceneNew && freshTurns.length >= 2;
  if (said < Math.max(50, Math.trunc(room.cfg.scene.every_words)) && !first) return;
  const wasAGuess = room.sceneNew;
  room.sceneNew = false;
  const recent = freshTurns.length ? freshTurns : room.history.slice(-4);
  room.sceneAt = room.history.length;
  try {
    await noteScene(room, await sceneUpdate(room, recent.slice(-6), !wasAGuess));
  } catch (e) {
    hatch.say(`scene note failed: ${why(e)}`, 'warn');
  }
}

/* ---- where you stand ------------------------------------------------------ */

/** Judge the exchange that just happened.
 *
 * Shown the exchange and nothing else -- never the accumulated score -- so it
 * cannot talk itself into a direction. Hidden turns never reach here:
 * continuous mode is the pill talking to itself, and there is nothing about you
 * in it to judge.
 */
export async function scoreRelation(
  room: Open, him: string, her: string,
): Promise<void> {
  const cfg = room.cfg.relation;
  if (!cfg.enabled || !cfg.score) return;
  const era = room.epoch;
  try {
    const raw = await ask({
      system: room.prompts.relation_system ?? '',
      user: fill(room.prompts.relation_user ?? '',
                 {him: him.trim(), her: her.trim().slice(0, 400)}),
      temperature: 0.1,
      // One line of JSON. The cap matters because the model serves one request
      // at a time: every token this spends is a token the next reply waits
      // for, if you answer before the pill has finished speaking.
      max_tokens: 48,
    });
    const [deltas, whyMoved] = readDeltas(raw);
    if (!Object.values(deltas).some((d) => d)) return;
    if (!still(room)) return;
    if (handMoved(room, era)) {
      /* Where you stand was reset, or set by hand, while this exchange was
         being judged. Applying these deltas would put a standing back that
         somebody had just cleared -- and it did, a few seconds after they
         cleared it, which read as a reset that did not work. */
      hatch.say('where you stand was changed while that was being judged — '
        + 'the judgement was dropped', 'warn');
      return;
    }
    const state = applyDeltas(room.relation ?? blank(), deltas, whyMoved);
    await F.saveRelation(room.slug, state);
    const moved = state.log[state.log.length - 1];
    /* The numbers and not the reason. The scorer's `why` is a sentence about
       the exchange it was shown -- written out of what was said, and prompted
       to name something he did -- and the log rule is that none of that is
       ever written down. It is in the relation file, which is where somebody
       asking "why did it move" is looking anyway. */
    const [word, temper] = standing(state);
    hatch.say(`standing moved ${moved?.moved ?? ''} — now ${word}${temper ? `, ${temper}` : ''}`);
    landed(room, state);
  } catch (e) {
    hatch.say(`relation scoring failed: ${why(e)}`, 'warn');
  }
}

/** A standing that has moved: onto the room, onto disk, and onto the page.
 *
 * One door, because the room recolours off the store and a second path to it
 * would only be a second thing to keep true. See the relation case in
 * reduce.ts, which is what the room is watching.
 */
function landed(room: Open, state: Standing): void {
  room.relation = state;
  // The room's own record either way; the page's only while it is this page's
  // room. A standing that landed after an eject lit the next pill's card.
  if (!still(room)) return;
  link.setState(applyMsg(link.getState(), {
    type: 'relation',
    slug: room.slug,
    state: {warmth: round(state.warmth), trust: round(state.trust), mood: round(state.mood)},
    text: describe(state),
  }));
  link.setState({standing: standingCard(state)});
}

/** Put the pill at a warmth, to see what it looks like.
 *
 * The room is lit by warmth and today's mood, and the only other way to see
 * the far ends of that is to edit the file by hand — which works, and has a
 * trap in it: every read is decayed first, so a number written next to
 * yesterday's timestamp has already faded by the time it is read, and mood,
 * whose half-life is six hours, is most of the way gone by morning. This
 * stamps it as of now.
 *
 * Both axes, because they are not the same thing to look at: warmth is where
 * you stand and moves over weeks, mood is today and is half of what makes a
 * room look bright.
 */
export async function setStanding(
  room: Open, warmth: number, mood?: number,
): Promise<Standing> {
  const state: Standing = {
    ...decayed(room.relation ?? blank()),
    warmth: Math.max(-LIMIT, Math.min(LIMIT, warmth)),
    updated: Date.now() / 1000,
  };
  if (mood !== undefined) state.mood = Math.max(-LIMIT, Math.min(LIMIT, mood));
  touched(room);                       // a hand on the axes, same as a reset
  await F.saveRelation(room.slug, state);
  landed(room, state);
  return state;
}

/* ---- and what a hand writes on the sheets ----------------------------------
 *
 * The two files a person can edit from the page, and the reason they are here
 * rather than in the sheet that draws them: writing the file is the smaller
 * half of saving. The room read that file once, on the way in, and goes on
 * prompting from what it read -- so a save that only wrote to disk was undone
 * by the next fold and never reached the model at all. "*I never had a dog*
 * removes the dog" (MANUAL:225) has to hold in the sitting it was said in.
 */

/** What the pill remembers, as somebody has just rewritten it.
 *
 * The file, the open room's copy of it, and the sheet that is drawing it. The
 * room's copy only when it is the same pill: the sheet can be open on one
 * pill's memory from inside another one's room. */
export async function saveMemory(slug: string, text: string): Promise<void> {
  const kept = (text || '').trim();
  await F.saveMemory(slug, kept);
  const room = opened();
  const mine = room?.slug === slug;
  if (mine && room) {
    room.memory = kept;
    // And a fold that is out at the model right now writes nothing: what it
    // would write is the memory as it was before this was typed.
    touched(room);
  }
  link.setState({remembered: {
    slug, text: kept,
    off: mine && room ? !room.cfg.memory.enabled
                      : (link.getState().remembered?.off ?? false),
  }});
}

/** Where you stand, back to nothing.
 *
 * The file goes, and with it the room's copy and the card on the page. Without
 * the last two, the next scored turn read the standing the room was still
 * holding, applied its deltas to that, and wrote the whole thing back: a reset
 * undone by the next thing said, with the file back a minute later looking as
 * though nothing had happened. */
export async function clearStanding(slug: string): Promise<boolean> {
  const had = await F.resetRelation(slug);
  const room = opened();
  if (room?.slug === slug) {
    room.relation = null;
    // The other half of the same rule: a judgement already out at the model is
    // about the standing this just cleared, and must not put it back.
    touched(room);
  }
  if (room?.slug === slug || link.getState().slug === slug) {
    link.setState({standing: {}, relation: null});
  }
  return had;
}

/* ---- and the order they go in --------------------------------------------- */

/** Everything a turn owes once it has been said.
 *
 * One worker for all of it: the fold and the judgement share a model, so they
 * take their turn rather than racing for it. Never awaited by the turn that
 * asked for it -- the next reply must not queue behind a memory being written.
 */
export async function afterTurn(
  room: Open, o: {him: string; her: string; hidden: boolean},
): Promise<void> {
  if (!still(room)) return;
  await maybeFold(room);
  if (!still(room)) return;
  await maybeScene(room);
  if (!still(room) || o.hidden) return;
  await scoreRelation(room, o.him, o.her);
}

const round = (n: number): number => Math.round(n * 10) / 10;
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
