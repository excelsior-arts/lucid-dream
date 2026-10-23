/* The conversation, lying on the glass.
 *
 * Two speakers: you, and whoever else is talking. Which is what the label
 * says and nothing more — nothing in here names a character or picks a
 * pronoun for one, and no line of it knows what the conversation is with.
 *
 * The turns are handed in. What this file owns is everything about *showing*
 * them: the shapes, the corner a game hangs its tools off, and the scroll
 * policy, which is the part with the history in it.
 */
import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {render} from './render';
import './Transcript.css';

/** One bubble. `text` is what was said; the rest is how it is shown. */
export interface Line {
  role: 'user' | 'assistant';
  text: string;
  /** Still being written: the caret blinks under it. */
  streaming?: boolean;
  /** Nothing to show yet — three dots instead of words. Not a turn: it
      stands in for one that has not arrived. */
  pending?: boolean;
  /** Done rather than said, so it leans. */
  hand?: boolean;
  /** Written, never spoken, and saying so beside the words. */
  unheard?: boolean;
  /** It broke off part-way: its last words fade out where it broke. */
  cut?: boolean;
}

export interface Props {
  turns: readonly Line[];
  /** What the other speaker is called. "You" is always the reader. */
  name: string;
  /** What the pacer is letting through of the reply still arriving. */
  visible?: string | null;
  /** A reply is still being released against its voice, so the caret stays. */
  pacing?: boolean;
  /** The bubble's own corner: whatever the game offers to do with a line. */
  tools?: (turn: Line, at: number) => ReactNode;
  /** The unheard mark pressed. */
  onUnheard?: (turn: Line, at: number) => void;
}

/* The one mark drawn here rather than handed in: a speaker with the waves
   struck through, which is what a line looks like when it was written but not
   spoken. The tools on the corner are the game's — what can be done with a
   line is a fact about the game — and arrive through `tools`.
*/
const Muted = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    <path d="M22 9l-6 6" /><path d="M16 9l6 6" />
  </svg>
);

const Dots = () => <i className="dots"><b /><b /><b /></i>;

/* Where a line broke off: its last few words fade out, a step at a time,
   the last of them ending in a dash where it broke -- none after a sentence
   that had ended, where the fade alone says it. Nothing else: no label, no
   mark, no other word in the bubble (Eugene, 10-10: a CUT OFF after it read
   as debug UI). A reader that cannot see the fade is told in words. Each
   word is its own step, so the fade holds across a line wrap, and the last
   one keeps its dash with it. Finished, so no caret; and not a warning,
   which is the game's to say somewhere other than in the words. */
const ENDED = /[.!?\u2026]["'\u201d\u2019)\]]*$/;
/** How many words fade: f1 to f4 in the stylesheet, the last the faintest. */
const FADE = 4;
function Broke({text}: {text: string}) {
  const t = text.trimEnd().replace(/\n[ \t]+/g, '\n');
  /* The last few words, with what stood between them: the words fade, the
     space and any line break between them stay as they were. */
  const tail = new RegExp(`(?:\\S+\\s+){0,${FADE - 1}}\\S+$`).exec(t);
  const head = tail ? t.slice(0, tail.index) : t;
  const parts = tail ? tail[0].split(/(\s+)/) : [];
  const words = parts.filter((_, i) => i % 2 === 0);
  /* Fewer words than steps take the faintest: the last is always f4. */
  const from = FADE - words.length + 1;
  const dash = ENDED.test(t) ? '' : '\u2014';
  return (
    <>
      {render(head)}
      {parts.map((p, i) => {
        if (i % 2) return p;
        const n = i / 2;
        const last = n === words.length - 1;
        return (
          <span key={`f${n}`} className={`fade f${from + n}${last ? ' end' : ''}`}>
            {render(p)}{last ? dash : ''}
          </span>
        );
      })}
      <span className="cut-said"> cut off</span>
    </>
  );
}

/* One line, and its own memo.

   The pacer releases words against the voice and re-renders the transcript
   fourteen times a second while a reply is arriving. Everything above this
   line is unchanged on every one of those ticks — the same turn objects, the
   same corner, the same marked-up text — and all of it was being built again
   anyway: `render()` re-parses the markup of every bubble, and late in an
   evening there are hundreds of them. Three hundred bubbles at fourteen ticks
   a second is four thousand re-parses a second for one line of new words.

   So the shape below is what the memo needs rather than what reads most
   directly at the call site: the corner is built in here from `tools` and the
   index, not handed in as an element, because an element built in the parent
   is a new object on every tick and a memo over one is a memo over nothing. */
interface BubbleProps {
  turn: Line;
  at: number;
  name: string;
  /** What to show: the turn's own text, or what the pacer has let through. */
  text: string;
  /** The caret rides this one. */
  live: boolean;
  tools?: (turn: Line, at: number) => ReactNode;
  onUnheard?: (turn: Line, at: number) => void;
  watch: (el: HTMLDivElement | null) => (() => void) | undefined;
}

const Bubble = memo(function Bubble(
  {turn, at, name, text, live, tools, onUnheard, watch}: BubbleProps,
) {
  const mine = turn.role === 'user';
  const corner = turn.pending ? null : tools?.(turn, at);
  return (
    <div
      ref={watch}
      className={'msg ' + (mine ? 'you' : 'them')
        + (turn.hand ? ' hand' : '')
        + (live ? ' streaming' : '')
        + (turn.pending ? ' pending' : '')}
    >
      <div className="who">{mine ? 'You' : name}</div>
      {/* Three dots where the words will be. It hears you now and the
          transcript arrives a second later; without this the screen says
          nothing while you talk and the reply seems to come out of
          nowhere. */}
      <div className="body">
        {turn.pending ? <Dots /> : turn.cut ? <Broke text={text} /> : render(text)}
      </div>
      {corner && <span className="tools">{corner}</span>}
      {/* A line that arrived while the sound was off. The words are on the
          glass and the voice was dropped, which from in here is
          indistinguishable from a line that was simply quiet — so the bubble
          says so itself, beside the text, without waiting to be hovered.
          Hovering is not a thing a phone does, and this is exactly the case
          somebody meets on one. */}
      {turn.unheard && (
        <button type="button" className="unheard" title="not spoken — press to hear it"
                aria-label="not spoken — press to hear it"
                onClick={(e) => { e.stopPropagation(); onUnheard?.(turn, at); }}>
          <Muted />
        </button>
      )}
    </div>
  );
});

function Transcript(props: Props) {
  const {turns, name, visible, pacing, tools} = props;
  const chat = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState(false);

  // ---- staying at the bottom, without fighting you ------------------------
  // Following the conversation means pinning to the newest line; reading back
  // through it means being left alone. The rule: keep pinning while you are
  // already near the bottom, and offer a way back when you are not.
  const pinned = useRef(true);
  /* Where we last put the scroll ourselves, and when. A scroll event at that
     position, moments after we put it there, is our own doing and not the
     reader's — and telling the two apart is the whole of it. Following a
     reply, we scroll to the bottom on every delta; each of those raises a
     scroll event that arrives a frame later, by which time the next delta has
     made the page taller. So the handler read "not at the bottom", let go of
     the conversation mid-sentence, and there was no way back: nothing sets
     `pinned` again except a scroll event, and we had just stopped producing
     them. The ↓ latest button sat there while you were already looking at the
     latest.

     The "when" matters as much as the "where". Position alone was wrong: an
     empty conversation scrolls to 0, so 0 stayed marked as ours for the rest
     of the evening, and scrolling back to the very first line — which lands
     on exactly 0 — was read as something we had done and ignored. */
  const ourTop = useRef(-1);
  const ourAt = useRef(0);

  const nearBottom = useCallback(() => {
    const c = chat.current;
    return !c || c.scrollHeight - c.scrollTop - c.clientHeight < 60;
  }, []);

  const keepDown = useCallback((force?: boolean) => {
    const c = chat.current;
    if (!c) return;
    // Reading back through it: leave the reader alone and offer the way down —
    // but only if there is one. Asked while already at the end, the honest
    // answer is no button, whatever the flag believes.
    if (!force && !pinned.current) { setJump(!nearBottom()); return; }
    c.scrollTop = c.scrollHeight;
    ourTop.current = c.scrollTop;
    ourAt.current = Date.now();
    pinned.current = true;
    setJump(false);
  }, [nearBottom]);

  const onScroll = useCallback(() => {
    const c = chat.current;
    if (!c) return;
    // Ours, or theirs. Content growing under us does not move scrollTop, so a
    // late event still reads the position we set — and is still ours, as long
    // as we put it there a moment ago rather than at some point this evening.
    if (c.scrollTop !== ourTop.current || Date.now() - ourAt.current > 400) {
      pinned.current = nearBottom();
    }
    // And the button follows the truth rather than a flag: a way back down
    // while there is somewhere to go, and nothing at all at the end of the
    // conversation. It used to appear only when a new line arrived, so reading
    // back through a long evening meant scrolling all the way out by hand.
    if (nearBottom()) pinned.current = true;
    setJump(!nearBottom());
  }, [nearBottom]);

  /* Following the conversation has to survive the room moving under it. The
     glass is a plane in a room, so the page is laid out again — at a different
     width, and at a different size of type — after the transcript has been
     drawn and scrolled to its end. Every line changes height, the conversation
     gets taller, and the view stays where it was: a phone opened a
     conversation at the top of it, thousands of pixels from anything recent,
     with nothing saying so. Each line is watched, so whatever changes its
     height takes the view with it — as long as we are still following. */
  const growth = useRef<ResizeObserver | null>(null);
  // Made on the first commit rather than during a render, which is not a
  // place a component may make anything.
  const watcher = useCallback(() => {
    if (!growth.current && typeof ResizeObserver !== 'undefined') {
      growth.current = new ResizeObserver(() => {
        /* The same rule the scroll handler keeps, applied at the other place
           that can see it move: being at the end is what following means. A
           conversation can change height without raising a scroll event —
           every line does when the room hands the glass a new type size — and
           a page that let go during one of those was left with a ↓ latest
           over a conversation already at its end, and nothing to press that
           would take it away. */
        if (nearBottom()) pinned.current = true;
        if (pinned.current) keepDown(true);
        else setJump(true);
      });
    }
    return growth.current;
  }, [keepDown, nearBottom]);
  useEffect(() => {
    const watch = watcher();
    const box = chat.current;
    if (watch && box) watch.observe(box);
    // A ResizeObserver holds its targets, so everything it was ever given
    // must be given back — a whole transcript at a time when a conversation
    // is swapped out, which is the one moment this happens in bulk.
    return () => watch?.disconnect();
  }, [watcher]);
  const watchGrowth = useCallback((el: HTMLDivElement | null) => {
    const watch = watcher();
    if (!watch || !el) return;
    watch.observe(el);
    return () => watch.unobserve(el);
  }, [watcher]);

  /* The on-screen keyboard shrinks the viewport; keep the latest reply in
     view. And the same for the field that opened it, which is focused a moment
     before the keyboard has finished arriving.

     Only that field, though. `focusin` is every focus change on the page:
     pressing replay or delete on a line five hundred lines back, opening the
     console, or a Tab from anywhere. All of those used to take the view to
     the end of the conversation a quarter of a second later, which read as
     the page throwing away the thing you had just gone looking for — and it
     took the reader's own scroll with it, because it was asked with `force`.

     So: the typing line, and unforced. A reader who has scrolled up stays
     scrolled up even when they open the keyboard, and somebody already at the
     end is kept there, which is the case this exists for. */
  useEffect(() => {
    const bottom = () => keepDown(true);
    const later = (e: FocusEvent) => {
      const el = e.target;
      const typing = el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!typing) return;
      setTimeout(() => keepDown(), 250);
    };
    window.visualViewport?.addEventListener('resize', bottom);
    document.addEventListener('focusin', later);
    return () => {
      window.visualViewport?.removeEventListener('resize', bottom);
      document.removeEventListener('focusin', later);
    };
  }, [keepDown]);

  /* A freshly loaded log opens at its end. Which conversation this is can
     change under the page — a speaker switch, an old session opened — and the
     view has to go with it rather than stay wherever the last one had been
     read to.

     Counted without the dots. A pair of them going up and coming down again
     is not a conversation being swapped for another one, and read as one it
     forced the view to the end while somebody was reading back through it.
     They still have to be followed, though — they are a line arriving — which
     is what the second count is for. */
  const said = turns.filter((t) => !t.pending);
  const first = said[0]?.text ?? '';
  const count = said.length;
  const growing = said[count - 1]?.text ?? '';
  const shown = turns.length;
  const was = useRef({first, count});
  useLayoutEffect(() => {
    const swapped = first !== was.current.first || count < was.current.count;
    was.current = {first, count};
    keepDown(swapped);
  }, [first, count, shown, growing, visible, keepDown]);

  /* The last line that is actually a line: what the pacer's words go into,
     and what the caret rides. The dots stand after it. */
  const last = count - 1;

  return (
    <div id="chatwrap">
      <div id="chat" ref={chat} onScroll={onScroll}>
        {turns.map((turn, i) => {
          const ending = turn.role !== 'user' && i === last;
          return (
            <Bubble
              key={i}
              turn={turn}
              at={i}
              name={name}
              text={ending && visible != null ? visible : turn.text}
              live={!!turn.streaming || (ending && !!pacing)}
              tools={tools}
              onUnheard={props.onUnheard}
              watch={watchGrowth}
            />
          );
        })}
      </div>
      {/* Only shown once you have scrolled away from the bottom. */}
      <button id="jump" hidden={!jump} onClick={() => keepDown(true)}>&darr; latest</button>
    </div>
  );
}

/* Redrawn when the conversation changes, and not five times a second: the
   tick that repaints the deck arrives that often and none of it is about the
   words on the glass. Which is a promise about `turns` and `tools`: hand in
   an array or a function built during a render and this memo is a no-op. */
export default memo(Transcript);
