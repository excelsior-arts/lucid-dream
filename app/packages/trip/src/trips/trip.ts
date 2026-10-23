/* What a trip is, to the box and to the route.
 *
 * A trip is a directory under trips/: the piece itself, however it is built,
 * and one small file beside it -- trip.ts -- that says what is printed on its
 * card and how to open it. The box reads the cards without loading a byte of
 * any piece; the route opens the one whose card was taken and mounts it into
 * an element. That is the whole contract, and it is what makes a second trip
 * a directory and a line in trips/index.ts.
 */

export interface TripCard {
  /** The second segment of the card's address: /trip/<id>. */
  id: string;
  title: string;
  blurb: string;
  /** "r, g, b", the way the box paints a card. */
  color: string;
  /** What backs it, by name in @lucid/ui's Box.css. */
  figure: 'diamond' | 'spiral' | 'flame';
}

/** A piece on the screen. */
export interface Piece {
  /** Resolves once the piece is up and can be played; rejects if it could
      not come up, or with an AbortError when it was left before it was. */
  ready: Promise<unknown>;
  /** Let go of everything: the loop, the renderer, the sound, every listener.
      Saying it twice is nothing. */
  dispose(): void;
  /** How loud the house wants it: a gain where 1 is the level the piece was
      mixed at, and whether it is hushed. Said once on mount and again whenever
      the rail's speaker moves. A piece with no sound leaves it out. */
  hear?(gain: number, hushed: boolean): void;
}

/** Build the piece into `host` and bring it up. The host is an empty element
    the size of the screen; the piece owns everything inside it. */
export type Mount = (host: HTMLElement) => Piece;

export interface Trip {
  card: TripCard;
  /** The piece's chunk. Named once, so the shelf and the box warm the same
      door. */
  open: () => Promise<{mount: Mount}>;
}
