/* The deck.
 *
 * What a game runs through this is linear, positional, replayable and finite,
 * so the controls of a tape are honest about it rather than decoration over
 * something else. Say it again, let it run on its own, record, stop the tape
 * and take it out.
 *
 * Eight keys and a counter, not the six of the machine this is looking at: a
 * row of identical black keys under six-point labels is charming and
 * unusable. The posture is borrowed, the legibility is not given up — every
 * key keeps a word under it and a sentence in its tooltip.
 *
 * What each key *means* is the game's, and arrives as this array: which keys
 * there are, what they say and which of them can be pressed is a fact about
 * what the game is doing. This file is the keys themselves, the meter along
 * the foot of one of them, and the row they stand in.
 */
import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';
import type {Meter} from './meter';
import {hearing} from './meter';
import './Deck.css';

/* The keys' faces, drawn rather than typed.
 *
 * They were the characters for them — ⏮ ▶ ■ ⏭ ⏏ — which is exactly what those
 * characters are for, and which a phone renders as color emoji: a row of
 * little glossy 3-D buttons sitting inside the flat ones, at whatever size
 * and weight Apple felt like. There is no asking a font not to do that
 * reliably, and the rest of this interface is drawn anyway, so these are too.
 * One shape each, on the same 24-unit grid as the corner rail, filled with
 * whatever color the key is — so a record circle still goes red by being told
 * to, and nothing here has to know about that.
 */
const FACE = {
  play: <path d="M8 5.2 19 12 8 18.8Z" />,
  pause: <path d="M8.2 5h3.1v14H8.2zM12.7 5h3.1v14h-3.1z" />,
  stop: <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.2" />,
  again: <path d="M5 5h2.6v14H5zM19.6 5v14L9.1 12Z" />,
  skip: <path d="M4.4 5 14.9 12 4.4 19ZM16.4 5H19v14h-2.6z" />,
  record: <circle cx="12" cy="12" r="5.4" />,
  eject: <path d="M12 4.8 20 14H4ZM4.6 16.4h14.8v2.8H4.6z" />,
  /* Three answers, for a game that asks: a tick, a cross, and a tilde that
     has not made up its mind. Filled like the rest, on the same grid. */
  yes: <path d="M4.6 12.6 7.1 10.1 10.2 13.2 16.9 6.5 19.4 9 10.2 18.2Z" />,
  no: <path d="M6.6 4.8 12 10.2 17.4 4.8 19.2 6.6 13.8 12 19.2 17.4 17.4 19.2 12 13.8 6.6 19.2 4.8 17.4 10.2 12 4.8 6.6Z" />,
  maybe: <path d="M4.6 13.4c1.1-2.6 2.6-3.9 4.5-3.9 1.4 0 2.5.7 3.4 2.1.6.9 1.2 1.3 1.9 1.3 1 0 1.8-.9 2.5-2.6l2.5 1.1c-1.1 2.6-2.6 3.9-4.5 3.9-1.4 0-2.5-.7-3.4-2.1-.6-.9-1.2-1.3-1.9-1.3-1 0-1.8.9-2.5 2.6Z" />,
  /* A map, folded in three, for a game with ground to look back over. */
  map: <path d="M3.4 6.2 8.4 4.3v13.6l-5 1.9Zm6.6-1.9 4 1.7v13.6l-4-1.7Zm5.6 1.7 5-1.9v13.6l-5 1.9Z" />,
};

/** The ten shapes there are. A key wears one of them. */
export type Icon = keyof typeof FACE;

const Face = ({name}: {name: Icon}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{FACE[name]}</svg>
);

export interface Key {
  /** Its own name. The button is `#t-<id>`, which is what a browser test,
      a room's stylesheet and the screenshot walk all reach for. */
  id: string;
  icon: Icon;
  label: string;
  title?: string;
  disabled?: boolean;
  /** Gone rather than grayed: a key for something this address cannot do. */
  hidden?: boolean;
  /** A switch rather than a button, to a screen reader and to the ear both. */
  pressed?: boolean;
  /** Pressed, and staying down while what it started is happening. */
  down?: boolean;
  /** Lit green: the tape is running. */
  playing?: boolean;
  /** A record key that is live. */
  armed?: boolean;
  /** Pressed, and still waiting on whatever it started — a model coming up
      under it. Not disabled: the press that would take it back is the one
      thing that still has to work. */
  busy?: boolean;
  /** One of the record keys — what goes on the tape comes through it. */
  rec?: boolean;
  /** This key is the meter. */
  meter?: Meter;
  /** Something small worn in the key's corner: a part limited where this
      page runs (the shell's Mark), say. The key stays a key. */
  mark?: ReactNode;
  onPress: () => void;
}

export interface Props {
  keys: readonly Key[];
  /** Whatever is being counted, on the right of the row. */
  counter?: ReactNode;
  /** The writing line, which lives among the keys. */
  children?: ReactNode;
}

export default function Deck({keys, counter, children}: Props) {
  const faces = useRef(new Map<string, HTMLButtonElement>());
  /* A level, along the foot of a key and nowhere else. Small on purpose: it
     is here to answer "is it hearing me" while something is being set up, not
     to be watched. Written straight onto the key rather than kept as state —
     it moves once a block, thirty times a second, and nothing else on the
     page has any use for it. */
  const lvls = useRef(new Map<string, number>());
  const ear = keys.map((k) => (k.meter ? `${k.id}:${k.meter.level}:${k.meter.floor}:${k.meter.live}` : ''))
                  .join('|');
  useEffect(() => {
    for (const k of keys) {
      const el = faces.current.get(k.id);
      if (!el || !k.meter) continue;
      const {level, floor, live} = k.meter;
      // the dot: dark when the device is off, green when live, bright when it hears you
      const gate = Math.max(floor * 3, 0.004);
      const heard = live ? Math.min(1, level / Math.max(gate * 3, 0.02)) : 0;
      const was = lvls.current.get(k.id) ?? 0;
      const now = heard > was ? heard : was * 0.7 + heard * 0.3;   // falls back gently
      const kept = now < 0.01 ? 0 : now;
      lvls.current.set(k.id, kept);
      el.style.setProperty('--lvl', (kept * 100).toFixed(1) + '%');
      /* The key is the meter. It blinks while the device is open and blinks
         faster when it can actually hear you, which is the one thing a person
         needs to know about a microphone and the thing a label never says. */
      el.style.setProperty('--beat', hearing(k.meter) ? '.45s' : '1.6s');
    }
    // What it reads is in `ear`; `keys` is rebuilt on every render and would
    // step the meter's fall once per repaint of everything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ear]);

  return (
    <div id="deck">
      {keys.map((key) => (
        <button
          key={key.id}
          id={'t-' + key.id}
          ref={(el) => {
            if (el) faces.current.set(key.id, el);
            else faces.current.delete(key.id);
          }}
          className={'key' + (key.rec ? ' rec' : '') + (key.armed ? ' armed' : '')
            + (key.busy ? ' busy' : '')
            + (key.down ? ' down' : '') + (key.playing ? ' playing' : '')}
          disabled={key.disabled}
          hidden={key.hidden}
          aria-pressed={key.pressed}
          title={key.title}
          onClick={key.onPress}
        >
          <i data-icon={key.icon}><Face name={key.icon} /></i>
          <span>{key.label}</span>
          {key.mark && <em className="key-mark">{key.mark}</em>}
        </button>
      ))}
      {children}
      {counter}
    </div>
  );
}
