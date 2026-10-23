/* Where the machine answers. The socket's address with the scheme it was made
   from, so nothing in here has to be configured and a page under a dev proxy
   reaches the same Python its websocket does. See stt.ts in @lucid/audio,
   which asks the same question of the same shell.

   And who answers, which is the one seam every route goes through: `call`
   is a fetch of the machine's own path, and that is all it is until a stand-in
   is put in front of it. A page with no machine behind it puts one there --
   see page/machine.ts, which answers the same routes out of this browser --
   and a desktop wrapper that speaks to its own backend over a bridge would put
   its own. Nothing above this line knows which it is talking to. */
import {backend} from '@lucid/shell';

export const machine = (): string => backend().replace(/^ws/, 'http');

/** And as a websocket, which is what the voice is reached on. */
export const machineWs = (): string => backend();

/** Something that answers the machine's routes without a network: a path in,
    a Response out, exactly as the machine would have sent it. */
export type Answer = (path: string, init?: RequestInit) => Promise<Response>;

let standIn: Answer | null = null;

/** Put a stand-in in front of the machine, or take it away (null). */
export function answeredBy(answer: Answer | null): void {
  standIn = answer;
}

/** One of the machine's routes -- `/machine/...` or `/store/...` -- asked of
    whoever answers them on this page. */
export const call = (path: string, init?: RequestInit): Promise<Response> =>
  standIn ? standIn(path, init) : fetch(machine() + path, init);

/** The same, from a page that is going away: a JSON body, POSTed. `sendBeacon`
    to the machine, which outlives the document; a stand-in in this page is
    handed it in the same moment, before anything is awaited, so what it opens
    to write is opened while the page is still here. */
export function beacon(path: string, json: string): boolean {
  if (standIn) {
    try {
      void standIn(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: json})
        .catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
  try {
    return navigator.sendBeacon(machine() + path, new Blob([json], {type: 'application/json'}));
  } catch {
    return false;
  }
}
