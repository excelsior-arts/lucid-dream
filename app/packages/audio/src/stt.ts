/* ---- the recognizer, as a page reaches it ---------------------------------
 *
 * One call: a whole turn of samples goes up, a line of text comes back. On a
 * Mac the model is the machine's -- Parakeet, the same one for everybody on
 * the network -- so what is here is the address, the encoding, and nothing
 * else. A page with no machine behind it runs a smaller one of its own in a
 * worker, and puts it in front of this (`heardBy`, from `settle` in
 * @lucid/machine), the way the page's voice stands in for the machine's
 * socket: the turn goes there instead, and nothing that calls this knows.
 *
 * Any game that hears wants exactly this and nothing more. What the words
 * then mean is the game's business.
 */
import {backend} from '@lucid/shell';
import {toPcm, toRate} from './capture';

/** Signed 16-bit back to floats, for an ear in this page: it takes what the
    microphone gave, and only a caller holding PCM already sends this. */
const fromPcm = (pcm: Int16Array): Float32Array => Float32Array.from(pcm, (v) => v / 32768);
import {RATE} from './vad';

/** The machine's own address. The socket's, with the scheme it was made from
    -- one address for the page, so nothing here has to be configured. */
const machine = (): string => backend().replace(/^ws/, 'http');

/** A whole turn into its words, answered in this page: 16 kHz floats in. */
export type Hear = (samples: Float32Array) => Promise<string>;

let standIn: Hear | null = null;

/** Put an ear in front of the machine's, or take it away (null). */
export function heardBy(hear: Hear | null): void {
  standIn = hear;
}

/** A whole turn, as the recognizer wants it: raw signed 16-bit mono at `rate`.
 *
 * Raw rather than base64 in a JSON body, which would be a third more bytes for
 * nothing, and whole rather than streamed, because a recognizer that is given
 * a sentence at a time reads the sentence. */
export async function transcribe(
  samples: Float32Array | Int16Array,
  rate = RATE,
): Promise<string> {
  if (standIn) {
    const floats = samples instanceof Float32Array ? samples : fromPcm(samples);
    return standIn(rate === RATE ? floats : toRate(floats, rate, RATE));
  }
  /* The samples themselves rather than a copy of them, and the cast is the one
     thing the compiler cannot work out: a buffer that came from a microphone
     on this page is an ordinary ArrayBuffer and never shared memory. */
  const pcm = (samples instanceof Int16Array ? samples : toPcm(samples)) as Int16Array<ArrayBuffer>;
  const res = await fetch(machine() + '/machine/stt?rate=' + rate, {
    method: 'POST',
    headers: {'Content-Type': 'application/octet-stream'},
    body: pcm,
  });
  if (!res.ok) throw new Error('the recognizer answered ' + res.status);
  return ((await res.json()) as {text?: string}).text ?? '';
}
