/* A character: what makes somebody somebody, apart from the room they are in.
 *
 * A persona with the player's own two files over it, the prompts it is spoken
 * through, what it remembers of you, and where you stand with it -- and the
 * two model calls that move the last two: the fold, which rewrites the memory
 * from what has fallen out of the window, and the judgement, which moves the
 * standing from one exchange. Everything else a pill has is the room's: the
 * conversation, the scene, the hands, the voice on the floor.
 *
 * Cut out of room.ts and after.ts because a second game wanted exactly this
 * and nothing else. A narrator over a walk is a character: it has a memory of
 * you, a standing toward you, a fold at the end of an evening and a judgement
 * after every exchange, and it lives in this game's tray as an internal
 * persona -- so that one day it can be a pill, and so that any pill can one
 * day be a narrator. The room is Talk's; the character is anybody's who asks
 * by slug. Nothing in here touches the page's store: a caller that has a page
 * says what it wants said on it.
 *
 * The one thing a caller hands in is how a call is run. A room runs it
 * straight, in the drain after a reply; a walk has a lane with a narrator's
 * speech ahead of everything and runs it there. And `still`: whether the
 * caller is still where it was when it asked, which only the caller knows.
 */
import type {Message} from '@lucid/machine';
import {hatch, host} from '@lucid/shell';
import type {PersonaCard, Standing as TopLine} from '../link/shapes';
import type {prompts as shipped} from './bundle';
import {prompts as bundled} from './bundle';
import {chat, refusing} from './refusal';
import type {MemoryConfig, PlayerConfig, RelationConfig} from './config';
import {gameConfig} from './config';
import * as F from './files';
import {clean} from './memory';
import {effectivePersona, forget} from './persona';
import type {Prompts} from './prompt';
import {systemFor} from './prompt';
import type {Standing} from './relation';
import {DEFAULT_VOICE, say as voiced, words, type Voice} from './pronouns';
import {
  LIMIT, apply as applyDeltas, blank, decayed, read as readStanding, readDeltas, standing,
  standingCard,
} from './relation';

export interface Character {
  slug: string;
  persona: PersonaCard;
  prompts: Prompts;
  /** When to fold and whether to judge, and who is playing. A room's whole
      config satisfies it. */
  cfg: {memory: MemoryConfig; relation: RelationConfig; player?: PlayerConfig};
  /** Which words every prompt uses for it and for the player: the
      persona's own `pronouns:` and the player's from the config. */
  pronouns: Voice;
  /** What it remembers about you, and where you stand. Both hold still for
      most of an evening, which is why they may sit in the system prompt. */
  memory: string;
  /** The arc of this sitting, when a game has written one: a scenario the
      character is playing him through, placed after everything that holds
      still and before the window, so it changes seldom and the cache holds.
      Empty is no arc, which is every room today. */
  arc?: string;
  relation: Standing | null;
  /** The delivery tags its voice performs, "[laugh]" and the like, as the
      machine reports them. Set by a room that has a voice to speak through;
      left out, nothing is offered and the prompt is the one it always was.
      See `soundsLine` in prompt.ts. */
  tags?: readonly string[];
  /** What a hand has done to what the model also writes, counted.
   *
   * The fold and the judgement are each a model call away from the state they
   * read, and a person is not: a memory edited or a standing reset while one
   * of them is thinking must not be written over by an answer about the state
   * as it was a minute ago. So they take this number when they start and
   * compare it before they write, and the hand wins. Counted rather than
   * flagged because two of them can be in flight at once. */
  epoch: number;
  /** Two folds running at once both read the same memory and both write: the
      later one wins and the earlier fold's turns are lost for good. */
  folding: boolean;
}

export type Say = (line: string, level?: 'debug' | 'info' | 'warn' | 'error') => void;

/** How a model call is run: straight, or through a caller's own lane. Nothing
    coming back means the lane declined to run it. */
export type Run = <T>(job: (signal: AbortSignal) => Promise<T>) => Promise<T | undefined>;

export interface Calling {
  run?: Run;
  /** Whether the caller is still where it was when it asked. A room that was
      left mid-fold must not have its fold land on the next room's memory. */
  still?: () => boolean;
  say?: Say;
}

const straight: Run = (job) => job(new AbortController().signal);
const says: Say = (line, level = 'info') => hatch.say(line, level);

/** Read one in: the shipped persona with the player's files over it, and
    the two things it keeps about you. `cfg` is read unless one is handed in,
    since a room has already read the whole of it. */
export async function openCharacter(
  slug: string, o: {cfg?: Character['cfg']; prompts?: ReturnType<typeof shipped>} = {},
): Promise<Character> {
  const [persona, cfg, memory, onDisk] = await Promise.all([
    effectivePersona(slug),
    o.cfg ?? gameConfig(),
    F.memory(slug),
    F.relation(slug).catch(() => null),
  ]);
  return {
    slug,
    persona,
    prompts: o.prompts ?? bundled(),
    cfg,
    pronouns: {self: persona.pronouns ?? 'she', other: cfg.player?.pronouns ?? 'he'},
    memory,
    /* Through `decayed` on the way in, the way every read of this state is:
       what is on disk is only ever a snapshot of a moment that has since
       passed, and a bad mood six hours old is not a bad mood. */
    relation: onDisk ? decayed(readStanding(onDisk)) : null,
    epoch: 0,
    folding: false,
  };
}

/** A hand has changed what the model also writes. See `epoch`. */
export function touch(c: Character | null): void {
  if (c) c.epoch += 1;
}

/** The front of every prompt: who it is, what it remembers, where you stand.
    All three change a handful of times an evening and no oftener, which is
    what makes the prefix worth caching. `tags` is what the voice speaking
    this reply performs, its own by default; a room passes none while nothing
    will be heard (see `heardTags` in turn.ts). */
export const front = (c: Character, tags: readonly string[] | undefined = c.tags): string =>
  systemFor(c.persona, c.prompts, c.memory, c.relation, undefined, voiceOf(c), tags)
  + (c.arc?.trim() ? '\n\n' + c.arc.trim() : '');

/** Whether a reply is the model refusing as itself rather than the character
 * speaking ("I can't continue this roleplay. I am an AI..."), where that is
 * caught: from a censored model, wherever it runs (host().censored; see
 * refusal.ts). The guard there cuts one and asks again before a word is
 * shown; one that came back refusing twice is shown, and goes no further.
 * From any other model, never: it is shown everything it said. */
export const asItself = (text: string): boolean => host().censored && refusing(text);

/** What of a conversation the model reads again: all of it, less the
 * replies it gave as itself (`asItself`).
 *
 * Once one is in the window the small model reads itself refusing and goes
 * on doing it -- the research of 10-09 watched one such reply turn into a
 * refusal on most turns after it, and a tangent into an assistant's answer.
 * So it stays on the glass and on disk, which is what was said, and out of
 * the window, the fold and the judgement, which is what is read. His line
 * before it stays: he said it. */
export const readAgain = <T extends Message>(lines: readonly T[]): T[] =>
  lines.filter((m) => m.role !== 'assistant' || !asItself(m.content));

/** Which words to use for the two of them. A character made by hand --
    a test's, an old caller's -- without the pair is the pair the prompts
    were first written in. */
export const voiceOf = (c: Pick<Character, 'pronouns'>): Voice => c.pronouns ?? DEFAULT_VOICE;

/** The card a sheet draws, or an empty one when nothing has been scored or
    the game has standing turned off. */
export const card = (c: Character): TopLine =>
  c.cfg.relation.enabled ? standingCard(c.relation) : {};

/** Fill a prompt's `{name}` slots.
 *
 * One pass, with the values handed in and never String.replace's own `$`
 * patterns: what goes in here is a memory, a transcript and a reply, all of
 * which are full of characters that would otherwise be read as instructions.
 */
export function fill(template: string, values: Record<string, string>, voice?: Voice): string {
  if (voice) return voiced(template, voice, values);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** One short call, whole. Nothing here streams to anybody: these are a
    handful of bullets or one line of JSON. */
async function once(
  o: {system: string; user: string; temperature: number; max_tokens: number},
  run: Run,
): Promise<string | undefined> {
  return run(async (signal) => {
    let out = '';
    for await (const delta of chat({
      messages: [{role: 'system', content: o.system}, {role: 'user', content: o.user}],
      temperature: o.temperature, max_tokens: o.max_tokens, signal,
    })) out += delta;
    return out;
  });
}

/* ---- memory --------------------------------------------------------------- */

/** What a fold came to. `folded` is the only one that wrote anything. */
export type Folded = 'folded' | 'empty' | 'moved' | 'left' | 'declined' | 'off';

/** Fold what fell out of the window -- or, at the end of a walk, the whole of
 *  what was said -- into long-term memory.
 *
 * `more` is anything the caller knows about him that the transcript does
 * not: how he walked, what his hands did. Given as a finished paragraph under
 * its own heading, it goes into the question beside the talk, because how
 * somebody plays is as much a fact about him as what he says.
 *
 * Months of evenings, rewritten wholesale from the output of a language model
 * every time this runs. There is no other copy of it anywhere, which is why
 * nothing here moves on an answer that came back empty, and why a hand that
 * touched the memory while this was out at the model wins.
 */
export async function fold(
  c: Character, dropped: readonly Message[], o: Calling & {more?: string} = {},
): Promise<Folded> {
  const cfg = c.cfg.memory;
  if (!cfg.enabled) return 'off';
  if (c.folding) return 'declined';
  if (!dropped.length && !(o.more ?? '').trim()) return 'empty';
  const say = o.say ?? says;
  const still = o.still ?? (() => true);
  c.folding = true;
  try {
    /* Taken before the model is asked and compared after: see `epoch`. */
    const era = c.epoch;
    const existing = c.memory || '(nothing yet)';
    /* Named, not roled. Handed "user:" and "assistant:", the folder wrote its
       memories about "the assistant" -- and worse, read everything on a user:
       line as something he said about himself. He does not only speak as
       himself: he asks for a register and gives samples of it, writes lines
       for the character to say, sets a scene to play in. All of that arrives
       in the first person on his turn, and has been folded into the memory as
       biography.

       A name on each turn is what makes the difference legible, and it costs
       nothing: the character's own name is what the memory would call her
       anyway. */
    const hers = c.persona.name || c.persona.pill || 'you';
    const convo = readAgain(dropped)
      .map((m) => `${m.role === 'user' ? words(voiceOf(c).other).him : hers}: ${m.content}`).join('\n');
    const raw = await once({
      system: fill(c.prompts.fold_system ?? '', {name: hers}, voiceOf(c)),
      user: fill(c.prompts.fold_user ?? '', {
        existing,
        dropped: convo || '(nothing was said)',
        more: (o.more ?? '').trim(),
        max_bullets: String(cfg.max_bullets),
      }, voiceOf(c)),
      temperature: 0.3,
      max_tokens: 400,
    }, o.run ?? straight);
    if (raw === undefined) return 'declined';
    /* A fold the model answered as itself is not a memory: kept, it would
       be a bullet in front of every reply from now on. */
    if (asItself(raw)) {
      say('memory fold came back as the model refusing — not kept, trying again after the next turn', 'warn');
      return 'empty';
    }
    const kept = clean(raw, cfg.max_bullets);
    if (!still()) return 'left';          // the character was put away mid-fold
    if (c.epoch !== era) {
      /* Somebody rewrote the memory while this was being folded. What they
         wrote is the memory; the caller's mark stays where it is, so these
         turns are folded into it after the next one. */
      say('the memory was written by hand while it was being folded — '
        + 'the fold was dropped, and those turns are folded in after the next one', 'warn');
      return 'moved';
    }
    if (!kept) {
      /* Nothing was written, so nothing has been remembered, and the caller's
         mark stays where it is: these turns are folded again after the next
         one. Moving it first meant a fold interrupted by a Stop, or one the
         model answered with preamble, dropped those turns out of the window
         and out of the memory both. Silently, and for good. */
      say('memory fold came back empty — trying again after the next turn', 'warn');
      return 'empty';
    }
    await F.saveMemory(c.slug, kept);
    c.memory = kept;
    return 'folded';
  } catch (e) {
    say(`memory fold failed: ${why(e)}`, 'warn');
    return 'declined';
  } finally {
    c.folding = false;
  }
}

/** What the character remembers, as somebody has just rewritten it by hand.
    The file and the character's copy, and a fold that is out at the model
    right now writes nothing: what it would write is the memory as it was
    before this was typed. */
export async function remember(c: Character | null, slug: string, text: string): Promise<void> {
  const kept = (text || '').trim();
  await F.saveMemory(slug, kept);
  if (c && c.slug === slug) {
    c.memory = kept;
    touch(c);
  }
}

/* ---- where you stand ------------------------------------------------------ */

/** Judge the exchange that just happened, and move where you stand.
 *
 * Shown the exchange and nothing else -- never the accumulated score -- so it
 * cannot talk itself into a direction. What comes back is the standing as it
 * now is, or null when nothing moved, or the caller had moved on, or a hand
 * had been on it in the meantime -- in which case the judgement is dropped,
 * because applying it would put a standing back that somebody had just
 * cleared, which read as a reset that did not work.
 */
export async function judge(
  c: Character, him: string, her: string, o: Calling = {},
): Promise<Standing | null> {
  const cfg = c.cfg.relation;
  if (!cfg.enabled || !cfg.score) return null;
  // Nothing she said: the model, as itself (see readAgain).
  if (asItself(her)) return null;
  const say = o.say ?? says;
  const still = o.still ?? (() => true);
  const era = c.epoch;
  try {
    const raw = await once({
      system: voiced(c.prompts.relation_system ?? '', voiceOf(c)),
      user: fill(c.prompts.relation_user ?? '',
                 {him_said: him.trim(), her_said: her.trim().slice(0, 400)}, voiceOf(c)),
      temperature: 0.1,
      // One line of JSON. The cap matters because the model serves one request
      // at a time: every token this spends is a token the next reply waits
      // for, if you answer before the character has finished speaking.
      max_tokens: 48,
    }, o.run ?? straight);
    if (raw === undefined) return null;
    const [deltas, whyMoved] = readDeltas(raw);
    if (!Object.values(deltas).some((d) => d)) return null;
    if (!still()) return null;
    if (c.epoch !== era) {
      say('where you stand was changed while that was being judged — '
        + 'the judgement was dropped', 'warn');
      return null;
    }
    const state = applyDeltas(c.relation ?? blank(), deltas, whyMoved);
    await F.saveRelation(c.slug, state);
    c.relation = state;
    const moved = state.log[state.log.length - 1];
    /* The numbers and not the reason. The scorer's `why` is a sentence about
       the exchange it was shown -- written out of what was said -- and the
       log rule is that none of that is ever written down. It is in the
       relation file, which is where somebody asking "why did it move" is
       looking anyway. */
    const [word, temper] = standing(state);
    say(`standing moved ${moved?.moved ?? ''} — now ${word}${temper ? `, ${temper}` : ''}`);
    return state;
  } catch (e) {
    say(`relation scoring failed: ${why(e)}`, 'warn');
    return null;
  }
}

/** Put the character at a warmth, by hand, to see what it looks like. Both
    axes, because they are not the same thing to look at: warmth is where you
    stand and moves over weeks, mood is today. Stamped as of now, since every
    read decays first and a number written next to yesterday's timestamp has
    already faded by the time it is read. */
export async function stand(c: Character, warmth: number, mood?: number): Promise<Standing> {
  const state: Standing = {
    ...decayed(c.relation ?? blank()),
    warmth: Math.max(-LIMIT, Math.min(LIMIT, warmth)),
    updated: Date.now() / 1000,
  };
  if (mood !== undefined) state.mood = Math.max(-LIMIT, Math.min(LIMIT, mood));
  touch(c);                            // a hand on the axes, same as a reset
  await F.saveRelation(c.slug, state);
  c.relation = state;
  return state;
}

/** Where you stand, back to nothing: the file, and the character's copy, and
    a judgement already out at the model is about the standing this just
    cleared and must not put it back. Returns whether there was one. */
export async function unstand(c: Character | null, slug: string): Promise<boolean> {
  const had = await F.resetRelation(slug);
  if (c && c.slug === slug) {
    c.relation = null;
    touch(c);
  }
  return had;
}

/* ---- the persona, taken again --------------------------------------------- */

/** Take the character again, after somebody has changed it: the cache is
    dropped, the two files are read again, and what came back is the persona
    from the next prompt on. Returns what it was, so a caller can see whether
    the voice changed. */
export async function refresh(c: Character): Promise<PersonaCard> {
  forget(c.slug);
  const fresh = await effectivePersona(c.slug);
  const was = c.persona;
  c.persona = fresh;
  return was;
}

/* ---- without a character open: what a sheet reads and writes ------------- */

/** What it remembers, off the file. */
export const memoryOf = (slug: string): Promise<string> => F.memory(slug);

/** Where you stand, off the file, as the card a sheet draws. */
export async function standingOf(slug: string): Promise<TopLine> {
  const onDisk = await F.relation(slug).catch(() => null);
  return standingCard(onDisk ? decayed(readStanding(onDisk)) : null);
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
