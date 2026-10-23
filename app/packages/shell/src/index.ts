/* The shell, as a game sees it.
 *
 * A game imports this name and nothing deeper, which is the other half of the
 * rule ESLint enforces the near side of: the shell may not import a game at
 * all, and a game may only reach what is listed here. The one exception is
 * styles/box.css, which is a stylesheet and has to be imported as a file.
 */
export {default as App} from './App';
export type {GameRoute, Manifest, RailNotes} from './manifest';

export {backend} from './backend';
export {BASE, href, routed} from './base';
export {host, MACHINE, onHost, PAGE, setHost} from './host';
export type {Files, Host, Words} from './host';
export {expose} from './debug';
export {hatch, installErrorHandlers} from './shell/console';
export type {Health, Lamp, Level, Line, Order, Row} from './shell/console';
export {fitOpenBox} from './shell/fit';
export {askForCard, offerVoice, onAskForCard, onVoiceOffer, voiceOffer} from './shell/offer';
export type {CardSection, VoiceOffer} from './shell/offer';
export {inBrowser, limit, limited, limits, limitsMoved, onLimits, RUN_ON_MAC} from './shell/limits';
export type {Limit} from './shell/limits';
export {LimitNote, Mark, RunOnMac} from './ui/Limits/Limits';
export {useInBrowser, useLimited} from './ui/Limits/use';
export {usePage} from './shell/page';
export {startSky} from './shell/sky';
export {listenForPresses, RESTING_LEVEL, sound} from './shell/sound';
export type {Air, Chime, Loop, Played, Puff, Shelf, Thud} from './shell/sound';
