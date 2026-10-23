/* What a door looks like when it is not a page: on its way, and not coming.
 *
 * Both are the shell's own -- a game that has not arrived cannot draw its own
 * waiting mark -- and they live beside the doors rather than in them because a
 * file that exports a component and a function is a file the dev server cannot
 * hot-reload.
 */
import {Component} from 'react';
import type {ReactNode} from 'react';
import {hatch} from '../shell/console';
import {askAgain, reloadOnce, stale} from './lazy';
import s from './Doorway.module.css';

/** A page on its way. Shown while a chunk is on the wire.
 *
 * It was nothing at all, on the reasoning that the shelf has the chunk in hand
 * before the lid finishes opening -- true of the shelf, and not true of
 * somebody arriving at a game's address directly, whose first second was a
 * page with the corner rail on it and a hole where the game goes. That is the
 * one case a mark is for, and it is the case somebody hits with a link.
 */
export const Waiting = () => <div className={s.wait} role="status" aria-label="opening"><i /></div>;

/** And a page that is not coming.
 *
 * `use()` re-throws a rejected chunk to the nearest error boundary, and there
 * was none: a fetch that failed -- a rebuild mid-evening, a dropped connection
 * at exactly the wrong second -- threw past the router and unmounted the whole
 * app, rail, console and all, with a reload the only way back. Caught here
 * instead, and the press is what forgets the refusal and asks again.
 */
export class Doorway extends Component<{children: ReactNode}, {failed: unknown}> {
  override state: {failed: unknown} = {failed: null};
  /** Presses that asked again in place and were refused again. */
  private tries = 0;

  static getDerivedStateFromError(failed: unknown): {failed: unknown} {
    return {failed};
  }

  override componentDidCatch(e: unknown): void {
    hatch.say(`that page did not arrive: ${(e instanceof Error ? e.message : '') || String(e)}`,
              'error');
  }

  /* A chunk this build no longer has -- the site rebuilt or redeployed under
     an open tab, its old hashes gone -- never arrives however often it is
     asked for: the page that names it is stale. So the press reloads the page
     for the new one, and so does a second press after asking again in place
     was refused again. Once: a reload that lands on the same failure asks in
     place from then on rather than reloading for ever. */
  private again = (): void => {
    if ((stale(this.state.failed) || this.tries > 0) && reloadOnce()) return;
    this.tries += 1;
    askAgain();
    this.setState({failed: null});
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={`plate ${s.gone}`}>
        <b>That page did not arrive.</b>
        <p>Its code didn&rsquo;t come through — another press usually fixes it.</p>
        <button type="button" onClick={this.again}>Try again</button>
      </div>
    );
  }
}

