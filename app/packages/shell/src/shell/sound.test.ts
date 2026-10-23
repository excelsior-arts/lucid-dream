import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {Instrument, listenForPresses, sound} from './sound';

/* Enough of WebAudio to be scheduled against. Nothing here listens to the
   sound; what is worth holding still is the wiring — that the master gain
   follows the level, that hush takes it to nothing, and that what was chosen
   survives the page. */
class Gain {
  gain = {value: 1, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {},
          linearRampToValueAtTime: () => {}, cancelScheduledValues: () => {}};
  connect() {}
}
const param = () => ({value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}});
class Ctx {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  gains: Gain[] = [];
  createGain() { const g = new Gain(); this.gains.push(g); return g; }
  createBuffer(_ch: number, len: number) { return {getChannelData: () => new Float32Array(len)}; }
  started: Array<{buffer: unknown; loop: boolean}> = [];
  createBufferSource() {
    const src = {
      buffer: null as unknown, loop: false, playbackRate: {value: 1}, connect: () => {},
      start: () => { this.started.push({buffer: src.buffer, loop: src.loop}); }, stop: () => {},
    };
    return src;
  }
  decodeAudioData(raw: ArrayBuffer) { return Promise.resolve({decoded: raw.byteLength}); }
  createOscillator() {
    return {type: '', frequency: param(), connect: () => {}, start: () => {}, stop: () => {}};
  }
  createBiquadFilter() { return {type: '', frequency: param(), Q: {value: 0}, connect: () => {}}; }
  resume() { return Promise.resolve(); }
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('AudioContext', Ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('nothing is built before a real press', () => {
  expect(sound.wake()).toBeNull();       // a hover is not a gesture
  expect(sound.wake(true)).not.toBeNull();
});

test('the level is kept, clamped, and said out loud', () => {
  const heard: number[] = [];
  const ear = (e: Event) => heard.push((e as CustomEvent<number>).detail);
  document.addEventListener('lucid:volume', ear);
  sound.setLevel(0.4);
  sound.setLevel(3);
  document.removeEventListener('lucid:volume', ear);

  expect(heard).toEqual([0.4, 1]);
  expect(sound.level).toBe(1);
  expect(localStorage.getItem('lucid:volume')).toBe('1');
});

test('hush is its own switch, and the app is told about it', () => {
  const heard: boolean[] = [];
  const ear = (e: Event) => heard.push((e as CustomEvent<boolean>).detail);
  document.addEventListener('lucid:hush', ear);
  sound.setLevel(0.6);
  sound.wake(true);
  sound.setHush(true);
  const master = sound.wake(true) as unknown as Ctx;
  expect(master.gains[0]!.gain.value).toBe(0);
  sound.setHush(false);
  expect(master.gains[0]!.gain.value).toBe(0.6);
  document.removeEventListener('lucid:hush', ear);

  expect(heard).toEqual([true, false]);
  expect(localStorage.getItem('lucid:hush')).toBe('0');
});

test('calm is kept too', () => {
  sound.setCalm(true);
  expect(localStorage.getItem('lucid:calm')).toBe('1');
  expect(sound.calm).toBe(true);
  sound.setCalm(false);
  expect(localStorage.getItem('lucid:calm')).toBe('0');
});

test('what was chosen is what the next page starts with', async () => {
  sound.setLevel(0.25);
  sound.setCalm(true);
  vi.resetModules();
  const again = await import('./sound');
  expect(again.sound.level).toBe(0.25);
  expect(again.sound.calm).toBe(true);
});

test('the interface asks for the media channel, and never takes the mic away', () => {
  /* iOS routes WebAudio to the channel the ring/silent switch kills, so a
     silenced phone talks and the interface is mute — which reads as broken.
     Asking for `playback` puts both on the media channel. But `playback` is
     also a category a microphone cannot be opened in, and a page that is
     listening has already asked for `play-and-record`, which is the same
     channel with a mic attached. Downgrading that gains nothing and costs the
     microphone. */
  const at = (type: string) => {
    Object.defineProperty(navigator, 'audioSession',
                          {value: {type}, configurable: true});
    return navigator.audioSession!;
  };
  const quiet = at('');
  new Instrument().wake(true);
  expect(quiet.type).toBe('playback');

  const listening = at('play-and-record');
  new Instrument().wake(true);
  expect(listening.type).toBe('play-and-record');
});

test('a press on anything pressable makes a sound, and a switch a heavier one', () => {
  const tick = vi.spyOn(sound, 'tick');
  const latch = vi.spyOn(sound, 'latch');
  document.body.innerHTML = `
    <button id="plain">go</button>
    <button id="dead" disabled>go</button>
    <span id="quiet" data-quiet><button id="own">go</button></span>
    <input id="switch" type="checkbox">
    <p id="prose">nothing</p>`;
  const stop = listenForPresses(document);
  const press = (id: string) =>
    document.getElementById(id)!.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true}));

  press('plain');
  expect(tick).toHaveBeenCalledTimes(1);
  press('prose');
  press('dead');
  press('own');                          // makes its own sound, at its own moment
  expect(tick).toHaveBeenCalledTimes(1);
  press('switch');
  expect(latch).toHaveBeenCalledTimes(1);

  stop();
  press('plain');
  expect(tick).toHaveBeenCalledTimes(1);
});

/* The shelf: recordings by name, from wherever the composition says. */
const tick = () => new Promise((r) => setTimeout(r, 0));
/* What was started off the shelf: the noise the instrument makes itself on
   waking is a buffer too, and not the point. */
const played = (it: Instrument) =>
  (it.wake() as unknown as Ctx).started.filter((s) => (s.buffer as {decoded?: number}).decoded !== undefined);
function aShelf(names: string[]) {
  const asked: string[] = [];
  return {
    asked,
    names: () => Promise.resolve(names),
    clip: (name: string) => { asked.push(name); return Promise.resolve(new ArrayBuffer(name.length)); },
  };
}

test('a clip off the shelf is fetched once, by a name the shelf has, and never for one it has not', async () => {
  const it = new Instrument();
  const shelf = aShelf(['step', 'wind']);
  it.stock(shelf);
  it.wake(true);
  it.play('step');
  it.play('step');
  it.play('nothing');
  for (let i = 0; i < 4; i++) await tick();
  expect(shelf.asked).toEqual(['step']);
  expect(played(it).map((s) => s.buffer)).toEqual([{decoded: 4}, {decoded: 4}]);
});

test('with no shelf at all, nothing is asked and nothing plays', async () => {
  const it = new Instrument();
  it.wake(true);
  it.play('step');
  for (let i = 0; i < 4; i++) await tick();
  expect(played(it)).toEqual([]);
});

test('a loop and a preload asked for before the first press wait for it', async () => {
  const it = new Instrument();
  const shelf = aShelf(['wind', 'step']);
  it.stock(shelf);
  it.preload(['step']);
  const air = it.loop('wind', .5);
  for (let i = 0; i < 4; i++) await tick();
  expect(shelf.asked).toEqual([]);          // no context yet: nothing fetched
  it.wake(true);
  for (let i = 0; i < 6; i++) await tick();
  expect(shelf.asked.sort()).toEqual(['step', 'wind']);
  expect(played(it)).toEqual([{buffer: {decoded: 4}, loop: true}]);
  air.stop(0);
});

test('hushed, a clip is not even started', async () => {
  const it = new Instrument();
  const shelf = aShelf(['step']);
  it.stock(shelf);
  it.wake(true);
  it.setHush(true);
  it.play('step');
  for (let i = 0; i < 4; i++) await tick();
  expect(played(it)).toEqual([]);
  it.setHush(false);
});

test('a context built while already hushed is silent from its first frame', () => {
  localStorage.setItem('lucid:hush', '1');
  const it = new Instrument();
  expect(it.hush).toBe(true);
  const ctx = it.wake(true) as unknown as Ctx;
  expect(ctx.gains[0]!.gain.value).toBe(0);      // the master, made first
  it.setHush(false);
  expect(ctx.gains[0]!.gain.value).toBeGreaterThan(0);
});

/* ---- made, not recorded --------------------------------------------------- */

test('the air is noise looped through a filter, waits for the first press, and stops', async () => {
  const it = new Instrument();
  const air = it.air({cutoff: 400, drone: [55, 110]}, .5);
  expect(it.wake()).toBeNull();              // no context yet: nothing playing
  const ctx = it.wake(true) as unknown as Ctx;
  for (let i = 0; i < 4; i++) await tick();
  /* One looped source: the noise. Nothing was fetched from anywhere, and
     nothing was decoded. */
  expect(ctx.started.filter((s) => s.loop)).toHaveLength(1);
  expect(played(it)).toEqual([]);
  air.level(.2, 1);
  air.stop(0);
});

test('a puff, a chime and a thud each start what they need, and nothing when hushed', () => {
  const it = new Instrument();
  const ctx = it.wake(true) as unknown as Ctx;
  it.puff({kind: 'highpass', freq: 800});
  expect(ctx.started).toHaveLength(2);       // the unlock frame, and the puff
  it.chime([220, 330, 440]);
  it.thud({freq: 90});
  expect(ctx.started).toHaveLength(3);       // the thud's own noise
  it.setHush(true);
  it.puff();
  it.chime([440]);
  it.thud();
  expect(ctx.started).toHaveLength(3);
});

test('silent is the hush or the knob at zero, said once each time it changes', () => {
  const s = new Instrument();
  const said: boolean[] = [];
  const hear = (e: Event) => said.push((e as CustomEvent<boolean>).detail);
  document.addEventListener('lucid:silent', hear);
  try {
    expect(s.silent).toBe(false);
    s.setLevel(0.4);                 // a level that is not zero is not news
    expect(said).toEqual([]);
    s.setLevel(0);
    expect(s.silent).toBe(true);
    s.setHush(true);                 // already silent: nothing to say
    s.setHush(false);
    expect(said).toEqual([true]);
    s.setLevel(0.1);
    expect(said).toEqual([true, false]);
    s.setHush(true);
    expect(said).toEqual([true, false, true]);
    s.setLevel(0);                   // muted already
    s.setLevel(0.5);
    s.setHush(false);
    expect(said).toEqual([true, false, true, false]);
    expect(s.silent).toBe(false);
  } finally {
    document.removeEventListener('lucid:silent', hear);
  }
});
