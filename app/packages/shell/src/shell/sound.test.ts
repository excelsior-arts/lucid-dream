import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {Instrument, listenForPresses, sound} from './sound';

/* Enough of WebAudio to be scheduled against. Nothing here listens to the
   sound; what is worth holding still is the wiring — that the master gain
   follows the level, that hush takes it to nothing, and that what was chosen
   survives the page. */
class Gain {
  gain = {value: 1, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}};
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
  createBufferSource() { return {buffer: null, connect: () => {}, start: () => {}, stop: () => {}}; }
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
