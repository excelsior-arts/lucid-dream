/* A pill's paperwork: what is asked for, what is waited on, and what is
 * written back. The sheets read three of the game's bags over HTTP now rather
 * than off a socket every window shared, so what is stubbed here is the bags —
 * and each one is a promise this test holds, because the wait is half of what
 * a sheet is: it says "…" until the answer is actually back.
 */
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {SessionCard} from '../../link/shapes';
import {EMPTY, link} from '../../link/store';
import Sheets from '@lucid/ui/Sheet/Sheet';
import {close, isOpen, openMemory, openSessions} from './sheets';

/** A promise somebody else settles: the machine, taking its time. */
function held<T>() {
  let answer!: (value: T) => void;
  const wait = new Promise<T>((go) => { answer = go; });
  return {wait, answer};
}

interface Held<T> {
  wait: Promise<T>;
  answer(value: T): void;
}

const bag = vi.hoisted(() => ({
  asked: [] as string[],
  saved: [] as unknown[],
  memory: null as unknown as Held<string>,
  sessions: null as unknown as Held<unknown[]>,
}));

vi.mock('../../conversation/files', () => ({
  memory: (slug: string) => { bag.asked.push(`memory ${slug}`); return bag.memory.wait; },
  saveMemory: (slug: string, text: string) => {
    bag.saved.push({slug, text});
    return Promise.resolve({text});
  },
  sessions: (slug: string) => { bag.asked.push(`sessions ${slug}`); return bag.sessions.wait; },
  resetRelation: (slug: string) => { bag.saved.push({reset: slug}); return Promise.resolve({}); },
  config: () => Promise.resolve({}),
}));

const sheets = () =>
  render(
    <MemoryRouter>
      <Sheets />
    </MemoryRouter>,
  );

/** Let whatever the sheet asked for come back. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  bag.asked.length = 0;
  bag.saved.length = 0;
  bag.memory = held<string>();
  bag.sessions = held<unknown[]>();
  link.setState({...EMPTY});
});

afterEach(() => {
  act(() => close());
  cleanup();
});

test('the memory sheet asks, waits, and then shows what came back', async () => {
  sheets();
  act(() => openMemory('lover', 'Purple'));
  expect(bag.asked).toEqual(['memory lover']);
  expect(screen.getByText('…')).toBeInTheDocument();

  bag.memory.answer('you take it black');
  await settle();
  const box = await screen.findByPlaceholderText(/fills in as you talk/);
  expect(box).toHaveValue('you take it black');

  fireEvent.change(box, {target: {value: 'you take it black, no sugar'}});
  fireEvent.click(screen.getByText('Save'));
  expect(bag.saved).toContainEqual({
    slug: 'lover',
    text: 'you take it black, no sugar',
  });
  expect(isOpen()).toBe(false); // saving is the end of it
});

test('memory that is off is shown, and cannot be written to', () => {
  sheets();
  act(() => link.setState({remembered: {slug: 'lover', text: 'kept, not read', off: true}}));
  act(() => openMemory('lover', 'Purple'));
  expect(screen.getByText(/memory is off/)).toBeInTheDocument();
  expect(screen.queryByText('Save')).not.toBeInTheDocument();
});

test('a conversation has an address, and the row is a link to it', async () => {
  sheets();
  act(() => openSessions('lover', 'Purple'));
  expect(bag.asked).toEqual(['sessions lover']);
  bag.sessions.answer([
    {
      id: '2026-08-28T12-12-26_lover',
      persona: 'lover',
      persona_name: 'Purple',
      turns: 57,
      when: 'Aug 28 15:22',
      preview: 'word',
    },
    // Another pill's. Asked for by pill, this cannot arrive any more -- but a
    // room reads the same store, and a sheet drawing evenings it cannot open
    // would be a list of dead links.
    {
      id: '2026-08-28T09-00-00_thinker',
      persona: 'thinker',
      persona_name: 'Gold',
      turns: 3,
      when: 'Aug 28 09:00',
      preview: 'word',
    },
  ] as SessionCard[]);
  await settle();
  const rows = await screen.findAllByRole('link');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveAttribute('href', '/lucid-talk/lover?session=2026-08-28T12-12-26_lover');
});

test('a card shows what it asked for, not what the card before it asked for', async () => {
  /* One sheet, one store, and two fetches in the air. Purple's memory landing
     after Gold's used to write itself under Gold's name -- and because the
     card waits for an answer whose slug is its own, Gold's stayed on "…" for
     the life of it. */
  sheets();
  const purple = held<string>();
  const gold = held<string>();
  bag.memory = purple;
  act(() => openMemory('lover', 'Purple'));
  bag.memory = gold;
  act(() => openMemory('thinker', 'Gold'));

  gold.answer('it takes you seriously');
  await settle();
  purple.answer('you take it black');
  await settle();

  expect(link.getState().remembered?.slug).toBe('thinker');
  expect(await screen.findByPlaceholderText(/fills in as you talk/))
    .toHaveValue('it takes you seriously');
});

test('escape is the way out', async () => {
  const {container} = sheets();
  act(() => openMemory('lover', 'Purple'));
  expect(container.querySelector('.sheet')).toBeInTheDocument();
  fireEvent.keyDown(document, {key: 'Escape'});
  expect(isOpen()).toBe(false);
  await waitFor(() => expect(container.querySelector('.sheet')).toBeNull());
});
