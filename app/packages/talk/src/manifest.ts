/* Lucid Talk, as the shell sees it: a name, a line on a tile, and two doors —
 * and, below them, what the game is tuned to.
 *
 * Nothing in here reaches into the game. That is the point — the shell mounts
 * this object without loading a byte of the conversation, and the conversation
 * arrives when somebody opens the box.
 */
import type {Manifest} from '@lucid/shell';

// Named once, because the shell warms a door by this function's identity.
const box = () => import('./routes/box/Box');
const room = () => import('./routes/room/Room');

export const talk: Manifest = {
  slug: 'lucid-talk',
  /* The address, which is not the name: a player's files stay under
     lucid-talk/ whatever this says. /lucid-talk was the address until
     2026-10-08, and still arrives here. */
  path: 'talk',
  was: ['lucid-talk'],
  name: 'Lucid Talk',
  blurb: 'A box of pills. Take one and dream out loud.',
  routes: () => [
    {path: '', load: box},
    {path: ':slug', load: room},
  ],
  /* A room is the one page here with a conversation to ask about; in front of
     the box there is no room, and "idle" and which pill is in hand are answers
     about one. */
  where: (pathname) => (pathname.split('/')[2] ? 'room' : ''),
};

/* What the game ships tuned to, and the only place those answers are written
 * down. `GAME.md` carried them until the machine stopped knowing what a game
 * is; they travel with the package now, and a player's own
 * `userdata/players/<who>/lucid-talk/config.json` is merged over them — its
 * absence meaning nothing here has been changed. See conversation/config.ts,
 * which does the merging and decides what each of these means.
 *
 * What is *not* here: the language model, the recognizer, the voice and the
 * microphone's thresholds. Those are the machine's — one of each, however many
 * games are on the shelf — and are read from `GET /machine`.
 *
 * Two settings GAME.md carried are not here. `idle_stop_minutes` is the
 * machine's own watchdog and is set there, in userdata/config.json (see
 * machine/config.py); `warm_on_open` stopped being read when the conversation
 * moved into the page, which warms on the way into a room either way.
 */
export const settings = {
  memory: {
    enabled: true,
    // The whole memory block, and it is a hard budget rather than a target:
    // every bullet is re-prefilled on every turn, so a fact earns its place by
    // displacing a weaker one.
    max_bullets: 8,
    fold_after: 4,          // messages that must fall out before folding runs
  },
  // Where you stand with it: warmth, trust and mood, kept per persona and
  // moved one exchange at a time. This is the point of the thing — a
  // conversation you can damage and have to repair — so it is on.
  relation: {
    enabled: true,
    // Judging costs one short LLM call per exchange, run while it is still
    // speaking. Turn it off to freeze the state where it is: the feelings
    // still color its replies, nothing moves them any more.
    score: true,
  },
  // Where the two of you are, written down every few turns and carried
  // forward. Its replies run long enough that the opening of a scene falls out
  // of the live window within four turns, which is how a conversation that
  // began in a shop ends up in a bedroom nobody walked to.
  /* Who is playing, as far as the prompts need to know: which words to use
     for you. Every prompt and every band of the standing is written about
     two people in the third person, and this is the second of them; the
     first is the persona's own `pronouns:` line. See conversation/pronouns. */
  player: {
    pronouns: 'he' as const,
  },
  scene: {
    enabled: true,
    // Words spoken since the last note, not turns. A turn is anything from
    // "mm-hm" to four hundred words, so counting them measures nothing; what
    // matters is how much has been said, because that is what pushes the
    // beginning out of the live window. Half of context_words, so the room is
    // written down before it can fall out of view.
    every_words: 300,
  },
  // Taking a pill you were already under picks the conversation back up rather
  // than starting a new one: a reload, a dropped socket, a phone locking
  // itself. Past this, it was a different dream. Minutes, counted from the last
  // thing said; 0 always starts fresh.
  //
  // Short on purpose: five minutes is the length of an accident. You left the
  // room and came straight back, or the page reloaded under you. Anything
  // longer is a decision, and a decision should start something.
  resume_within_minutes: 5,
  ui: {
    // How long "keep going" runs when you tick it. Asked for on the first
    // visit, because it is the one number a person actually has an opinion
    // about before they have used anything.
    continuous_minutes: 15,
  },
};
