/* A seven-segment readout, the kind a pocket calculator had.
 *
 * The deck's clock was a pair of small amber digits in a rounded box, beside
 * a count of turns in another — two numbers of the same weight, and the one
 * that mattered was the one nobody could tell from across the room. This is
 * a window of grey-green glass with dark segments in it, and it is drawn
 * rather than typed: every segment that could light is there, faintly, the
 * way the ghost of an eight sits behind every digit on a real one, and the
 * lit ones are the same shapes filled in. A colon that blinks is a clock that
 * is running; one that holds is a clock that is stopped, which can be told at
 * a glance.
 *
 * Nothing in here knows what is being counted. It shows a string of digits
 * and colons, and the game says what they mean.
 */
import './Lcd.css';

export interface Props {
  /** Digits and colons, e.g. "12:30". Anything else is drawn dark. */
  text: string;
  /** The colon blinks: whatever this counts is moving. */
  running?: boolean;
  /** Stepped back — held, or run out. */
  dim?: boolean;
  id?: string;
  title?: string;
  className?: string;
}

/* One digit in a 20 by 36 box, drawn as seven hexagonal bars with a hair of
   a gap at every joint, and leant a few degrees the way the moulds were. */
const W = 20, H = 36, T = 2.6, GAP = .7;
const bar = (x0: number, x1: number, y: number): string =>
  `M${x0 + GAP},${y} L${x0 + GAP + T},${y - T} L${x1 - GAP - T},${y - T} L${x1 - GAP},${y} `
  + `L${x1 - GAP - T},${y + T} L${x0 + GAP + T},${y + T} Z`;
const post = (x: number, y0: number, y1: number): string =>
  `M${x},${y0 + GAP} L${x + T},${y0 + GAP + T} L${x + T},${y1 - GAP - T} L${x},${y1 - GAP} `
  + `L${x - T},${y1 - GAP - T} L${x - T},${y0 + GAP + T} Z`;
const L = T, R = W - T, TOP = T, MID = H / 2, BOT = H - T;
const SEG = {
  a: bar(L, R, TOP), g: bar(L, R, MID), d: bar(L, R, BOT),
  f: post(L, TOP, MID), b: post(R, TOP, MID), e: post(L, MID, BOT), c: post(R, MID, BOT),
};
type Seg = keyof typeof SEG;
const ALL: Seg[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const LIT: Record<string, Seg[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'], '1': ['b', 'c'], '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'], '4': ['f', 'g', 'b', 'c'], '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'd', 'c'], '7': ['a', 'b', 'c'], '8': ALL,
  '9': ['a', 'b', 'c', 'd', 'f', 'g'], '-': ['g'],
};
const COLON = 8;      // the width a colon takes between two digits
const PAD = 3, END = 1;   // the bezel's own margin, and less of it on the right

export default function Lcd({text, running, dim, id, title, className}: Props) {
  const chars = [...text];
  const width = chars.reduce((w, c) => w + (c === ':' ? COLON : W + 2), 0) + PAD + END;
  let x = PAD;
  const glyphs = chars.map((c, i) => {
    if (c === ':') {
      const at = x + COLON / 2;
      x += COLON;
      return (
        <g key={i} className="colon">
          <rect x={at - 1.9} y={MID - 8} width={3.8} height={3.8} />
          <rect x={at - 1.9} y={MID + 4.2} width={3.8} height={3.8} />
        </g>
      );
    }
    const lit = new Set(LIT[c] ?? []);
    const here = x;
    x += W + 2;
    return (
      <g key={i} transform={`translate(${here} 0)`}>
        {ALL.map((s) => (
          <path key={s} d={SEG[s]} className={lit.has(s) ? 'on' : 'off'} />
        ))}
      </g>
    );
  });
  return (
    <b id={id} title={title}
       className={['lcd', running ? 'running' : '', dim ? 'dim' : '', className ?? '']
         .filter(Boolean).join(' ')}>
      <svg viewBox={`0 0 ${width} ${H + PAD * 2}`} aria-hidden="true">
        <g transform={`translate(0 ${PAD}) skewX(-6)`}>{glyphs}</g>
      </svg>
      {/* The same digits as words, for a reader that cannot see a segment. */}
      <span className="lcd-said">{text}</span>
    </b>
  );
}
