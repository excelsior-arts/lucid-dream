/* The bootstrap, and the two ways it used to end badly.
 *
 * There is no room here: WebGL does not exist in jsdom and there is nothing
 * to build, which is the right seam anyway — what is being checked is the
 * order of the sequence and what it does when a step arrives after the page
 * has stopped waiting for it. The room itself is checked in a browser.
 *
 * Both halves of it are props now — `spec`, the room's own file, and `mount`,
 * the game's way of building one — so nothing here is mocked by module name
 * and a test owns exactly when each await finishes. The one that is held back
 * is `spec`, because it sits in the sequence before the mount, which is where
 * a slow disk actually keeps somebody waiting.
 */
import {act, cleanup, render} from '@testing-library/react';
import {createRef} from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import Stage from './Stage';

const engine = {mount: vi.fn(), stop: vi.fn(), knows: vi.fn()};

function stage() {
  const glass = createRef<HTMLElement>();
  const under = createRef<HTMLElement>();
  const pane = document.createElement('div');
  const panel = document.createElement('div');
  const room = document.createElement('div');
  room.id = 'stage';
  document.body.append(pane, panel, room);
  (glass as {current: HTMLElement | null}).current = pane;
  (under as {current: HTMLElement | null}).current = panel;
  return {glass, under};
}

/** A room file that arrives when it is let in, and not before. */
function slowRoom() {
  let land!: () => void;
  const there = new Promise<Record<string, never>>((r) => { land = () => r({}); });
  return {land, spec: () => there};
}

/** Everything the sequence is waiting on, short of a timer. */
const settle = () => act(async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
});

beforeEach(() => {
  vi.useFakeTimers();
  engine.mount.mockReset();
  engine.stop.mockReset();
  engine.knows.mockReset();
  engine.mount.mockImplementation(async (_spec: unknown, into: {stage: HTMLElement}) => {
    // The canvas is the scene's, and Stage listens on it for a context going
    // away — so a mock without one cannot be asked that question.
    into.stage.append(document.createElement('canvas'));
    return {room: {knows: engine.knows}, stop: engine.stop};
  });
  // The probe is the first thing in the sequence and jsdom answers no to it,
  // which would end every test in the flat page before anything else happened.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ({}) as unknown as RenderingContext);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.className = '';
  document.documentElement.style.background = '';
  document.body.innerHTML = '';
});

test('a room that arrives after the patience has run out is never mounted', async () => {
  const {glass, under} = stage();
  const late = slowRoom();
  document.documentElement.classList.add('waking');
  render(<Stage slug="lover" spec={late.spec} mount={engine.mount} glass={glass} under={under}
                told={() => ({})} onRoom={vi.fn()} />);

  // Nine seconds on a slow disk: the page gave up at eight and is already
  // flat, with #stage display:none behind it.
  await act(async () => { vi.advanceTimersByTime(9000); });
  expect(document.documentElement.classList.contains('flat')).toBe(true);
  expect(engine.mount).not.toHaveBeenCalled();

  late.land();
  await settle();

  // It used to build the room anyway and leave it running its rAF loop behind
  // the flat page for as long as the route was open.
  expect(engine.mount).not.toHaveBeenCalled();
});

test('giving up twice leaves one resize listener, not two', async () => {
  const {glass, under} = stage();
  document.documentElement.classList.add('waking');
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');

  const view = render(<Stage slug="lover" spec={() => Promise.resolve({})}
                             mount={engine.mount} glass={glass} under={under}
                             told={() => ({})} onRoom={vi.fn()} />);
  await settle();
  const canvas = document.querySelector('#stage canvas')!;

  /* A context taken away twice, which is what stopping the room now does on
     its way out — the engine hands the GPU back itself, and that raises this
     event again while the listener is still attached. `flat` used to run for
     each one, overwrite the first call's undo with the second's, and leave a
     resize listener on the window for the life of the page. */
  await act(async () => {
    canvas.dispatchEvent(new Event('webglcontextlost', {cancelable: true}));
  });
  await act(async () => {
    canvas.dispatchEvent(new Event('webglcontextlost', {cancelable: true}));
  });
  expect(document.documentElement.classList.contains('flat')).toBe(true);

  const fits = added.mock.calls.filter(([kind]) => kind === 'resize');
  expect(fits).toHaveLength(1);

  view.unmount();
  const gone = removed.mock.calls.filter(([kind]) => kind === 'resize');
  expect(gone).toHaveLength(1);
  expect(gone[0]![1]).toBe(fits[0]![1]);
});

test('and the room is let go of before it takes the context down with it', async () => {
  const {glass, under} = stage();
  const view = render(<Stage slug="lover" spec={() => Promise.resolve({})}
                             mount={engine.mount} glass={glass} under={under}
                             told={() => ({})} onRoom={vi.fn()} />);
  await settle();
  const canvas = document.querySelector('#stage canvas')!;

  /* The engine's stop() now hands the GPU back itself (forceContextLoss),
     which raises `webglcontextlost` on the way out of every room. So the
     listener has to come off first — left attached, leaving a room would
     paint the flat page over the one being arrived at. */
  const order: string[] = [];
  const off = EventTarget.prototype.removeEventListener;
  vi.spyOn(canvas, 'removeEventListener').mockImplementation(function (
    this: EventTarget, ...args: Parameters<typeof off>
  ) {
    if (args[0] === 'webglcontextlost') order.push('let go');
    return off.apply(this, args);
  });
  engine.stop.mockImplementation(() => { order.push('stop'); });

  view.unmount();
  expect(order).toEqual(['let go', 'stop']);

  canvas.dispatchEvent(new Event('webglcontextlost', {cancelable: true}));
  expect(document.documentElement.classList.contains('flat')).toBe(false);
});

test('the void it painted on the page goes back when the route does', async () => {
  const tag = document.createElement('meta');
  tag.name = 'theme-color';
  tag.content = '#000000';
  document.head.append(tag);
  const {glass, under} = stage();
  document.documentElement.style.background = 'rgb(1, 2, 3)';

  const view = render(<Stage slug="lover"
                             spec={() => Promise.resolve({palette: {void: 0x123456}})}
                             mount={engine.mount} glass={glass} under={under}
                             told={() => ({})} onRoom={vi.fn()} />);
  await settle();
  expect(tag.content).toBe('#123456');

  view.unmount();
  // The route used to put the background back and nobody put this back at
  // all, so the phone's bands stayed the colour of a room you had left.
  expect(tag.content).toBe('#000000');
  expect(document.documentElement.style.background).toBe('rgb(1, 2, 3)');
  tag.remove();
});

test('a slow download is not a room that has stalled', async () => {
  const {glass, under} = stage();
  document.documentElement.classList.add('waking');
  // The room's code arrives thirty seconds in, which is a phone across the
  // wifi fetching a few megabytes and not a machine that cannot draw.
  let landed!: () => void;
  const arrive = () => new Promise<void>((ok) => { landed = ok; });
  render(<Stage slug="lover" spec={() => Promise.resolve({})} mount={engine.mount} fetch={arrive}
                glass={glass} under={under} told={() => ({})} onRoom={vi.fn()} />);
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(document.documentElement.classList.contains('flat')).toBe(false);
  expect(engine.mount).not.toHaveBeenCalled();

  landed();
  await settle();
  expect(engine.mount).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains('waking')).toBe(false);
  expect(document.documentElement.classList.contains('flat')).toBe(false);
});

test('but code that never arrives still gives way to the flat page', async () => {
  const {glass, under} = stage();
  document.documentElement.classList.add('waking');
  render(<Stage slug="lover" spec={() => Promise.resolve({})} mount={engine.mount}
                fetch={() => new Promise(() => {})} glass={glass} under={under}
                told={() => ({})} onRoom={vi.fn()} />);
  await act(async () => { vi.advanceTimersByTime(121000); });
  expect(document.documentElement.classList.contains('flat')).toBe(true);
  expect(engine.mount).not.toHaveBeenCalled();
});
