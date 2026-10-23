/* What Lucid Talk says is limited in a browser, and that the machine is
   told none of it: the marks, the Talk key, where you stand, and the content
   line that only a browser's prompt carries. */
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {limited, limits, MACHINE, PAGE, setHost} from '@lucid/shell';
import {all, prompts} from './conversation/bundle';
import {systemFor} from './conversation/prompt';
import TapeDeck from './ui/TapeDeck/TapeDeck';
import type {Machine} from './ui/TapeDeck/deck';
import {Forget} from './ui/Sheets/contents';
import './limits';

afterEach(() => { cleanup(); setHost(MACHINE); vi.unstubAllGlobals(); });

const QUIET: Machine = {
  state: 'stopped', running: false, continuous: false, inputMode: 'type', nowhere: false,
  adrift: false, sounding: false, held: false, seeded: true, lastSaid: true, captureOn: false,
  micWarming: false, typing: false,
};
const ear = {level: 0, floor: 0, onChange: () => () => {}};
const deck = (canBeHeard: boolean) => render(
  <TapeDeck machine={QUIET} minutes={15} continuousMin={0} ear={ear}
            canBeHeard={canBeHeard} onPress={() => {}} />);

test('on the machine nothing is limited, and the Talk key is as it was', () => {
  expect(limits()).toEqual([]);
  deck(false);
  expect(document.querySelector('#t-rec')).toHaveProperty('hidden', true);
  expect(document.querySelector('[data-limit-mark]')).toBeNull();
});

test('in a browser the parts that are off or smaller are listed, in plain words', () => {
  setHost(PAGE);
  const ids = limits().map((l) => l.id);
  for (const id of ['standing', 'ear', 'words', 'memory', 'window', 'scene', 'content']) {
    expect(ids).toContain(id);
  }
  for (const l of limits()) {
    expect(`${l.name} ${l.mac} ${l.here}`).not.toMatch(/\b(LLM|TTS|STT|localhost|Mac app)\b/);
  }
});

test('a browser that cannot run the pill says so and how, and not that a small one runs', () => {
  setHost(PAGE);
  expect(limited('pill')).toBeNull();
  expect(limited('words')).not.toBeNull();
  setHost({...PAGE, llm: 'none'});
  expect(limited('words')).toBeNull();
  const l = limited('pill')!;
  expect(l.here).toMatch(/can’t run the pill — open this page in Chrome, Edge or Safari, or run it on your Mac/);
  expect(l.here).not.toMatch(/Mac app|desktop app/);
});

test('a config that moves where you stand again is not told it is held', () => {
  setHost(PAGE);
  dispatchEvent(new CustomEvent('lucid:config', {detail: {
    memory: {enabled: true, fold_after: 12}, relation: {enabled: true, score: true},
    scene: {enabled: false}, llm: {context_turns: 4},
  }}));
  expect(limited('standing')).toBeNull();
  expect(limited('scene')).not.toBeNull();
  dispatchEvent(new CustomEvent('lucid:config', {detail: {
    memory: {enabled: true, fold_after: 12}, relation: {enabled: true, score: false},
    scene: {enabled: false}, llm: {context_turns: 4},
  }}));
  expect(limited('standing')).not.toBeNull();
});

test('in a browser that cannot hear, the Talk key stays, marked, and says why', () => {
  setHost(PAGE);
  deck(false);
  const rec = document.querySelector<HTMLButtonElement>('#t-rec')!;
  expect(rec.hidden).toBe(false);
  expect(rec.title).toMatch(/this browser can’t hear you/);
  expect(rec.querySelector('[data-limit-mark]')).not.toBeNull();
  expect(limited('ear')!.here).not.toMatch(/not in the browser version|STT|ASR/);
});

/** A browser with an ear and a microphone it may open. */
function hearing() {
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices',
                        {value: {getUserMedia: () => Promise.reject(new Error('no'))}, configurable: true});
  setHost({...PAGE, ear: true});
}

test('in a browser that can hear, speaking is not limited: no mark, no sheet, not in the eye', () => {
  hearing();
  try {
    expect(limited('ear')).toBeNull();
    expect(limits().map((l) => l.id)).not.toContain('ear');
    deck(true);
    const rec = document.querySelector<HTMLButtonElement>('#t-rec')!;
    expect(rec.hidden).toBe(false);
    expect(rec.disabled).toBe(false);
    expect(rec.title).toMatch(/talk to it/);
    expect(rec.querySelector('[data-limit-mark]')).toBeNull();
  } finally {
    Object.defineProperty(navigator, 'mediaDevices', {value: undefined, configurable: true});
  }
});

test('where the pill cannot run, the Talk key is dark and says it is the pill', () => {
  hearing();
  try {
    setHost({llm: 'none'});
    render(<TapeDeck machine={{...QUIET, noWords: true}} minutes={15} continuousMin={0} ear={ear}
                     canBeHeard onPress={() => {}} />);
    const rec = document.querySelector<HTMLButtonElement>('#t-rec')!;
    expect(rec.disabled).toBe(true);
    expect(rec.title).toMatch(/can’t run the pill/);
    expect(limited('ear')).toBeNull();
  } finally {
    Object.defineProperty(navigator, 'mediaDevices', {value: undefined, configurable: true});
  }
});

test('where you stand, pressed in a browser, says it is held and how to run it on a Mac', () => {
  setHost(PAGE);
  render(<Forget sheet={{kind: 'forget', slug: 'lover', name: 'Purple', since: []}} />);
  expect(screen.getByText(/nothing you say moves it/)).toBeInTheDocument();
  expect(screen.getByText(/turn by turn/)).toBeInTheDocument();
  expect(screen.getByText('Run it on your Mac')).toBeInTheDocument();
  expect(screen.getByText('./run.sh')).toBeInTheDocument();
});

test('the content line is the browser’s alone, in its system prompt before the persona', () => {
  const lover = all().find((p) => p.slug === 'lover')!;
  expect(prompts().page_limits).toBeUndefined();
  expect(systemFor(lover, prompts(), '', null)).not.toMatch(/decides when the lights go out/);
  setHost(PAGE);
  const front = systemFor(lover, prompts(), '', null);
  expect(front).toMatch(/decides when the lights go out/);
  expect(prompts().page_limits).toBeUndefined();
  expect(front.indexOf('decides when the lights go out')).toBeLessThan(front.indexOf('You are Lover'));
  expect(front.indexOf('decides when the lights go out')).toBeGreaterThan(front.indexOf('Write the way you talk'));
});

test('a tagless browser voice: system_text.md\'s sound line, then the content line, then the persona', () => {
  const lover = all().find((p) => p.slug === 'lover')!;
  setHost(PAGE);
  const sound = 'Make a sound by writing it the way it sounds';
  const limit = 'decides when the lights go out';
  const tagless = systemFor(lover, prompts(), '', null);
  expect(tagless).not.toMatch(/\{(if|else|end)/);
  expect(tagless.indexOf(sound)).toBeGreaterThan(-1);
  expect(tagless.indexOf(sound)).toBeLessThan(tagless.indexOf(limit));
  expect(tagless.indexOf(limit)).toBeLessThan(tagless.indexOf('You are Lover'));
  // A voice that performs tags is offered them instead, and the content line still leads the persona.
  const tagged = systemFor(lover, prompts(), '', null, undefined, undefined, ['[laugh]', '[sigh]']);
  expect(tagged).not.toContain(sound);
  expect(tagged).not.toMatch(/\{(if|else|end)/);
  expect(tagged.indexOf(limit)).toBeGreaterThan(tagged.indexOf('Write the way you talk'));
  expect(tagged.indexOf(limit)).toBeLessThan(tagged.indexOf('You are Lover'));
});
