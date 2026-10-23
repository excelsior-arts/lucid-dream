import {expect, test, vi} from 'vitest';
import {holdAt} from './hold';

const param = (withHold: boolean) => ({
  value: 0.42,
  cancelScheduledValues: vi.fn(),
  setValueAtTime: vi.fn(),
  ...(withHold ? {cancelAndHoldAtTime: vi.fn()} : {}),
}) as unknown as AudioParam & Record<string, ReturnType<typeof vi.fn>>;

test('where the browser holds a param itself, that is the call', () => {
  const p = param(true);
  holdAt(p, 3);
  expect(p.cancelAndHoldAtTime).toHaveBeenCalledWith(3);
  expect(p.cancelScheduledValues).not.toHaveBeenCalled();
});

test('and in Firefox, which cannot, the value now is set at that time after the schedule is cleared', () => {
  const p = param(false);
  holdAt(p, 3);
  expect(p.cancelScheduledValues).toHaveBeenCalledWith(3);
  expect(p.setValueAtTime).toHaveBeenCalledWith(0.42, 3);
});
