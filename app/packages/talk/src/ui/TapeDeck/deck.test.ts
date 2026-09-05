/* The two rules in deck.ts that no screenshot can check. The eight keys
   themselves are checked where they are drawn — see ui/TapeDeck. */
import {expect, test} from 'vitest';
import type {Machine} from './deck';
import {deck, lineDisabled, waiting} from './deck';

const QUIET: Machine = {
  state: 'stopped', running: false, continuous: false, inputMode: 'type',
  nowhere: false, adrift: false,
  sounding: false, held: false, seeded: true, lastSaid: true,
  captureOn: false, micWarming: false, typing: false,
};

/* Once an evening, and only the first time. It answers exactly one question —
   does the sound work at all — and that question is asked once, by somebody
   who has never heard this voice and is watching words scroll past in
   silence. After that it is the same sound at the same interval with nothing
   left to explain, ticking under a conversation. */
test('the waiting pulse plays before the first voice, and never after it', () => {
  const coming = {...QUIET, state: 'thinking'} as Machine;
  expect(waiting(coming, false)).toBe(true);
  expect(waiting(coming, true)).toBe(false);
});

test('and never for a wait that is not one', () => {
  // Nothing is coming.
  expect(waiting({...QUIET, state: 'idle'}, false)).toBe(false);
  // It is already speaking: the answer arrived.
  expect(waiting({...QUIET, state: 'speaking', sounding: true}, false)).toBe(false);
  // Paused by you is not waiting.
  expect(waiting({...QUIET, state: 'thinking', held: true}, false)).toBe(false);
});

test('the line to write in goes dark with the keys', () => {
  expect(lineDisabled(QUIET)).toBe(false);
  expect(lineDisabled({...QUIET, adrift: true})).toBe(true);
  expect(lineDisabled({...QUIET, nowhere: true})).toBe(true);
});

/* The Talk key is three things, not two: off, working, and armed. The middle
   one is the recognizer loading under a press that has already happened —
   nothing is loaded to listen with until somebody asks to be heard. */
test('the talk key says it is working while the recognizer comes up', () => {
  const warming = deck({...QUIET, running: true, inputMode: 'mic',
                        captureOn: true, micWarming: true}).rec;
  expect(warming.busy).toBe(true);
  expect(warming.armed).toBe(false);
  expect(warming.disabled).toBe(false);      // pressing it again is how you stop
  expect(warming.title).toMatch(/warming the recognizer/);

  const armed = deck({...QUIET, running: true, inputMode: 'mic',
                      captureOn: true}).rec;
  expect(armed.busy).toBe(false);
  expect(armed.armed).toBe(true);
  expect(armed.title).toMatch(/listening/);
});
