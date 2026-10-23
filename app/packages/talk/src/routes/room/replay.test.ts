/* The play key on a bubble, in each state the voice can be in: it does what
   stands between the press and the sound, once. */
import {afterEach, expect, test, vi} from 'vitest';
import {MACHINE, offerVoice, onAskForCard, RESTING_LEVEL, setHost, sound} from '@lucid/shell';
import type {VoiceOffer} from '@lucid/shell';
import {replay, replayState} from './replay';

afterEach(() => {
  offerVoice(null);
  setHost(MACHINE);
  sound.setHush(false);
  if (sound.level === 0) sound.setLevel(RESTING_LEVEL);
});

const offer = (o: Partial<VoiceOffer>): VoiceOffer => {
  const made: VoiceOffer = {on: true, what: 'Chatterbox Turbo', mb: 647, state: 'ready', set: vi.fn(), ...o};
  offerVoice(made);
  return made;
};

test('ready: said at once', () => {
  const speak = vi.fn(() => Promise.resolve());
  expect(replayState()).toBe('ready');
  replay('Hello.', speak);
  expect(speak).toHaveBeenCalledWith('Hello.');
});

test('silent: one press brings the sound back at its resting level, and says the line', () => {
  sound.setHush(true);
  sound.setLevel(0);
  expect(replayState()).toBe('silent');
  const speak = vi.fn(() => Promise.resolve());
  replay('Hello.', speak);
  expect(sound.hush).toBe(false);
  expect(sound.level).toBe(RESTING_LEVEL);
  expect(speak).toHaveBeenCalledWith('Hello.');
});

test('no voice downloaded: the models panel at its voice, and nothing said or loaded', () => {
  const o = offer({on: false, missing: true, state: 'off'});
  setHost({voice: false});
  sound.setHush(true);
  expect(replayState()).toBe('missing');
  const asked = vi.fn();
  const away = onAskForCard(asked);
  const speak = vi.fn(() => Promise.resolve());
  replay('Hello.', speak);
  expect(asked).toHaveBeenCalledWith('voice');
  expect(o.set).not.toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
  expect(sound.hush).toBe(true);
  away();
});

test('switched off but downloaded: switched on, and said once it is up', async () => {
  setHost({voice: false});
  const o = offer({on: false, state: 'off'});
  expect(replayState()).toBe('off');
  const speak = vi.fn(() => Promise.resolve());
  replay('Hello.', speak);
  expect(o.set).toHaveBeenCalledWith(true);
  offer({on: true, state: 'fetching'});
  await Promise.resolve();
  expect(speak).not.toHaveBeenCalled();
  offer({on: true, state: 'ready'});
  setHost({voice: true});
  expect(speak).toHaveBeenCalledWith('Hello.');
});

test('and a switch that turns out to open the panel instead lets the line go', async () => {
  setHost({voice: false});
  offer({on: false, state: 'off'});
  const speak = vi.fn(() => Promise.resolve());
  replay('Hello.', speak);
  await Promise.resolve();
  setHost({voice: true});          // much later, from somewhere else
  expect(speak).not.toHaveBeenCalled();
});
