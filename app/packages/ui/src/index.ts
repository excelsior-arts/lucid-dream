/* The mechanics, as a game sees them.
 *
 * Every interface in this app that a second game would want back: the open
 * box with its lid and cards, the transport deck, the banners, the confirm
 * dialog, the sheet frame, the transcript pane, the typing line, the stage
 * and the glass. What is *in* any of them is the game's — a persona, a pill,
 * a dose, a memory — and none of that has ever been in here.
 *
 * What this file carries is the types and the parts with no stylesheet: the
 * card flight, the tape clock, the meter's one number, the two storage keys,
 * and the three controllers a game calls by hand. The components themselves
 * are imported by their own path —
 *
 *     import Deck from '@lucid/ui/Deck/Deck';
 *
 * — and deliberately, because a component brings its CSS with it and a route
 * should only ever load the sheets it actually draws. Re-exported from here
 * they would arrive in one lump on every page.
 */

// ---- the open box ----------------------------------------------------------
export type {Card, Props as BoxProps} from './Box/Box';
export {take} from './Box/take';
export type {Flight} from './Box/take';

// ---- the deck --------------------------------------------------------------
export type {Icon, Key, Props as DeckProps} from './Deck/Deck';
export type {Props as LcdProps} from './Deck/Lcd';
export {hearing} from './Deck/meter';
export type {Meter} from './Deck/meter';
export {createTape} from './Deck/tape';
export type {Reading, Tape, Told} from './Deck/tape';

// ---- the banners -----------------------------------------------------------
export type {Action as BannerAction, Props as BannerProps} from './Banners/Banners';

// ---- asking before something cannot be undone ------------------------------
export {ask, drawnBy} from './ConfirmDialog/ask';
export type {Question} from './ConfirmDialog/ask';

// ---- the sheet -------------------------------------------------------------
export {FADE_MS, close as closeSheet, isOpen as sheetIsOpen, openSheet} from './Sheet/open';
export type {Sheet} from './Sheet/open';

// ---- the transcript --------------------------------------------------------
export type {Line, Props as TranscriptProps} from './Transcript/Transcript';

// ---- the typing line -------------------------------------------------------
export {DRAFT, UNSENT, store, stored} from './TypeLine/draft';
export type {Keys as DraftKeys} from './TypeLine/draft';
export type {Props as TypeLineProps} from './TypeLine/TypeLine';

// ---- the stage and the glass -----------------------------------------------
/* The stage builds nothing itself: what goes on it arrives as `mount`, and
   these three are the whole of what it then knows about the result. */
export type {Dressing, Into as StageInto, Props as StageProps, Scene} from './Stage/Stage';
