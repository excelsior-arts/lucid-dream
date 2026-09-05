/* What the model is shown, and in what order.
 *
 * Ported from session.py: `_memory_block`, `_relation_block`, `_state_press`,
 * `_scene_press`, `_unstick` and `_window`, plus personas.system_prompt. All of
 * it is one decision made over and over -- what holds still goes in front, what
 * moves goes on the end -- and the reason is the prompt cache. See `window`,
 * which is the one place that still breaks the rule.
 */
import type {Message} from '@lucid/machine';
import type {PersonaCard} from '../link/shapes';
import {asPromptBlock as memoryBlockOf} from './memory';
import type {Standing} from './relation';
import {asPromptBlock as relationBlockOf, conduct, decayed} from './relation';
import {asPromptBlock as sceneBlockOf} from './scene';

/** The prompts, by name, as conversation/bundle.ts reads them out of the
    package. */
export type Prompts = Readonly<Record<string, string>>;

/* How much of a conversation is sent. The machine's numbers, from the `llm`
   block of its config: live context is deliberately short, because
   time-to-first-token climbs steeply past ~4 exchanges (1.6s at 4, 3.3s at 6,
   4.6s at 12 on this machine). Long-term continuity comes from memory, not from
   a bigger window. */
export const CONTEXT_TURNS = 6;      // user+assistant pairs kept in context
export const CONTEXT_WORDS = 600;    // and a ceiling on their length; 0 is none

export function systemPrompt(persona: PersonaCard, prompts: Prompts): string {
  // System first, persona last. The model weights what it read most recently,
  // so anything generic sitting after a persona quietly overrides it -- which
  // is why system.md carries no style or length guidance, only the facts about
  // being spoken aloud that the model cannot work out for itself.
  return (prompts.system ?? '').replace(/\s+$/, '') + '\n\n' + (persona.prompt ?? '').trim();
}

/** What the pill remembers about you, for the system prompt.
 *
 * This belongs in front, with the persona, and that is a decision rather than
 * an accident: it changes only when a fold writes a memory, which is a handful
 * of times an evening. The system prompt is the front of the prefix the LLM
 * server actually caches — see `window` — so the test for putting something
 * here is not "is it about the person" but "does it hold still". Memory does.
 * The relation's *numbers* do not, which is why what goes in beside this is the
 * banded prose and not the state.
 */
export function memoryBlock(mem: string, prompts: Prompts): string {
  return memoryBlockOf(mem, prompts.memory_intro ?? '');
}

/** Where you stand with the pill. Facts are memory's job; this is stance. */
export function relationBlock(state: Standing | null, prompts: Prompts, now?: number): string {
  if (!state) return '';
  return relationBlockOf(state, prompts.relation_intro ?? '', now);
}

/** The whole of what goes in front of a conversation: the persona, what it
    remembers of you, and where you stand. Every part of it changes a handful of
    times an evening and no oftener, which is what makes the prefix cacheable. */
export function systemFor(
  persona: PersonaCard, prompts: Prompts, mem: string, state: Standing | null, now?: number,
): string {
  return systemPrompt(persona, prompts) + memoryBlock(mem, prompts)
    + relationBlock(state, prompts, now);
}

export interface WindowOptions {
  contextTurns?: number;
  contextWords?: number;
  /** Where the window was cut last time, as an index into `history`.
   *
   * Given one, the same cut is kept for as long as it is anywhere near right
   * -- see `cut` below, which is the whole of the prompt-cache fix. Left out,
   * the window is cut to fit exactly, which is what a caller with nowhere to
   * keep a mark gets. */
  from?: number;
}

/** How far over the limits a window is allowed to run before it is cut again.
 *
 * Half a window, and half the word budget. A cut that drops the overrun plus
 * the excess means the next several turns fit without moving the start, and
 * the prefix in front of them is byte-identical for all of them. */
const SLACK = 0.5;

/** The window, and where it was cut.
 *
 * `window` is this without the bookkeeping. What a caller that keeps the mark
 * gets is a prompt whose first N messages are the same bytes turn after turn
 * -- see the note above, and room.ts, which holds `windowFrom`.
 */
export function windowCut(
  history: readonly Message[], o: WindowOptions = {},
): {from: number; messages: Message[]} {
  const turns = Math.max(2, (o.contextTurns ?? CONTEXT_TURNS) * 2);
  const budget = o.contextWords ?? CONTEXT_WORDS;
  const words = (m: Message) =>
    (m.content || '').trim() ? m.content.trim().split(/\s+/).length : 0;

  /** How much of the history from `at` onwards would be sent. */
  const size = (at: number): [number, number] => {
    let used = 0;
    for (let i = at; i < history.length; i++) used += words(history[i]!);
    return [history.length - at, used];
  };

  /** The tightest honest cut: the last `turns` messages, trimmed to the word
      budget, on an exchange boundary and never past the last one. */
  const tight = (): number => {
    let at = Math.max(0, history.length - turns);
    if (budget > 0) {
      let used = 0;
      let i = history.length - 1;
      for (; i >= at; i--) {
        const n = words(history[i]!);
        if (i < history.length - 1 && used + n > budget) break;
        used += n;
      }
      at = Math.max(at, i + 1);
    }
    return Math.min(at, Math.max(0, history.length - 1));
  };

  const was = o.from;
  if (was !== undefined && was >= 0 && was <= history.length - 1) {
    const [kept, used] = size(was);
    const overrun = kept > turns * (1 + SLACK)
      || (budget > 0 && used > budget * (1 + SLACK));
    if (!overrun) return {from: was, messages: history.slice(was)};
  }
  const at = tight();
  return {from: at, messages: history.slice(at)};
}

/** The recent messages to send, bounded by both count and size.
 *
 * contextTurns alone counts messages, not their length, and a pill's vary from
 * a few words to nearly two hundred -- so the prompt, and with it
 * time-to-first-token, swung by roughly 5x depending on how talkative the pill
 * had been. contextWords puts a ceiling on that. The last exchange is always
 * kept, however long it is.
 *
 * ---- and this is the one place that throws the prompt cache away ----
 *
 * mlx_lm keeps the prompts it has already processed and re-uses the longest
 * matching prefix — see LLMServer.args, where the cache is sized, and the
 * measurement there: 3.4s to first token against 1.6s. That is live, now, not a
 * thing to plan for.
 *
 * A cache is a bet on the *prefix* holding still, and everything else in this
 * prompt is built to hold it still. The persona and the memory block sit in the
 * system prompt and change a handful of times an evening. The relation is
 * quantised into bands, so the words only move when a band boundary is crossed.
 * The scene and the conduct are pressed onto the *last* user turn rather than
 * the front (see scenePress). All of that is deliberate and all of it is worth
 * keeping.
 *
 * This slides, and undoes it. `history[-turns:]` moves its start forward by one
 * exchange every exchange, so once a conversation outgrows the window every
 * turn changes the first token of the prompt and the cache matches nothing — at
 * exactly the length where it was paying for itself. The word budget below
 * trims from the same end and does the same thing.
 *
 * Measured over twelve turns at the settings in config.json: the first six
 * cache 21–42 new tokens each, the seventh misses entirely (976 tokens, 2.6s),
 * and every turn after it is pinned to the system prompt — 150 new tokens,
 * 0.80s, against 0.58s. Short evenings never notice; long ones look like the
 * model being slow rather than like a bug.
 *
 * ---- so it is cut in chunks --------------------------------------------
 *
 * Given where it was cut last time (`from`, which the room keeps), the window
 * is left exactly where it is until it has overrun the limits by half again --
 * and only then cut back to fit. The messages from that point on are the same
 * messages, in the same order, for every turn in between: history is only ever
 * appended to, so a start that does not move is a prefix that does not change.
 * One turn in several pays for a miss instead of all of them, and the fold --
 * which rewrites the memory in the system prompt, and so changes the prefix
 * anyway -- is the other moment the room re-cuts, where it costs nothing.
 *
 * A caller that keeps no mark gets the tight cut, which is what this always
 * did. The shape is what matters either way: stable in front, append-only in
 * the middle, volatile pressed onto the end.
 */
export function window(history: readonly Message[], o: WindowOptions = {}): Message[] {
  return windowCut(history, o).messages;
}

/** Break the model out of copying its own short replies.
 *
 * Once one clipped reply is in context the model imitates it, and every turn
 * after that is one line -- reliably, from a single one-word cue. Measured: with
 * its own short replies in context it returns one sentence every time; with no
 * assistant history at all the same prompt returns three. Instructions in the
 * system prompt do not touch it, and the server ignores repetition_penalty.
 *
 * What does work is a reminder at the very end, where recency favours it,
 * folded into the user turn -- a trailing system message is rejected. It is not
 * stored in history, so the transcript stays clean.
 */
export function unstick(messages: readonly Message[]): Message[] {
  const out = [...messages];
  const last = out[out.length - 1];
  if (!last || last.role !== 'user') return out;   // the nudge only rides along on a user turn
  const replies = out.filter((m) => m.role === 'assistant').slice(-2).map((m) => m.content);
  if (replies.length < 2) return out;
  const sentences = (t: string) => t.trim().split(/(?<=[.!?])\s+/).filter((x) => x).length;
  if (replies.some((r) => sentences(r) > 1)) return out;
  const words = replies[replies.length - 1]!.trim().split(/\s+/).filter((w) => w);
  const opener = words.length ? words[0]!.replace(/^[.,!?]+|[.,!?]+$/g, '').toLowerCase() : '';
  let nudge = 'Your last replies were single lines. This one is fuller: move the '
    + 'scene forward and put him somewhere.';
  if (opener) nudge += ` Do not start it with "${opener}" again.`;
  out[out.length - 1] = {...last, content: `${last.content}\n\n[${nudge}]`};
  return out;
}

/** Put the hard rules where the model will actually act on them.
 *
 * The same lesson as `unstick`: instructions in the system prompt lose to the
 * persona sitting right after them, while the same words at the end of the user
 * turn land. So the state describes the feeling up there and says what it does
 * down here. Nothing here limits how long the reply may be — whatever the pill
 * says, you get all of it.
 *
 * And it is the right place for a second reason that costs nothing to keep:
 * this text moves as the relation moves, and pressing it onto the last user
 * turn leaves everything before it untouched. See scenePress.
 */
export function statePress(
  messages: readonly Message[], state: Standing | null, now?: number,
): Message[] {
  const out = [...messages];
  if (!state) return out;
  const text = conduct(decayed(state, now));
  const last = out[out.length - 1];
  if (!text || !last || last.role !== 'user') return out;
  out[out.length - 1] = {...last, content: `${last.content}\n\n[${text}]`};
  return out;
}

/** Put the room back in front of the pill.
 *
 * On the last user turn rather than in the system prompt, so that the stable
 * prefix in front stays cached — the scene changes, the persona does not.
 *
 * In front of what he said rather than after it, which is the correction. It
 * rode at the very end for a while, on the reasoning that what is said last is
 * acted on -- and it was: the pill answered the room instead of the man. Once a
 * place settles, Place is the same sentence every turn (measured: identical
 * across ten turns of one evening), so the last thing in the context was the
 * same room described over and over, and replies opened by narrating it back to
 * somebody standing in it. Ahead of his words it is still present every turn,
 * which is what folding needs, and the freshest thing is the person who just
 * spoke.
 *
 * Cost of the move: nothing. Everything before the last message is untouched,
 * so the cached prefix is the same length either way, and that final message is
 * new tokens whichever end the block goes on.
 *
 * The second reason is worth more than it looks, because the cache is real:
 * mlx_lm re-uses the longest prefix it has already processed. So the rule is
 * that anything which changes during a conversation goes on the last user turn
 * and never in front of the history. Adding one volatile line to the system
 * prompt costs nothing to write and about two seconds a turn thereafter. See
 * `window`, which is the one place that still breaks the rule.
 */
export function scenePress(
  messages: readonly Message[], scene: string, prompts: Prompts,
): Message[] {
  const out = [...messages];
  const block = sceneBlockOf(scene, prompts.scene_intro ?? '');
  const last = out[out.length - 1];
  if (!block || !last || last.role !== 'user') return out;
  out[out.length - 1] = {...last, content: block.trim() + '\n\n' + last.content};
  return out;
}
