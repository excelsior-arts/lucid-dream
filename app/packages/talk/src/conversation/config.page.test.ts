/* What the game is tuned to where the words come from this browser. */
import {afterEach, expect, test} from 'vitest';
import {MACHINE, PAGE, setHost} from '@lucid/shell';
import {DEFAULTS, readConfig} from './config';
import {prompts} from './bundle';

afterEach(() => { setHost(MACHINE); });

test('the machine\'s answers are the machine\'s, untouched', () => {
  expect(readConfig({})).toEqual(DEFAULTS);
  expect(prompts().system).not.toBe(prompts().system_text);
});

test('in a browser: a shorter window, no judgement or scene, a rarer fold', () => {
  setHost({...PAGE});
  const cfg = readConfig({});
  expect(cfg.llm.context_turns).toBe(4);
  expect(cfg.llm.context_words).toBe(400);
  expect(cfg.relation.score).toBe(false);
  expect(cfg.relation.enabled).toBe(true);
  expect(cfg.scene.enabled).toBe(false);
  expect(cfg.memory.fold_after).toBeGreaterThan(DEFAULTS.memory.fold_after);
  // And what the player set still wins.
  expect(readConfig({llm: {context_words: 300}}).llm.context_words).toBe(300);
});

test('words loaded at 8192: the machine\'s window, the rest still the browser\'s', () => {
  setHost({...PAGE, context: 8192});
  const cfg = readConfig({});
  expect(cfg.llm).toEqual(DEFAULTS.llm);
  expect(cfg.llm.context_turns).toBe(6);
  expect(cfg.llm.context_words).toBe(600);
  expect(cfg.scene.enabled).toBe(false);
  expect(cfg.relation.score).toBe(false);
  // Came up short (a long load that failed): four and 400 again, never six into 4096.
  setHost({context: 4096});
  expect(readConfig({}).llm.context_turns).toBe(4);
  expect(readConfig({}).llm.context_words).toBe(400);
  // And the player's own word wins at either.
  expect(readConfig({llm: {context_turns: 5}}).llm.context_turns).toBe(5);
});

test('a censored model in a browser -- every build there -- reads system_page.md, then the content line', () => {
  setHost({...PAGE, censored: true});
  const p = prompts();
  // system_page.md -- system_text.md with "You are heard aloud, not read." in front -- and after
  // it the browser's content line (page_limits.md).
  expect(p.system).toMatch(/^You are heard aloud, not read\. You are here with \{him\}, not software\./);
  expect(p.system!.slice('You are heard aloud, not read. '.length).startsWith(p.system_text!)).toBe(true);
  expect(p.system).toMatch(/decides when the lights go out/);
  expect(p.system_page).toBeUndefined();
});

test('a Mac with no voice on its shelf keeps system_text.md', () => {
  setHost({...MACHINE, voice: false});
  const p = prompts();
  expect(p.system).toBe(p.system_text);
  expect(p.system).not.toMatch(/heard aloud|lights go out/);
});

test('the opening follows the model, not the host: a censored model on a Mac reads system_page.md', () => {
  setHost({...MACHINE, censored: true});
  const p = prompts();
  expect(p.system).toMatch(/^You are heard aloud, not read\. You are here with \{him\}, not software\./);
  // The content line is the web build's, whatever its model.
  expect(p.system).not.toMatch(/decides when the lights go out/);
  setHost({...MACHINE, voice: false, censored: true});
  expect(prompts().system).toBe(p.system);
});

test('no model flagged, no system_page.md: a Mac reads system.md, a browser system_text.md and its content line', () => {
  setHost({...MACHINE});
  const mac = prompts();
  // system.md: neither system_text.md nor system_page.md, which is system_text.md behind one line.
  expect(mac.system).not.toContain(mac.system_text);
  setHost({...PAGE});
  const page = prompts();
  expect(page.system!.startsWith(page.system_text!)).toBe(true);
  expect(page.system).toMatch(/decides when the lights go out/);
});
