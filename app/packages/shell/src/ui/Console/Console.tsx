/* The sheet that comes down over whatever is on screen: what the machine is
   doing along the top, everything it has said underneath, and a line to type
   into. On every page, because it is the shell's.

   It is deliberately not a popover like the other three fittings. Those are
   small answers to small questions. This is the place you go when the evening
   is not working, and it wants the width of the window and a scrollback you
   can read. */
import {Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {KeyboardEvent} from 'react';
import {clock, hatch} from '../../shell/console';
import s from './Console.module.css';
import {near} from './near';

const subscribe = (fn: () => void) => hatch.subscribe(fn);
const version = () => hatch.version;

export default function Console() {
  useSyncExternalStore(subscribe, version, version);
  const [line, setLine] = useState('');
  const [pick, setPick] = useState(0);
  const [recall, setRecall] = useState(-1);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Following the tail unless you have scrolled up to read something. A ref
  // rather than state: it is answered on every scroll event and nothing on the
  // page looks different for it.
  const follow = useRef(true);

  const open = hatch.open;
  const rows = hatch.rows;
  const list = useMemo(() => near(line, hatch.commands()), [line]);
  const shown = list.length > 0;

  useEffect(() => {
    document.documentElement.classList.toggle('hatched', open);
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (document.activeElement === input.current) input.current?.blur();
      return;
    }
    follow.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    const at = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(at);
  }, [open]);

  /* Keyed on the newest line rather than on how many there are.

     The ring holds 1200 (console.ts), and once it is full every new line
     pushes an old one out — so the count stops changing, this effect stops
     running, and the console quietly stops following its own tail at exactly
     the moment there is most to follow. The ids only ever go up, so the last
     one names the newest line whether or not anything was dropped to make
     room for it. */
  const newest = rows.length ? rows[rows.length - 1]!.id : -1;
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [newest]);

  /* The tilde, as consoles have opened since Quake — but never while somebody
     is writing, which in this program is most of the time.

     Escape closes it from anywhere, not only from the line you type into:
     having clicked something in the scrollback, the way out should still be the
     key everybody reaches for. Captured, so the sheet takes it before whatever
     is underneath — and only while it is open, or it would be stealing the key
     from the page. */
  useEffect(() => {
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !hatch.open) return;
      e.preventDefault();
      e.stopPropagation();
      hatch.show(false);
    };
    const tilde = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '`' && e.key !== '~') return;
      const el = document.activeElement;
      const typing = el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing && el !== input.current) return;
      e.preventDefault();
      hatch.show(!hatch.open);
    };
    addEventListener('keydown', escape, true);
    addEventListener('keydown', tilde);
    return () => {
      removeEventListener('keydown', escape, true);
      removeEventListener('keydown', tilde);
    };
  }, []);

  const take = useCallback((name: string) => {
    setLine('/' + name + ' ');
    setPick(0);
    input.current?.focus();
  }, []);

  const send = () => {
    const said = line.trim();
    if (!said) return;
    setLine('');
    setRecall(-1);
    setPick(0);
    hatch.send(said);
  };

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    const on = shown ? list[pick] : undefined;
    if (shown && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const i = pick + (e.key === 'ArrowDown' ? 1 : -1);
      setPick((i + list.length) % list.length);
      return;
    }
    if (shown && (e.key === 'Tab' || e.key === 'Enter') && on) {
      /* Enter completes what you started, but runs what you have already
         finished: typing the whole of /where and pressing return should do the
         thing, not politely finish the word you just typed. */
      const typed = line.slice(1).split(' ')[0]!.toLowerCase();
      if (e.key === 'Enter' && hatch.commands().some(o => o.name === typed)) {
        e.preventDefault();
        send();
        return;
      }
      e.preventDefault();
      take(on.name);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {         // what you typed before
      if (!hatch.past.length) return;
      e.preventDefault();
      const i = e.key === 'ArrowUp' ? Math.min(recall + 1, hatch.past.length - 1)
                                    : Math.max(recall - 1, -1);
      setRecall(i);
      setLine(i < 0 ? '' : hatch.past[i]!);
    }
    if (e.key === 'Escape') { e.stopPropagation(); hatch.show(false); }
  };

  const lamps = hatch.lamps();
  const build = hatch.build;

  return (
    <div
      className={`${s.hatch} ${open ? s.open : ''}`}
      // A click in the sheet is not a click away from the rail's panels.
      onClick={e => e.stopPropagation()}
    >
      {/* The machine first and always — the models are shared, expensive and
          breakable, and they are the reason anybody opens this. Then whichever
          app you are standing in, which on the front page is none. */}
      <div className={s['hatch-bar']}>
        {lamps.length === 0 && <span className={s['hatch-quiet']}>nothing running yet</span>}
        {lamps.map((h, i) => (
          <Fragment key={h.app}>
            {/* A rule divides one thing from another thing, not a name from its
                own facts: the room's row has no name because it belongs to the
                app named just before it, so it is set beside it rather than
                across a line. */}
            {i > 0 && h.name ? <span className={s['hatch-rule']} /> : null}
            {/* Only what was given a name gets one. The room's row is facts
                alone — printing its key there said APP/PAGE at somebody. */}
            {h.name ? <span className={s['hatch-app']}>{h.name}</span> : null}
            {(h.parts ?? []).map(p => (
              <span key={p.name} className={`${s['hatch-lamp']} ${s[p.state ?? 'off'] ?? ''}`}
                    title={p.title ?? p.name}><i />{p.name}</span>
            ))}
            {(h.facts ?? []).map(f => <span key={f} className={s['hatch-fact']}>{f}</span>)}
          </Fragment>
        ))}
        {/* Which build this is, kept out of the way on the right until somebody
            wants it — and they want it exactly once, when they are telling
            somebody else what happened. */}
        {build && (
          <span className={s['hatch-build']} title="the version of Lucid Dream this is">
            {build}
          </span>
        )}
      </div>

      <div
        className={s['hatch-log']}
        role="log"
        ref={log}
        onScroll={e => {
          const el = e.currentTarget;
          follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
        }}
      >
        {rows.map(row => row.kind === 'since'
          ? <div key={row.id} className={s['hatch-since']}>{row.text}</div>
          : (
            <div key={row.id} className={`${s['hatch-line']} ${s[row.level] ?? ''}`}>
              <span className={s.t}>{clock(row.at)}</span>
              <span className={s.w}>{row.source}</span>
              <span className={s.m}>{row.text}</span>
            </div>
          ))}
      </div>

      {/* The commands sit in the panel's own column rather than floating out of
          the input row. Hung off the row they opened upward with nothing above
          them to stop it: past a certain number of commands the list was taller
          than the panel, and on a phone taller than the screen. Here the panel
          shares its height out — the log gives way, the list takes what it needs
          and no more. */}
      <div className={s['hatch-hints']} hidden={!shown}>
        {list.map((o, i) => (
          <button type="button" key={o.name}
                  className={`${s['hatch-hint']} ${i === pick ? s.on : ''}`}
                  onClick={() => take(o.name)}>
            <span className={s.what}><b>/{o.name}</b>{o.args ? <> <em>{o.args}</em></> : null}</span>
            <span className={s.why}>{o.about}</span>
          </button>
        ))}
      </div>

      <form className={s['hatch-say']} autoComplete="off" onSubmit={e => { e.preventDefault(); send(); }}>
        {/* The prompt is the way in.

            Everything here starts with a slash, and on a phone that character is
            two taps down a keyboard nobody has been to since they last typed a
            URL. It was already sitting there as an ornament — a chevron saying
            "this is where you type" to somebody who could see the box perfectly
            well — so it does the one job that was missing instead: press it and
            the list is open. */}
        <button type="button" className={s['hatch-mark']} title="the commands"
                aria-label="show the commands"
                onClick={() => {
                  setLine(was => (was.startsWith('/') ? was : '/' + was));
                  input.current?.focus();
                }}>/</button>
        <input type="text" spellCheck={false} ref={input}
               placeholder="type / for what you can do"
               value={line}
               onChange={e => { setLine(e.target.value); setPick(0); }}
               onKeyDown={key} />
      </form>
    </div>
  );
}
