/* The open box: the inside of the thing on the shelf.
 *
 * A case standing open on a table, with a sheet to read inside the lid and
 * cards lying in the tray. Press one and it comes up out of the box, turns
 * over and arrives in your face until it is the only thing on the screen;
 * press the lid and it comes down again.
 *
 * Nothing in here knows what the cards are for. What is on them, what is
 * written on the lid and where a card goes when it lands are all handed in —
 * which is the whole difference between a box and a box of something.
 *
 * The geometry is @lucid/shell's styles/box.css, shared with the shelf,
 * because this has to be the object you just pressed rather than a picture
 * of one.
 */
import type {CSSProperties, ReactNode} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {fitOpenBox, sound} from '@lucid/shell';
import type {Flight} from './take';
import {take} from './take';
import '@lucid/shell/styles/box.css';
import './Box.css';

export interface Card {
  /** Its own name, and what `onTake` is handed back. */
  id: string;
  /** Three channels — the card is painted `rgba(var(--card), …)`. */
  color: string;
  /** What backs it: one figure repeated over the whole card, the way a
      playing card is backed. Which figures there are is drawn in the CSS
      beside this; which one a card wears is data. */
  figure?: string;
  /** What is printed on it, large, and the line under that. */
  title: string;
  blurb: string;
  /** Where pressing it goes. A real address, so ⌘-click opens a tab and the
      card is a link rather than a thing that only works when clicked. */
  href?: string;
  /** What a screen reader calls it. The title and the blurb, by default. */
  name?: string;
}

export interface Props {
  /** Engraved on the plaque. */
  title: string;
  /** The sheet inside the lid: whatever this box has to say about itself. */
  lid?: ReactNode;
  cards: readonly Card[];
  /** Lying on the floor of the tray, where the next ones will go. */
  note?: string;
  /** The card landed. This is where a game goes somewhere: it is called
      inside the view transition, with the DOM changed by the time it
      returns, so what it opens continues the flight instead of cutting. */
  onTake: (card: Card) => void;
  /** Pressed — before it has flown anywhere. For whatever is worth starting
      while the card is in the air. */
  onPress?: (card: Card) => void;
  /** The lid came down. */
  onShut: () => void;
  /** Whose box this is: `data-game` on the room, so a game can recolour the
      case and the cards without any new markup. */
  game?: string;
}

/* One shape, cut twice: the plate on the lid and the lock on the front. A
   diamond with its sides bowed out — drawn as a stroked path rather than a
   clip, so the brass line keeps its weight whatever size the box is. */
function Cut() {
  return (
    <svg className="cut" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M50 1.5 Q78 13 98.5 30 Q78 47 50 58.5 Q22 47 1.5 30 Q22 13 50 1.5 Z" />
    </svg>
  );
}

/* How far the lid's own controls keep from the rail's knobs. */
const KNUCKLE = 14;

/* The rail's knobs, without the gutter round them that takes stray presses. */
function railKnobs() {
  const rail = document.querySelector<HTMLElement>('[data-rail]');
  if (!rail) return null;
  const b = rail.getBoundingClientRect(), cs = getComputedStyle(rail);
  const k = {left: b.left + parseFloat(cs.paddingLeft), right: b.right - parseFloat(cs.paddingRight),
             top: b.top + parseFloat(cs.paddingTop), bottom: b.bottom - parseFloat(cs.paddingBottom)};
  return k.right > k.left && k.bottom > k.top ? k : null;
}

/* On a phone the open lid's top corner stands under the rail. Anything up
   there that takes its own presses (`data-own-press`: Talk's gear, at the end
   of the rule under its title) is kept a knuckle clear of the knobs:
   --rail-clear, in the lid's own pixels, is how far in from its right edge the
   sheet ends that line -- nothing where there is room. Measured against where
   it is drawn, so it holds whatever size the box was fitted to; each pass
   corrects the last. Close beside a knob, a tap on the gear went to the knob
   (a phone moves a tap that lands on nothing pressable onto the nearest thing
   that is, and the rail's gutter is nothing pressable). */
function clearRail(lid: HTMLElement | null) {
  if (!lid) return;
  const was = parseFloat(lid.style.getPropertyValue('--rail-clear')) || 0;
  const knobs = railKnobs();
  const scale = lid.getBoundingClientRect().width / (lid.offsetWidth || 1);
  let need = -Infinity;
  for (const el of lid.querySelectorAll<HTMLElement>('[data-own-press]')) {
    const r = el.getBoundingClientRect();
    if (!knobs || !r.width || r.bottom < knobs.top - KNUCKLE || r.top > knobs.bottom + KNUCKLE) continue;
    need = Math.max(need, r.right + KNUCKLE - knobs.left);
  }
  const clear = Number.isFinite(need) && scale > 0 ? Math.max(0, was + need / scale) : 0;
  lid.style.setProperty('--rail-clear', `${Math.round(clear)}px`);
}

/** How long the lid takes to come down before whatever is behind it. */
const SHUT_MS = 620;

export default function Box({title, lid, cards, note, onTake, onPress, onShut, game}: Props) {
  const room = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const object = useRef<HTMLDivElement>(null);
  const lidEl = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLButtonElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flying = useRef<Flight | null>(null);

  /* Fit first, paint once, and only then let anything be allowed to move. The
     same on the way back: a router hands this page back mid-shut or with a
     card still lit, and it has to be sitting open again before it is shown. */
  const [priming, setPriming] = useState(true);
  const [settled, setSettled] = useState(false);
  const [shutting, setShutting] = useState(false);
  const [chosen, setChosen] = useState('');

  /* Exactly what the front page does at the end of its opening, from the same
     shared fitter: this has to be that box, at that size. Fit the box, then
     park the shut-zone over the top edge of its lid. */
  const measure = useCallback(() => {
    fitOpenBox(object.current, room.current);
    clearRail(lidEl.current);
    const seen = lidEl.current?.getBoundingClientRect();
    const z = zone.current?.style;
    if (!seen || !z) return;
    const deep = Math.max(30, Math.min(seen.height * 0.2, 60)); // a thumb, not a hairline
    /* Short of anything on the lid's sheet that takes its own presses up
       there (`data-own-press`, a gear in the corner): the zone lies over
       the lid, and a press on it would shut the box instead. */
    let right = seen.right;
    for (const el of lidEl.current?.querySelectorAll('[data-own-press]') ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width && r.top < seen.top + deep) right = Math.min(right, r.left);
    }
    z.left = Math.round(seen.left) + 'px';
    z.top = Math.round(seen.top) + 'px';
    z.width = Math.round(Math.max(0, right - seen.left)) + 'px';
    z.height = Math.round(deep) + 'px';
  }, []);


  useEffect(() => {
    let inner = 0;
    measure();
    const outer = requestAnimationFrame(() => {
      measure(); // once more, on a settled page
      inner = requestAnimationFrame(() => {
        setPriming(false);
        setSettled(true); // and only now is it shown
      });
    });
    // Every way a window can change shape, and immediately: a rotation, a
    // dragged edge, a toolbar sliding away. The fitter turns transitions off
    // while it works, so none of these animate.
    for (const ev of ['resize', 'orientationchange']) addEventListener(ev, measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      for (const ev of ['resize', 'orientationchange']) removeEventListener(ev, measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [measure]);

  /* And once more with the box actually on screen — when the fade is over,
     not when it starts. Held back at opacity 0 the room is a flattened
     subtree: an element that has to group its descendants to composite them
     stops honouring `transform-style: preserve-3d`, so every fit before this
     one measures a box with no perspective in it and puts the hinge a dozen
     pixels above the middle line. Those earlier fits are still worth doing —
     they are what stops the box arriving at one size and springing to another
     — but this is the one that lands. */
  useEffect(() => {
    const here = room.current;
    if (!here) return;
    const done = (e: TransitionEvent) => {
      if (e.propertyName === 'opacity') measure();
    };
    here.addEventListener('transitionend', done);
    return () => here.removeEventListener('transitionend', done);
  }, [measure]);

  // The cards can arrive a moment after the box is drawn, and what is in the
  // tray is part of what was fitted.
  useEffect(() => {
    if (settled) measure();
  }, [measure, cards, settled]);

  // Leaving mid-flight — the back button, or a window closed — takes the layer
  // the card is flying on with it.
  useEffect(
    () => () => {
      if (leaving.current) clearTimeout(leaving.current);
      flying.current?.clear();
    },
    [],
  );

  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* What the two documents got from the browser, asked for by hand: a router
     starts no view transition for us, and startViewTransition wants the DOM
     changed by the time its callback returns. The card is handed over under
     the name whatever opens next picks it up by — see view-transition-name
     in Box.css. */
  const go = (then: () => void) => {
    const move = () => {
      flying.current?.clear();
      flying.current = null;
      then();
    };
    if (document.startViewTransition) document.startViewTransition(() => flushSync(move));
    else move();
  };

  const takeOne = (e: React.MouseEvent<HTMLAnchorElement>, card: Card) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onPress?.(card);
    sound.latch();
    setTimeout(() => sound.whoosh({dur: 0.9}), 120);
    const el = e.currentTarget;
    setChosen(card.id);
    if (still()) {
      go(() => onTake(card));
      return;
    }
    flying.current = take(el);
    leaving.current = setTimeout(() => go(() => onTake(card)), flying.current.ms);
  };

  // ---- shutting the box ---------------------------------------------------
  // The lid is the way back: press it and it comes down, then whatever is
  // behind it.
  const shut = () => {
    // Back to the stylesheet's viewing distance as well. The fitter moves the
    // eye with the size of the open box; shutting it at that distance left the
    // closed box a little smaller than the one the front page draws, so it
    // grew as you arrived.
    if (table.current) table.current.style.perspective = '';
    sound.whoosh({dur: 0.7, peak: 0.38});
    setShutting(true);
    leaving.current = setTimeout(() => go(onShut), still() ? 0 : SHUT_MS);
  };
  /* A press or a key, on any of the three things that shut it. */
  const shutter = {
    onClick: shut,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        shut();
      }
    },
    onPointerEnter: () => sound.hover(),
  };

  return (
    <>
      <div id="room" className={settled ? 'settled' : undefined} data-game={game} ref={room}>
        <div className="table" ref={table}>
          <div
            className={`object${priming ? ' priming' : ''}${shutting ? ' shutting' : ''}`}
            id="case"
            ref={object}
          >
            <div className="box">
              <div className="face floor" />
              <div className="face w-back" />
              <div className="face w-front">
                {/* The lock on the front of the box shuts it too — the obvious
                    place to press on a box standing open in front of you. */}
                <i
                  className="clasp"
                  id="clasp"
                  role="button"
                  tabIndex={0}
                  aria-label="shut the box"
                  {...shutter}
                >
                  <Cut />
                  <b />
                </i>
              </div>
              <div className="face w-left" />
              <div className="face w-right" />
              <div className="lamp" />

              <div className={`contents${chosen ? ' taken' : ''}`} id="cards">
                {cards.map((card) => (
                  <a
                    key={card.id}
                    className={`card${chosen === card.id ? ' chosen' : ''}`}
                    href={card.href}
                    style={{'--card': card.color} as CSSProperties}
                    data-figure={card.figure || ''}
                    aria-label={card.name ?? `${card.title} — ${card.blurb}`}
                    onPointerEnter={() => sound.hover()}
                    onClick={(e) => takeOne(e, card)}
                  >
                    <span className="mark" aria-hidden="true">
                      <i />
                    </span>
                    <span className="caption">
                      <b>{card.title}</b>
                      <em>{card.blurb}</em>
                    </span>
                  </a>
                ))}
              </div>
              {/* Lying in the corner of the tray, where the next ones will go. */}
              {note && (
                <p className="soon" aria-hidden="true">
                  {note}
                </p>
              )}

              <div className="lid" id="lid" ref={lidEl}>
                <div className="out">
                  <i className="bracket b1" />
                  <i className="bracket b2" />
                  <i className="bracket b3" />
                  <i className="bracket b4" />
                  <div className="plaque">
                    <Cut />
                    <span>{title}</span>
                  </div>
                  <i className="filigree" />
                </div>
                <div className="in">
                  {/* The lid is not a button — there is a sheet on it to read,
                      and possibly a list to scroll. Only its top edge shuts
                      the box. */}
                  <button
                    className="grip"
                    id="grip"
                    type="button"
                    aria-label="shut the box"
                    {...shutter}
                  />
                  {lid}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The press-here for shutting the box, living outside the 3-D scene.
          Safari's hit-testing inside a preserve-3d subtree is unreliable: the
          strip drawn on the lid takes clicks on a Mac and none at all on an
          iPhone. This is a plain rectangle in plain 2-D, moved to sit exactly
          over the lid's top edge each time the box is fitted. */}
      <button id="shutzone" type="button" aria-label="shut the box" ref={zone} {...shutter} />
    </>
  );
}
