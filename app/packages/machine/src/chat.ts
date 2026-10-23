/* One turn of a language model, as a stream of text.
 *
 * The body is an OpenAI chat body and the frames are the ones mlx_lm sends --
 * `choices[0].delta.content`, then `[DONE]` -- because that is what every
 * client of a chat endpoint already knows how to read, and because a hosted
 * provider will send the same. See machine/machine.py, chat_frames.
 *
 * Nothing here knows what a persona is. Messages in, words out.
 */
import {call} from './address';
import {Dropped, FIRST_WORD_MS, LATE_MS, NEXT_WORD_MS, NotAnswering, Stalled, within} from './stall';
import {Told} from './told';

export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface ChatOptions {
  messages: Message[];
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  /** Abort it. The machine reads the flag inside its own generation loop, so
      a reply nobody will hear stops being written rather than being written
      into a socket nobody is reading. */
  signal?: AbortSignal;
  /** How long the page waits for the first word and for each after it
      before it calls the model stopped (stall.ts): the machine's own rule,
      a little later. A test's to shorten. */
  firstMs?: number;
  nextMs?: number;
}

/** What a `data:` line carried. Only the two fields anybody reads. */
interface Frame {
  choices?: Array<{delta?: {content?: string}}>;
  error?: string;
  /** The error is in the page's own words (told.ts): only a browser's
      stand-in sends it. */
  told?: boolean;
  /** The model stopped answering part-way, and the machine is waking it
      (stall.ts): said quietly, not as a failure of the request. */
  not_answering?: boolean;
}

/** One chat call, yielding the deltas as they arrive.
 *
 * Aborting the caller's signal closes the response body, which the machine
 * sees as the page having gone: generation stops there rather than running to
 * the end of a reply that was interrupted a sentence in.
 */
export async function* streamChat(o: ChatOptions): AsyncIterable<string> {
  const body: Record<string, unknown> = {messages: o.messages, stream: true};
  // Only what was actually set. A null temperature is a persona with no
  // opinion about temperature, and sending it as one is a different reply.
  if (o.temperature != null) body.temperature = o.temperature;
  if (o.top_p != null) body.top_p = o.top_p;
  if (o.max_tokens != null) body.max_tokens = o.max_tokens;

  const res = await call('/machine/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok || !res.body) {
    const why = await res.text().catch(() => '');
    throw new Error('the language model answered ' + res.status + (why ? ': ' + why : ''));
  }

  const reader = res.body.getReader();
  const decode = new TextDecoder();
  /* Frames arrive in whatever lumps the network made of them, so a `data:`
     line can be split across two reads and two of them can share one. What is
     held here is the tail that has no newline on it yet. */
  let rest = '';
  /* The page's own watch on the model, behind the machine's (stall.ts): from
     the machine's answer, the first word within FIRST_WORD_MS and each after
     it within NEXT_WORD_MS, each a little later than the machine would have
     said so itself. Counted from the last word, not the last read -- a frame
     with no words in it is not the model answering -- and only while this
     waits on the stream: the time a reader spends with a word, handing a
     sentence to the voice, is not the model's. */
  const firstMs = (o.firstMs ?? FIRST_WORD_MS) + LATE_MS;
  const nextMs = (o.nextMs ?? NEXT_WORD_MS) + LATE_MS;
  let flowing = false;
  /** Waited on the stream since the last word. */
  let waited = 0;
  /** The next lump of the body, or the stall, or the stream gone. */
  const read = async () => {
    const began = Date.now();
    try {
      const ms = flowing ? nextMs : firstMs;
      return await within(reader.read(), Math.max(0, ms - waited),
                          () => new Stalled(`the machine sent no word for ${Math.round(ms / 1000)} s`));
    } catch (e) {
      /* Ours to stop, or a stall: as it is. A read that failed under nobody
         stopping it is the stream dropped -- a reset, a machine gone -- and
         the reply breaks off there (reply.ts). */
      if (o.signal?.aborted || e instanceof NotAnswering) throw e;
      throw new Dropped(e instanceof Error ? e.message : String(e));
    } finally {
      waited += Date.now() - began;
    }
  };
  /* One line of the stream: the words in it, or the end of it. */
  function* take(line: string): Generator<string, boolean> {
    if (!line.startsWith('data:')) return false;      // the blank line between frames
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return true;
    let frame: Frame;
    try {
      frame = JSON.parse(payload) as Frame;
    } catch {
      return false;                                   // not ours to make sense of
    }
    if (frame.error) {
      throw frame.not_answering ? new NotAnswering(frame.error)
        : frame.told ? new Told(frame.error) : new Error(frame.error);
    }
    const delta = frame.choices?.[0]?.delta?.content;
    if (delta) { flowing = true; waited = 0; yield delta; }
    return false;
  }
  try {
    for (;;) {
      const {done, value} = await read();
      if (done) break;
      rest += decode.decode(value, {stream: true});
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (yield* take(line)) return;
      }
    }
    /* The tail, once the body has ended: a last frame the machine flushed
       without a newline behind it was dropped, and its [DONE] never seen. */
    rest += decode.decode();
    if (rest.trim()) yield* take(rest);
  } finally {
    /* Whatever ended this -- the end of the reply, an interrupt, a throw --
       the body is let go of here. Cancelling it is what tells the machine
       nobody is listening. */
    await reader.cancel().catch(() => {});
  }
}
