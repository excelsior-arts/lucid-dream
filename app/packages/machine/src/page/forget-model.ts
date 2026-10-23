/* The models panel's delete, asked of whoever answers the machine's routes:
 * in a browser, the stand-in (page/machine.ts), which takes the model's files
 * out of the caches (forget.ts). A Mac's panel offers no delete, and the
 * machine has no such route -- which is why this lives here and not in
 * status.ts, whose addresses the wiring test holds against the machine's. */
import {call} from '../address';
import type {Forgot} from './forget';

/** Which part of the panel a model is in. */
export type PartKind = 'llm' | 'voice' | 'ear';

/** The panel's ask: what deleting a model would free (dry), or delete it.
    Answered only by this browser's stand-in (page/machine.ts) -- a Mac's
    panel offers no delete, and the machine has no such route. */
export async function forgetModel(part: PartKind, id: string, o: {dry?: boolean} = {}): Promise<Forgot> {
  const res = await call('/machine/models/forget', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({part, id, dry: !!o.dry}),
  });
  const got = await res.json().catch(() => ({})) as Partial<Forgot> & {error?: string};
  if (!res.ok) throw new Error(got.error ?? `the browser answered ${res.status}`);
  return {bytes: got.bytes ?? 0, files: got.files ?? 0};
}
