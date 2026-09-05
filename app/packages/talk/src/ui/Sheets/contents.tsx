/* What is written on a pill's sheets.
 *
 * The card they are drawn in is @lucid/ui's Sheet — the frame, the fade,
 * Escape, the scrim — and the three bands are its: a title, whatever there is
 * to read, and whatever there is to press. The last of those is outside the
 * scrolling part on purpose, so a long memory cannot push Save off the bottom
 * of the card and leave you scrolling a text box to find the way to keep what
 * you wrote.
 *
 * Which there are, and what each of them says, is all that is here.
 */
import {useRef} from 'react';
import {Link} from 'react-router';
import {closeSheet} from '@lucid/ui';
import {hatch} from '@lucid/shell';
import type {Sheet} from './sheets';
import {saveCharacter} from './sheets';
import {clearStanding, saveMemory} from '../../conversation/after';
import {useLink} from '../../link/store';

const trouble = (what: string) => (e: unknown) =>
  hatch.say(`${what}: ${e instanceof Error ? e.message : String(e)}`, 'warn');

/** Nothing has come back yet. */
function Waiting() {
  return (
    <div className="sheet-body">
      <div className="sheet-wait">…</div>
    </div>
  );
}

// ---- what it has already been told -----------------------------------------
export function Sessions({sheet}: {sheet: Sheet}) {
  const sessions = useLink((s) => s.sessions);
  if (sessions === sheet.since) return <Waiting />;
  /* And only the ones about this pill. The list is asked for by the sheet
     itself now and is this pill's by the time it is read, but the filter is
     kept: a room reads the same store, and a sheet drawing another pill's
     evenings offers conversations it cannot open. */
  const rows = sessions.filter((x) => x.persona === sheet.slug);
  if (!rows.length)
    return (
      <div className="sheet-body">
        <div className="sheet-none">nothing yet</div>
      </div>
    );
  return (
    <div className="sheet-body">
      {/* Real links, not click handlers: a conversation has an address, so it
          can be opened in a new tab, bookmarked, or sent to the phone by the
          same code that puts this page there. */}
      {rows.map((x) => (
        <Link
          key={x.id}
          className="sheet-row"
          to={`/lucid-talk/${sheet.slug}?session=${encodeURIComponent(x.id)}`}
          onClick={closeSheet}
        >
          <b>{x.when}</b>
          <span>{x.turns} turns</span>
          <span className="pv">{x.preview}</span>
        </Link>
      ))}
    </div>
  );
}

// ---- what it remembers -----------------------------------------------------
export function Memory({sheet}: {sheet: Sheet}) {
  const remembered = useLink((s) => s.remembered);
  const box = useRef<HTMLTextAreaElement>(null);
  if (!remembered || remembered.slug !== sheet.slug) return <Waiting />;
  /* Off is a state worth drawing rather than hiding. The file is still yours
     to read, and the two things this sheet says when it is on — fills in as
     you talk, goes into every reply — are both untrue then. A sheet that lied
     about that would be discovered a week later, by somebody wondering why
     nothing is remembered. */
  const off = remembered.off;
  return (
    <>
      <div className="sheet-body">
        <textarea
          /* Keyed on the pill, not on the text: what is typed in here belongs
             to the person typing until they press Save. Keyed on the text, a
             fold landing while somebody was mid-sentence remounted the box and
             threw the sentence away -- which is the one moment a fold is most
             likely, since it happens while the reply is being spoken. The
             sheet is opened fresh each time, so the box still starts from
             whatever is on disk. */
          key={sheet.slug}
          ref={box}
          className="sheet-text"
          spellCheck={false}
          readOnly={off}
          defaultValue={remembered.text || ''}
          placeholder={
            off
              ? 'memory is off — nothing is being kept'
              : 'nothing remembered yet — this fills in as you talk'
          }
        />
      </div>
      <div className="sheet-foot">
        {off ? (
          <span>
            memory is off in this game&rsquo;s config: what is here is not read, and nothing new is
            written
          </span>
        ) : (
          <>
            <span>edit freely; this is prepended to every reply</span>
            <button
              type="button"
              className="sheet-save"
              onClick={() => {
                /* Through after.ts rather than straight at the file: the room
                   read this memory on the way in and prompts from what it
                   read, so a save that only wrote to disk was overwritten by
                   the next fold and never reached the model. */
                void saveMemory(sheet.slug, box.current?.value ?? '')
                  .then(() => hatch.say(`memory saved for ${sheet.slug}`),
                        trouble('could not save that memory'));
                closeSheet();
              }}
            >
              Save
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ---- and the character itself ----------------------------------------------

/** The words in a pill's mouth, as this player has them.
 *
 * The same card as Memory, and on purpose: the two files sit beside each other
 * in the player's directory and are the two things about a character that are
 * theirs. What is in the box is the effective character — the shipped words,
 * or the player's if they have written any — so editing starts from what is
 * actually being said rather than from an empty page.
 *
 * Saving an empty box is a reset, and the foot says so: there is no such thing
 * as a character with nothing to say, so a page somebody has cleared is a page
 * asking for the shipped words back. The rest of the card — the name, the
 * colour, the room it opens in — is the game's and is not here to edit.
 */
export function Character({sheet, words}: {sheet: Sheet; words: string}) {
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <div className="sheet-body">
        <textarea
          /* Keyed on what came back, and uncontrolled after that: what is
             typed in here belongs to the person typing until they press
             Save. */
          key={words}
          ref={box}
          className="sheet-text"
          spellCheck={false}
          defaultValue={words}
          placeholder="the words this character speaks in"
        />
      </div>
      <div className="sheet-foot">
        <span>yours alone, over what the game ships; save an empty page to put it back</span>
        <button type="button" className="sheet-no" onClick={closeSheet}>
          Cancel
        </button>
        <button
          type="button"
          className="sheet-save"
          onClick={() => {
            void saveCharacter(sheet.slug, sheet.name, box.current?.value ?? '');
            closeSheet();
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

// ---- and how it is taking you ----------------------------------------------
export function Forget({sheet}: {sheet: Sheet}) {
  return (
    <>
      <div className="sheet-body">
        <p className="sheet-say">
          Warmth, trust and mood go back to nothing, and the record of how you got here is deleted.
          Your conversations, and what {sheet.name} remembers about you, are not touched.
        </p>
      </div>
      <div className="sheet-foot">
        <span />
        <button type="button" className="sheet-no" onClick={closeSheet}>
          Leave it
        </button>
        <button
          type="button"
          className="sheet-yes danger"
          onClick={() => {
            /* Again through after.ts: the file is the smaller half, and a
               standing the room is still holding is written back over this
               by the next scored turn. */
            void clearStanding(sheet.slug)
              .then(() => hatch.say(`${sheet.name} is back to nothing`),
                    trouble('could not reset that standing'));
            closeSheet();
          }}
        >
          Reset
        </button>
      </div>
    </>
  );
}
