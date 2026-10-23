/* Burning Man, as a thing a page can open.
 *
 * One function: hand it an empty element and the piece builds its stage in
 * it, shows its loading screen, brings the desert up and takes the screen
 * down when the first frame is drawn -- which is what the standalone page's
 * bootstrap.ts did with the document. What comes back is the way to let go of
 * it all again, and the controls once it is up.
 *
 * Nothing of the rest of the workspace is imported here or below: this
 * directory is the piece as it is in its own repository, and knows nothing of
 * a shell, a box or a card. The card is trip.ts beside this file, and the
 * route that opens it is Lucid Trip's.
 */
import {buildStage} from '@lucid/world/desert';
import {play} from './experience/piece';
import type {Controls, Piece} from './experience/piece';

export type {Controls, Piece} from './experience/piece';

export function mount(host: HTMLElement): Piece {
  buildStage(host, {title: 'BURNING MAN 2026', start: 'Let it', countdown: '2:30'});
  const status = host.querySelector<HTMLElement>('.loading-status')!;
  const spinner = host.querySelector<HTMLElement>('.loading-spinner')!;
  const retry = host.querySelector<HTMLButtonElement>('.loading-retry')!;
  retry.onclick = () => window.location.reload();

  const piece = play(host);
  const ready: Promise<Controls> = piece.ready.then(
    async (controls) => {
      // Install layout before anything is revealed, then reveal only a
      // rendered scene: two frames, the way the standalone page waited.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      host.querySelector<HTMLElement>('.loading-screen')!.hidden = true;
      host.classList.remove('loading');
      host.removeAttribute('aria-busy');
      return controls;
    },
    (error: unknown) => {
      // Left before it was up is not a failure, and the stage is gone with it.
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.error('The experience could not load.', error);
      status.textContent = 'The desert could not load.';
      status.classList.remove('visually-hidden');
      spinner.hidden = true;
      retry.hidden = false;
      host.removeAttribute('aria-busy');
      throw error;
    },
  );
  ready.catch(() => {});
  return {ready, dispose: piece.dispose, hear: piece.hear};
}
