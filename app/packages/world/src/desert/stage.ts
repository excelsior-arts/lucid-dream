/* What a trip draws onto: the markup that was Burning Man's standalone <body>.
 *
 * The canvas, the masthead with its wordmark and transport, the invitation
 * with its one button, the hint, the credits, and the loading screen that
 * covers all of it until the first frame is drawn. The ids are the ones a
 * piece looks the elements up by and stage.css draws them by; the states
 * that were classes on <body> (loading, playing, score-ended, hinting) are
 * classes on the host, since the host is what stands for the document here.
 * The words on it are the trip's, handed in.
 *
 * The wordmark is a link, which it was not upstream: inside the app it is the
 * way back to the box this card came out of, and the route that mounts the
 * stage is what makes it a route change rather than a page load.
 */
import './stage.css';

export interface StageWords {
  /** On the masthead and the invitation. */
  title: string;
  /** On the one button. */
  start: string;
  /** What the countdown shows before the piece has said. */
  countdown?: string;
}

const PAUSE = 'M7 5h3v14H7zM14 5h3v14h-3z';

const stage = ({title, start, countdown = '0:00'}: StageWords) => `
<div class="loading-screen" role="status" aria-live="polite">
  <span class="loading-spinner" aria-hidden="true">
    <svg class="loading-element" viewBox="0 0 32 32" focusable="false"><circle cx="16" cy="16" r="10" /></svg>
    <svg class="loading-element" viewBox="0 0 32 32" focusable="false"><path d="M16 5 28 26H4Z" /></svg>
    <svg class="loading-element" viewBox="0 0 32 32" focusable="false"><path d="M5 10c7-6 15 6 22 0M5 16c7-6 15 6 22 0M5 22c7-6 15 6 22 0" /></svg>
    <svg class="loading-element" viewBox="0 0 32 32" focusable="false"><path d="M5 13a11 11 0 0 0 22 0M7 10c6-4 12 4 18 0" /></svg>
    <svg class="loading-element" viewBox="0 0 32 32" focusable="false"><path d="m16 4 12 12-12 12L4 16Z" /></svg>
  </span>
  <p class="loading-status visually-hidden">Loading</p>
  <button class="loading-retry" type="button" hidden>Try again</button>
</div>
<canvas id="world" aria-label="A man in a desert of moving sand"></canvas>
<header class="masthead">
  <a class="wordmark" href="${import.meta.env.BASE_URL}trip" title="back to the box">${title}</a>
  <div class="transport">
    <button id="pause" type="button" aria-label="Pause" title="Pause">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="${PAUSE}" /></svg>
    </button>
    <output id="progress" role="timer" aria-live="off" aria-label="Time remaining">${countdown}</output>
  </div>
</header>
<main id="invitation">
  <h1>${title}</h1>
  <button id="start" type="button" disabled aria-busy="true">${start}</button>
</main>
<p class="hint" id="hint" aria-live="polite"></p>
<footer class="credits"></footer>
`;

/** Build the stage inside `host`, which becomes the piece's document. */
export function buildStage(host: HTMLElement, words: StageWords): void {
  host.classList.add('trip-stage', 'loading');
  host.setAttribute('aria-busy', 'true');
  host.innerHTML = stage(words);
}
