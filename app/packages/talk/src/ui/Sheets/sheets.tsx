/* A pill's paperwork, and the four doors into it.
 *
 * The card in the middle of the screen is @lucid/ui's Sheet — the frame, the
 * fade, Escape, the scrim. What is here is what is written on one: what a
 * pill remembers about you, the conversations you have already had, how it is
 * taking you, and — from a room, through the console — the words in its mouth.
 *
 * The first three are used from two places and they are the same three things
 * in both. From the box's dashboard, where a row per pill is the natural way to
 * look after them — read what it remembers, open a conversation you had last
 * week, put the temperature back to nothing. And from inside a room, through
 * the console, because somebody who is already in a conversation should not
 * have to leave it to check what it remembers.
 *
 * One implementation, two doorways — and this is the doorway. What is on a
 * sheet is read here and put in the store, and the sheet reads it there: they
 * were replies on a socket every window shared, which meant a sheet could be
 * handed a list it never asked for and had to check whose it was.
 *
 * The pill is a parameter, always. A room can only ever mean the one you are
 * in; the dashboard means whichever row you pressed, and every route takes the
 * slug in its address for exactly that reason.
 */
import {openSheet} from '@lucid/ui';
import {hatch} from '@lucid/shell';
import {Character, Forget, Memory, Sessions} from './contents';
import {gameConfig} from '../../conversation/config';
import * as F from '../../conversation/files';
import {effectivePersona, setPrompt} from '../../conversation/persona';
import {refreshPersona} from '../../conversation/room';
import type {SessionCard} from '../../link/shapes';
import {link} from '../../link/store';

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export {closeSheet as close, sheetIsOpen as isOpen} from '@lucid/ui';

export type SheetKind = 'sessions' | 'memory' | 'forget' | 'character';

export interface Sheet {
  kind: SheetKind;
  /** Which pill this sheet is about. */
  slug: string;
  name: string;
  /* The conversations as the store had them at the moment we asked. A reply
     replaces that list wholesale, so anything else in it is the answer —
     which is how the sheet knows the difference between "nothing yet" and
     "not back yet", now that the message itself has been and gone. */
  since: SessionCard[];
}

const TITLE: Record<SheetKind, string> = {
  sessions: 'conversations',
  memory: 'memory',
  forget: 'start from nothing',
  character: 'character',
};

const made = (kind: SheetKind, slug: string, name: string): Sheet =>
  ({kind, slug, name, since: link.getState().sessions});

/* Which card is the one in front, counted.
 *
 * There is one sheet and one store, and what a sheet is waiting for arrives
 * whenever it arrives. Open one pill's memory and then another's and the first
 * answer could land last -- under the second pill's name, or, since a sheet
 * waits for a result whose slug is its own, leaving the card on "…" for the
 * life of it. A fetch belongs to the card that asked for it. */
let showing = 0;

/** Open a card, and hand back the question its own answer has to pass. */
function show(kind: SheetKind, slug: string, name: string): () => boolean {
  const sheet = made(kind, slug, name);
  const mine = ++showing;
  openSheet({
    title: `${name} — ${TITLE[kind]}`,
    body: kind === 'sessions' ? <Sessions sheet={sheet} />
        : kind === 'memory' ? <Memory sheet={sheet} />
        : <Forget sheet={sheet} />,
  });
  return () => mine === showing;
}

/** What you have already said to it. */
export function openSessions(slug: string, name: string): void {
  const ours = show('sessions', slug, name);
  void F.sessions(slug).then(
    (items) => { if (ours()) link.setState({sessions: items}); },
    (e: unknown) => hatch.say(`could not read that pill's conversations: ${why(e)}`, 'warn'));
}

/** What it remembers, and whether it is being used at all.
 *
 * memory.enabled off leaves the file exactly where it is and stops it reaching
 * any reply — so the sheet has to say so. Shown rather than hidden, because
 * what is written there is still yours to read.
 */
export function openMemory(slug: string, name: string): void {
  const ours = show('memory', slug, name);
  void Promise.all([F.memory(slug), gameConfig()]).then(
    ([text, cfg]) => {
      if (ours()) link.setState({remembered: {slug, text, off: !cfg.memory.enabled}});
    },
    (e: unknown) => hatch.say(`could not read what ${name} remembers: ${why(e)}`, 'warn'));
}

/** And how it is taking you — which this offers to put back to nothing. */
export function openForget(slug: string, name: string): void {
  show('forget', slug, name);
}

/** The words themselves, for editing.
 *
 * The one sheet that waits before it opens rather than opening on "…": what it
 * shows is the effective character, which the room it is opened from has
 * already read and cached — so the wait is nothing, and a card that appeared
 * empty and then filled in under somebody's cursor would be a card that ate
 * the first thing they typed.
 */
export function openCharacter(slug: string, name: string): void {
  void effectivePersona(slug).then(
    (persona) => {
      // A card in front of the others: whatever they are still waiting for is
      // no longer for the sheet that is open.
      showing += 1;
      openSheet({
        title: `${name} — ${TITLE.character}`,
        body: <Character sheet={made('character', slug, name)} words={persona.prompt} />,
      });
    },
    (e: unknown) => hatch.say(`could not read ${name}: ${why(e)}`, 'warn'));
}

/** What Save on that card does: write the words, or take the override away if
    the page was cleared, and tell the room so the next turn is in the new
    character. */
export function saveCharacter(slug: string, name: string, text: string): Promise<void> {
  return setPrompt(slug, text)
    .then((kept) => refreshPersona().then(() => {
      hatch.say(kept ? `${name} speaks in your words now`
                     : `${name} is the shipped character again`);
    }))
    .catch((e: unknown) => hatch.say(`could not save that character: ${why(e)}`, 'warn'));
}
