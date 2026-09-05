/* What a pill remembers about you.
 *
 * Months of evenings, rewritten wholesale from the output of a language model
 * every time enough turns fall out of the window. The file is the machine's --
 * `data/memory/<slug>.md` -- and the fold that writes it is a chat call
 * like any other. What is here is the two ends of that: what the model's answer
 * is allowed to look like before it is kept, and how what is kept goes back in
 * front of the model.
 */

/** Keep only bullet lines, capped — models like to add preamble. */
export function clean(raw: string, maxBullets: number): string {
  const lines: string[] = [];
  for (const original of (raw || '').split('\n')) {
    let line = original.trim();
    if (!line) continue;
    if (!/^[-*•]\s+/.test(line)) {
      // A stray "Here is the memory:" line, or a bullet without its dash.
      if (line.endsWith(':') || (lines.length === 0 && line.split(/\s+/).length < 4)) continue;
      line = '- ' + line;
    }
    line = line.replace(/^[*•]\s+/, '- ');
    lines.push(line);
    if (lines.length >= maxBullets) break;
  }
  return lines.join('\n');
}

/** What goes into the system prompt, or nothing at all. `intro` is the
    memory_intro prompt.
 *
 * Phrasing matters: telling the model "do not recite this" made it deny knowing
 * things that were sitting right there in its own prompt.
 */
export function asPromptBlock(mem: string, intro: string): string {
  if (!mem) return '';
  return '\n\n' + intro + '\n' + mem;
}
