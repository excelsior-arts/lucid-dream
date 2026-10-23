/* The voice, as a socket that stays open for as long as the room does.
 *
 * A chunk of text goes up as `{text, voice, ends_paragraph, id}`; `{pcm, rate,
 * chars}` frames come back as they are made, then `{done, stats}`, every one of
 * them carrying the `id` of the chunk it belongs to. `chars` is
 * what that chunk covers *as written*, on the first frame only -- the machine
 * strips asterisks and the tags its voice does not perform before synthesis,
 * so counting what it produced would count markup nobody hears. See
 * machine/models.py, `voice_text`.
 *
 * ---- one socket per room, not per reply -------------------------------------
 *
 * The machine remembers which reference clip is loaded *per socket*, and
 * switching it costs an embedding. A socket per reply would pay that on every
 * turn of an evening, plus the accept and the origin check, for nothing: a
 * room is one persona talking, and the voice it wants is the same voice all
 * the way through. So one is opened the first time a room speaks and closed
 * when the room is left -- which is also what makes the reply's `stop()`
 * cheap, since the socket it interrupts is still there for the next sentence.
 *
 * ---- and why every chunk is named -------------------------------------------
 *
 * One socket carrying one chunk at a time reads like it needs no names, and it
 * did not until the first interrupt. The machine hears a stop while a chunk is
 * being made and finishes it anyway -- MLX is on one thread, and abandoning a
 * clip half-made costs more than dropping it -- so that chunk's `done` arrives
 * a second or more after this end has moved on, by which time the next reply's
 * first sentence has usually been sent. Unnamed, that late `done` ended the
 * *new* chunk: its frames then arrived to nothing, its `chars` credit was never
 * applied, and the reply carried on from sentence two with the first one made
 * and thrown away. Every interrupt, every Skip in a run.
 *
 * So each chunk carries an id, the machine echoes it on every frame, on the
 * `done` and on any `error`, and frames for a chunk this end has let go of are
 * dropped here rather than credited to whatever is speaking now.
 */
import {machineWs} from './address';
import {Told} from './told';

/** The little of a WebSocket this uses, so a test can be one. */
export interface Socketish {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: {data: string}) => void) | null;
  onclose: (() => void) | null;
  onerror?: (() => void) | null;
}

export type MakeSocket = (url: string) => Socketish;

/** The path the voice answers on. */
export const TTS_PATH = '/machine/tts';

/** A chunk of the voice: base64 signed 16-bit PCM at `rate`. */
export interface Frame {
  pcm: string;
  rate: number;
  /** Characters of the reply this chunk speaks; 0 on every frame but the
      first, so a page can pace its text against the voice without counting
      the same words twice. */
  chars: number;
}

/** What the last chunk cost against what it produced. */
export interface Stats {
  gen_s?: number;
  audio_s?: number;
  /** Under 1 means sound came out faster than it plays. Null when too short. */
  rtf?: number | null;
  words?: number;
  mem_gb?: number;
}

export interface Voice {
  /** One chunk, spoken. The frames arrive as they are made rather than when
      the last one is done, which is the whole reason this is a socket. */
  speak(text: string, endsParagraph?: boolean): AsyncIterable<Frame>;
  /** Abandon the chunk being made. The machine finishes the clip it is on and
      drops it; what is left of the chunk is not sent. */
  stop(): void;
  close(): void;
  /** What the machine said about the last chunk it made. */
  readonly stats: Stats;
}

export interface Options {
  /** Which voice to speak in: a name on the machine's shelf, which is
      `models/voices/<name>.wav` and is listed by `voices()`. Sent with every
      chunk; the machine switches the clip only when the name changes, and
      refuses a chunk naming one it has not got rather than speaking it in
      whichever voice was loaded last. */
  voice: string;
  url?: string;
  socket?: MakeSocket;
}

const OPEN = 1;

/** A message from the machine, in any of the three shapes it sends. */
interface Said {
  /** Which chunk this is about: whatever `speak` put on it. */
  id?: string;
  pcm?: string;
  rate?: number;
  chars?: number;
  done?: boolean;
  stats?: Stats;
  error?: string;
  /** The chunk was refused rather than failed -- today, only `"voice"`, for a
      name the machine's shelf has not got. Not the machine being unreachable,
      and not to be reported as it. */
  refused?: string;
  /** The error is in the page's own words (told.ts): only a browser's voice
      sends it. */
  told?: boolean;
}

/** The machine would not speak this chunk, and said why.
 *
 * Told apart from a socket that went away because they mean opposite things to
 * a room: a refusal is one line of a file to fix and the machine is perfectly
 * well, so the amber "not answering" banner is a lie. See turn.ts. */
export class VoiceRefused extends Error {}

/** The voice could not make this chunk: its words are on the glass all the
 * same, at the reading pace. The voice's trouble, not the pill's -- which
 * answered -- so not the "not answering" banner either (10-10, headless
 * WebKit, a phone's voice whose runtime would not start: the banner went up
 * over a reply that was there, and the keys locked). See turn.ts. */
export class VoiceFailed extends Error {}

/** Frames in at whatever rate they are made, out at whatever rate they are
    read. One of these per chunk being spoken. */
function pipe() {
  const items: Frame[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let failed: Error | null = null;
  const nudge = () => {
    const go = wake;
    wake = null;
    go?.();
  };
  return {
    put(f: Frame) { items.push(f); nudge(); },
    end() { ended = true; nudge(); },
    fail(e: Error) { failed = e; ended = true; nudge(); },
    async *drain(): AsyncIterable<Frame> {
      for (;;) {
        while (items.length) yield items.shift()!;
        if (failed) throw failed;
        if (ended) return;
        await new Promise<void>((go) => { wake = go; });
      }
    },
  };
}

/* Who answers the voice's socket when nobody says: the machine, over a real
   WebSocket -- or, on a page with no machine, a voice running in this browser
   that speaks the same messages (page/voice.ts). Read when a socket is opened
   rather than when the voice is, so a room opened before the browser's voice
   was chosen speaks through it from its next sentence. */
let standIn: MakeSocket | null = null;

/** Put a voice in front of the socket, or take it away (null). */
export function voiceAnsweredBy(make: MakeSocket | null): void {
  standIn = make;
}

export function openVoice(o: Options): Voice {
  const url = o.url ?? machineWs() + TTS_PATH;
  const make = o.socket ?? ((at: string) => (standIn
    ? standIn(at) : new WebSocket(at) as unknown as Socketish));

  let ws: Socketish | null = null;
  let opening: Promise<Socketish> | null = null;
  let closed = false;
  let stats: Stats = {};
  /* The chunks this end is still listening for, by the name it sent them
     under. Ordinarily one: chunks are spoken one after another. What makes it
     a map is the one that has been let go of -- abandoned by an interrupt,
     with its `done` still to come -- which is removed here the moment it is
     abandoned, so anything that arrives for it afterwards lands on nothing.
     See the note at the top. */
  const live = new Map<string, ReturnType<typeof pipe>>();
  /* Which socket each chunk was sent down, so the close of one socket fails
     its own chunks and not the next socket's. */
  const sentOn = new Map<string, Socketish>();
  let named = 0;

  /** The chunk a frame is about. A frame with no name on it belongs to the
      only chunk in flight, if there is exactly one -- which is what a machine
      that does not echo ids leaves us, and better than dropping it. */
  function whose(id: string | undefined): ReturnType<typeof pipe> | null {
    if (typeof id === 'string') return live.get(id) ?? null;
    return live.size === 1 ? [...live.values()][0]! : null;
  }
  /* Chunks are spoken one after another, which is also how a reply is written:
     the next sentence is handed over when the last one's frames have all
     arrived. This is the queue that keeps that true even if a caller does not. */
  let turn: Promise<unknown> = Promise.resolve();

  function socket(): Promise<Socketish> {
    if (ws && ws.readyState === OPEN) return Promise.resolve(ws);
    if (opening) return opening;
    const mine: Promise<Socketish> = new Promise<Socketish>((ready, no) => {
      const sock = make(url);
      ws = sock;
      sock.onopen = () => { if (opening === mine) opening = null; ready(sock); };
      sock.onmessage = (ev) => {
        let said: Said;
        try {
          said = JSON.parse(ev.data) as Said;
        } catch {
          return;                              // not ours to make sense of
        }
        /* Whose it is, first. A chunk nobody is listening for any more is one
           this end abandoned: its late `done` must not end the chunk that is
           speaking now, and its frames must not be credited to it. */
        const mine = whose(said.id);
        if (!mine) return;
        if (said.error) {
          mine.fail(said.refused === 'voice' ? new VoiceRefused(said.error)
            : said.told ? new Told(said.error) : new VoiceFailed(said.error));
          return;
        }
        if (said.done) {
          if (said.stats) stats = said.stats;
          mine.end();
          return;
        }
        if (typeof said.pcm === 'string') {
          mine.put({pcm: said.pcm, rate: said.rate ?? 0, chars: said.chars ?? 0});
        }
      };
      sock.onclose = () => {
        /* This socket's, and only this one's. A socket still closing when the
           next chunk opened a new one used to wipe the new socket's handle on
           its way out and fail the chunk being made on it: the machine went on
           speaking into a socket nobody held, stop() had nothing to send to,
           and the chunk after that opened a third. */
        if (opening === mine) opening = null;
        if (ws === sock) ws = null;
        // A chunk that was being made when the socket went is a chunk that is
        // not coming. Said out loud rather than left hanging: a reply waiting
        // on frames that will never arrive is a room that has gone quiet with
        // nothing in the console.
        for (const [id, chunk] of [...live.entries()]) {
          if (sentOn.get(id) !== sock) continue;
          chunk.fail(new Error('the voice socket closed'));
          live.delete(id);
          sentOn.delete(id);
        }
        if (!closed) no(new Error('the voice socket closed'));
      };
      if (sock.onerror !== undefined) sock.onerror = () => { /* onclose says it */ };
    });
    opening = mine;
    return mine;
  }

  async function* say(text: string, endsParagraph: boolean): AsyncIterable<Frame> {
    if (closed) return;
    const sock = await socket();
    const id = `c${++named}`;
    const mine = pipe();
    live.set(id, mine);
    sentOn.set(id, sock);
    sock.send(JSON.stringify({text, voice: o.voice, ends_paragraph: endsParagraph, id}));
    let over = false;
    try {
      yield* mine.drain();
      over = true;
    } finally {
      live.delete(id);
      /* Let go of before it was done: whoever was reading these frames has
         stopped, so tell the machine as well as forgetting the name. A replay
         cut off by pressing the key again is the case with nothing else to say
         it -- it abandons the iterator and sends no stop of its own -- and a
         machine still making sentences nobody will hear is the next reply
         waiting behind them on the one thread. */
      if (!over && !closed && ws && ws.readyState === OPEN) {
        ws.send(JSON.stringify({stop: true}));
      }
    }
  }

  return {
    speak(text: string, endsParagraph = false): AsyncIterable<Frame> {
      /* Its place in the queue is taken here, when it is asked for, and the
         chunk is only sent once the one in front of it is done. `mine` settles
         whether the chunk was spoken to the end, abandoned or thrown by, so
         one failure does not stop the queue for the rest of the evening. */
      const frames = async function* (): AsyncIterable<Frame> {
        /* Taken inside the generator, where it is released. Taken outside,
           on the call, a chunk asked for and never read -- an early return,
           a caller that changed its mind -- held its place for ever, and
           every sentence after it on this socket waited behind nothing. */
        const wait = turn;
        let release: () => void = () => {};
        turn = new Promise<void>((go) => { release = go; });
        try {
          await wait;
          yield* say(text, endsParagraph);
        } finally {
          release();
        }
      };
      return frames();
    },

    stop() {
      // Only what is being made. The socket stays: the next sentence of the
      // next turn wants the same voice, already loaded.
      if (ws && ws.readyState === OPEN) ws.send(JSON.stringify({stop: true}));
    },

    close() {
      closed = true;
      for (const chunk of [...live.values()]) chunk.end();
      live.clear();
      ws?.close();
      ws = null;
    },

    get stats() { return stats; },
  };
}
