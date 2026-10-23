/* The box, which opens no socket at all: three reads, and what it does with
 * them. The pills, the sheet inside the lid and the dose used to arrive in a
 * handshake, stamped with whichever conversation happened to be live; each is
 * a route now, so what is stubbed here is the machine rather than a wire.
 *
 * The three answers are real ones, taken off a running server: two pills, an
 * evening's worth of doses, and a standing per pill as the machine keeps it —
 * a bag of numbers, with the word made here. */
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {MACHINE, PAGE, setHost} from '@lucid/shell';
import type {LedgerPill, PersonaCard} from '../../link/shapes';
import {EMPTY, link} from '../../link/store';
// ?raw so this stays a string the test parses, and not a module the bundler
// has already made its own idea of.
import sampleJson from './fixtures/box.json?raw';
import Box from './Box';
import '../../limits';

const sample = JSON.parse(sampleJson) as {
  personas: PersonaCard[];
  ledger: {doses: number; pills: LedgerPill[]};
  minutes: number;
};
const PILLS = sample.personas;
const BOOK = sample.ledger;
const DOSE = sample.minutes;
/* Stamped as of now. A standing fades from the moment it was written — mood by
   half every six hours — so a sample with a date on it reads as a pill that
   has come back to the middle, which is exactly the thing the column is not
   supposed to say. See decayed() in conversation/relation.ts. */
for (const p of BOOK.pills) {
  if (p.standing) (p.standing as {updated: number}).updated = Date.now() / 1000;
}

const {asked, started} = vi.hoisted(
  () => ({asked: [] as unknown[], started: {times: 0}}));
// The pills ship with the game and are not a read at all -- so they are stood
// in for where they are read, and the fixture stays what a running machine
// answered with.
vi.mock('../../conversation/bundle', () => ({personas: () => PILLS}));
vi.mock('../../conversation/files', () => ({
  ledger: () => Promise.resolve(BOOK),
  config: () => Promise.resolve({relation: {enabled: true},
                                 ui: {continuous_minutes: DOSE}}),
  saveConfig: (patch: unknown) => { asked.push(patch); return Promise.resolve({}); },
}));
vi.mock('@lucid/machine', async (real) => ({
  ...(await real<typeof import('@lucid/machine')>()),
  models: {start: () => { started.times += 1; return Promise.resolve({}); }},
}));

beforeEach(() => {
  vi.useFakeTimers();
  asked.length = 0;
  started.times = 0;
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // The card flight is a WAAPI animation, which jsdom has never had.
  Element.prototype.animate = () => ({}) as Animation;
  link.setState({...EMPTY});
});

afterEach(() => {
  cleanup();
  setHost(MACHINE);
  link.setState({...EMPTY});
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The box, with what it asked for already back. */
const box = async () => {
  const shown = render(
    <MemoryRouter initialEntries={['/talk']}>
      <Routes>
        <Route path="/talk" element={<Box />} />
        <Route path="/talk/:slug" element={<p>the room</p>} />
        <Route path="/" element={<p>the shelf</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return shown;
};

test('what is in the box is what the machine said is in it', async () => {
  const {container} = await box();
  const cards = container.querySelectorAll('.card');
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveAttribute('data-figure', 'diamond');
  expect(cards[1]).toHaveAttribute('data-figure', 'spiral');
  expect(document.documentElement.dataset.page).toBe('box');
});

test('the sheet inside the lid is the record, not a score', async () => {
  const {container} = await box();
  expect(container.querySelectorAll('.line')).toHaveLength(2);
  /* One word, made here out of the numbers the machine keeps: it has no
     opinion about what a warmth of 41 is called. */
  expect(screen.getByText('close')).toBeInTheDocument();
  expect(screen.getByText('cool · wary')).toBeInTheDocument();
  expect(screen.getByText('37 doses')).toBeInTheDocument();
  expect(screen.getByText('4 memories')).toBeInTheDocument();
  // 7 + 4, counted here rather than sent.
  expect(container.querySelector('.tally')?.textContent).toBe('Doses 97 · Remembered 11');
});

test('on your Mac each line says how the pill is taking you, unmarked', async () => {
  const {container} = await box();
  expect(container.querySelectorAll('.line .said')).toHaveLength(2);
  expect(container.querySelector('.line.bare')).toBeNull();
  expect(container.querySelector('[data-limit-mark]')).toBeNull();
});

test('in a browser, where you stand is held and its column is not drawn at all', async () => {
  setHost(PAGE);
  const {container} = await box();
  const lines = container.querySelectorAll('.line');
  expect(lines).toHaveLength(2);
  // No standing word, no "never taken", no mark: the cell is gone.
  expect(container.querySelector('.line .said')).toBeNull();
  expect(screen.queryByText('close')).toBeNull();
  expect(screen.queryByText('never taken')).toBeNull();
  expect(container.querySelector('[data-limit-mark]')).toBeNull();
  // The line keeps the pill's name, its doses and its memories, three columns.
  for (const line of lines) expect(line).toHaveClass('bare');
  expect(lines[0]!.querySelector('.tag')).toBeInTheDocument();
  expect(screen.getByText('37 doses')).toBeInTheDocument();
  expect(screen.getByText('4 memories')).toBeInTheDocument();
  expect(container.querySelector('.tally')?.textContent).toBe('Doses 97 · Remembered 11');
});

test('one dose is one dose, and none is no doses', async () => {
  const [first, second] = BOOK.pills;
  const was = [first!.doses, second!.doses];
  first!.doses = 1;
  second!.doses = 0;
  try {
    await box();
    expect(screen.getByText('1 dose')).toBeInTheDocument();
    expect(screen.queryByText('1 doses')).toBeNull();
    expect(screen.getByText('no doses')).toBeInTheDocument();
  } finally {
    [first!.doses, second!.doses] = was as [number, number];
  }
});

test('the strength is set on the lid, and written where the game reads it', async () => {
  await box();
  expect(document.getElementById('dosenow')).toHaveTextContent(String(DOSE));
  fireEvent.click(screen.getByLabelText('stronger'));
  expect(document.getElementById('dosenow')).toHaveTextContent(String(DOSE + 5));
  // A patch of the one key, so the rest of the section is not sent back to be
  // kept -- see saveConfig, which merges the patch over what is on disk.
  expect(asked).toEqual([{ui: {continuous_minutes: DOSE + 5}}]);
});

test('taking one starts the machine, then leaves for the room', async () => {
  const {container} = await box();
  fireEvent.click(container.querySelector('.card')!);
  expect(started.times).toBe(1);
  expect(screen.queryByText('the room')).not.toBeInTheDocument(); // the card is still flying
  act(() => void vi.advanceTimersByTime(1000));
  expect(screen.getByText('the room')).toBeInTheDocument();
});

test('the lid comes down before the shelf is asked for', async () => {
  const {container} = await box();
  fireEvent.click(screen.getAllByLabelText('shut the box')[0]!);
  expect(container.querySelector('#case')?.className).toContain('shutting');
  act(() => void vi.advanceTimersByTime(700));
  expect(screen.getByText('the shelf')).toBeInTheDocument();
});
