/* A failure said in the page's own words, for the person rather than the
 * console.
 *
 * Most of what goes wrong under a reply is a library's sentence -- a
 * ModelNotLoadedError, a status code -- which the console keeps and nobody in
 * a room should have to read. A few are the page's own, written for whoever is
 * sitting there: the model in this browser that stopped answering, the GPU
 * that let go of it. Those travel as this, across the stand-in's chat stream
 * (a frame with `told`) and the voice's socket alike, and a game shows their
 * words where it would otherwise say only that the pill did not answer (see
 * talk's turn.ts). The machine on a Mac sends none: what it says is unchanged.
 */
export class Told extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Told';
  }
}
