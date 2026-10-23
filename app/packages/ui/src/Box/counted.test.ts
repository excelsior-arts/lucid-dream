import {expect, test} from 'vitest';
import {counted} from './counted';

test('one of a thing is singular, any other number plural', () => {
  expect(counted(1, 'dose')).toBe('1 dose');
  expect(counted(2, 'dose')).toBe('2 doses');
  expect(counted(37, 'dose')).toBe('37 doses');
  expect(counted(1, 'memory', 'memories')).toBe('1 memory');
  expect(counted(3, 'memory', 'memories')).toBe('3 memories');
});
