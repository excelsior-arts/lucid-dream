/* A model that stops answering, noticed.
 *
 * One rule for both machines, and these are its numbers. Once words are
 * flowing, a model that working would write several a second: fifteen
 * seconds with no new one is a stall. Before the first word it is reading
 * the prompt, which at 8192 tokens of context, or on a model just woken, can
 * take tens of seconds: ninety. Starting the model is not counted at all --
 * both machines answer a chat only once the model is up (machine.py's chat
 * route waits on start_llm, page/machine.ts on the engine's start), and the
 * clock below starts from that answer.
 *
 * Each machine keeps the rule itself and recovers from it -- the Mac's kills
 * and restarts its model server (machine/models.py, Stalled), the browser's
 * puts its worker down (page/engine.ts) -- and says so in the stream, with
 * `not_answering` on the frame. The page keeps it as well, a little later
 * (`LATE_MS`), for a machine that says nothing at all: see streamChat.
 */
import {Told} from './told';

/** Before the first word: the prompt being read. */
export const FIRST_WORD_MS = 90_000;
/** Between words, once they are flowing. */
export const NEXT_WORD_MS = 15_000;
/** How much later than the machine the page gives up on its own: long
    enough for the machine's word -- and its recovery -- to arrive first. */
export const LATE_MS = 5_000;

/** The model stopped answering part-way: it stalled, the GPU let go of it,
    the stream dropped. Not a refusal, and not a model that would not start:
    the machine is waking it, and the room says so quietly rather than with
    a banner (talk's turn.ts). */
export class NotAnswering extends Told {
  constructor(message = 'the language model stopped answering') {
    super(message);
    this.name = 'NotAnswering';
  }
}

/** No new word within its time. */
export class Stalled extends NotAnswering {
  constructor(message = 'the language model stopped answering — it is started again for the next line') {
    super(message);
    this.name = 'Stalled';
  }
}

/** The stream went away under a reply: a connection reset, a machine gone. */
export class Dropped extends NotAnswering {
  constructor(why = '') {
    super(`the reply’s stream dropped${why ? ` (${why})` : ''}`);
    this.name = 'Dropped';
  }
}

/** A step, or the stall it turned into. */
export function within<T>(step: Promise<T>, ms: number, stalled: () => Error = () => new Stalled()): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(stalled()), ms); });
  return Promise.race([step, late]).finally(() => clearTimeout(timer));
}
