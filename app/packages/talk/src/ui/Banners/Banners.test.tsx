import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {MACHINE, PAGE, setHost} from '@lucid/shell';
import Banners from './Banners';

afterEach(() => { cleanup(); setHost(MACHINE); });

const show = (state: {nowhere?: boolean; adrift?: boolean},
              on: {back?: () => void} = {}) =>
  render(<Banners nowhere={!!state.nowhere} adrift={!!state.adrift}
                  onBack={on.back ?? (() => {})} />);

const said = (id: string) => !document.getElementById(id)?.hasAttribute('hidden');

test('a quiet page says neither of them', () => {
  show({});
  expect([said('gone'), said('adrift')]).toEqual([false, false]);
});

/* And there is no third. The banner that said another window had the machine
   went with the claim: two rooms open at once are two conversations. */
test('and there is nothing left to say about another window', () => {
  show({nowhere: true, adrift: true});
  expect(document.getElementById('taken')).toBeNull();
});

test('a conversation that is not there offers the one thing that still works', () => {
  const back = vi.fn();
  show({nowhere: true}, {back});
  expect(said('gone')).toBe(true);
  fireEvent.click(document.getElementById('goback')!);
  expect(back).toHaveBeenCalled();
});

/* No button on this one, because the page is already retrying every second and
   a key that duplicates what is happening anyway is a key that lies about
   being needed. */
test('nothing on the other end says so, and offers nothing', () => {
  show({adrift: true});
  expect(said('adrift')).toBe(true);
  expect(document.getElementById('adrift')!.querySelector('button')).toBeNull();
});

/* A page with nothing behind it has no machine to be not answering: what put
   the banner up there is the pill in this browser failing a reply, and the
   page says that in its own words. */
test('in a browser it is the pill that did not answer, not a machine', () => {
  show({adrift: true});
  expect(document.getElementById('adrift')!.textContent).toMatch(/the machine is not answering — still trying/);
  cleanup();
  setHost(PAGE);
  show({adrift: true});
  const words = document.getElementById('adrift')!.textContent!;
  expect(words).toMatch(/the pill didn’t answer — try again in a moment/);
  expect(words).not.toMatch(/machine/);
});

/* And where the page knows why -- the GPU in this browser letting go of the
   pill, a pill that stalled -- it says that rather than only that the pill
   did not answer. Never on a Mac, whose banner is the machine's. */
test('in a browser it says why, where the page knows', () => {
  setHost(PAGE);
  render(<Banners nowhere={false} adrift said="this browser’s GPU let go of the pill mid-reply — say that again"
                  onBack={() => {}} />);
  expect(document.getElementById('adrift')!.textContent).toBe('this browser’s GPU let go of the pill mid-reply — say that again');
  cleanup();
  setHost(MACHINE);
  render(<Banners nowhere={false} adrift said="anything" onBack={() => {}} />);
  expect(document.getElementById('adrift')!.textContent).toMatch(/the machine is not answering/);
});

/* A reply that broke off -- a stall, the GPU letting go, a stream dropped --
   is not a banner: a quiet line over the keys while the pill is woken, which
   says when a line waits on it, and none of the banner's box. */
test('a pill being woken is said quietly, not as a banner', () => {
  const {rerender} = render(<Banners nowhere={false} adrift={false} waking="waking" onBack={() => {}} />);
  const line = document.getElementById('not-answering')!;
  expect(said('not-answering')).toBe(true);
  expect(said('adrift')).toBe(false);
  expect(line.classList.contains('banner')).toBe(false);
  expect(line.textContent).toBe('the pill isn’t answering — waking it');
  expect(line.textContent).not.toMatch(/Mac|desktop|app|STT|ASR/);
  rerender(<Banners nowhere={false} adrift={false} waking="line" onBack={() => {}} />);
  expect(line.textContent).toBe('the pill isn’t answering — waking it, your line is next');
  rerender(<Banners nowhere={false} adrift={false} waking="" onBack={() => {}} />);
  expect(said('not-answering')).toBe(false);
  // Under a banner, which says more, it is not said twice.
  rerender(<Banners nowhere={false} adrift waking="waking" onBack={() => {}} />);
  expect([said('adrift'), said('not-answering')]).toEqual([true, false]);
});
