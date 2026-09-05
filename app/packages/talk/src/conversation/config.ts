/* What this game is tuned to.
 *
 * What the game ships with, in `manifest.ts`, merged with whatever this player
 * has changed: how much a pill remembers and when it folds, whether where you
 * stand is scored, how often the room is written down, and the window all
 * three of those are measured against. Every trigger in the loop is one of
 * these numbers, so the page reads the whole file rather than a hand-picked
 * few.
 *
 * Read once when a room opens, over the shipped answers, so a missing key or a
 * machine that will not answer is a room that runs on what the game ships with
 * rather than a room that does not open.
 */
import {settings} from '../manifest';
import * as F from './files';

export interface MemoryConfig {
  enabled: boolean;
  /** Messages that must fall out of the window before folding runs. */
  fold_after: number;
  /** The whole memory block, and a hard budget rather than a target: every
      bullet is re-prefilled on every turn, so a fact earns its place by
      displacing a weaker one. */
  max_bullets: number;
}

export interface RelationConfig {
  enabled: boolean;
  /** Judging costs one short call per exchange, run while it is still
      speaking. Off freezes the state where it is: the feelings still color its
      replies, nothing moves them any more. */
  score: boolean;
}

export interface SceneConfig {
  enabled: boolean;
  /** Words spoken since the last note, not turns. A turn is anything from
      "mm-hm" to four hundred words, so counting them measures nothing. */
  every_words: number;
}

export interface LlmConfig {
  context_turns: number;
  context_words: number;
  /** What this machine is tuned to, for a persona with no opinion of its own.
      The same fallback the reply itself is generated with, and what the room
      is built at. */
  temperature: number;
  top_p: number;
}

export interface UiConfig {
  /** How long a dose lasts: how long "keep going" runs when you press Play.
      Set on the lid of the open box, where the tally of what each pill has
      given you is — so it is a thing you change in passing rather than a
      question anybody is asked before they are allowed to take one. */
  continuous_minutes: number;
}

export interface GameConfig {
  memory: MemoryConfig;
  relation: RelationConfig;
  scene: SceneConfig;
  llm: LlmConfig;
  ui: UiConfig;
  /** How long a room may be left and still be the same sitting, in minutes.
      A reload, a dropped socket, a phone locking itself in a pocket are not
      new dreams; anything longer is a decision, and a decision should start
      something. 0 always starts fresh. See room.ts, `recentSession`. */
  resume_within_minutes: number;
}

/* How much of a conversation is sent, and how varied the words are. The
   machine's numbers rather than the game's -- the same ones as `config.py`'s
   `llm` block -- and written down here because they are read on every turn by
   a page that must not stop working when nothing answers. A persona overrides
   the sampling with its own; a player overrides all four in their
   config.json. */
const LLM: LlmConfig = {
  context_turns: 6, context_words: 600, temperature: 0.8, top_p: 0.95,
};

/** What the game ships tuned to, as the page reads it. See manifest.ts, which
    is where the answers and the reasons for them are written down. */
export const DEFAULTS: GameConfig = {
  memory: settings.memory,
  relation: settings.relation,
  scene: settings.scene,
  llm: LLM,
  ui: settings.ui,
  resume_within_minutes: settings.resume_within_minutes,
};

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Whatever the machine says, shaped and bounded by what the game ships with. */
export function readConfig(raw: unknown): GameConfig {
  const got = (raw ?? {}) as Record<string, unknown>;
  const section = (name: string): Record<string, unknown> =>
    (got[name] as Record<string, unknown> | undefined) ?? {};
  const mem = section('memory');
  const rel = section('relation');
  const scn = section('scene');
  const llm = section('llm');
  const ui = section('ui');
  return {
    memory: {
      enabled: bool(mem.enabled, DEFAULTS.memory.enabled),
      fold_after: num(mem.fold_after, DEFAULTS.memory.fold_after),
      max_bullets: num(mem.max_bullets, DEFAULTS.memory.max_bullets),
    },
    relation: {
      enabled: bool(rel.enabled, DEFAULTS.relation.enabled),
      score: bool(rel.score, DEFAULTS.relation.score),
    },
    scene: {
      enabled: bool(scn.enabled, DEFAULTS.scene.enabled),
      every_words: num(scn.every_words, DEFAULTS.scene.every_words),
    },
    llm: {
      context_turns: num(llm.context_turns, DEFAULTS.llm.context_turns),
      context_words: num(llm.context_words, DEFAULTS.llm.context_words),
      temperature: num(llm.temperature, DEFAULTS.llm.temperature),
      top_p: num(llm.top_p, DEFAULTS.llm.top_p),
    },
    ui: {
      continuous_minutes: num(ui.continuous_minutes,
                              DEFAULTS.ui.continuous_minutes),
    },
    resume_within_minutes: num(got.resume_within_minutes,
                               DEFAULTS.resume_within_minutes),
  };
}

/** What the machine is tuned to, or the defaults if it will not say. */
export async function gameConfig(): Promise<GameConfig> {
  try {
    return readConfig(await F.config());
  } catch {
    return readConfig({});
  }
}
