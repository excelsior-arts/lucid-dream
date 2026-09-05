/* A frame loop, for a game that has not already got one.
 *
 * Lucid Talk has: room3d.js runs its own rAF and has since before there was a
 * world to step, and it is where the projection, the mirrors and the glyph
 * sheet are all timed from. So the room keeps its own loop and steps the
 * world inside it; this is here for the next game, which will start from a
 * world rather than from a renderer.
 *
 * It stops when the tab goes away and starts again when it comes back, and
 * hands `dt` in seconds since the last frame it actually ran. It is not a
 * clock: nothing in a world advances except through `advance`, and what
 * `advance` does with a long gap is throw most of it away — see world.ts.
 */
export type Frame = (dt: number) => void;

/** Run `fn` every frame. Returns the way to stop. */
export function onFrame(fn: Frame): () => void {
  if (typeof requestAnimationFrame !== 'function') return () => {};
  let raf = 0;
  let last = 0;
  let dead = false;

  const tick = (now: number) => {
    if (dead) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (dt > 0) fn(dt);
  };

  const wake = () => {
    if (dead) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      /* And the clock is forgotten with it. Coming back holding the last
         frame from before lunch is what makes a world simulate lunch. */
      last = 0;
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  };

  document.addEventListener('visibilitychange', wake);
  raf = requestAnimationFrame(tick);
  return () => {
    dead = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', wake);
  };
}
