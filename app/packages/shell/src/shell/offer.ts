/* A voice this page could have and has not yet: an offer, shown beside the
 * mute.
 *
 * On the machine the voice is simply there. A page with nothing behind it can
 * run one itself -- a speech model in the browser, hundreds of megabytes to
 * fetch first -- and that is a choice for whoever is listening, made where they
 * already reach for sound. The shell draws the switch and knows nothing about
 * what is behind it: whoever makes the offer (@lucid/machine's page voice)
 * says what it is, how big, how far along, and what a press does.
 */

export interface VoiceOffer {
  /** Chosen: wanted in this browser, whether or not it is up yet. */
  on: boolean;
  /** What it is, to a person: the engine's name. */
  what: string;
  /** What the choice costs to fetch, in MB. */
  mb: number;
  state: 'off' | 'fetching' | 'ready' | 'error';
  /** How much of it is here, 0..1, while it is being fetched. */
  got?: number;
  /** Nothing can be heard (muted, or the knob at zero): a voice chosen is
      not fetched until it can be, and one that is up is let go of soon. */
  silent?: boolean;
  /** Not downloaded yet (in this browser, or on this Mac): a press opens the
      first-open card at its voice section rather than starting anything. */
  missing?: boolean;
  /** What went wrong, in words, when it did. */
  why?: string;
  /** The press: choose it, or let it go. */
  set(on: boolean): void;
}

let now: VoiceOffer | null = null;
let version = 0;
const watchers = new Set<() => void>();

/** Make the offer, change it, or take it back (null). */
export function offerVoice(next: VoiceOffer | null): void {
  now = next;
  version += 1;
  for (const fn of watchers) fn();
}

export const voiceOffer = (): VoiceOffer | null => now;
export const voiceOfferVersion = (): number => version;

export function onVoiceOffer(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/* The first-open card, which is a game's (Lucid Talk's ModelCard) and not the
   shell's: whoever can open it says so here, and the voice's switch and the
   microphone ask for it by section. Nobody to open it -- no room open -- is
   false, and the asker says where it can be found. */
export type CardSection = 'voice' | 'ear';
let opener: ((section: CardSection) => void) | null = null;

export function onAskForCard(fn: (section: CardSection) => void): () => void {
  opener = fn;
  return () => { if (opener === fn) opener = null; };
}

export function askForCard(section: CardSection): boolean {
  if (!opener) return false;
  opener(section);
  return true;
}
