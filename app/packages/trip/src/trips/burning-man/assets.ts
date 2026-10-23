/* Where the body's files are.
 *
 * Upstream they sit in a directory beside the page and are fetched by name
 * relative to the document. Here the page is the whole app, served from one
 * document for every route, and the machine mounts exactly two directories:
 * /shared for the house's own icons and /assets for the bundle, where every
 * file is named after a hash of its contents and cached for a year on the
 * strength of that. So the body goes through the bundle too: each file is
 * named here with `new URL(..., import.meta.url)`, which Vite turns into a
 * hashed address under /assets at build time and serves straight off the disk
 * in the dev server. Nothing in the character code changes but the function
 * that turns a name into an address.
 */
const FILES: Record<string, string> = {
  'character/man.glb': new URL('./assets/character/man.glb', import.meta.url).href,
  'character/fallen.glb': new URL('./assets/character/fallen.glb', import.meta.url).href,
  'character/body-detail.bin': new URL('./assets/character/body-detail.bin', import.meta.url).href,
  'character/body-normal.png': new URL('./assets/character/body-normal.png', import.meta.url).href,
  'character/body-cavity.png': new URL('./assets/character/body-cavity.png', import.meta.url).href,
  'character/flame.png': new URL('./assets/character/flame.png', import.meta.url).href,
  'animations/clips.bin': new URL('./assets/animations/clips.bin', import.meta.url).href,
  'animations/locomotion.bin': new URL('./assets/animations/locomotion.bin', import.meta.url).href,
};

/** The one shelf the body is on. `preloadCharacter` caches its downloads by
    the base it was asked for, and this is the only base there is. */
export const ASSETS = 'bundle';

/** The address of one of the body's files, by the name the character code
    asks for it under. A name not on the shelf is answered with itself, which
    is a 404 the loaders already know how to report. */
export function assetUrl(path: string): string {
  return FILES[path] ?? path;
}
