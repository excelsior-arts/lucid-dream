/* The frame, with something in it that is nobody's paperwork. */
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, test} from 'vitest';
import Sheet from './Sheet';
import {close, isOpen, openSheet} from './open';

afterEach(() => {
  act(() => close());
  cleanup();
});

test('a sheet is a title and whatever the game put under it', () => {
  const {container} = render(<Sheet />);
  expect(container.querySelector('.sheet')).toBeNull();   // shut is nothing at all
  act(() => openSheet({title: 'a title', body: <div className="sheet-body">a body</div>}));
  expect(container.querySelector('.sheet-head b')).toHaveTextContent('a title');
  expect(screen.getByText('a body')).toBeInTheDocument();
  expect(isOpen()).toBe(true);
});

test('the cross and escape are both the way out, and the fade outlives the shut', async () => {
  const {container} = render(<Sheet />);
  act(() => openSheet({title: 'one', body: null}));
  fireEvent.click(screen.getByLabelText('close'));
  expect(isOpen()).toBe(false);
  // Still drawn, on its way out.
  expect(container.querySelector('.sheet')).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.sheet')).toBeNull());

  act(() => openSheet({title: 'two', body: null}));
  fireEvent.keyDown(document, {key: 'Escape'});
  expect(isOpen()).toBe(false);
});

test('asking for one while another is fading out keeps the new one', async () => {
  render(<Sheet />);
  act(() => openSheet({title: 'first', body: null}));
  act(() => close());
  act(() => openSheet({title: 'second', body: null}));
  await new Promise((r) => setTimeout(r, 220));
  expect(isOpen()).toBe(true);
  expect(document.querySelector('.sheet-head b')).toHaveTextContent('second');
});
