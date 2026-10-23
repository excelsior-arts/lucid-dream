/** What the score's `music` field names: nothing, or a local audio file. */
export type MusicSource = {kind: 'none'} | {kind: 'file'; path: string};

const FILE = /^\.?\/?[\w./-]+\.(?:mp3|ogg|wav|m4a)$/i;

/**
 * Read the score's music field. An empty string is no music at all.
 * Anything unrecognised returns null so the score validator can refuse it.
 */
export function musicSource(value: unknown): MusicSource | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return {kind: 'none'};
  if (FILE.test(text)) return {kind: 'file', path: text};
  return null;
}
