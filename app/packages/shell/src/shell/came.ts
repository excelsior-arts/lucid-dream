/* Where the page was before this one, for a page that wants to arrive the
   way it was left. The shelf asks it when it mounts: coming back from a
   game's open box, that box is shut in the middle of the screen at full
   size, and the shelf starts from there and puts it back on the table. A
   fresh load came from nowhere. App's chrome writes it after each change of
   address, so during the next page's first render it still holds the last. */
export const came = {at: ''};
