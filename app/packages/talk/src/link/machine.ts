/* What the machine is doing, into the store.
 *
 * The tick carried this five times a second, along with everything about the
 * conversation, because there was one conversation and Python was running it.
 * The two halves have come apart: what a conversation is doing is the page's
 * own and is written as it happens, and what the machine is doing is asked for
 * — `GET /machine`, while a room is open.
 *
 * Every five seconds, which is a different clock from a tick's for a reason.
 * Nothing here moves at conversation speed: three lamps that change when a
 * model loads, a memory meter measured on a thread and already a few seconds
 * old, and two standing orders about the microphone that change when somebody
 * types a console command. Five times a second was the rate the turns needed.
 *
 * It does not feed the idle watchdog, and must not: a room left open all
 * afternoon should let the machine put itself away, which is the whole of what
 * `idle_stop_minutes` is for. What keeps the models up is asking them for
 * something. See `ping` in @lucid/machine for the other half of that.
 */
import {status} from '@lucid/machine';
import {EMPTY, link} from './store';

/** How often, while a room is open. */
export const EVERY_MS = 5000;

/** One read. Anything the machine leaves out is what the page shipped with:
    a room whose microphone stopped following the window because one request
    failed would be a worse answer than a stale flag. */
export async function readMachine(): Promise<void> {
  const facts = await status();
  link.setState({
    status: facts.status ?? {},
    memory: facts.memory ?? EMPTY.memory,
    mic_barge: facts.mic_barge ?? EMPTY.mic_barge,
    mic_follow: facts.mic_follow ?? EMPTY.mic_follow,
  });
}

/** Read it now, and keep reading it. The returned function stops.
 *
 * This is also the heartbeat, and it is the only one there is. `adrift` was the
 * socket going away; with the loop in the page the honest version of "the
 * machine is not answering" is that the machine stopped answering, so a read
 * that fails puts the banner up and the next one that comes back takes it
 * down. Nothing is said in the console about it: the banner is on screen, and
 * a line every five seconds for as long as a Mac is asleep is a console nobody
 * can read afterwards.
 */
export function watchMachine(every = EVERY_MS): () => void {
  const tick = () => void readMachine().then(
    () => { if (link.getState().adrift) link.setState({adrift: false}); },
    () => { if (!link.getState().adrift) link.setState({adrift: true}); });
  tick();
  const timer = setInterval(tick, every);
  return () => clearInterval(timer);
}
