/* Say a line again: the play key on a bubble, and Again on the deck.
 *
 * A press means "let me hear that", so it does whatever stands between the
 * press and the sound, once, rather than nothing with a line in the console:
 *
 *   missing  no voice downloaded (a Mac without its voice on the shelf; a
 *            browser with no engine in its cache): the models panel, at its
 *            voice section. Nothing loads by itself.
 *   silent   hushed, or the knob at zero: the sound comes back at its resting
 *            level, as the unheard mark brings it back, and the line is said.
 *   off      a browser's voice switched off, its engine in the cache: it is
 *            switched on, and the line is said once it is up.
 *   ready    said.
 *
 * Silent and off together are both undone by the one press. `replayState` is
 * what the key wears, so it can say beforehand what a press will do.
 */
import {askForCard, hatch, host, onHost, onVoiceOffer, RESTING_LEVEL, sound, voiceOffer} from '@lucid/shell';

export type Replay = 'ready' | 'silent' | 'missing' | 'off';

export function replayState(): Replay {
  const offer = voiceOffer();
  if (offer?.missing) return 'missing';
  if (sound.silent) return 'silent';
  if (offer && !offer.on) return 'off';
  return 'ready';
}

/** What the key says it will do, in its tooltip. */
export const REPLAY_TITLE: Record<Replay, string> = {
  ready: 'say it again',
  silent: 'the sound is off — press to turn it on and hear this again',
  missing: 'no voice downloaded — press to choose one',
  off: 'the voice is off — press to switch it on and hear this again',
};

/** Told whenever the answer to replayState may have moved. */
export function onReplayState(fn: () => void): () => void {
  const offers = onVoiceOffer(fn);
  const hosts = onHost(fn);
  document.addEventListener('lucid:silent', fn);
  return () => { offers(); hosts(); document.removeEventListener('lucid:silent', fn); };
}

/** How long a line waits for a voice being switched on before it is let go. */
const WAIT_MS = 180_000;
/** A newer press is the one that is wanted. */
let pressed = 0;

export function replay(text: string, speak: (text: string) => Promise<void>): void {
  const mine = ++pressed;
  const offer = voiceOffer();
  if (offer?.missing) {
    if (!askForCard('voice')) hatch.say('no voice is downloaded — the models panel brings one down', 'warn');
    return;
  }
  if (sound.silent) {
    if (sound.hush) sound.setHush(false);
    if (sound.level === 0) sound.setLevel(RESTING_LEVEL);
  }
  if (offer && !offer.on) offer.set(true);
  if (host().voice) { void speak(text); return; }
  /* Coming up: said once it is, unless the switch went off again (a voice
     not in the cache after all, whose press opened the panel instead), it
     failed, another press came, or it took too long. */
  hatch.say('the voice is loading — the line is said once it is up');
  const done = () => { off(); clearTimeout(timer); };
  const timer = setTimeout(done, WAIT_MS);
  const check = () => {
    if (mine !== pressed) return done();
    const o = voiceOffer();
    if (o && (!o.on || o.state === 'error')) return done();
    if (host().voice) { done(); void speak(text); }
  };
  const offs = [onHost(check), onVoiceOffer(check)];
  const off = () => { for (const f of offs) f(); };
  queueMicrotask(check);
}
