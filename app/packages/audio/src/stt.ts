/* ---- the recognizer, as a page reaches it ---------------------------------
 *
 * One call: a whole turn of samples goes up, a line of text comes back. The
 * model itself is the machine's -- it is far too big to be in a browser, and
 * it is the same one for everybody on the network -- so what is here is the
 * address, the encoding, and nothing else.
 *
 * Any game that hears wants exactly this and nothing more. What the words
 * then mean is the game's business.
 */
import {backend} from '@lucid/shell';
import {toPcm} from './capture';
import {RATE} from './vad';

/** The machine's own address. The socket's, with the scheme it was made from
    -- one address for the page, so nothing here has to be configured. */
const machine = (): string => backend().replace(/^ws/, 'http');

/** A whole turn, as the recognizer wants it: raw signed 16-bit mono at `rate`.
 *
 * Raw rather than base64 in a JSON body, which would be a third more bytes for
 * nothing, and whole rather than streamed, because a recognizer that is given
 * a sentence at a time reads the sentence. */
export async function transcribe(
  samples: Float32Array | Int16Array,
  rate = RATE,
): Promise<string> {
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
