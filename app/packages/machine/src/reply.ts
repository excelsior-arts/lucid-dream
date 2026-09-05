/* One reply: text streamed in, sentences spoken out.
 *
 * Nothing here knows about a persona, a transcript, a scene or a standing: it
 * is handed messages and a voice and nothing else. Any game with a speaking
 * character wants exactly this, which is why it is here rather than in one.
 *
 * The shape of it: the model writes, whole sentences are handed to the voice
 * as soon as they exist, the frames go into the page's own queue, and what was
 * actually heard is what gets stored if somebody cuts it off.
 */
import type {Pacer, Playback} from '@lucid/audio';
import type {ChatOptions, Message} from './chat';
import {streamChat} from './chat';
import {mergeFor, splitForSpeech, spokenPrefix} from './speech';
import type {Voice} from './tts';

export interface ReplyOptions {
  messages: Message[];
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  /** The socket the sentences are spoken down. Opened and closed by whoever
      owns the room: a reply borrows it.
   *
   * Null is a reply with no voice, which is what the sound being fully muted
   * means: nothing is sent, so no socket is opened and no voice is loaded on
   * the machine for words nobody will hear. The reply is otherwise the same
   * reply — it streams, it is kept, it can be interrupted — and the words are
   * released to the page at a reading pace instead (see the pacer). Decided
   * by the caller when the reply starts and fixed for the whole of it: a
   * voice cannot be given to a reply half-way through, because the half
   * already written was never sent to one. */
  voice: Voice | null;
  /** This page's queue. The frames go in here and nowhere else. */
  playback: Playback;
  /** Given one, the words are released against the voice here. A caller that
      puts the reply into a store something else paces from -- which is what
      the room does -- leaves this out, or the words arrive twice. */
  pacer?: Pacer;
  /** The next words of the reply, as they are written. */
  onDelta?: (delta: string) => void;
  /** The first chunk has been handed to the voice: the state is `speaking`
      rather than `thinking`. */
  onSpeaking?: () => void;
  /** A chunk has been handed to the voice: its size, and what decided it.
      Counts only, never the words -- this is for a log, and the words of a
      conversation do not go in one. `n` counts from 1 within the reply;
      `queuedS` is the audio waiting when the cut was made and `merge` the
      cap that came of it; see mergeFor. */
  onChunk?: (chunk: {n: number; words: number; chars: number; queuedS: number;
                     merge: number; paragraph: boolean}) => void;
  /** What to keep. `text` is the model's own writing, cut where the voice
      stopped if it was; `spoken` is the chunks that were actually said.
      Not called at all when nothing was said -- see below. */
  onDone?: (text: string, spoken: string[]) => void;
  /** The model would not answer, or the voice would not speak. */
  onTrouble?: (e: Error) => void;
  /** Cut from outside: the room was left, the page went away. */
  signal?: AbortSignal;
}

export interface Reply {
  /** Settles when the reply is over, however it ended. It never rejects:
      trouble goes to `onTrouble`, because a turn that failed is still a turn
      that finished. */
  done: Promise<void>;
  /** Cut it off here. Generation stops, the queue goes, and what is stored is
      what was heard rather than what was written. */
  interrupt(): void;
  /** Stop this one line. The same thing on this end -- there is one reply
      here -- and a different thing to whoever called it: an interrupt ends a
      run, a skip takes the next turn of it. */
  skip(): void;
  /** Let the line it is on land, and stop after it.
   *
   * `soft` on the queue rather than a hard stop, and that is the whole of the
   * difference: cutting a voice off mid-word to answer somebody reads as a
   * machine glitching, and the half second it costs to finish the line is the
   * difference between being interrupted and being listened to. What is
   * queued behind that chunk goes; nothing more is generated. Ported from
   * session.py `steer`. */
  steer(): void;
  /** Pause, or let it go on. The sound in the room, not the tape. */
  hold(on: boolean): void;
  /** What of this reply has been spoken, as it stands right now.
   *
   * The same text `onDone` would keep if it were interrupted at this moment,
   * and it exists for the one caller that has no chance to interrupt: a page
   * being closed mid-reply. The user's line is on disk by then and the answer
   * is not, so resuming showed a question nobody answered -- and the Python
   * this replaced stored what had been heard. See Room.tsx, `pagehide`. */
  snapshot(): string;
  /** Whether this reply is still between its first chunk and its last.
   *
   * Python held the speaker across this stretch, and the note there is worth
   * keeping: a reply is a run of sentences with gaps between them, and an
   * unheld gap is a microphone opening into the pill's next sentence. The
   * microphone's half of that is the page's own now -- the detector reads the
   * queue and knows a gap from a silence without being told (see vad.ts) --
   * and what is left here is the pacing: whether there is still a reply in
   * flight, which is what a run waits on before it writes the next turn. */
  readonly holding: boolean;
}

export function runReply(o: ReplyOptions): Reply {
  const cut = new AbortController();
  if (o.signal) {
    if (o.signal.aborted) cut.abort();
    else o.signal.addEventListener('abort', () => cut.abort(), {once: true});
  }

  const spoken: string[] = [];

  const credits: number[] = [];          // characters the voice made for each

  const bankedAtStart = o.playback.spokenChars;
  /* The model's own text so far. Out here rather than inside `work` because a
     snapshot can be asked for at any moment, including one where nothing is
     going to run again -- the page is going away. */
  let full = '';
  let buffer = '';
  let startedSpeaking = false;
  let stopped = false;
  let holding = false;

  /** Speak whole sentences as soon as they exist — no waiting for the full reply.
   *
   * How many go in one call depends on how much audio is already waiting:
   * with none, a sentence is sent the moment it is complete; with seconds of
   * it, sentences are carried together, which is fewer seams in the voice and
   * less work for the machine, paid for out of time the page was going to
   * spend playing anyway. See mergeFor. Muted, nothing is queued and nothing
   * is spoken, so the size of a chunk is nobody's concern. */
  async function flush(final: boolean): Promise<void> {
    // Hurry only the opening, and only until something is playing.
    const queuedS = o.voice ? o.playback.queuedS : 0;
    const merge = mergeFor(queuedS);
    const chunks = splitForSpeech(buffer, {firstShort: !startedSpeaking, merge});
    if (!final && chunks.length <= 1) return;
    const take = final ? chunks : chunks.slice(0, -1);
    const rest = final ? '' : chunks[chunks.length - 1] ?? '';
    for (const chunk of take) {
      if (stopped) return;
      if (!startedSpeaking) {
        startedSpeaking = true;
        o.onSpeaking?.();
      }
      if (!chunk.trim()) continue;
      /* Kept as said even when nothing said it: what "spoken" is for is the
         cut an interrupt makes -- how much of the reply got out -- and with
         no voice what got out is what the page was handed. An empty list here
         is a muted reply cut off half-way leaving nothing behind at all. */
      spoken.push(chunk);
      credits.push(0);
      if (!o.voice) continue;         // muted: nothing is sent, so nothing is made
      try {
        /* The paragraph marker, the way the splitter writes it: a trailing
           newline is a thought ending, and the machine puts a beat after it. */
        const endsParagraph = chunk.endsWith('\n');
        const text = endsParagraph ? chunk.slice(0, -1) : chunk;
        o.onChunk?.({n: spoken.length, words: text.trim().split(/\s+/).filter(Boolean).length,
                     chars: text.length, queuedS: Math.round(queuedS * 10) / 10, merge,
                     paragraph: endsParagraph});
        for await (const frame of o.voice.speak(text, endsParagraph)) {
          if (stopped) return;
          o.playback.enqueue(frame.pcm, frame.rate);
          /* What that audio just covered, in characters of the reply as
             written. The page paces the text against the voice, and it cannot
             work this out for itself: the machine strips bracketed tags and
             every asterisk before synthesis, so counting the characters it
             streamed would count markup that is never said, and read the voice
             as faster than it is. The +1 is the whitespace this chunk was
             split on, and it arrives on the first frame of the chunk. */
          if (frame.chars) {
            o.playback.credit(frame.chars);
            credits[credits.length - 1] = (credits[credits.length - 1] ?? 0) + frame.chars;
          }
        }
      } catch (e) {
        o.onTrouble?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
    buffer = rest;
  }

  async function work(): Promise<void> {
    // Held from here, not from the first chunk: the sentences of a reply
    // arrive with gaps between them, and an unheld gap is a microphone opening
    // into the pill's next sentence.
    holding = true;
    o.playback.expect(true);
    try {
      for await (const delta of streamChat({
        messages: o.messages,
        temperature: o.temperature,
        top_p: o.top_p,
        max_tokens: o.max_tokens,
        signal: cut.signal,
      } satisfies ChatOptions)) {
        if (stopped) break;
        full += delta;
        buffer += delta;
        o.onDelta?.(delta);
        o.pacer?.feed(delta);
        await flush(false);
      }
    } catch (e) {
      /* An abort is this end doing what it was asked, not the model failing --
         and it falls through to the tail rather than returning, because a
         reply that was cut off still has a transcript to leave behind. It used
         to return here, and the bubble it had been streaming into stayed
         streaming for the rest of the evening: nothing ever said the reply was
         over, so the caret went on blinking under a line nobody was writing.
         A cut from outside, through `signal`, is the same thing said by the
         room being left: it is stopped, not in trouble. */
      if (!stopped && cut.signal.aborted) stop(false);
      if (!stopped) {
        o.onTrouble?.(e instanceof Error ? e : new Error(String(e)));
        holding = false;
        o.playback.expect(false);
        return;
      }
    }

    if (!stopped) await flush(true);
    // Every sentence has been handed to the page, so there are no more gaps to
    // hold shut. What is left is the page playing what it has, which the queue
    // already knows about.
    holding = false;
    o.playback.expect(false);

    /* Keep the model's own text, line breaks and all. Rejoining the speech
       chunks with single spaces flattened every paragraph, so a reply that
       streamed with breaks collapsed into a block the moment it finished. An
       interrupted reply is the exception: only what was actually spoken is
       true, and the rest was never heard. */
    const said = stopped
      /* Cut from what the model wrote rather than rebuilt out of the pieces it
         was spoken in — see spokenPrefix, which explains what rebuilding costs
         a transcript. */
      ? heard()
      : (full.trim() || spoken.join(' ').trim());
    if (!said) {
      // Cut off before a single token arrived: an empty turn would go into the
      // transcript and back to the model as context.
      o.pacer?.done('');
      return;
    }
    o.pacer?.done(said);
    o.onDone?.(said, stopped ? spoken.slice(0, heardAt ?? heardChunks()) : spoken);
  }

  /* How many of the chunks handed to the voice the room has actually heard.

     Handed is not heard: the voice runs ahead of the speaker, so three
     sentences are made and queued while the first is still playing, and an
     interrupt -- or a page closed mid-reply -- used to keep all three as
     said. The transcript then carried sentences nobody heard, and the model
     was shown them as context the next evening. The speaker banks a chunk's
     characters when it has been played, and says whose it is playing now;
     a chunk counts once the sound that carries it has started. Muted,
     nothing is played and what was handed to the page is what got out. */
  const heardChunks = (): number => {
    if (!o.voice) return spoken.length;
    const got = o.playback.spokenChars - bankedAtStart + o.playback.playingChars;
    let n = 0, sum = 0;
    for (const c of credits) {
      if (c <= 0) break;                    // not yet made: not heard
      sum += c;
      if (sum > got) break;
      n += 1;
    }
    return n;
  };
  let heardAt: number | null = null;

  const stop = (soft: boolean) => {
    if (stopped) return;
    stopped = true;
    holding = false;
    o.playback.expect(false);
    // Counted before the queue goes: the chunk in hand was being heard.
    heardAt = heardChunks();
    /* This end first, and this end at all: the queue that has to stop is on
       this page, and waiting for the machine to stop making a sentence nobody
       will hear is a sentence and a half of somebody talking over it. */
    o.playback.stop(soft);
    o.voice?.stop();
    cut.abort();
  };

  /** What was spoken of it, cut out of the model's own text. See `spokenPrefix`,
      which explains what rebuilding it out of the chunks costs a transcript. */
  const heard = (): string => {
    const got = spoken.slice(0, heardAt ?? heardChunks());
    return spokenPrefix(full, got).trim() || got.join(' ').trim();
  };

  return {
    done: work(),
    snapshot: heard,
    interrupt: () => stop(false),
    skip: () => stop(false),
    steer: () => stop(true),
    hold(on: boolean) { o.playback.hold(on); },
    get holding() { return holding; },
  };
}
