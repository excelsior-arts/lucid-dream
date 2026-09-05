import {expect, test} from 'vitest';
import {matrix} from './qr';
import codes from './fixtures/qr.json';

/* Nothing here can decode a QR code, and nothing should try: what a phone
   reads is the whole encoder — mode, mask, error correction, the lot — and
   the only proof that any of it is right is a code somebody has scanned.
   fixtures/qr.json holds three of those, drawn module for module, taken from
   the encoder these have been photographed off for months. A change to any
   pixel of them is a change to what a camera sees.

   `#` is a dark module, which is the ink; a printed one is readable enough
   that a fixture with a finder pattern out of place can be seen to be wrong. */
function drawn(text: string): string[] {
  return matrix(text).map((row) => row.map((on) => (on ? '#' : '.')).join(''));
}

const ADDRESS = 'http://127.0.0.1:6969/';

test('the same modules as the codes phones have been reading', () => {
  for (const [text, want] of Object.entries(codes)) {
    expect(drawn(text), text).toEqual(want);
  }
});

test('a version is 21 modules across, and four more for each after it', () => {
  const small = matrix('hi');
  expect(small.length).toBe(21);
  expect(small[0]!.length).toBe(21);
  // Long enough to need more room than a version 1 code has.
  const big = matrix('http://192.168.1.44:6969/lucid-talk/lover?session=abcdef0123456789');
  expect((big.length - 21) % 4).toBe(0);
  expect(big.length).toBeGreaterThan(21);
});

test('the three finders are where a scanner looks for them', () => {
  const m = matrix(ADDRESS);
  const n = m.length;
  const finder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const on = y === 0 || y === 6 || x === 0 || x === 6 ||
                 (x >= 2 && x <= 4 && y >= 2 && y <= 4);
      expect(m[oy + y]![ox + x]).toBe(on);
    }
  };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
});

test('the timing lines alternate between the finders', () => {
  const m = matrix(ADDRESS);
  const n = m.length;
  for (let i = 8; i < n - 8; i++) {
    expect(m[6]![i]).toBe(i % 2 === 0);
    expect(m[i]![6]).toBe(i % 2 === 0);
  }
});
