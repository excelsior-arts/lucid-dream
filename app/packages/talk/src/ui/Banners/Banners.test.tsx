import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import Banners from './Banners';

afterEach(cleanup);

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
