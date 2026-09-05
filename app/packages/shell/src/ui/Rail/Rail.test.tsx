import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import Console from '../Console/Console';
import Rail from './Rail';
import {hatch} from '../../shell/console';

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
});

test('four fittings, in one rail', () => {
  render(shell());
  expect(screen.getByLabelText(/How loud the interface is/)).toBeInTheDocument();
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
  const knob = screen.getByLabelText(/How loud the interface is/);
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
