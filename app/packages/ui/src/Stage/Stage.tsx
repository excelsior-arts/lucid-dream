/* A stage, and what happens when there is not one.
 *
 * The 3D bootstrap: probe, build, and the flat fallback. It owns the scene's
 * handle for as long as the route is on screen and gives it back on the way
 * out, which is the whole of what React adds here. The rest is one sequence
 * in one order, because the order is the design: the probe before anything is
 * fetched, the patience timer around all of it, the void painted before
 * anything is mounted into it.
 *
 * What is *in* the scene is not this file's business and never was. It used
 * to import the engine by name, which made a mechanic every game reuses
 * depend on one game's idea of a room; `mount` is a prop now — a function the
 * game hands in, which fetches whatever it needs and builds it into the three
 * elements below. So a second game with a scene of its own gets the probe,
 * the patience and the flat page for nothing, and this file goes on knowing
 * only that a scene can be stopped.
 */
import {useEffect} from 'react';
import type {RefObject} from 'react';
import {hatch} from '@lucid/shell';
import './Stage.css';

/** The one thing a stage reads of a scene's own description: the color of the
    void it stands in. Everything else in there is the game's, and is handed
    straight back to `mount` unopened. */
export type Dressing = {palette?: {void?: number}};

/** Where a scene is built: the room's element, the conversation's plane, and
    what stands in front of it. */
export interface Into {
  stage: HTMLElement;
  glass: HTMLElement;
  under: HTMLElement | null;
}

/** And what comes back from building one — the least a stage needs it to be.
    `stop()` gives the loop and the GPU back; `room` is told, once, what the
    page knows and the scene cannot. What is on either of them is the game's,
    so this says nothing more about them than the two lines below use. */
export interface Scene {
  stop(): void;
  room: {knows(told: unknown): void};
  renderer?: unknown;
}

export interface Props<D extends Dressing = Dressing, S extends Scene = Scene> {
  /** Whose room this is. Only ever said back in a message about it. */
  slug: string;
  /** The scene's own description, fetched when there is something to build it
      with. A room is furniture for a character, which makes it the game's;
      this is the stage it stands on and it has never heard of a character.
      Left out, whatever `mount` defaults to is the room. */
  spec?: (slug: string) => Promise<D>;
  /** The game's own: fetch the engine, build the scene into those three
      elements, hand back something that can be stopped. Asked for only after
      the probe below has said this browser can draw at all, so a machine that
      cannot never downloads it. */
  mount: (dressing: D, into: Into) => Promise<S>;
  /** What has to arrive before a room can be built -- the code of the room,
      which is fetched when a room is first opened and may be most of the
      application. Awaited with the patience switched off: a download is not
      a room that has stalled, and a page that gave up eight seconds into a
      slow one drew the flat page and then ignored the room when it came. */
  fetch?: () => Promise<unknown>;
  /** The conversation's own plane. Laid on the window by the projection. */
  glass: RefObject<HTMLElement | null>;
  /** What stands in front of it, so the last line can keep clear. */
  under: RefObject<HTMLElement | null>;
  /** What the page knows and the scene does not, the moment it is built. */
  told: () => unknown;
  /** The handle, for the route to talk to and to put on the debug shelf. */
  onRoom: (handle: S | null) => void;
}

/* The phone's own bands, and the page behind everything, in the color of the
   room they are framing. Both are the void the room stands in: the thing you
   would see if the walls gave out, which is exactly what is past the edges of
   the screen.

   Both are given back on the way out, and by the same hand that took them.
   The background used to be put right by the route and the meta tag by
   nobody, so leaving a room left the phone's bands the color of a room that
   is no longer on screen — for the rest of the evening, since nothing else
   ever writes that tag. */
function paintEdges(dressing: Dressing): (() => void) | null {
  const hex = dressing.palette?.void;
  if (typeof hex !== 'number') return null;
  const css = '#' + hex.toString(16).padStart(6, '0');
  const root = document.documentElement;
  const was = root.style.background;
  root.style.background = css;
  const tag = document.querySelector('meta[name=theme-color]');
  const wasTag = tag instanceof HTMLMetaElement ? tag.content : null;
  if (tag instanceof HTMLMetaElement) tag.content = css;
  return () => {
    root.style.background = was;
    if (tag instanceof HTMLMetaElement && wasTag !== null) tag.content = wasTag;
  };
}

/* How long a room may take to build once its code is here, and how long the
   code may take to arrive. The first is a decision about a machine that
   cannot draw; the second is a download and is only there so a page is never
   waiting forever on a link that went away. */
const PATIENCE_MS = 8000;
const FETCH_MS = 120000;

export default function Stage<D extends Dressing, S extends Scene>(
  {slug, spec, mount, fetch, glass, under, told, onRoom}: Props<D, S>,
) {
  useEffect(() => {
    const root = document.documentElement;
    /* Two of everything, in development: React mounts an effect, tears it
       down and mounts it again to prove it can be. So this cleans up after
       itself completely — the handle is stopped, which takes the canvas with
       it — and everything after an `await` asks whether it is still wanted. */
    let dead = false;
    /* And once: the patience runs out and the page becomes a flat one, which
       is a decision. Everything after an `await` asks this too, because a
       room that arrives late has nowhere to go — the flat page is already on
       screen, `#stage` is `display:none`, and mounting into it builds a
       renderer that runs its animation loop against a canvas nobody will ever
       see, for as long as the route is open. Which is exactly what a slow
       disk or an old integrated card buys you. */
    let gaveUp = false;
    let handle: S | null = null;
    let clear: (() => void) | null = null;
    let unpaint: (() => void) | null = null;
    let letGo: (() => void) | null = null;

    // Without a room. The conversation is the app; the room is what it
    // happens in, and a machine that cannot draw one should still be able to
    // talk.
    const open = () => { if (!dead) root.classList.remove('waking'); };

    function flat(why: string) {
      if (dead) return;
      /* Said once. A second call used to overwrite `clear` with a second
         resize listener's undo and leave the first one attached to the
         window for the life of the page — and there are two ways to get
         here twice: the patience running out and then the import failing,
         or a lost context after either. */
      if (gaveUp) return;
      gaveUp = true;
      root.classList.add('flat');
      open();
      const pane = glass.current, panel = under.current;
      if (pane && panel) {
        // The panel still stands in front of it, and out here nobody is
        // measuring the projection, so the last line is kept clear by hand.
        const fit = () => pane.style.setProperty('--under', panel.offsetHeight + 16 + 'px');
        fit();
        addEventListener('resize', fit);
        const watch = window.ResizeObserver ? new ResizeObserver(fit) : null;
        watch?.observe(panel);
        clear = () => { removeEventListener('resize', fit); watch?.disconnect(); };
      }
      console.warn('lucid: no room —', why);
      /* And into the console, which is where somebody looks. A flat page is
         the app working correctly on a machine that cannot draw — but it is
         also what a broken room looks like, and those two want telling apart
         without opening the browser's own inspector. */
      hatch.say('no room — ' + why, 'error');
    }

    /* If the scene neither arrives nor fails -- a stalled request, a machine
       thinking about it far too long -- the conversation still has to happen.
       Armed only once the room's code is here: the wait for that is a
       download, which on a phone across the wifi can be longer than any
       patience a stalled room deserves, and it has its own, longer limit. */
    let patience: ReturnType<typeof setTimeout> | null = null;
    const wait = (ms: number, why: string) => {
      if (patience) clearTimeout(patience);
      patience = setTimeout(() => {
        if (root.classList.contains('waking')) flat(why);
      }, ms);
    };

    (async () => {
      try {
        // Ask before fetching the engine: an old browser says no here.
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no WebGL');
        if (fetch) {
          wait(FETCH_MS, 'the room never arrived');
          await fetch();
          if (dead || gaveUp) return;
        }
        wait(PATIENCE_MS, 'took too long');

        /* A room that will not load is not a reason to lose the page —
           whatever `mount` builds with nothing is a room. But it used to
           happen in total silence, so a typo in one room's file looked
           exactly like a page that had never been given one. */
        let dressing = {} as D;
        try {
          if (spec) dressing = await spec(slug);
        } catch (e) {
          const why = `${slug}'s room did not load — ${(e as Error)?.message ?? String(e)}`;
          console.warn('lucid:', why);
          hatch.say(why, 'error');
        }
        if (dead || gaveUp) return;
        unpaint = paintEdges(dressing);

        const stage = document.getElementById('stage');
        const pane = glass.current;
        if (!stage || !pane) throw new Error('no stage to build in');
        const built = await mount(dressing, {stage, glass: pane, under: under.current});
        if (dead || gaveUp) { built.stop(); return; }
        handle = built;
        onRoom(built);

        /* What the room cannot know by itself: whose room this is, which run
           of it, how it is set right now, and what the last save says was done
           to it. It arrives once the page has found out, possibly long after
           this — the room is built to be told later. */
        built.room.knows(told());
        open();

        // A context can be taken away long after it was granted — another tab
        // wanting the GPU, a laptop waking up. Then the room goes and what is
        // written on the glass stays.
        const canvas = stage.querySelector('canvas');
        const lost = (e: Event) => {
          e.preventDefault();
          handle?.stop();
          handle = null;
          onRoom(null);
          flat('context lost');
        };
        canvas?.addEventListener('webglcontextlost', lost);
        /* And off again before the room is stopped on the way out, because
           stopping it is what takes the context away now: the engine hands
           the GPU back itself (forceContextLoss), which raises this event.
           Left attached, leaving a room would paint the flat page over the
           one being left. */
        letGo = () => canvas?.removeEventListener('webglcontextlost', lost);
      } catch (e) {
        flat((e as Error)?.message ?? String(e));
      } finally {
        if (patience) clearTimeout(patience);
      }
    })();

    return () => {
      dead = true;
      if (patience) clearTimeout(patience);
      clear?.();
      letGo?.();
      handle?.stop();
      handle = null;
      onRoom(null);
      unpaint?.();
      root.classList.remove('flat');
    };
  }, [slug, spec, mount, glass, under, told, onRoom, fetch]);

  return (
    <>
      {/* The room, rendered into here by the game. Nothing of the app is in it. */}
      <div id="stage" aria-hidden="true" />
      {/* Shown only while it is not yet known whether there is a room. */}
      <div id="waking" aria-hidden="true"><i /></div>
    </>
  );
}
