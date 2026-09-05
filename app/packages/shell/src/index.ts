/* The shell, as a game sees it.
 *
 * A game imports this name and nothing deeper, which is the other half of the
 * rule ESLint enforces the near side of: the shell may not import a game at
 * all, and a game may only reach what is listed here. The one exception is
 * styles/box.css, which is a stylesheet and has to be imported as a file.
 */
export {default as App} from './App';
export type {GameRoute, Manifest} from './manifest';

export {backend} from './backend';
export {expose} from './debug';
export {hatch, installErrorHandlers} from './shell/console';
export type {Health, Lamp, Level, Line, Order, Row} from './shell/console';
export {fitOpenBox} from './shell/fit';
export {usePage} from './shell/page';
export {startSky} from './shell/sky';
export {listenForPresses, sound} from './shell/sound';
