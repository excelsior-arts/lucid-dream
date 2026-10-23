import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import Console from '../Console/Console';
import Rail from './Rail';
import {hatch} from '../../shell/console';
import {MACHINE, PAGE, setHost} from '../../host';
import {limit} from '../../shell/limits';

/* The socket and the question about phones both go to the server, and neither
   is what these tests are about. */
class Wire {
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: {data: string}) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) { this.url = url; }
  send() {}
}

const shell = () => (
  <>
    <Rail where="" />
    <Console />
  </>
);

beforeEach(() => {
  vi.stubGlobal('WebSocket', Wire);
  vi.stubGlobal('fetch', () =>
    Promise.resolve({json: () => Promise.resolve({phone: true, urls: ['http://192.168.1.5:6969']})}));
});

afterEach(() => {
  // Vitest is run without globals, so testing-library has nothing to hang its
  // own cleanup on: without this every render of the rail is still on the page
  // when the next test looks for one knob and finds three.
  cleanup();
  if (hatch.open) hatch.show(false);
  vi.unstubAllGlobals();
  setHost(MACHINE);
});

test('four fittings, in one rail', () => {
  render(shell());
  expect(screen.getByLabelText(/How loud the interface and the voice are/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Open this on your phone/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Nothing leaves this machine/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^The console/)).toBeInTheDocument();
  expect(screen.getByLabelText('volume')).toHaveValue('70');
});

test('the console knob is what opens the console', async () => {
  const {container} = render(shell());
  const sheet = container.querySelector('[role=log]')!.parentElement!;
  expect(sheet.className).not.toContain('open');

  screen.getByLabelText(/^The console/).click();
  await waitFor(() => expect(sheet.className).toContain('open'));
  expect(hatch.open).toBe(true);
  expect(document.documentElement.classList.contains('hatched')).toBe(true);

  screen.getByLabelText(/^The console/).click();
  await waitFor(() => expect(hatch.open).toBe(false));
});

test('a panel opens on its own knob and shuts on a press away from it', async () => {
  render(shell());
  const knob = screen.getByLabelText(/How loud the interface and the voice are/);
  const corner = knob.parentElement!;
  knob.click();
  await waitFor(() => expect(corner.className).toContain('open'));

  document.body.click();
  await waitFor(() => expect(corner.className).not.toContain('open'));
});

test('the phone knob waits for the server, then draws the code', async () => {
  render(shell());
  const corner = screen.getByLabelText(/Open this on your phone/).parentElement!;
  await waitFor(() => expect(corner.hidden).toBe(false));
  expect(screen.getByText('192.168.1.5:6969')).toBeInTheDocument();
  // A version 1 code is 21 across, and this address needs more room than that.
  const code = corner.querySelectorAll('i').length;
  expect(Math.sqrt(code) % 1).toBe(0);
  expect(Math.sqrt(code)).toBeGreaterThanOrEqual(21);
});

test('and the code follows the page, because it carries the whole address', async () => {
  /* Scanning it from a conversation is supposed to open that conversation in
     your hand. Drawn once, when the machine answered, it was whatever address
     the tab happened to be at when it opened -- the front door, all evening. */
  const {rerender} = render(<Rail where="" at="/" />);
  const corner = screen.getByLabelText(/Open this on your phone/).parentElement!;
  await waitFor(() => expect(corner.hidden).toBe(false));
  const front = corner.querySelectorAll('i').length;

  rerender(<Rail where="room" at="/lucid-talk/lover?session=2026-09-02T20-14-31_lover" />);
  // A longer address needs a bigger code: it is not the front door's any more.
  expect(corner.querySelectorAll('i').length).toBeGreaterThan(front);
});

test('a page that reaches past the machine does not make the promise, and names its speaker', () => {
  /* A trip fetches its song from a CDN: the crossed eye would be a lie there,
     and the speaker turns the trip up, not the clicks. */
  const {rerender} = render(<Rail where="" at="/" />);
  const eye = screen.getByLabelText(/Nothing leaves this machine/).parentElement!;
  expect(eye.hidden).toBe(false);
  expect(screen.getByTitle(/How loud the interface and the voice are/)).toBeInTheDocument();

  rerender(<Rail where="burning-man" at="/lucid-trip/burning-man"
                 notes={{offline: false, speaker: 'How loud the trip is.', inline: true}} />);
  expect(eye.hidden).toBe(true);
  expect(screen.getByTitle('How loud the trip is.')).toBeInTheDocument();
});

test('in a browser the eye says, for the whole app, that its AI is smaller here, and how to run it on a Mac', () => {
  const said = [
    limit({id: 'standing', name: 'Where you stand', kind: 'off', mac: 'tracked', here: 'It is held.'}),
    limit({id: 'window', name: 'How far back it reads', kind: 'smaller', mac: 'six', here: 'Four.'}),
    limit({id: 'content', name: 'Intimacy', kind: 'smaller', mac: 'all', here: 'It fades out.'}),
  ];
  setHost(PAGE);
  render(shell());
  const eye = screen.getByLabelText(/^Nothing leaves this browser/).parentElement!;
  const text = eye.textContent ?? '';
  expect(text).toContain('Nothing leaves this browser.');
  expect(text).toContain('No account, and nobody on the other end. What you play and the models stay here.');
  expect(text).toContain('Here the game’s AI runs smaller, with some of it off. For the full experience '
    + '— still offline, still private — run it on your Mac.');
  // No part of one game is named: the panel is on every page of the app.
  for (const part of ['Where you stand', 'It is held.', 'How far back it reads', 'Intimacy',
                      'It fades out.', 'content is kept tame', 'conversations', 'Off or smaller']) {
    expect(text).not.toContain(part);
  }
  expect(eye.querySelector('[data-limit-mark]')).toBeNull();
  expect(text).toContain('Run it on your Mac');
  expect(text).toContain('./setup.sh');
  expect(text).not.toMatch(/Mac app|desktop app|STT|ASR|\b\d+B\b/);
  // The phone knob stays hidden, as it always was; the rail carries no mark.
  expect(screen.getByLabelText(/Open this on your phone/).parentElement!.hidden).toBe(true);
  expect(document.querySelector('[data-limit-mark]')).toBeNull();
  for (const back of said) back();
});

test('a browser that cannot run the AI at all is told so, and not that it runs smaller', () => {
  setHost({...PAGE, llm: 'none'});
  render(shell());
  const text = screen.getByLabelText(/^Nothing leaves this browser/).parentElement!.textContent ?? '';
  expect(text).toContain('This browser can’t run the game’s AI — try Chrome, Edge or Safari.');
  expect(text).not.toContain('runs smaller');
  expect(text).toContain('run it on your Mac');
});

test('on the machine the eye is as it was, and nothing is marked', () => {
  const back = limit({id: 'standing', name: 'Where you stand', kind: 'off', mac: 'tracked', here: 'It is held.'});
  render(shell());
  const eye = screen.getByLabelText(/Nothing leaves this machine/).parentElement!;
  expect(eye.textContent).toContain('Nothing leaves this room.');
  expect(eye.textContent).not.toContain('Run it on your Mac');
  expect(document.querySelector('[data-limit-mark]')).toBeNull();
  expect(document.querySelector('[data-run-on-mac]')).toBeNull();
  back();
});

test('the console knob names what runs the page', () => {
  render(shell());
  expect(screen.getByLabelText(/^The console/).title).toMatch(/what the machine is doing/);
  cleanup();
  setHost(PAGE);
  render(shell());
  const knob = screen.getByLabelText(/^The console/);
  expect(knob.title).toMatch(/what this browser is doing/);
  expect(knob.title).not.toMatch(/machine/);
});

test("a press on the rail's gutter over a page's own control is that control's; any other is swallowed", () => {
  const pressed = vi.fn();
  const {container} = render(
    <>
      <button type="button" data-own-press onClick={pressed}>gear</button>
      {shell()}
    </>,
  );
  const gear = screen.getByText('gear');
  vi.spyOn(gear, 'getBoundingClientRect').mockReturnValue(
    {left: 300, right: 330, top: 90, bottom: 120, width: 30, height: 30, x: 300, y: 90, toJSON() {}} as DOMRect);
  const rail = container.querySelector<HTMLElement>('[data-rail]')!;
  fireEvent.click(rail, {clientX: 315, clientY: 100});
  expect(pressed).toHaveBeenCalledTimes(1);
  fireEvent.click(rail, {clientX: 250, clientY: 100});      // beside it: nobody's
  expect(pressed).toHaveBeenCalledTimes(1);
  // A knob's own press stays the knob's.
  fireEvent.click(screen.getByLabelText(/^The console/), {clientX: 315, clientY: 100});
  expect(pressed).toHaveBeenCalledTimes(1);
});
