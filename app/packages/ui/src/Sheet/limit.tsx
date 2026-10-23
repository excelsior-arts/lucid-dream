/* A part limited in this browser, pressed: the sheet that says so.
 *
 * The words are the shell's list (limits.ts in @lucid/shell) and the note is
 * its LimitNote -- on your Mac, in this browser, and the steps to run it
 * there -- in the house's card. On the machine nothing is limited and this
 * opens nothing, which the caller hears as false. */
import {LimitNote, limited} from '@lucid/shell';
import {close, openSheet} from './open';

export function openLimit(id: string): boolean {
  const l = limited(id);
  if (!l) return false;
  openSheet({
    title: `${l.name} — in this browser`,
    body: (
      <>
        <div className="sheet-body"><LimitNote id={id} /></div>
        <div className="sheet-foot">
          <span />
          <button type="button" className="sheet-no" onClick={close}>Close</button>
        </div>
      </>
    ),
  });
  return true;
}
