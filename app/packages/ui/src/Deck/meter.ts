/* The level along the foot of a key, and the one number that decides it.
 *
 * Kept out of the component so that a game can ask the same question the
 * meter is answering — "is it hearing me" — without importing the deck's
 * stylesheet to find out. What the answer is called is the game's; the bar
 * is this.
 */

/** The page's own ear: the two numbers a voice detector is deciding by, and
    whether the device is actually open. See @lucid/audio. */
export interface Meter {
  level: number;
  floor: number;
  live: boolean;
}

/* Over the bar, and by the same arithmetic the meter draws with — so that a
   key which says it can hear you is a key whose meter is moving. */
export function hearing(m: Meter): boolean {
  return m.live && m.level > Math.max(m.floor * 3, 0.004);
}
