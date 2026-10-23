/* The corners.

   Four controls, in one corner, on every screen: what you can hear, how to put
   this in your pocket, the fact that none of it leaves the room, and the way
   under the hood. Built here rather than written into each page, because three
   copies of a control is three copies of a bug.

   One corner rather than three. Scattering them meant three things to find and
   three edges for the eye to check, and on a page whose whole subject is in the
   middle they read as litter round the frame. Stacked, they are a single small
   object you learn once. */
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {CSSProperties} from 'react';
import {host} from '../../host';
import {hatch} from '../../shell/console';
import {onVoiceOffer, voiceOffer, voiceOfferVersion} from '../../shell/offer';
import type {VoiceOffer} from '../../shell/offer';
import {matrix} from '../../shell/qr';
import {RunOnMac} from '../Limits/Limits';
import {useInBrowser} from '../Limits/use';
import {sound} from '../../shell/sound';
import type {RailNotes} from '../../manifest';
import s from './Rail.module.css';

/* A press on the rail's gutter, not on a knob, that lands over a control of
   the page's own which takes its presses ([data-own-press]: the gear in the
   corner of Talk's lid, on a phone where that corner lies under the gutter)
   is that control's: aimed at something there, it is not a missed knob. Any
   other press there is still swallowed. Found by its rectangle rather than by
   hit-testing, which inside the box's 3-D subtree is not to be trusted on an
   iPhone (see the shut-zone in @lucid/ui's Box). */
const through = (e: React.MouseEvent<HTMLElement>) => {
  if (e.target !== e.currentTarget) return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-own-press]')) {
    if (e.currentTarget.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      el.click();
      return;
    }
  }
};

const subscribe = (fn: () => void) => hatch.subscribe(fn);
const version = () => hatch.version;

const Speaker = ({on}: {on: boolean}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4z" />
    {on
      ? <><path d="M15.4 9.2a4 4 0 0 1 0 5.6" /><path d="M18 6.6a7.6 7.6 0 0 1 0 10.8" /></>
      : <path d="M16 10l4.5 4.5M20.5 10L16 14.5" />}
  </svg>
);

const Phone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="2.5" width="10" height="19" rx="2.4" /><path d="M11 18.6h2" />
  </svg>
);

const Term = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="4" width="19" height="16" rx="2.2" />
    <path d="M6.5 9.5L9.5 12l-3 2.5" /><path d="M12.5 15h5" />
  </svg>
);

const Eye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.6" /><path d="M4 20L20 4" />
  </svg>
);

/** The line under the voice's switch, which is on or off and nothing else:
    the download is the first-open card's, beside the language model's, and a
    press on a voice that is not here yet opens that card. */
function offered(o: VoiceOffer): {name: string; line: string} {
  if (o.missing) {
    const size = o.mb >= 1000 ? `${(o.mb / 1000).toFixed(1)} GB` : `${o.mb} MB`;
    return {name: 'Voices off', line: `${o.what} is not downloaded — ${size}, on the card a press opens`};
  }
  if (!o.on) return {name: 'Voices off', line: o.what};
  if (o.state === 'error') return {name: 'Voices failed', line: o.why || 'it would not load'};
  if (o.silent) {
    return {name: 'Voices on', line: o.state === 'off'
      ? `${o.what} — waits for the sound to come back`
      : `${o.what} — let go of soon while the sound is off`};
  }
  if (o.state === 'fetching') return {name: 'Voices on', line: `${o.what} — loading`};
  if (o.state === 'off') return {name: 'Voices on', line: `${o.what} — loads when a pill speaks`};
  return {name: 'Voices on', line: `${o.what}, in this browser`};
}

/** The eye's panel in a browser, short, and about the whole of Lucid Dream,
    since the rail is on every page: what holds here, that the game's AI is
    smaller here and some of it off, and the steps to the full thing. No list
    of parts: each says so where it is met (its mark and its note). A browser
    that cannot run the AI at all is told that instead of "smaller", which
    there would not be true. */
function BrowserTale({none}: {none: boolean}) {
  return (
    <>
      <b>Nothing leaves this browser.</b>
      <p>No account, and nobody on the other end. What you play and the models stay here.</p>
      <p className={s.full}>
        {none ? 'This browser can’t run the game’s AI — try Chrome, Edge or Safari. '
          : 'Here the game’s AI runs smaller, with some of it off. '}
        For the full experience — still offline, still private — run it on your Mac.
      </p>
      <RunOnMac lede={false} />
    </>
  );
}

interface Where {phone?: boolean; urls?: string[]}
/** What the phone panel draws: the code, and which machine it reaches. */
interface Pocket {host: string; code: boolean[][] | null}

const INTERFACE = 'How loud the interface and the voice are.';
/* The console's knob. What it shows is whatever runs this page: the machine,
   or -- with nothing behind the page -- this browser's own model, voice and ear. */
const CONSOLE = (browser: boolean) => `The console — what ${browser ? 'this browser' : 'the machine'} is doing, `
  + 'and how to tell it to do something. Type / in it for the list.';

export default function Rail({where = '', app = '', at = '', notes = {}}: {where?: string; app?: string; at?: string; notes?: RailNotes}) {
  /* What the page says about itself: whether the promise holds here, what the
     speaker is turning up, and whether its own controls sit along the top. */
  const {offline = true, speaker = INTERFACE, inline = false} = notes;
  const rail = useRef<HTMLDivElement>(null);

  /* Inline, the row's width is the page's business: it ends its own row a gap
     short of it. Measured rather than counted, since the phone knob comes and
     goes with the machine. */
  useEffect(() => {
    const el = rail.current;
    if (!inline || !el) return;
    const root = document.documentElement;
    const said = () => {
      const c = getComputedStyle(el);
      const span = el.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight);
      root.style.setProperty('--rail-span', `${Math.max(0, span)}px`);
    };
    said();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(said);
    watch?.observe(el);
    return () => { watch?.disconnect(); root.style.removeProperty('--rail-span'); };
  }, [inline]);
  useSyncExternalStore(subscribe, version, version);
  /* A voice this page could run itself, offered by whoever can: nothing on a
     page with a machine behind it, whose voice is simply there. */
  useSyncExternalStore(onVoiceOffer, voiceOfferVersion, voiceOfferVersion);
  const offer = voiceOffer();
  /* A page with no machine behind it: the eye says what is true here. */
  const browser = useInBrowser();
  const [pop, setPop] = useState<'audio' | 'phone' | 'off' | null>(null);
  const [level, setLevel] = useState(sound.level);
  const [hush, setHush] = useState(sound.hush);
  const [calm, setCalm] = useState(sound.calm);
  /** The first address the machine says it answers on, once it has said. */
  const [reaches, setReaches] = useState('');
  const slider = useRef<HTMLInputElement>(null);

  /* Where the page is standing, said again whenever it moves. `where` alone is
     not enough: a game reports the same word for its front door and for the
     shelf, so walking into one changed nothing here and the console went on
     asking for the commands that make sense nowhere. */
  useEffect(() => { hatch.start(where, app); }, [where, app, at]);

  // ---- one popover open at a time ----
  useEffect(() => {
    const away = () => setPop(null);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    document.addEventListener('click', away);
    addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', away);
      removeEventListener('keydown', escape);
    };
  }, []);

  // ---- which machine, asked once ----
  useEffect(() => {
    let gone = false;
    /* A page with no machine behind it has no phone to offer: the address it
       is on is already the one a phone would open. */
    if (!host().machine) return;
    fetch('/shared/where').then(r => r.json() as Promise<Where>).then(w => {
      if (gone || !w.phone || !w.urls?.length) return;      // started without a phone
      setReaches(w.urls[0]!);
    }).catch((e: unknown) => {
      // The knob simply stays hidden, which looks identical to a machine that
      // was started without phone access. Worth one line to tell them apart.
      hatch.say('could not ask about phone access — '
                + (e instanceof Error ? e.message : String(e)), 'debug');
    });
    return () => { gone = true; };
  }, []);

  /* ---- and the picture, redrawn wherever the page goes ----
     The code carries the whole address, path and all, so scanning it from a
     conversation opens that conversation in your hand rather than the front
     door. Which it only does if it is drawn again when the address changes:
     built once, at the moment the machine answered, it was the front door for
     the rest of the evening — and on a phone, the address you scanned from the
     shelf. The line underneath is only there to tell you which machine you are
     about to reach, so it is just the host. */
  const pocket = useMemo<Pocket | null>(() => {
    if (!reaches) return null;
    let code: boolean[][] | null = null;
    try { code = matrix(reaches + at); } catch { code = null; }
    return {host: reaches.replace(/^https?:\/\//, ''), code};
  }, [reaches, at]);

  // Dragging fires input every few pixels, and a tick per event is a
  // machine-gun. The drag itself is silent; letting go plays one short breath at
  // the level you landed on, which is what you were listening for. The release
  // is the element's own change event, which React does not forward.
  useEffect(() => {
    const el = slider.current;
    if (!el) return;
    const landed = () => sound.whoosh({dur: 0.42, peak: 0.4});
    el.addEventListener('change', landed);
    return () => el.removeEventListener('change', landed);
  }, []);

  const apply = useCallback((v: number) => {
    sound.setLevel(v);
    setLevel(sound.level);
    // No tick of its own: the press that got here already made one. It used to
    // add a second, and a press that answers twice reads as a stutter.
  }, []);

  const toggle = (which: 'audio' | 'phone' | 'off') =>
    setPop(was => (was === which ? null : which));

  const quiet = hush || level === 0;
  const codeStyle = {'--n': pocket?.code?.length ?? 25} as CSSProperties;

  return (
    <div className={s.corners}>
      {/* One rail, in one corner, in the order you would reach for them: what
          you can hear, how to take it with you, what it promises, and the way
          under the hood. */}
      <div ref={rail} data-rail className={`${s.rail} ${inline ? s.inline : ''}`} onClick={through}>
        {/* ---- what you can hear ---- */}
        <div className={`${s.corner} ${pop === 'audio' ? s.open : ''}`}>
          <button className={`${s.knob} ${quiet ? s.muted : ''}`}
                  aria-label={speaker}
                  title={speaker}
                  onPointerEnter={() => sound.hover()}
                  onClick={e => { e.stopPropagation(); toggle('audio'); }}>
            <Speaker on={!quiet} />
          </button>
          <div className={`${s.pop} ${s.vol}`} onClick={e => e.stopPropagation()}>
            {/* One press for "not now". It takes the interface *and* the voice,
                which is the only version of a mute anybody means when they reach
                for one in a hurry — and the voice is the loud thing. It plays no
                sound of its own going on, for the obvious reason, and one going
                off so you know it came back. */}
            <button className={`${s.hush} ${hush ? s.on : ''}`} type="button" data-quiet
                    onClick={e => {
                      e.stopPropagation();
                      sound.setHush(!sound.hush);
                      setHush(sound.hush);
                      if (!sound.hush) sound.tick();
                    }}>
              <Speaker on={!hush} />
              {/* A verdict under the name, in both states. Everybody knows what
                  a mute does, so the line is never about the mechanism: before,
                  that we would rather they did not; after, what they are left
                  with. */}
              <span className={s.what}>
                <b>{hush ? 'Muted' : 'Mute everything'}</b>
                <em>{hush ? 'the game is boring' : 'not recommended'}</em>
              </span>
            </button>
            {/* A page with no machine: the voices are a download, and this is
                where somebody who wants sound asks for them. Says what it costs
                before the press and how far it has come after. */}
            {offer && (() => {
              const {name, line} = offered(offer);
              return (
                <button className={`${s.hush} ${s.voices} ${offer.on ? s.on : ''}`} type="button"
                        data-quiet aria-pressed={offer.on}
                        onClick={e => { e.stopPropagation(); offer.set(!offer.on); sound.tick(); }}>
                  <Speaker on={offer.on && offer.state === 'ready'} />
                  <span className={s.what}><b>{name}</b><em>{line}</em></span>
                </button>
              );
            })()}
            <div className={s.stepper}>
              <button className={s.step} aria-label="quieter"
                      onClick={e => { e.stopPropagation(); apply(sound.level - 0.1); }}>&minus;</button>
              <input type="range" min="0" max="100" step="1" aria-label="volume"
                     ref={slider}
                     value={Math.round(level * 100)}
                     onChange={e => apply(+e.target.value / 100)} />
              <button className={s.step} aria-label="louder"
                      onClick={e => { e.stopPropagation(); apply(sound.level + 0.1); }}>+</button>
            </div>
            {/* Joe mode: the clicks and the air step back, the voice does not.
                Ticking it plays a tick, so you hear the difference you just
                asked for. */}
            <label className={s.calm} data-quiet
                   title="interface sounds at half; the voice is untouched">
              <input type="checkbox" checked={calm}
                     onChange={e => { sound.setCalm(e.target.checked); setCalm(sound.calm); sound.tick(); }} />
              {' '}Calm interface
            </label>
          </div>
        </div>

        {/* ---- take it with you ---- */}
        <div className={`${s.corner} ${pop === 'phone' ? s.open : ''}`} hidden={!pocket}>
          <button className={s.knob}
                  aria-label="Open this on your phone — scan the code, same wifi, no account."
                  title="Open this on your phone — scan the code, same wifi, no account."
                  onPointerEnter={() => sound.hover()}
                  onClick={e => { e.stopPropagation(); toggle('phone'); }}>
            <Phone />
          </button>
          <div className={`${s.pop} ${s.qr}`} onClick={e => e.stopPropagation()}>
            <b>Play on phone</b>
            <div className={s.code} style={codeStyle}>
              {pocket?.code
                ? pocket.code.flat().map((on, i) => <i key={i} className={on ? s.on : ''} />)
                : 'could not draw the code — the address is below'}
            </div>
            <div className={s.url}>{pocket?.host}</div>
          </div>
        </div>

        {/* ---- none of this leaves the room ----
            No caption any more. It said OFFLINE in the corner, which reads as a
            status — something that might one day say the other thing — when it
            is actually a promise about how the program is built. The crossed eye
            says that on its own, and the panel says it in words for anyone who
            asks. */}
        <div className={`${s.corner} ${pop === 'off' ? s.open : ''}`} hidden={!offline}>
          <button className={s.knob}
                  aria-label={browser ? 'Nothing leaves this browser. Nobody is on the other end.'
                    : 'Nothing leaves this machine. Nobody is on the other end.'}
                  title={browser ? 'Nothing leaves this browser. Nobody is on the other end.'
                    : 'Nothing leaves this machine. Nobody is on the other end.'}
                  onPointerEnter={() => sound.hover()}
                  onClick={e => { e.stopPropagation(); toggle('off'); }}>
            <Eye />
          </button>
          <div className={`${s.pop} ${s.tale} ${browser ? s.limit : ''}`} onClick={e => e.stopPropagation()}>
            {browser ? <BrowserTale none={host().llm === 'none'} /> : (
              <>
                <b>Nothing leaves this room.</b>
                <p>No account. No key. Nobody on the other end. The drugs and the dreams
                   stay on this machine — pull the plug on the network and nothing here
                   notices.</p>
              </>
            )}
          </div>
        </div>

        {/* ---- the console ----
            Not a popover like the other three: it is a sheet that comes down
            over the page, so it belongs to the document rather than to the rail.
            What lives here is the way in — and a lamp, because the state of the
            machine is worth knowing at a glance without opening anything. */}
        <div className={s.corner}>
          <button
            className={`${s.knob} ${s.term} ${hatch.trouble ? s.trouble : ''}`}
            // Its own, because the tilde and Escape open it too and they are not
            // presses on anything.
            data-quiet
            aria-label={CONSOLE(browser)}
            title={CONSOLE(browser)}
            onPointerEnter={() => sound.hover()}
            onClick={e => { e.stopPropagation(); hatch.show(!hatch.open); }}
          >
            <Term />
          </button>
        </div>
      </div>
    </div>
  );
}
