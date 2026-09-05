import {useCallback, useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {useNavigate} from 'react-router';
import {fitOpenBox} from '../../shell/fit';
import {startSky} from '../../shell/sky';
import {sound} from '../../shell/sound';
import {usePage} from '../../shell/page';
import type {Manifest} from '../../manifest';
import {lazyPage} from '../lazy';
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
   of the thing you just opened rather than as a page load. */
const OPENING_MS = 760;

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
  const measure = useCallback(() => {
    for (const obj of table.current?.querySelectorAll<HTMLElement>('.object') ?? [])
      fitOpenBox(obj, room.current, 'opening');
  }, []);

  useEffect(() => {
    measure();
    // Two frames, then it may move: fitting during the first paint measures a
    // page that has not settled, and the box lands on one size and springs to
    // another.
    const f = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        measure();
        setPriming(false);
      }),
    );
    for (const ev of ['resize', 'orientationchange']) addEventListener(ev, measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(f);
      for (const ev of ['resize', 'orientationchange']) removeEventListener(ev, measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => () => void (leaving.current && clearTimeout(leaving.current)), []);

  const open = (e: React.MouseEvent, slug: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let the browser have it
    e.preventDefault();
    /* Somebody who has asked not to be moved is not made to watch a lid: the
       address changes now. Between documents this was left to the browser's
       own navigation; in one document there is nobody else to hand it to. */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate(`/${slug}`);
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
         wants the DOM changed by the time its callback returns. */
      if (document.startViewTransition)
        document.startViewTransition(() => flushSync(() => navigate(`/${slug}`)));
      else navigate(`/${slug}`);
    }, OPENING_MS);
  };

  return (
    <>
      <canvas id="sky" ref={sky} />
      <main ref={room}>
        <div className="table" ref={table}>
          {games.map((app) => (
            <a
              key={app.slug}
              className={`object${priming ? ' priming' : ''}${opening === app.slug ? ' opening' : ''}`}
              href={`/${app.slug}`}
              aria-label={`${app.name} — ${app.blurb}`}
              // The lid creaks when you come near it. That is also how you
              // learn your speakers are live and at what level, before it ever
              // says anything. A quiet shift of something heavy as it turns;
              // the lid keeps its own sound for when it actually opens.
              onPointerEnter={() => sound.hover()}
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
