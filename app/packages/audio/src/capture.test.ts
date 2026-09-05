import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {RATE, canBeHeard, createCapture, toPcm, toRate} from './capture';
import {BLOCK} from './vad';

/* Enough of a microphone to be opened and closed. jsdom has no getUserMedia
   and no AudioContext; what is worth holding still is the wiring -- what the
   page says about echo cancellation, what it tells the server about barge-in,
   and the mic following the window in and out. */
class FakeProcessor {
  onaudioprocess: ((ev: {inputBuffer: {getChannelData: () => Float32Array}}) => void) | null = null;
  connect() {}
  disconnect() {}
}
class FakeCtx {
  static made: FakeCtx[] = [];
  /** How a new context starts: a browser refusing one outside a gesture says suspended. */
  static startAs = 'running';
  state = FakeCtx.startAs;
  touched = false;
  sampleRate = 48000;
  destination = {};
  node = new FakeProcessor();
  closed = false;
  constructor() { FakeCtx.made.push(this); }
  createGain() { return {gain: {value: 1}, connect() {}, disconnect() {}}; }
  createMediaStreamSource() { return {connect: () => {}, disconnect: () => {}}; }
  createScriptProcessor() { return this.node; }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
}

let stopped = 0;
function fakeStream(aec: boolean | undefined) {
  return {
    getAudioTracks: () => [{getSettings: () => ({echoCancellation: aec})}],
    getTracks: () => [{stop: () => stopped++}],
  };
}

/* The window taking the microphone and giving it back, as whoever is holding
   the page hears about it: true when it opened again by itself, false when it
   closed behind you. What a game then says on its own wire is the game's. */
let opened: boolean[] = [];
let said: string[] = [];
let blocks: Float32Array[] = [];
const opts = () => ({
  onMic: (open: boolean) => { opened.push(open); },
  say: (line: string) => { said.push(line); },
  hear: (block: Float32Array) => { blocks.push(block); },
});

let granted: boolean | undefined = true;
let refuse: {name: string; message?: string} | null = null;

function stub(what: string, value: unknown, on: object = navigator) {
  Object.defineProperty(on, what, {value, configurable: true, writable: true});
}

beforeEach(() => {
  opened = [];
  said = [];
  blocks = [];
  stopped = 0;
  granted = true;
  refuse = null;
  FakeCtx.made = [];
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('isSecureContext', true);
  stub('mediaDevices', {
    getUserMedia: () => (refuse ? Promise.reject(refuse) : Promise.resolve(fakeStream(granted))),
  });
  stub('userAgent', 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Chrome/140 Safari/537');
  stub('hidden', false, document);
  stub('audioSession', undefined);        // everywhere but Safari
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('an address a browser will not open a microphone on says so', () => {
  expect(canBeHeard()).toBe(true);
  vi.stubGlobal('isSecureContext', false);
  expect(canBeHeard()).toBe(false);           // a phone over plain http
  vi.stubGlobal('isSecureContext', true);
  stub('mediaDevices', undefined);
  expect(canBeHeard()).toBe(false);           // not merely refused: absent
});

test('16 kHz from whatever this device runs at, on a ramp', () => {
  const ramp = new Float32Array(48000);
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length;
  const out = toPcm(toRate(ramp, 48000));
  expect(out.length).toBe(RATE);
  /* Every third sample, landing on the samples themselves. Truncated rather
     than rounded, because the store into an Int16Array is what rounds here and
     it rounds toward zero -- half a bit, and the same half a bit the page has
     always sent. */
  expect(out[0]).toBe(0);
  expect(out[1]).toBe(Math.trunc(ramp[3]! * 32768));
  expect(out[RATE - 1]).toBe(Math.trunc(ramp[48000 - 3]! * 32768));
});

test('and between samples where the rate does not divide', () => {
  const ramp = new Float32Array(44100);
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length;
  const out = toPcm(toRate(ramp, 44100));
  expect(out.length).toBe(Math.floor(44100 / (44100 / RATE)));
  const ratio = 44100 / RATE;
  for (const i of [1, 100, 9999]) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    const want = (ramp[i0]! * (1 - f) + ramp[i0 + 1]! * f) * 32768;
    expect(out[i]).toBe(Math.trunc(want));
  }
});

test('nothing leaves the page past full scale', () => {
  const hot = Float32Array.from([2, -2, 1, -1, 0.5]);
  const out = toPcm(toRate(hot, RATE));
  expect([...out]).toEqual([32767, -32768, 32767, -32768, 16384]);
  // And it is bytes the recognizer can read, two per sample, little end first.
  const bytes = new Uint8Array(toPcm(Float32Array.from([1 / 32768, -1 / 32768])).buffer);
  expect([...bytes]).toEqual([1, 0, 255, 255]);
});

test('what the track granted is what the page decides barge-in by', async () => {
  const mic = createCapture(opts());
  await mic.start();
  expect(mic.on).toBe(true);
  expect(mic.status()).toMatchObject({aec: true, lying: false});
  expect(said.some((l) => l.includes('echo canceled'))).toBe(true);
  mic.dispose();
});

test('no cancellation means no talking over the pill', async () => {
  granted = false;
  const mic = createCapture(opts());
  await mic.start();
  expect(mic.status().aec).toBe(false);
  expect(said.some((l) => l.includes('use headphones'))).toBe(true);
  mic.dispose();
});

test('a browser that does not report is not a browser that failed', async () => {
  granted = undefined;
  const mic = createCapture(opts());
  await mic.start();
  expect(mic.status().aec).toBeNull();
  mic.dispose();
});

test('and the one that reports what it does not do is not believed', async () => {
  stub('userAgent', 'Mozilla/5.0 (Macintosh; rv:154.0) Gecko/20100101 Firefox/154.0');
  const mic = createCapture(opts());
  await mic.start();
  expect(mic.status()).toMatchObject({aec: true, lying: true});
  expect(said.some((l) => l.includes('does not do'))).toBe(true);
  mic.dispose();
});

test('safari is told this page does both, before the mic is asked for', async () => {
  /* WebKit keeps an audio session for the page and picks a category from what
     the page has been doing. This one plays a voice, so by the time anybody
     presses Talk the category is `playback` — and a microphone cannot be
     opened in `playback`: Safari refuses with InvalidStateError and the words
     "AudioSession category is not compatible with audio capture", which is the
     only clue there is. */
  const session = {type: 'playback'};
  stub('audioSession', session);
  let when = '';
  stub('mediaDevices', {
    getUserMedia: () => { when = session.type; return Promise.resolve(fakeStream(true)); },
  });
  const mic = createCapture(opts());
  await mic.start();
  expect(when).toBe('play-and-record');       // set before asking, not after
  mic.dispose();
});

test('a refusal is the answer, in the browser own words', async () => {
  refuse = {name: 'NotAllowedError', message: 'Permission denied'};
  const mic = createCapture(opts());
  await expect(mic.start()).rejects.toThrow(/allow it for this page/);
  expect(mic.on).toBe(false);
  expect(said.some((l) => l.includes('the browser said: Permission denied'))).toBe(true);
  mic.dispose();
});

test('not ready is asked twice before it is believed', async () => {
  vi.useFakeTimers();
  let asks = 0;
  stub('mediaDevices', {
    getUserMedia: () => {
      asks++;
      return asks === 1
        ? Promise.reject({name: 'InvalidStateError'})
        : Promise.resolve(fakeStream(true));
    },
  });
  const mic = createCapture(opts());
  const open = mic.start();
  await vi.advanceTimersByTimeAsync(400);
  await open;
  expect(asks).toBe(2);
  expect(mic.on).toBe(true);
  mic.dispose();
});

test('a stop while the browser is still asking leaves no microphone open', async () => {
  /* The permission prompt: Talk pressed, the prompt up, Talk pressed again
     to think better of it. stop() found no stream and did nothing, the
     prompt was answered, and the microphone came up live under a key that
     said off. */
  let answer: (s: unknown) => void = () => {};
  stub('mediaDevices', {
    getUserMedia: () => new Promise((go) => { answer = go; }),
  });
  const mic = createCapture(opts());
  const asked = mic.start();
  mic.stop();
  answer(fakeStream(true));
  await asked;
  expect(mic.on).toBe(false);
  expect(stopped).toBe(1);                   // the stream that arrived was given back
  expect(FakeCtx.made).toHaveLength(0);      // and no graph was built on it
  mic.dispose();
});

test('one attempt at a time', async () => {
  let asks = 0;
  stub('mediaDevices', {
    getUserMedia: () => { asks++; return Promise.resolve(fakeStream(true)); },
  });
  const mic = createCapture(opts());
  await Promise.all([mic.start(), mic.start()]);
  expect(asks).toBe(1);
  mic.dispose();
});

test('the window coming back and a press at the same moment open one microphone', async () => {
  /* One gesture on a desktop is both: the key pressed while the window is
     also taking focus. The press went through one guard and the window's
     return through none, and the browser answered both -- two streams, two
     nodes on the one context, every block heard twice, and the stream the
     second answer overwrote never stopped. */
  let asks = 0;
  stub('mediaDevices', {
    getUserMedia: () => { asks++; return Promise.resolve(fakeStream(true)); },
  });
  const mic = createCapture(opts());
  mic.follow('hidden');
  await mic.start();
  stub('hidden', true, document);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mic.on).toBe(false);
  stub('hidden', false, document);
  document.dispatchEvent(new Event('visibilitychange'));   // the window's reopen
  const pressed = mic.start();                             // and the press
  await pressed;
  await vi.waitFor(() => expect(mic.on).toBe(true));
  expect(asks).toBe(2);                                    // the first open, and one reopen
  mic.dispose();
  expect(stopped).toBe(2);                                 // every stream made was stopped
});

test('under hidden, a page that goes away closes the microphone and reopens it', async () => {
  const mic = createCapture(opts());
  mic.follow('hidden');
  await mic.start();
  opened = [];

  stub('hidden', true, document);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mic.on).toBe(false);
  expect(stopped).toBe(1);
  expect(opened).toEqual([false]);

  opened = [];
  stub('hidden', false, document);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(mic.on).toBe(true));
  expect(opened).toEqual([true]);
  mic.dispose();
});

test('and the browser that calls its own menu bar hidden gets a moment', async () => {
  stub('userAgent', 'Mozilla/5.0 (Macintosh; rv:154.0) Gecko/20100101 Firefox/154.0');
  vi.useFakeTimers();
  const mic = createCapture(opts());
  mic.follow('hidden');
  await mic.start();

  stub('hidden', true, document);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mic.on).toBe(true);                  // going to look at it is not leaving
  vi.advanceTimersByTime(400);
  expect(mic.on).toBe(true);
  vi.advanceTimersByTime(400);
  expect(mic.on).toBe(false);
  mic.dispose();
});

test('never means never', async () => {
  const mic = createCapture(opts());
  mic.follow('never');
  await mic.start();
  stub('hidden', true, document);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mic.on).toBe(true);
  mic.dispose();
});

test('under focus, a blur waits half a second to see whether it meant anything', async () => {
  vi.useFakeTimers();
  const mic = createCapture(opts());
  mic.follow('focus');
  await mic.start();

  window.dispatchEvent(new Event('blur'));
  vi.advanceTimersByTime(400);
  expect(mic.on).toBe(true);
  window.dispatchEvent(new Event('focus'));   // came straight back
  vi.advanceTimersByTime(1000);
  expect(mic.on).toBe(true);

  window.dispatchEvent(new Event('blur'));
  vi.advanceTimersByTime(500);
  expect(mic.on).toBe(false);

  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(mic.on).toBe(true));
  mic.dispose();
});

test('a microphone turned off by hand is not reopened by the window', async () => {
  const mic = createCapture(opts());
  mic.follow('hidden');
  await mic.start();
  mic.stop();
  expect(mic.on).toBe(false);
  stub('hidden', false, document);
  document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  expect(mic.on).toBe(false);
  mic.dispose();
});

test('what the microphone hears arrives in blocks of exactly 32 ms', async () => {
  const mic = createCapture(opts());
  await mic.start();
  const frame = new Float32Array(4096);
  for (let i = 0; i < frame.length; i++) frame[i] = 0.5;
  const feed = () =>
    FakeCtx.made[0]!.node.onaudioprocess!({inputBuffer: {getChannelData: () => frame}});
  feed();
  // 4096 frames at 48k is 1365 at 16k: two whole blocks, and the remainder
  // waits rather than arriving as a short one -- the detector is arithmetic on
  // 32 ms, and a block of another length is a level measured over the wrong
  // window.
  expect(blocks).toHaveLength(2);
  for (const b of blocks) expect(b.length).toBe(BLOCK);
  expect(blocks[0]![0]).toBeCloseTo(0.5, 6);
  feed();
  expect(blocks).toHaveLength(5);      // the third carries what was left over
  mic.dispose();
});

test('and a microphone nobody is listening to is closed again clean', async () => {
  const mic = createCapture(opts());
  await mic.start();
  const frame = new Float32Array(4096);
  FakeCtx.made[0]!.node.onaudioprocess!({inputBuffer: {getChannelData: () => frame}});
  mic.stop();
  blocks = [];
  await mic.start();
  // The same context, the second time: it is kept for the life of the capture.
  FakeCtx.made[0]!.node.onaudioprocess!({inputBuffer: {getChannelData: () => frame}});
  // What was left over from the last device is not the start of this one.
  expect(blocks).toHaveLength(2);
  mic.dispose();
});

test('one audio context for the life of the capture, kept across a close and a reopen', async () => {
  /* Safari lets a page run an AudioContext it made in a gesture, and lets it
     resume when the tab is seen again; a new one made on the way back from
     another window, with no gesture behind it, stays suspended silently -- a
     microphone that had just said "open again" heard nothing. */
  FakeCtx.made.length = 0;
  const mic = createCapture(opts());
  mic.follow('hidden');
  await mic.start();
  expect(FakeCtx.made).toHaveLength(1);
  stub('hidden', true, document);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(FakeCtx.made[0]!.closed).toBe(false);
  stub('hidden', false, document);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(mic.on).toBe(true));
  expect(FakeCtx.made).toHaveLength(1);
  mic.dispose();
  expect(FakeCtx.made[0]!.closed).toBe(true);
});

test('a context the browser will not run is said, and runs on the next press', async () => {
  FakeCtx.made.length = 0;
  // A browser that refuses to run a context made outside a gesture.
  FakeCtx.startAs = 'suspended';
  const resume = FakeCtx.prototype.resume;
  FakeCtx.prototype.resume = function (this: FakeCtx) {
    this.state = this.touched ? 'running' : 'suspended';
    return Promise.resolve();
  };
  const mic = createCapture(opts());
  await mic.start();
  FakeCtx.startAs = 'running';
  expect(mic.on).toBe(true);
  expect(said.some((l) => /paused the microphone until you touch the page/.test(l))).toBe(true);
  // The next press is the gesture the browser wanted.
  FakeCtx.made[0]!.touched = true;
  document.dispatchEvent(new Event('pointerdown'));
  await vi.waitFor(() => expect(said.some((l) => /microphone running/.test(l))).toBe(true));
  expect(FakeCtx.made[0]!.state).toBe('running');
  FakeCtx.prototype.resume = resume;
  mic.dispose();
});
