import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {sound} from '@lucid/shell';
import {createPlayback, wavBytes} from './playback';

/* jsdom has no media playback at all: an element there will not decode, will
   not play and will never fire `ended`. So the element is a stand-in and the
   test is the browser -- it says when a chunk ends, which is the event this
   whole queue is chained on. */
class FakeAudio {
  static made: FakeAudio[] = [];
  src = '';
  volume = 1;
  preload = '';
  playsInline = false;
  currentTime = 0;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: ((e: Event) => void) | null = null;
  onplay: ((e: Event) => void) | null = null;
  ended = false;
  /** What the next play() should refuse with, if anything. */
  refuse: {name: string} | null = null;
  constructor() { FakeAudio.made.push(this); }
  play() {
    if (this.refuse) return Promise.reject(this.refuse);
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
}

let urls = 0;
let live: string[] = [];

/** One second at 24k, as the socket sends it. */
function chunk(secs = 1, rate = 24000, level = 0.2): string {
  const pcm = new Int16Array(Math.round(secs * rate));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(level * 32767 * Math.sin((2 * Math.PI * 200 * i) / rate));
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* The two things it says about itself: held or let go, and how much is still
   to play. Both are callbacks -- what a game puts on its own wire when it
   hears one is the game's business and is tested where that happens. */
let holds: boolean[] = [];
let queued: number[] = [];
const ears = {
  onHold: (on: boolean) => { holds.push(on); },
  onQueued: (s: number) => { queued.push(s); },
};
const el = () => FakeAudio.made[0]!;

beforeEach(() => {
  holds = [];
  queued = [];
  urls = 0;
  live = [];
  vi.stubGlobal('Audio', FakeAudio);
  // One element per document, kept across tests the way it is kept across
  // rooms: whatever the last test left on it is not this test's.
  for (const a of FakeAudio.made) { a.refuse = null; a.ended = false; a.paused = true; a.currentTime = 0; }
  URL.createObjectURL = () => { const u = 'blob:' + ++urls; live.push(u); return u; };
  URL.revokeObjectURL = (u: string) => { live = live.filter((x) => x !== u); };
});

afterEach(() => {
  sound.setHush(false);
  vi.unstubAllGlobals();
});

/** play() settles on a microtask; the queue moves when it does. */
const settled = () => Promise.resolve();

test('a chunk is queued, played, and given back when it ends', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  await settled();
  expect(p.playing).toBe(true);
  expect(p.playingS).toBeCloseTo(1, 6);
  expect(p.queuedS).toBe(0);                 // the one in hand is not queued
  expect(el().src).toBe('blob:1');
  expect(live).toEqual(['blob:1']);

  p.enqueue(chunk(2), 24000);
  await settled();
  expect(p.queuedS).toBeCloseTo(2, 6);
  expect(el().src).toBe('blob:1');           // and it did not cut the first off

  el().onended!();
  await settled();
  expect(live).toEqual(['blob:2']);          // the first was revoked
  expect(el().src).toBe('blob:2');
  expect(p.playedS).toBeCloseTo(1, 6);
  expect(p.queuedS).toBe(0);
  p.dispose();
});

test('characters are banked only when the chunk that speaks them finishes', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  p.credit(30);                              // lands on the chunk in hand
  await settled();
  expect(p.spokenChars).toBe(0);
  el().onended!();
  await settled();
  expect(p.spokenChars).toBe(30);

  p.enqueue(chunk(1), 24000);
  p.credit(12);
  p.credit(8);                               // both onto the last one queued
  await settled();
  el().onended!();
  await settled();
  expect(p.spokenChars).toBe(50);
  p.dispose();
});

test('a hard stop empties the queue and pauses what was playing', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  p.enqueue(chunk(1), 24000);
  await settled();
  p.stop(false);
  expect(p.playing).toBe(false);
  expect(p.queuedS).toBe(0);
  expect(p.playingS).toBe(0);
  expect(el().paused).toBe(true);
  expect(el().onended).toBeNull();           // and cannot chain into the next
  expect(live).toEqual([]);
  p.dispose();
});

test('a fade takes the voice down to nothing, stops it, and puts the level back', async () => {
  vi.useFakeTimers();
  try {
    const p = createPlayback(ears);
    p.enqueue(chunk(2), 24000);
    p.enqueue(chunk(2), 24000);
    await settled();
    sound.setLevel(0.8);
    p.fade(1);
    vi.advanceTimersByTime(500);
    expect(el().paused).toBe(false);
    expect(el().volume).toBeGreaterThan(0.2);
    expect(el().volume).toBeLessThan(0.6);
    vi.advanceTimersByTime(600);
    expect(el().paused).toBe(true);
    expect(p.queuedS).toBe(0);
    expect(el().volume).toBeCloseTo(0.8, 6);    // for whoever speaks next
    // Nothing playing: a fade is a stop.
    p.fade(1);
    expect(el().paused).toBe(true);
    p.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test('a soft stop lets the line being spoken land', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  p.enqueue(chunk(1), 24000);
  await settled();
  p.stop(true);
  expect(p.playing).toBe(true);              // still coming out
  expect(el().paused).toBe(false);
  expect(p.queuedS).toBe(0);                 // what was behind it is gone
  el().onended!();
  await settled();
  expect(p.playing).toBe(false);
  p.dispose();
});

test('a hold pauses the sound and the run behind it', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  await settled();
  p.hold(true);
  expect(p.held).toBe(true);
  expect(el().paused).toBe(true);
  expect(holds).toEqual([true]);
  // Nothing arriving while it is held starts playing behind the pause.
  p.enqueue(chunk(1), 24000);
  await settled();
  expect(el().src).toBe('blob:1');

  p.hold(false);
  await settled();
  expect(el().paused).toBe(false);
  expect(el().src).toBe('blob:1');           // picked up, not skipped
  expect(holds).toEqual([true, false]);
  p.dispose();
});

test('hush drops what was in the air and says the line was never heard', async () => {
  const p = createPlayback(ears);
  let unheard = 0;
  p.onUnheard(() => unheard++);
  p.enqueue(chunk(1), 24000);
  await settled();

  sound.setHush(true);
  expect(unheard).toBe(1);
  expect(p.playing).toBe(false);
  expect(p.queuedS).toBe(0);

  p.enqueue(chunk(1), 24000);                // and nothing arriving is spoken
  expect(unheard).toBe(2);
  expect(p.playing).toBe(false);
  p.dispose();
});

test('the level in the corner is the level it speaks at', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  await settled();
  sound.setLevel(0.3);
  expect(el().volume).toBeCloseTo(0.3, 6);
  p.dispose();
});

test('the server is told how much is left to play, whenever it changes', async () => {
  const p = createPlayback(ears);
  p.enqueue(chunk(1), 24000);
  await settled();
  expect(queued.at(-1)).toBe(1);
  p.enqueue(chunk(2), 24000);
  await settled();
  expect(queued.at(-1)).toBe(3);
  p.stop(false);
  expect(queued.at(-1)).toBe(0);
  p.dispose();
});

test('the position is where the chunk in hand has got to', async () => {
  const p = createPlayback(ears);
  expect(p.position()).toBe(0);
  p.enqueue(chunk(1), 24000);
  await settled();
  el().currentTime = 0.4;
  expect(p.position()).toBeCloseTo(0.4, 6);
  p.stop(false);
  expect(p.position()).toBe(0);
  p.dispose();
});

test('a first gesture plays real silence, once', async () => {
  const p = createPlayback(ears);
  const off = p.unlockOnce();
  window.dispatchEvent(new Event('pointerdown'));
  expect(el().src.startsWith('data:audio/wav;base64,')).toBe(true);
  const first = el().src;
  el().src = '';
  window.dispatchEvent(new Event('keydown'));
  expect(el().src).toBe('');                 // once an evening, not once a key
  // The clip is a real 50 ms of it, not a header with nothing behind it.
  expect(atob(first.slice('data:audio/wav;base64,'.length)).length).toBe(44 + 1600);
  off();
  p.dispose();
});

test('the wav header is the 44 bytes a browser expects', () => {
  const wav = wavBytes(new Uint8Array(2400), 24000);
  const v = new DataView(wav.buffer);
  const word = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
  expect(wav.length).toBe(44 + 2400);
  expect(word(0)).toBe('RIFF');
  expect(v.getUint32(4, true)).toBe(36 + 2400);
  expect(word(8)).toBe('WAVE');
  expect(v.getUint32(16, true)).toBe(16);    // PCM, and the chunk that says so
  expect(v.getUint16(20, true)).toBe(1);
  expect(v.getUint16(22, true)).toBe(1);     // one channel
  expect(v.getUint32(24, true)).toBe(24000);
  expect(v.getUint32(28, true)).toBe(48000); // bytes a second, at 16 bits
  expect(v.getUint16(32, true)).toBe(2);
  expect(v.getUint16(34, true)).toBe(16);
  expect(word(36)).toBe('data');
  expect(v.getUint32(40, true)).toBe(2400);
});

test('a chunk the browser paused behind the page is stalled, and picked up when the page is seen', async () => {
  /* Safari stops media in a tab it has put in the background and does not say
     `ended`. The chunk stayed in hand for the rest of the evening: the room
     believed the pill was still speaking, the detector waited for somebody to
     talk over it, and a person back at the window talking normally lit the
     meter and was never heard. */
  const pb = createPlayback(ears);
  pb.enqueue(chunk(), 24000);
  await settled();
  expect(pb.playing).toBe(true);
  expect(pb.stalled).toBe(false);
  el().paused = true;
  el().onpause?.(new Event('pause'));
  expect(pb.stalled).toBe(true);
  expect(pb.playing).toBe(true);
  // Seen again: it plays on from where it stopped.
  document.dispatchEvent(new Event('visibilitychange'));
  await settled();
  expect(el().paused).toBe(false);
  el().onplay?.(new Event('play'));
  expect(pb.stalled).toBe(false);
  pb.dispose();
});

test('and let go of when the browser will not play it on', async () => {
  const pb = createPlayback(ears);
  pb.enqueue(chunk(), 24000);
  await settled();
  el().paused = true;
  el().onpause?.(new Event('pause'));
  el().refuse = {name: 'NotAllowedError'};
  document.dispatchEvent(new Event('visibilitychange'));
  await settled();
  await settled();
  // `ended` was raised by hand, so the queue moved on and nothing is in hand.
  expect(pb.playing).toBe(false);
  expect(pb.stalled).toBe(false);
  pb.dispose();
});

test('an abort is the browser superseding a play, and nobody is told', async () => {
  /* A skip, a stop, a stalled chunk let go of, a tab put away: every abort is
     something this page did or knew about, and "audio: play: AbortError" in
     the console taught people to read it as the sound being broken. */
  const said: string[] = [];
  const pb = createPlayback({...ears, say: (line: string) => { said.push(line); }});
  pb.enqueue(chunk(), 24000);
  await settled();
  el().refuse = {name: 'AbortError'};
  el().onended!();                 // the next chunk's play() is the one refused
  pb.enqueue(chunk(), 24000);
  await settled();
  await settled();
  expect(said.filter((l) => /Abort/.test(l))).toHaveLength(0);
  // And the queue moved on rather than hanging on the refused chunk.
  expect(pb.playing).toBe(false);
  pb.dispose();
});

test('a chunk that stops advancing is stalled after three seconds', async () => {
  /* The fault as the log showed it: back at the page, a chunk in hand that
     neither ended nor paused. Safari drops the event for media in a page it
     put away, and every reader of this object believed the chunk for the
     rest of the evening -- the floor held, the pacer withholding, the
     detector waiting to be talked over. The position is read once a second,
     and a chunk that is not advancing is not sound. */
  vi.useFakeTimers();
  const pb = createPlayback(ears);
  pb.enqueue(chunk(3), 24000);
  await vi.advanceTimersByTimeAsync(0);
  expect(pb.playing).toBe(true);
  el().currentTime = 0.5;
  await vi.advanceTimersByTimeAsync(1000);
  expect(pb.stalled).toBe(false);          // it moved
  await vi.advanceTimersByTimeAsync(3000);  // and then it did not
  expect(pb.stalled).toBe(true);
  expect(pb.playing).toBe(true);           // still in hand: seen() may play it on
  // In view and still not moving, it is let go of so the queue can move.
  await vi.advanceTimersByTimeAsync(3000);
  expect(pb.playing).toBe(false);
  expect(pb.stalled).toBe(false);
  pb.dispose();
  vi.useRealTimers();
});

test('an ended the browser never said is noticed', async () => {
  vi.useFakeTimers();
  const pb = createPlayback(ears);
  pb.enqueue(chunk(1), 24000);
  pb.enqueue(chunk(1), 24000);
  await vi.advanceTimersByTimeAsync(0);
  expect(pb.queuedS).toBeCloseTo(1, 3);
  el().ended = true;                        // over, with no event
  await vi.advanceTimersByTimeAsync(1000);
  // The queue moved: the second chunk is the one in hand now.
  expect(pb.playing).toBe(true);
  expect(pb.queuedS).toBe(0);
  expect(pb.playedS).toBeCloseTo(1, 3);
  pb.dispose();
  vi.useRealTimers();
});

test('stopping takes the stall with it', async () => {
  /* A stop while the tab was in the background left the flag standing on
     nothing, and the detector refused to believe the next reply's sound
     until a chunk happened to play. */
  const pb = createPlayback(ears);
  pb.enqueue(chunk(), 24000);
  await settled();
  el().paused = true;
  el().onpause?.(new Event('pause'));
  expect(pb.stalled).toBe(true);
  pb.stop(false);
  expect(pb.stalled).toBe(false);
  expect(pb.playing).toBe(false);
  pb.dispose();
});

test('a chunk let go of is not banked as said', async () => {
  /* Every way a chunk leaves the element used to bank its seconds and its
     characters: one that would not decode, one let go of for not moving, one
     superseded before it played. The reply counts what was heard by that
     bank, so an interrupt kept sentences nobody heard. */
  vi.useFakeTimers();
  const pb = createPlayback(ears);
  pb.enqueue(chunk(2), 24000);
  pb.credit(9);
  await vi.advanceTimersByTimeAsync(0);
  el().currentTime = 0.3;
  await vi.advanceTimersByTimeAsync(7000);       // stalled, then let go of in view
  expect(pb.playing).toBe(false);
  expect(pb.playedS).toBe(0);
  expect(pb.spokenChars).toBe(0);
  // One the browser played to the end is.
  pb.enqueue(chunk(1), 24000);
  pb.credit(4);
  await vi.advanceTimersByTimeAsync(0);
  el().onended!();
  expect(pb.playedS).toBeCloseTo(1, 3);
  expect(pb.spokenChars).toBe(4);
  pb.dispose();
  vi.useRealTimers();
});

test('a stretch of speech spans the holes of one reply', async () => {
  /* The voice runs slower than the speaker sometimes: a sentence plays out
     before the next is made. Told that more is coming, the speaker keeps the
     stretch going across the gap -- the detector measures its grace against
     the start of the stretch, and a grace that began again on every sentence
     was a reply that could not be talked over. */
  vi.useFakeTimers();
  const pb = createPlayback(ears);
  pb.expect(true);
  pb.enqueue(chunk(1), 24000);
  await vi.advanceTimersByTimeAsync(2000);
  el().onended!();                                // played out; nothing behind it
  expect(pb.playing).toBe(false);
  expect(pb.expecting).toBe(true);
  expect(pb.sinceStartMs).toBeGreaterThanOrEqual(2000);
  pb.enqueue(chunk(1), 24000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(pb.sinceStartMs).toBeGreaterThanOrEqual(3000);
  el().onended!();
  pb.expect(false);
  expect(pb.sinceStartMs).toBe(0);
  pb.dispose();
  vi.useRealTimers();
});

test('an empty queue is no seconds at all, whatever its chunks added up to', async () => {
  /* 10-12: hands-free talk stopped hearing anybody after a long reply. The
     queue's seconds were a running total -- each chunk added on the way in,
     taken off on the way out -- and floating point does not give back what it
     was given: these four left 8.9e-16 s "queued" behind an empty queue. The
     detector read that as a reply still going out, nothing started, so no
     grace had passed: every word said after the reply was refused without a
     line, the meter moving, until a typed line stopped the queue by hand. */
  const p = createPlayback(ears);
  for (const n of [24000, 30001, 45007, 52003]) p.enqueue(chunk(n / 24000), 24000);
  await settled();
  expect(p.queuedS).toBeCloseTo((30001 + 45007 + 52003) / 24000, 9);
  for (let i = 0; i < 4; i++) {
    el().onended!();
    await settled();
  }
  expect(p.playing).toBe(false);
  expect(p.queuedS).toBe(0);
  expect(queued[queued.length - 1]).toBe(0);     // and whoever paces on it is told so
  p.dispose();
});
