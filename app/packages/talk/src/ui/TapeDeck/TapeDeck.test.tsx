/* What the eight keys look like in every state the machine can be in.
 *
 * The table below is paintPlay() and lockDeck() read off the old page and
 * written down: one row per state, and a comment on each saying which rule
 * decided it. It is the part of this port that a screenshot cannot check —
 * two keys the wrong way round look exactly like two keys.
 */
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import type {KeyId, Machine} from './deck';
import TapeDeck from './TapeDeck';

afterEach(cleanup);

const QUIET: Machine = {
  state: 'stopped',
  running: false,
  continuous: false,
  inputMode: 'type',
  nowhere: false,
  adrift: false,
  sounding: false,
  held: false,
  seeded: true,
  lastSaid: true,
  captureOn: false,
  micWarming: false,
  typing: false,
};

/* The detector, as the deck reads it: two numbers and a way to be told they
   moved. The deck subscribes to this itself -- it moves at microphone rate,
   and the room above it must not redraw for the bar under one key. */
function anEar(level = 0, floor = 0) {
  const ears = new Set<() => void>();
  return {
    level, floor,
    onChange(fn: () => void) { ears.add(fn); return () => { ears.delete(fn); }; },
    /** What the microphone does thirty times a second. */
    heard(now: number) { this.level = now; for (const fn of [...ears]) fn(); },
  };
}

const show = (machine: Partial<Machine>, onPress: (key: KeyId) => void = () => {},
              ear = anEar()) =>
  render(<TapeDeck machine={{...QUIET, ...machine}} minutes={15}
                   continuousMin={0} ear={ear} canBeHeard
                   onPress={onPress} />);

const key = (id: KeyId) => screen.getByRole('button', {name: new RegExp(LABEL[id], 'i')});
const LABEL: Record<KeyId, string> = {
  back: 'again', play: 'play', pause: 'pause|resume', stop: 'stop',
  skip: 'skip', rec: 'talk|talking', type: 'type|typing', eject: 'eject',
};
const ALL: KeyId[] = ['back', 'play', 'pause', 'stop', 'skip', 'rec', 'type', 'eject'];

/** Which keys can be pressed right now. */
const live = () => ALL.filter((id) => !(key(id) as HTMLButtonElement).disabled);

interface Row {
  what: string;
  machine: Partial<Machine>;
  /** Everything not in here is dark. */
  live: KeyId[];
  /** The ones that stay down while what they started is happening. */
  down?: KeyId[];
}

const TABLE: Row[] = [
  // A blank tape cannot be played: the first word is always the one somebody
  // recorded, so Play and Skip need a turn of yours, and Again needs one of
  // its. Nothing is sounding, so Pause and Stop mean nothing either.
  {what: 'a room where nothing has been said',
   machine: {seeded: false, lastSaid: false},
   live: ['rec', 'type', 'eject']},

  // Something has been said and nothing is happening: the tape can be played
  // or wound on, and the last line can be said again.
  {what: 'stopped, with a conversation in it',
   machine: {},
   live: ['back', 'play', 'skip', 'rec', 'type', 'eject']},

  // Idle is the same picture: it is the gap between turns, not an event.
  {what: 'idle', machine: {state: 'idle'},
   live: ['back', 'play', 'skip', 'rec', 'type', 'eject']},

  // Listening is your voice going in, not its voice coming out — nothing to
  // pause or stop. The Talk key is armed and says so as a switch.
  {what: 'listening', machine: {state: 'listening', running: true, inputMode: 'mic', captureOn: true},
   live: ['back', 'play', 'skip', 'rec', 'type', 'eject']},

  // talking() is true for the whole reply, gaps and all: Pause, Stop and Skip
  // are all about the voice that is coming.
  {what: 'thinking', machine: {state: 'thinking', running: true},
   live: ['back', 'play', 'pause', 'stop', 'skip', 'rec', 'type', 'eject']},

  {what: 'speaking, with sound in the air',
   machine: {state: 'speaking', running: true, sounding: true},
   live: ['back', 'play', 'pause', 'stop', 'skip', 'rec', 'type', 'eject']},

  /* The tape is running: Play stays down, and Stop means something even
     between turns because there is a run to end. */
  {what: 'continuous',
   machine: {state: 'speaking', running: true, continuous: true, sounding: true},
   live: ['back', 'play', 'pause', 'stop', 'skip', 'rec', 'type', 'eject'],
   down: ['play']},

  // Held: nothing is sounding and Pause is still lit, because it is the key
  // that lets it go. It stays down while it holds.
  {what: 'held', machine: {state: 'idle', held: true},
   live: ['back', 'play', 'pause', 'stop', 'skip', 'rec', 'type', 'eject'],
   down: ['pause']},

  /* Adrift, the audio already queued goes on playing — it left the server
     long ago — so Pause keeps working and is deliberately left bright. */
  {what: 'adrift', machine: {state: 'speaking', sounding: true, adrift: true},
   live: ['pause', 'eject']},

  // And a page pointed at a conversation that is not there has nothing at all
  // but the door.
  {what: 'no such conversation', machine: {state: 'idle', sounding: true, nowhere: true},
   live: ['eject']},
];

for (const row of TABLE) {
  test(`the deck ${row.what}`, () => {
    show(row.machine);
    expect(live()).toEqual(row.live);
    for (const id of ALL) {
      expect(key(id).classList.contains('down')).toBe(!!row.down?.includes(id));
    }
  });
}

test('the two record keys are switches, and say so', () => {
  show({inputMode: 'mic', running: true, captureOn: true, typing: true});
  expect(key('rec')).toHaveAttribute('aria-pressed', 'true');
  expect(key('rec')).toHaveTextContent('Talking');
  expect(key('type')).toHaveAttribute('aria-pressed', 'true');
  expect(key('type')).toHaveTextContent('Typing');
  expect(key('rec').className).toContain('armed');
});

test('pause says what it would do', () => {
  const shown = show({held: true});
  expect(screen.getByRole('button', {name: /resume/i})).toBeInTheDocument();
  shown.unmount();
  show({state: 'speaking', sounding: true});
  expect(screen.getByRole('button', {name: /pause/i})).toBeInTheDocument();
});

test('every key that can be pressed says which one it is', () => {
  const pressed: KeyId[] = [];
  show({state: 'speaking', running: true, sounding: true, continuous: true},
       (id) => { pressed.push(id); });
  for (const id of ALL) fireEvent.click(key(id));
  expect(pressed).toEqual(ALL);
});

test('an address with no microphone has no Talk key', () => {
  render(<TapeDeck machine={QUIET} minutes={15} continuousMin={0}
                   ear={anEar()} canBeHeard={false} onPress={vi.fn()} />);
  // Hidden means gone, so the role query cannot see it either.
  expect(screen.queryByRole('button', {name: /talk/i})).toBeNull();
  expect(document.getElementById('t-rec')).toHaveAttribute('hidden');
});

test('the clock is there while a dose runs, and reads what is left of it', () => {
  /* And only then. Off a run the deck showed how long a Play would give and
     how many lines had been said, and neither number was one anybody was
     looking for; the writing line has that width now. */
  render(<TapeDeck machine={QUIET} minutes={20} continuousMin={0}
                   ear={anEar()} canBeHeard onPress={vi.fn()} />);
  expect(document.getElementById('tape')).toBeNull();
  expect(document.getElementById('turns')).toBeNull();
  cleanup();

  render(<TapeDeck machine={{...QUIET, continuous: true, running: true, state: 'speaking'}}
                   minutes={20} continuousMin={12.5}
                   ear={anEar()} canBeHeard onPress={vi.fn()} />);
  const tape = document.getElementById('tape')!;
  expect(tape).toHaveTextContent('12:30');
  expect(tape.className).toContain('running');
  // Every segment that could light is drawn, and the lit ones are on top.
  expect(tape.querySelectorAll('path.on').length).toBeGreaterThan(0);
  expect(tape.querySelectorAll('path.off').length).toBeGreaterThan(0);
  cleanup();

  // Held: the colon stops and the face steps back.
  render(<TapeDeck machine={{...QUIET, continuous: true, running: true, held: true}}
                   minutes={20} continuousMin={12.5}
                   ear={anEar()} canBeHeard onPress={vi.fn()} />);
  const held = document.getElementById('tape')!;
  expect(held.className).toContain('dim');
  expect(held.className).not.toContain('running');
});

test('the Talk key is the meter, and it is the page that is hearing', () => {
  /* The level and the floor are the detector's own — the same two numbers it
     is deciding by, off this device rather than reported back by a machine a
     socket away. Under the arming bar the key is only open; over it, it says
     it can hear you. */
  const ear = anEar(0.002, 0.004);
  show({captureOn: true, running: true, inputMode: 'mic'}, () => {}, ear);
  const rec = document.getElementById('t-rec')!;
  expect(parseFloat(rec.style.getPropertyValue('--lvl'))).toBeLessThan(10);
  expect(rec.title).not.toMatch(/hearing/);

  /* And the deck follows it without anybody re-rendering it: the meter is its
     own subscription, which is what keeps the room still while somebody
     talks. */
  act(() => ear.heard(0.09));
  expect(parseFloat(rec.style.getPropertyValue('--lvl'))).toBeGreaterThan(50);
  expect(rec.title).toMatch(/hearing you/);
});

test('the Talk key shows the recognizer coming up, and stays pressable', () => {
  /* The device is open in this stretch and the model is not there yet, so the
     bar under the key is not a level: it says the key is working. The words
     say the same thing, over a meter that would otherwise claim to be hearing
     somebody. */
  const ear = anEar(0.09, 0.004);
  const pressed: KeyId[] = [];
  show({inputMode: 'mic', running: true, captureOn: true, micWarming: true},
       (id) => { pressed.push(id); });
  const rec = document.getElementById('t-rec')!;
  expect(rec.className).toContain('busy');
  // Working, not listening: the device is open and the ear is not there yet.
  expect(rec.className).not.toContain('armed');
  expect(rec).not.toBeDisabled();
  expect(rec.title).toMatch(/warming the recognizer/);
  fireEvent.click(rec);
  expect(pressed).toEqual(['rec']);
  cleanup();

  // And once it is up, the key is the meter again and says nothing about it.
  show({inputMode: 'mic', running: true, captureOn: true}, () => {}, ear);
  const armed = document.getElementById('t-rec')!;
  expect(armed.className).not.toContain('busy');
  expect(armed.title).toMatch(/hearing you/);
});
