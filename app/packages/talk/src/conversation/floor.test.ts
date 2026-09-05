/* The floor's two facts about the speaker, read off a speaker that lies. */
import {expect, test} from 'vitest';
import type {Playback} from '@lucid/audio';
import {playInto, remainingS, speaking} from './floor';

const speaker = (over: Partial<Playback>): Playback => ({
  queuedS: 2, playingS: 3, playedS: 0, spokenChars: 0, playingChars: 0,
  playing: true, held: false, stalled: false, expecting: false, sinceStartMs: 1000,
  position: () => 0.5,
  enqueue() {}, credit() {}, stop() {}, hold() {}, expect() {},
  onChange: () => () => {}, onUnheard: () => () => {}, unlockOnce: () => () => {},
  dispose() {},
  ...over,
} as Playback);

test('what is left to hear is the queue plus the rest of the chunk in hand', () => {
  playInto(speaker({}));
  expect(remainingS()).toBeCloseTo(4.5, 6);
  expect(speaking()).toBe(true);
});

test('a chunk the browser has stopped is nothing to wait on', () => {
  /* A turn holds the floor until the sound has drained. Safari stops media
     in a page it put away, and a turn that waited on the stopped chunk held
     the floor for as long as the page was gone: the line said on coming back
     was heard, transcribed, and never answered. */
  playInto(speaker({stalled: true}));
  expect(remainingS()).toBe(0);
  expect(speaking()).toBe(false);
});
