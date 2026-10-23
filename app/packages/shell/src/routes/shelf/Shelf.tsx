import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {useNavigate} from 'react-router';
import {href} from '../../base';
import {fitOpenBox} from '../../shell/fit';
import {startSky} from '../../shell/sky';
import {sound} from '../../shell/sound';
import {usePage} from '../../shell/page';
import {came} from '../../shell/came';
import {handOff} from '../../shell/handoff';
import type {Manifest} from '../../manifest';
import {lazyPage} from '../lazy';
import {centring, chooseColumns, overlaps, placed, type Rect} from './arrange';
import {intent} from './intent';
import {leaning, type Leaning} from './lean';
import '../../styles/box.css';
import './Shelf.css';

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

/* Opening is the transition. The lid goes up, the box comes toward you, and
   only then does the address change — so the next page arrives as the inside
   of the thing you just opened rather than as a page load.

   With more than one box on the table, the one you took first goes to the
   middle of the room, at its full size, while the others fade: opened where
   it stood it grew across its neighbour, and finished off-centre where the
   next page has it centred. Only then does it open. Coming back is the same
   in reverse: the open-box page shuts the lid in the middle, and the shelf
   starts from there, puts it back in its place and lets the others back in. */
const OPENING_MS = 760;
const TRAVEL_MS = 380;
/* How long the others take to come back out from behind a box put back. */
const ARRIVING_MS = 1300;
/* How large the boxes stand on the table: three quarters of the size they
   open to, which grows with the screen -- a fixed size was a third of a
   laptop and a tenth of a large monitor, two small boxes crowding each other
   in the middle of it. The table is scaled as a whole, so every box keeps its
   own geometry -- the last frame of an opening is still the open page's
   first. */
const REST = 0.75;
/* The space between two boxes, either way, as a share of a box's width: the
   110 px a desk has always had at full size, and the same proportion on a
   phone, whose boxes are narrower. */
const GAP = 0.2;
/* How far clear of the rail's knobs the boxes stand where they would reach
   under it -- a phone, whose column of boxes starts under the rail. */
const CLEAR = 12;

/* The rail's knobs, without the gutter round them that takes stray presses. */
function railKnobs(): Rect | null {
  const rail = document.querySelector<HTMLElement>('[data-rail]');
  if (!rail) return null;
  const b = rail.getBoundingClientRect(), cs = getComputedStyle(rail);
  const k = {left: b.left + parseFloat(cs.paddingLeft), right: b.right - parseFloat(cs.paddingRight),
             top: b.top + parseFloat(cs.paddingTop), bottom: b.bottom - parseFloat(cs.paddingBottom)};
  return k.right > k.left && k.bottom > k.top ? k : null;
}

export default function Shelf({games}: {games: Manifest[]}) {
  const navigate = useNavigate();
  const sky = useRef<HTMLCanvasElement>(null);
  const room = useRef<HTMLElement>(null);
  const table = useRef<HTMLDivElement>(null);
  /* Arriving — a fresh load, or the router handing this page back — the box is
     shut, and nothing animates it shut: it is drawn primed, fitted, and only
     then allowed to move. This is what `pageshow` did between documents. */
  const [priming, setPriming] = useState(true);
  const [opening, setOpening] = useState('');
  const many = games.length > 1;
  /* The box we came back from, shut in the middle of the room: the page
     starts with it there and lets it go home once it is drawn. */
  const [returning, setReturning] = useState(() => {
    const at = came.at.split('/')[1] ?? '';
    const slug = games.find((g) => g.path === at)?.slug ?? '';
    return many && slug
      && !matchMedia('(prefers-reduced-motion: reduce)').matches ? slug : '';
  });
  /* And the others come out from behind it: they start in the middle, a
     little further back, and travel to their places as it travels to its,
     fading in slowly enough to be seen arriving. Held for the length of that. */
  const [arriving, setArriving] = useState(!!returning);
  // The box that came back, which stays in front until the others are home.
  const [home] = useState(returning);
  useEffect(() => {
    if (returning || !arriving) return;
    const done = setTimeout(() => setArriving(false), ARRIVING_MS);
    return () => clearTimeout(done);
  }, [returning, arriving]);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);

  usePage('shelf');

  /* Every installed game's first page, fetched while somebody is still looking
     at the table. Opening one is a lid going up and then an address change
     inside a single frame, and a chunk that has not arrived by then is a box
     that opens onto nothing. */
  useEffect(() => {
    for (const game of games) for (const door of game.routes()) lazyPage(door.load).warm();
  }, [games]);

  useEffect(() => (sky.current ? startSky(sky.current) : undefined), []);

  /* The size it opens to, worked out by the shared fitter so that this and
     the inside of the box are the same object at the same size.
     Fitted against the window, not against <main> — main is only as tall as
     the box inside it, so measuring against it shrinks the box towards zero. */
  const still = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Each box turning to a mouse that comes near it (lean.ts): placed by
     every measure, and started before the first, which is a layout effect. */
  const leaner = useRef<Leaning | null>(null);
  useLayoutEffect(() => {
    const l = leaning();
    leaner.current = l;
    return () => {
      l.dispose();
      leaner.current = null;
    };
  }, []);
  // The size the boxes may rest at, at most, as the last measure found it.
  const capped = useRef(Infinity);
  const measure = useCallback((resizing = false) => {
    const t = table.current, main = room.current;
    if (!t || !main) return;
    /* A window being resized is measured on every step, and each measure
       swaps the table to full size and back. Read in between, that swap is a
       change the browser animates -- the boxes swelled to full size and sank
       back on every step of a dragged edge. So while it is being resized
       nothing on the table animates, until a moment after the last step. */
    if (resizing) {
      t.classList.add('still');
      if (still.current) clearTimeout(still.current);
      still.current = setTimeout(() => t.classList.remove('still'), 200);
    }
    /* Everything is measured at full size, which is the size a box opens
       from the middle at, and with each box in its resting state: classes
       swapped and put back inside one task, so nothing is ever drawn so. */
    t.classList.add('fitting');
    const r = main.getBoundingClientRect(), cs = getComputedStyle(main);
    const [pl, pr, pt, pb] = [cs.paddingLeft, cs.paddingRight, cs.paddingTop, cs.paddingBottom].map(parseFloat);
    const cx = r.left + pl! + (r.width - pl! - pr!) / 2, cy = r.top + pt! + (r.height - pt! - pb!) / 2;
    const objs = [...t.querySelectorAll<HTMLElement>('.object')];
    const was = objs.map((obj) => obj.className);
    for (const obj of objs) obj.className = 'object priming';
    /* Where the boxes rest is the window, not the room the open box is fitted
       into: that keeps a strip along the bottom for the app's drawer, which
       this page has not got, and boxes centred over it stood high, the empty
       half of the window under them. The same margin all round. */
    const space: Rect = {left: r.left + pl!, right: r.right - pr!, top: r.top + pt!, bottom: r.bottom - pt!};
    const drawn = (of: HTMLElement): Rect => {
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const part of of.querySelectorAll<HTMLElement>('.face, .lid')) {
        const b = part.getBoundingClientRect();
        left = Math.min(left, b.left); right = Math.max(right, b.right);
        top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom);
      }
      return {left, right, top, bottom};
    };
    const group = () => drawn(t);
    const fits = (g: Rect, into: Rect, most = Infinity) => Math.min(most,
      ((into.right - into.left) * 0.94) / (g.right - g.left), ((into.bottom - into.top) * 0.92) / (g.bottom - g.top));
    /* How many to a row: each balanced layout tried at full size, and the
       one that stands the boxes largest, along the window (see arrange.ts). */
    const w = objs[0]?.offsetWidth ?? 0;
    const gap = Math.round(w * GAP);
    t.style.setProperty('--gap', `${gap}px`);
    const lay = (cols: number) => void (t.style.width = `${cols * w + (cols - 1) * gap}px`);
    const choose = () => chooseColumns(objs.length, (n) => {
      lay(n);
      const g = group();
      return g.right > g.left && g.bottom > g.top ? fits(g, space, capped.current) : 0;
    }, space.right - space.left >= space.bottom - space.top);
    /* Each box's way to the middle, and the size it opens to there, which
       caps the size it rests at -- and so decides, between two layouts that
       would both stand larger than that, that they are the same size. */
    // Where each box is drawn at full size, level: what it leans by (lean.ts).
    const own: Rect[] = [];
    const toMiddle = () => {
      let opens = Infinity;
      for (const [i, obj] of objs.entries()) {
        // The way to the middle of the room, from where the table put it: its
        // own rectangle with its own transform off. (Offsets would count from
        // the table, which a transform makes their parent.)
        obj.style.transform = 'none';
        const at = obj.getBoundingClientRect();
        own[i] = drawn(obj);
        obj.style.transform = '';
        obj.style.setProperty('--to-x', `${Math.round(cx - (at.left + at.width / 2))}px`);
        obj.style.setProperty('--to-y', `${Math.round(cy - (at.top + at.height / 2))}px`);
        opens = Math.min(opens, fitOpenBox(obj, main, 'opening') ?? Infinity);
      }
      return REST * (Number.isFinite(opens) ? opens : 1);
    };
    let cols = w > 0 ? choose() : 0;
    if (cols) lay(cols);
    let most = toMiddle();
    // The first measure has no cap to choose by yet, and a new cap can change
    // the choice: chosen again, and laid again if it did.
    if (cols && most !== capped.current) {
      capped.current = most;
      const again = choose();
      lay(again);
      if (again !== cols) most = toMiddle();
      cols = again;
    }
    capped.current = most;
    // The table at rest: REST of the open size, all of it in the window, the
    // group in its middle -- and clear of the rail where it would reach under
    // its knobs, centred in what the rail leaves.
    const g = group();
    if (g.right > g.left && g.bottom > g.top) {
      const tb = t.getBoundingClientRect();
      const origin = {x: tb.left + tb.width / 2, y: tb.top + tb.height / 2};
      let rest = fits(g, space, most);
      let by = centring(g, rest, origin, space);
      const knobs = railKnobs();
      if (knobs && overlaps(placed(g, rest, origin, by), {
        left: knobs.left - CLEAR, right: knobs.right + CLEAR, top: knobs.top - CLEAR, bottom: knobs.bottom + CLEAR,
      })) {
        const below = {...space, top: Math.max(space.top, knobs.bottom + CLEAR)};
        rest = fits(g, below, most);
        by = centring(g, rest, origin, below);
      }
      t.style.setProperty('--rest', rest.toFixed(3));
      t.style.setProperty('--rest-x', `${Math.round(by.x)}px`);
      t.style.setProperty('--rest-y', `${Math.round(by.y)}px`);
      // And each box where it stands at rest, for it to lean from there.
      leaner.current?.place(objs.map((el, i) => ({el, rect: placed(own[i]!, rest, origin, by)})));
    }
    objs.forEach((obj, i) => void (obj.className = was[i]!));
    t.classList.remove('fitting');
    // Settled here, while nothing may animate, rather than in the next frame.
    void getComputedStyle(t).transform;
  }, []);

  /* Before the first paint, not after: coming back, that paint is the box
     shut in the middle of the room, and it can only be put there measured. */
  useLayoutEffect(() => {
    measure();
    // Two frames, then it may move: fitting during the first paint measures a
    // page that has not settled, and the box lands on one size and springs to
    // another.
    const f = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        measure();
        setPriming(false);
        // A frame drawn at the middle with transitions on, then home.
        requestAnimationFrame(() => requestAnimationFrame(() => setReturning('')));
      }),
    );
    const resized = () => measure(true);
    for (const ev of ['resize', 'orientationchange']) addEventListener(ev, resized);
    window.visualViewport?.addEventListener('resize', resized);
    return () => {
      cancelAnimationFrame(f);
      if (still.current) clearTimeout(still.current);
      for (const ev of ['resize', 'orientationchange']) removeEventListener(ev, resized);
      window.visualViewport?.removeEventListener('resize', resized);
    };
  }, [measure]);

  useEffect(() => () => void (leaving.current && clearTimeout(leaving.current)), []);

  const open = (e: React.MouseEvent, slug: string) => {
    const to = `/${games.find((g) => g.slug === slug)?.path ?? slug}`;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let the browser have it
    e.preventDefault();
    /* Somebody who has asked not to be moved is not made to watch a lid: the
       address changes now. Between documents this was left to the browser's
       own navigation; in one document there is nobody else to hand it to. */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate(to);
      return;
    }
    // The catch, then the air: a click for the mechanism and a long breath
    // for the movement it starts, running under the whole transition.
    sound.latch();
    setTimeout(() => sound.whoosh(), 150);
    setOpening(slug);
    leaving.current = setTimeout(() => {
      /* What the two documents got from the browser, asked for by hand: the
         router will not start a view transition for us, and startViewTransition
         wants the DOM changed by the time its callback returns. The box is
         the same on both sides, so it is handed over rather than crossfaded
         (shell/handoff.ts). */
      handOff(() => flushSync(() => navigate(to)));
    }, OPENING_MS + (many ? TRAVEL_MS : 0));
  };

  /* The peek: a box lifts its lid for a pointer that rests on it, not for
     one passing over (intent.ts). Never while the table is moving -- a box
     coming home under a pointer left where the lid was pressed is not being
     looked at. */
  const [peek, setPeek] = useState('');
  const moving = priming || !!opening || !!returning || arriving;
  const [eye] = useState(() => intent((slug) => {
    setPeek(slug);
    // The lid creaks as it lifts -- which is also how you learn your speakers
    // are live, and at what level, before anything says a word.
    if (slug) sound.hover();
  }));
  useEffect(() => () => eye.dispose(), [eye]);
  useEffect(() => void (moving && eye.reset()), [moving, eye]);
  /* Nor does a box lean while the table moves: those boxes are on their own
     transforms, and the ones coming out from behind are on a transition a
     changed lean would start over. They lean again from where they stand. */
  useLayoutEffect(() => leaner.current?.hold(moving), [moving]);
  /* A mouse or a pen, and moving: a touch has no hover to rest, and a pointer
     that has not moved since the page changed under it is not looking. */
  const looking = (e: React.PointerEvent) =>
    e.pointerType !== 'touch' && !moving && (e.movementX !== 0 || e.movementY !== 0);

  const focus = opening || returning;
  /* Which box is in front while any of them move: the one being opened, or
     the one put back until the others are home. Without it the page's order
     decided, and a box opened first in it went under the one fading away. */
  const front = opening || returning || (arriving ? home : '');

  return (
    <>
      <canvas id="sky" ref={sky} />
      <main ref={room}>
        <div
          className={`table${priming ? ' priming' : ''}${focus ? ' focus' : ''}`}
          ref={table}
          style={{'--travel': `${many ? TRAVEL_MS : 0}ms`} as React.CSSProperties}
        >
          {games.map((app) => (
            <a
              key={app.slug}
              data-game={app.slug}
              className={`object${priming ? ' priming' : ''}${opening === app.slug ? ' opening' : ''}${
                returning === app.slug ? ' returning' : ''}${focus && focus !== app.slug ? ' away' : ''}${
                returning && returning !== app.slug ? ' behind' : ''}${arriving && !returning && opening !== app.slug ? ' arriving' : ''}${
                front ? (front === app.slug ? ' front' : ' back') : ''}${peek === app.slug ? ' peek' : ''}`}
              href={href(`/${app.path}`)}
              aria-label={`${app.name} — ${app.blurb}`}
              // The lid creaks as it peeks (above), and under a finger as it is
              // touched, as it always has: a quiet shift of something heavy as
              // it turns; the lid keeps its own sound for when it opens.
              onPointerEnter={(e) => void (e.pointerType === 'touch' && sound.hover())}
              onPointerMove={(e) => void (looking(e) && eye.enter(app.slug))}
              onPointerLeave={() => eye.leave(app.slug)}
              onClick={(e) => open(e, app.slug)}
            >
              {/* An app, as an object you can open. The name is engraved on
                  the lid rather than printed under it; the faces are elements
                  rather than a texture, so whatever the app puts inside its own
                  box is real HTML in a real box. */}
              <div className="box">
                <div className="face floor" />
                <div className="face w-back" />
                <div className="face w-front">
                  <i className="clasp">
                    <Cut />
                    <b />
                  </i>
                </div>
                <div className="face w-left" />
                <div className="face w-right" />
                <div className="lamp" />
                <div className="contents" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="lid">
                  <div className="out">
                    <i className="bracket b1" />
                    <i className="bracket b2" />
                    <i className="bracket b3" />
                    <i className="bracket b4" />
                    <div className="plaque">
                      <Cut />
                      <span>{app.name}</span>
                    </div>
                    <i className="filigree" />
                  </div>
                  <div className="in" />
                </div>
              </div>
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
