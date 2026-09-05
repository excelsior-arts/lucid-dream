/* Where the two of you are, kept while the conversation moves past it.
 *
 * The live context is deliberately short — six exchanges, six hundred words —
 * and her replies run to four hundred words apiece, so in continuous mode she
 * is often writing with one message of history: her own last one. Everything
 * before it is gone, including where the scene started. It began in a shopping
 * mall and ended in a bedroom, and nothing in the prompt disagreed.
 *
 * Memory cannot fix that. Memory is what is true about *you* — a name, a job, a
 * dog — and its instructions say plainly to keep facts and leave events. A
 * scene is all event: a place, a position, a thing just done. It belongs to the
 * conversation rather than to the person, so it lives in the transcript beside
 * the turns, and it dies with them.
 *
 * Kept short on purpose. It is prefilled on every turn, and a paragraph of
 * stage directions competes with the reply she is trying to write.
 */

export const MAX_WORDS = 70;

/** Three short lines, and nothing that pretends to be prose. */
export function trim(text: string): string {
  const clip = (l: string) => l.replace(/^[ \t\-•]+/, '').replace(/[ \t\-•]+$/, '');
  const lines = (text || '').split('\n')
    .map(clip)
    .filter((l) => l && !/^(here|sure|scene:)/.test(l.toLowerCase()));
  const out: string[] = [];
  let used = 0;
  for (const line of lines.slice(0, 4)) {
    const n = line.trim().split(/\s+/).length;
    if (used + n > MAX_WORDS) break;
    out.push(line);
    used += n;
  }
  return out.join('\n');
}

/** What it says when the two of them are simply talking and are not anywhere. */
export const NO_SCENE = ['none', 'no scene', 'nothing', 'n/a', '-'];

// What the previous place is worth, said in the heading rather than reasoned
// out by the model. A scene the conversation earned is a position somebody has
// taken and is defended as one; a seed is the room describing itself to an
// empty chair, and nobody has agreed to it yet. The caller knows which it is
// holding, so it says so, and the writer is left with one situation to read
// instead of a rule and its exception.
export const SETTLED = 'Where the scene was:';
export const GUESS = 'Where the room says it begins, which nobody has confirmed yet:';

// And how much to ask for. Before she has answered him there is no standing
// between them to describe and nothing has changed yet, so Now and Since are
// two lines invented to fill a form -- on one measured opening, Since came
// back as his own turn restated. Asking for the one line that can be true is
// also the cheapest thing this call ever does: three lines of it are most of
// the wait in front of a first reply.
export const ASK_ALL = 'Where is the scene now? Three lines at most.';
export const ASK_PLACE = 'Only the Place line, and nothing else -- they have not spoken to '
  + 'each other yet, so there is no Now and no Since to write.';

/** Whether what came back means "they are not anywhere". */
export const isNowhere = (text: string): boolean =>
  NO_SCENE.includes(text.trim().replace(/\.+$/, '').toLowerCase());

/** What rides along with the turn. Empty when there is no scene yet. `intro` is
    the scene_intro prompt, which lives in a file the machine serves. */
export function asPromptBlock(scene: string, intro: string): string {
  if (!scene) return '';
  return `\n\n[${intro.trim()}\n${scene}]`;
}
