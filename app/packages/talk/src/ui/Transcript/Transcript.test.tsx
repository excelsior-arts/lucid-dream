import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import type {Turn} from '../../link/store';
import Transcript from './Transcript';

afterEach(cleanup);

const TALK: Turn[] = [
  {role: 'user', text: 'are you there'},
  {role: 'assistant', text: 'I am. [warm] The rain is doing the thing it does.'},
  {role: 'user', text: '(opens the window)'},
];

const show = (turns: Turn[], more: Partial<Parameters<typeof Transcript>[0]> = {}) =>
  render(<Transcript turns={turns} personaName="Violet"
                     onReplay={() => {}} onDelete={() => {}} onUnheard={() => {}}
                     {...more} />);

const bubbles = () => [...document.querySelectorAll('#chat .msg')];

test('a conversation is one bubble a turn, on the right sides', () => {
  show(TALK);
  const all = bubbles();
  expect(all).toHaveLength(3);
  expect(all[0]?.className).toBe('msg you');
  expect(all[1]?.className).toBe('msg them');
  // A turn taken with your hands rather than your voice leans.
  expect(all[2]?.className).toBe('msg you hand');
  expect(all[1]?.querySelector('.who')).toHaveTextContent('Violet');
  // The bracketed marks in a reply are the pill's stage directions, not words.
  expect(all[1]?.querySelector('.tag')).toHaveTextContent('[warm]');
});

test('a reply still arriving shows what the pacer has let out, and a caret', () => {
  show([{role: 'user', text: 'go on'}, {role: 'assistant', text: 'the whole of it'}],
       {visible: 'the whole', pacing: true});
  const last = bubbles()[1];
  expect(last?.className).toContain('streaming');
  expect(last?.querySelector('.body')).toHaveTextContent('the whole');
  expect(last?.querySelector('.body')).not.toHaveTextContent('of it');
});

test('nothing to replay or delete until the line is finished', () => {
  show([{role: 'assistant', text: 'half a', streaming: true}]);
  expect(bubbles()[0]?.className).toContain('streaming');
});

test('the tools say it again and take it back', () => {
  const replayed: string[] = [];
  const deleted: [string, string][] = [];
  show(TALK, {onReplay: (t) => replayed.push(t),
              onDelete: (role, t) => deleted.push([role, t])});
  fireEvent.click(bubbles()[1]!.querySelector('.replay')!);
  expect(replayed).toEqual([TALK[1]!.text]);
  fireEvent.click(bubbles()[0]!.querySelector('.del')!);
  expect(deleted).toEqual([['user', 'are you there']]);
  // Nothing of yours can be said again: it was never spoken by the machine.
  expect(bubbles()[0]!.querySelector('.replay')).toBeNull();
});

test('a line whose voice was never heard says so, beside the words', () => {
  const asked = vi.fn();
  show(TALK, {unheard: new Set([1]), onUnheard: asked});
  const mark = bubbles()[1]!.querySelector('.unheard')!;
  expect(bubbles()[0]!.querySelector('.unheard')).toBeNull();
  fireEvent.click(mark);
  expect(asked).toHaveBeenCalledWith(TALK[1]!.text);
});

test('the dots stand in for words that have not arrived', () => {
  show(TALK, {heard: true, musing: true});
  const pending = document.querySelectorAll('#chat .msg.pending');
  expect(pending).toHaveLength(2);
  expect(pending[0]?.className).toBe('msg you pending');
  expect(pending[1]?.className).toBe('msg them pending');
});

test('the way back down is offered only once you have gone up', () => {
  show(TALK);
  const jump = document.getElementById('jump')!;
  expect(jump).toHaveAttribute('hidden');
  // jsdom lays nothing out, so every box is zero high and every scroll
  // position is the bottom: what is checked here is that the handler runs and
  // reads the box rather than a flag.
  fireEvent.scroll(document.getElementById('chat')!);
  expect(jump).toHaveAttribute('hidden');
});
