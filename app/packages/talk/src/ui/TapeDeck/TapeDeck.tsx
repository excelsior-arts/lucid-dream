/* Lucid Talk's deck: eight keys, a clock, and what each of them means here.
 *
 * The keys, the meter and the row they stand in are @lucid/ui's Deck — any
 * game with a conversation in it wants that. What is Lucid Talk's is deck.ts
 * beside this, which says what a key means given the state the machine is in,
 * and the one readout on the right: how much of this dose is left, while a
 * dose is running. There was a count of lines said beside it once; nobody
 * could say what it was for, and two numbers of the same weight hid the one
 * that moved. Off a run there is no clock at all, and the writing line has
 * the width.
 */
import {useEffect, useState, useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import type {Key} from '@lucid/ui';
import {createTape, hearing} from '@lucid/ui';
import {Mark, useLimited} from '@lucid/shell';
import Deck from '@lucid/ui/Deck/Deck';
import Lcd from '@lucid/ui/Deck/Lcd';
import type {Deck as Keys, KeyId, Machine} from './deck';
import {deck} from './deck';

/** The little of the detector the meter reads. */
export interface Ear {
  readonly level: number;
  readonly floor: number;
  onChange(fn: () => void): () => void;
}

export interface Props {
  machine: Machine;
  /** How long a Play would run, from the strength set on the box. */
  minutes: number;
  /** And how much of a running one is left, as the machine has it. */
  continuousMin: number;
  /** The page's own ear: the level, 0..1, and the floor it is measured
      against -- the same two numbers the detector is deciding by. See vad.ts
      in @lucid/audio.

      Subscribed to here rather than handed down as numbers, and that is the
      whole point of it: it moves about thirty times a second while the
      microphone is open, and read by the route it re-rendered the room -- the
      stage, the glass, three hundred bubbles, the typing line -- at that rate,
      for a bar under one key. Read here, the deck is the only thing that
      redraws. */
  ear: Ear;
  /** An address a browser will not open a microphone on has no Talk key. */
  canBeHeard: boolean;
  onPress: (key: KeyId) => void;
  /** The writing line, which lives among the keys. */
  children?: ReactNode;
}

/** Which face each key wears, and which are the two record keys. */
const ICON: Record<KeyId, Key['icon']> = {
  back: 'again', play: 'play', pause: 'pause', stop: 'stop',
  skip: 'skip', rec: 'record', type: 'record', eject: 'eject',
};
const ORDER: KeyId[] = ['back', 'play', 'pause', 'stop', 'skip', 'rec', 'type', 'eject'];

export default function TapeDeck(props: Props) {
  const {machine, minutes, continuousMin, ear: heard, canBeHeard} = props;
  const level = useSyncExternalStore(heard.onChange, () => heard.level);
  const floor = useSyncExternalStore(heard.onChange, () => heard.floor);
  const keys: Keys = deck(machine);
  /* A browser that cannot hear (no WebAssembly for its ear, or no
     microphone on this address): the Talk key stays anyway, marked, and a
     press says so and how to run it on your Mac (the room opens that; see
     Room.tsx). Where the browser can, null, as on the machine. */
  const noEar = useLimited('ear');
  /* And a browser that cannot run the pill at all: the Type key wears the
     mark, and a press opens what it says. */
  const noPill = useLimited('pill');
  /* The clock, which is not a render: it is counted off a deadline of this
     page's own, five times a second, and told what the machine believes
     whenever that arrives. See tape.ts in @lucid/ui. */
  const [clock] = useState(createTape);
  const tape = useSyncExternalStore(clock.subscribe, clock.get);
  useEffect(() => clock.tell({continuous: machine.continuous, minutes,
                              left: continuousMin, held: machine.held}),
            [clock, machine.continuous, machine.held, minutes, continuousMin]);
  useEffect(() => () => clock.dispose(), [clock]);

  /* The mic key is the meter, and the title it wears while the bar is moving
     is this game's way of saying so. `hearing` is the meter's own threshold,
     asked rather than guessed, so the words and the bar cannot disagree. */
  const ear = {level, floor, live: keys.rec.armed};

  const all: Key[] = ORDER.map((id) => {
    const key = keys[id];
    const rec = id === 'rec' || id === 'type';
    return {
      id,
      icon: ICON[id],
      label: key.label,
      title: id === 'rec' && noEar ? 'this browser can’t hear you — press to see how to speak on your Mac'
        : id === 'rec' && hearing(ear) && !key.busy
          ? 'hearing you — press to stop listening' : key.title,
      disabled: key.disabled,
      hidden: id === 'rec' && !canBeHeard && !noEar,
      ...(id === 'rec' && noEar ? {mark: <Mark title="limited in this browser" />} : {}),
      ...(id === 'type' && noPill ? {mark: <Mark title={noPill.here} />} : {}),
      pressed: key.pressed,
      down: key.down,
      playing: key.playing,
      armed: key.armed,
      busy: key.busy,
      rec,
      ...(id === 'rec' ? {meter: ear} : {}),
      onPress: () => props.onPress(id),
    };
  });

  return (
    <Deck
      keys={all}
      counter={
        /* Only while a dose is running. A clock on a deck that is not
           playing was a number most people never needed and every one of
           them read; the length a Play would run is in Play's own tooltip. */
        machine.continuous
          ? <Lcd id="tape" text={`${tape.mm}:${tape.ss}`}
                 running={!machine.held && !tape.spent}
                 dim={machine.held || tape.spent}
                 title={machine.held ? 'how much of this dose is left — paused'
                   : tape.spent ? 'this dose has run out' : 'how much of this dose is left'} />
          : null
      }
    >
      {props.children}
    </Deck>
  );
}
