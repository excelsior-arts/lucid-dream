/* What Lucid Talk is in a browser that it is not on your Mac.
 *
 * Said once, here, to the shell's list (see limits.ts in @lucid/shell), and
 * read from there by the eye's panel, the marks and the sheets. What holds is
 * asked of the config this page last read (said as lucid:config by gameConfig
 * in conversation/config.ts): a player whose config.json switched where they
 * stand back on is not told it is held. Until a config has been read, the
 * browser's own defaults are what holds -- they are what the page runs on.
 *
 * Plain words on the glass: "your Mac", "this browser"; the parts are named
 * by what they do for a person, never by the kind of model behind them.
 */
import {canBeHeard} from '@lucid/audio';
import {host, limit, limitsMoved} from '@lucid/shell';
import {settings} from './manifest';

/** The little of a game config a limit reads. */
export interface Seen {
  memory: {enabled: boolean; fold_after: number};
  relation: {enabled: boolean; score: boolean};
  scene: {enabled: boolean};
  llm: {context_turns: number};
}

let seen: Seen | null = null;

/* The config a page has just read: the marks are asked again. */
if (typeof addEventListener === 'function') {
  addEventListener('lucid:config', (e) => {
    seen = (e as CustomEvent<Seen>).detail;
    limitsMoved();
  });
}

limit({
  id: 'standing',
  name: 'Where you stand',
  kind: 'off',
  mac: 'It tracks where you stand with the pill, turn by turn: warmth, trust and mood move with what you say.',
  here: 'It is held. Where you stand still colours every reply, but nothing you say moves it.',
  holds: () => !seen || (seen.relation.enabled && !seen.relation.score),
});

/* Speaking is the browser's too, with an ear of its own (a download in the
   models panel): held only where it cannot run -- no WebAssembly to run the
   ear on, or no microphone to be had, which is an address a browser does not
   trust. See canBeHeard in @lucid/audio. */
limit({
  id: 'ear',
  name: 'Speaking',
  kind: 'off',
  mac: 'You talk to the pill out loud, and it hears you.',
  here: 'This browser can’t hear you here: you type, and the pill reads it.',
  holds: () => !canBeHeard(),
});

/* A browser that cannot run any model at all -- no WebGPU, or one whose GPU
   fell short of a limit the model asked it for when it tried (Firefox's nine
   storage buffers a shader, page/engine.ts in @lucid/machine) -- still
   opens the room, to look around: the line stays, marked, and says this. */
limit({
  id: 'pill',
  name: 'The pill',
  kind: 'off',
  mac: 'The pill talks with you: a model on your Mac writes every reply, and a voice says it.',
  here: 'This browser can’t run the pill — open this page in Chrome, Edge or Safari, or run it on your Mac.',
  holds: () => host().llm === 'none',
});

limit({
  id: 'words',
  name: 'The pill’s mind',
  kind: 'smaller',
  mac: 'A 27B model writes every reply — the one the pills were written against — or a 9B on a Mac with 16 GB.',
  here: 'A small one runs on this computer’s graphics card, 4B at most. It holds a character, mostly.',
  holds: () => host().llm !== 'none',
});

limit({
  id: 'memory',
  name: 'Memory',
  kind: 'smaller',
  mac: 'What the pill remembers about you is rewritten every few exchanges.',
  here: 'It is rewritten a third as often, so the small model stays quick.',
  holds: () => !seen || (seen.memory.enabled && seen.memory.fold_after > settings.memory.fold_after),
});

limit({
  id: 'window',
  name: 'How far back it reads',
  kind: 'smaller',
  mac: 'Every reply reads the last six exchanges.',
  here: 'Every reply reads the last four.',
  holds: () => !seen || seen.llm.context_turns < 6,
});

limit({
  id: 'scene',
  name: 'The scene',
  kind: 'off',
  mac: 'The pill keeps a note of where the two of you are, so a scene you moved to stays put.',
  here: 'No note is kept: where you are lives only in the last few exchanges.',
  holds: () => !seen || (settings.scene.enabled && !seen.scene.enabled),
});

limit({
  id: 'content',
  name: 'Intimacy',
  kind: 'smaller',
  mac: 'Nothing is held back: the pills go where the scene goes.',
  here: 'Intimacy stays off the page: when a scene gets that close, the lights go out and it picks up after.',
});
