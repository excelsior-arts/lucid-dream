/* A QR code, drawn here, from nothing.

   The obvious way to put a QR on a page is an image service, and this program
   would sooner not run at all than ask the network for a picture of its own
   address. So this is the encoder: byte mode, error correction level M,
   versions 1 to 10 — which covers any URL this machine can serve — and it
   returns a matrix of booleans that the page draws as elements.

   Only the parts of the spec that a URL needs are here. Kanji mode, numeric
   mode, and versions past 10 are absent because nothing would ever reach them.

   window.QR.matrix(text) -> [[bool, ...], ...]                                */
(() => {
  // ---- the tables that cannot be computed --------------------------------
  // Per version, level M: [data codewords, ec codewords per block, blocks in
  // group 1, data codewords in each, blocks in group 2, data codewords each].
  const V = {
    1:  [16,  10, 1, 16, 0, 0],
    2:  [28,  16, 1, 28, 0, 0],
    3:  [44,  26, 1, 44, 0, 0],
    4:  [64,  18, 2, 32, 0, 0],
    5:  [86,  24, 2, 43, 0, 0],
    6:  [108, 16, 4, 27, 0, 0],
    7:  [124, 18, 4, 31, 0, 0],
    8:  [154, 22, 2, 38, 2, 39],
    9:  [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44],
  };
  // Where the alignment patterns sit, by version.
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  // ---- GF(256), for the error correction ---------------------------------
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;          // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= mul(g[j], EXP[i]);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    // Built low-degree-first; the division below wants the leading coefficient
    // in front. Reversed, this is the polynomial the standard prints; not
    // reversed, every code produced is a valid-looking one that no scanner
    // will accept, because only the error correction is wrong.
    return g.reverse();
  }

  function ecc(data, n) {
    const g = generator(n), rem = new Array(n).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem[0];
      rem.shift(); rem.push(0);
      for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], factor);
    }
    return rem;
  }

  // ---- format and version information, both BCH --------------------------
  // Long division in GF(2): shift the generator up under each set bit above
  // the remainder's width and cancel it. Getting this subtly wrong costs you
  // nothing visible — the code still looks like a QR code, and no scanner on
  // earth will read it, because the format is the first thing they decode.
  function formatBits(mask) {
    const data = (0b00 << 3) | mask;                    // 00 = error level M
    let rem = data << 10;
    for (let i = 4; i >= 0; i--) if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
    return (((data << 10) | (rem & 0x3ff)) ^ 0x5412) >>> 0;
  }

  function versionBits(v) {
    let rem = v << 12;
    for (let i = 5; i >= 0; i--) if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i;
    return ((v << 12) | (rem & 0xfff)) >>> 0;
  }

  // ---- the matrix ---------------------------------------------------------
  function skeleton(version) {
    const n = version * 4 + 17;
    const m = Array.from({length: n}, () => new Array(n).fill(null));  // null = free
    const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < n && y < n) m[y][x] = v; };

    const finder = (ox, oy) => {
      for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
        const on = (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
                   (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
                   (x >= 2 && x <= 4 && y >= 2 && y <= 4);
        put(ox + x, oy + y, on);
      }
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);

    for (let i = 8; i < n - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }

    for (const cy of ALIGN[version]) for (const cx of ALIGN[version]) {
      if (m[cy][cx] !== null) continue;               // skips the three corners
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++)
        m[cy + y][cx + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1;
    }

    m[n - 8][8] = true;                               // the one always-dark module

    // Reserve the format areas so data does not land in them.
    for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = false;
                                  if (m[i][8] === null) m[i][8] = false; }
    for (let i = 0; i < 8; i++) { if (m[8][n - 1 - i] === null) m[8][n - 1 - i] = false;
                                  if (m[n - 1 - i][8] === null) m[n - 1 - i][8] = false; }
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = Math.floor(i / 3), b = i % 3;
        m[b][n - 11 + a] = false; m[n - 11 + a][b] = false;
      }
    }
    return m;
  }

  const reserved = (version) => {
    // A second skeleton, used only to remember which cells were taken.
    const s = skeleton(version);
    return s.map(row => row.map(v => v !== null));
  };

  function place(m, taken, bits) {
    const n = m.length;
    let i = 0, up = true;
    for (let right = n - 1; right > 0; right -= 2) {
      if (right === 6) right--;                       // the vertical timing line
      for (let step = 0; step < n; step++) {
        const y = up ? n - 1 - step : step;
        for (const x of [right, right - 1]) {
          if (taken[y][x]) continue;
          m[y][x] = i < bits.length ? bits[i] : false;
          i++;
        }
      }
      up = !up;
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];

  function penalty(m) {
    const n = m.length;
    let score = 0;
    const run = line => {
      let same = 1, total = 0;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) same++;
        else { if (same >= 5) total += same - 2; same = 1; }
      }
      if (same >= 5) total += same - 2;
      return total;
    };
    for (let y = 0; y < n; y++) score += run(m[y]);
    for (let x = 0; x < n; x++) score += run(m.map(row => row[x]));

    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++)
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1])
        score += 3;

    const FIND = [true, false, true, true, true, false, true, false, false, false, false];
    const hasAt = (line, i) => FIND.every((v, k) => line[i + k] === v);
    const scan = line => {
      let s = 0;
      for (let i = 0; i + 11 <= line.length; i++) {
        if (hasAt(line, i)) s += 40;
        if (hasAt(line.slice(i, i + 11).reverse(), 0)) s += 40;
      }
      return s;
    };
    for (let y = 0; y < n; y++) score += scan(m[y]);
    for (let x = 0; x < n; x++) score += scan(m.map(row => row[x]));

    const dark = m.flat().filter(Boolean).length;
    score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
    return score;
  }

  function matrix(text) {
    const bytes = [...new TextEncoder().encode(text)];

    // The smallest version this will fit in, counting the header honestly.
    let version = 0;
    for (let v = 1; v <= 10; v++) {
      const header = 4 + (v < 10 ? 8 : 16);
      if (header + bytes.length * 8 <= V[v][0] * 8) { version = v; break; }
    }
    if (!version) throw new Error('too long for a version 10 code');

    const [dataCw, ecCw, g1, g1cw, g2, g2cw] = V[version];
    const countBits = version < 10 ? 8 : 16;

    // ---- the bit stream ----
    const bits = [];
    const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i & 1) === 1); };
    push(0b0100, 4);
    push(bytes.length, countBits);
    for (const b of bytes) push(b, 8);
    for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(false);   // terminator
    while (bits.length % 8) bits.push(false);
    const pad = [0xec, 0x11];
    for (let i = 0; bits.length < dataCw * 8; i++) push(pad[i % 2], 8);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8)
      codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | (b ? 1 : 0), 0));

    // ---- blocks, error correction, and the interleave ----
    const blocks = [], eccs = [];
    let at = 0;
    for (const [count, size] of [[g1, g1cw], [g2, g2cw]]) {
      for (let b = 0; b < count; b++) {
        const chunk = codewords.slice(at, at + size); at += size;
        blocks.push(chunk); eccs.push(ecc(chunk, ecCw));
      }
    }
    const stream = [];
    for (let i = 0; i < Math.max(g1cw, g2cw); i++)
      for (const b of blocks) if (i < b.length) stream.push(b[i]);
    for (let i = 0; i < ecCw; i++) for (const e of eccs) stream.push(e[i]);

    const dataBits = [];
    for (const cw of stream) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i & 1) === 1);

    // ---- the eight masks, and the least ugly one wins ----
    const taken = reserved(version);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = skeleton(version);
      place(m, taken, dataBits);
      const n = m.length;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        if (!taken[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];

      const fmt = formatBits(mask);
      for (let i = 0; i < 15; i++) {
        const on = ((fmt >> i) & 1) === 1;
        // The format information is written twice, in two L-shapes.
        if (i < 6) m[i][8] = on;
        else if (i < 8) m[i + 1][8] = on;
        else if (i === 8) m[8][7] = on;
        else m[8][14 - i] = on;

        if (i < 8) m[8][n - 1 - i] = on;
        else m[n - 15 + i][8] = on;
      }
      if (version >= 7) {
        const ver = versionBits(version);
        for (let i = 0; i < 18; i++) {
          const on = ((ver >> i) & 1) === 1;
          const a = Math.floor(i / 3), b = i % 3;
          m[b][n - 11 + a] = on; m[n - 11 + a][b] = on;
        }
      }
      const score = penalty(m);
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  window.QR = {matrix};
})();
