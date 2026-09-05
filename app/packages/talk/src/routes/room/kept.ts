/* The two things this browser remembers about a room.
 *
 * Not a draft — the line you are writing keeps its own two keys, in
 * @lucid/ui — but the same three lines of storage and the same shrug when a
 * browser refuses to keep anything, which is why they are read and written
 * with the same pair.
 */

/** Which of the two ways in you were last using. A preference, not a state. */
export const TYPING = 'lucid:typing';
/* And which figure a pill is backed with, once this browser has been told —
   `lucid.figure.<slug>`. It comes from the personas the socket sends, which is
   a message a page cannot ask for; written down, the second visit to a room
   shows the right mark before a word has come back. */
export const FIGURE = 'lucid.figure.';
