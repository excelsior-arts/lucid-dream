/* Lucid Talk's conversation, on the glass.
 *
 * The pane, the bubbles and the scroll policy are @lucid/ui's Transcript.
 * What is here is what only this game means: which turns were taken with your
 * hands rather than your voice, which of them were never spoken aloud, the
 * two pairs of dots standing in for words that have not arrived, and the two
 * things you can do to a line — say it again, take it back.
 */
import {useCallback, useMemo} from 'react';
import type {Line} from '@lucid/ui';
import Pane from '@lucid/ui/Transcript/Transcript';
import type {Turn} from '../../link/store';

export interface Props {
  turns: readonly Turn[];
  /** Never a name, never a pronoun: what the box handed you. */
  personaName: string;
  /** What the pacer is letting through of the reply still arriving. */
  visible?: string | null;
  /** A reply is still being released against its voice, so the caret stays. */
  pacing?: boolean;
  /** Turns whose voice was never heard, by their place in the transcript. */
  unheard?: ReadonlySet<number>;
  /** It is hearing you now; the transcript arrives a second later. */
  heard?: boolean;
  /** And it is thinking, and has not said anything yet. */
  musing?: boolean;
  onReplay: (text: string) => void;
  onDelete: (role: 'user' | 'assistant', text: string) => void;
  /** The mark pressed: turn the sound back on and say that line. */
  onUnheard: (text: string) => void;
}

const Speaker = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

const Trash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </svg>
);

/* A turn taken with your hands rather than your voice: the room wrote it, and
   it is wrapped in brackets because that is how it reads to the model as well
   — a thing done rather than a thing said. Same bubble, same side of the
   conversation, leaning. */
const byHand = (text: string) => /^\s*\(.*\)\s*$/.test(text || '');

export default function Transcript(props: Props) {
  const {turns, personaName, visible, pacing, unheard, heard, musing} = props;

  /* Built once per change and not once per render, because the pane is
     memoized against exactly this: the tick that repaints the deck arrives
     five times a second and none of it is about the words on the glass. */
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = turns.map((turn, i) => ({
      role: turn.role,
      text: turn.text,
      streaming: turn.streaming,
      hand: turn.role === 'user' && byHand(turn.text),
      unheard: unheard?.has(i),
    }));
    /* Your turn, before the words exist: it hears you now, the transcript
       arrives a second later. Without this the screen says nothing while you
       talk and the reply seems to come out of nowhere. */
    if (heard) out.push({role: 'user', text: '', pending: true});
    /* And the same three dots on the other side, while it is thinking and has
       not said anything yet. The pulse says a voice is coming and the dots say
       a reply is; between them there was a gap where the room was quietly
       beating at somebody with nothing on the glass to explain it. */
    if (musing) out.push({role: 'assistant', text: '', pending: true});
    return out;
  }, [turns, unheard, heard, musing]);

  /* Both of these have to keep the same identity for the life of the pane, or
     its memo is a no-op and the whole conversation is redrawn five times a
     second with the tick. Which makes it a rule about what the room hands in:
     the three callbacks below are useCallback'd there, and this is where that
     matters. */
  const {onReplay, onDelete} = props;
  const tools = useCallback((turn: Line) => (
    <>
      {turn.role === 'assistant' && (
        <button className="replay" title="say it again"
                onClick={() => onReplay(turn.text)}><Speaker /></button>
      )}
      <button className="del" title="delete this — from here and from the transcript"
              onClick={() => onDelete(turn.role, turn.text)}><Trash /></button>
    </>
  ), [onReplay, onDelete]);

  const told = props.onUnheard;
  const onUnheard = useCallback((turn: Line) => told(turn.text), [told]);

  return (
    <Pane turns={lines} name={personaName} visible={visible} pacing={pacing}
          tools={tools} onUnheard={onUnheard} />
  );
}
