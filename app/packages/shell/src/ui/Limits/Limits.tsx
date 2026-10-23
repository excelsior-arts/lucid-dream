/* What a limited part looks like, and what it says.
 *
 * Three pieces, read off one list (shell/limits.ts) and used wherever a part
 * is off or smaller in this browser:
 *
 *   Mark      a small broken ring in the house's thin line, beside the part:
 *             the part stays where it is and works as far as it does
 *   LimitNote the one line for it -- on your Mac, in this browser -- and the
 *             steps under it; what a press on a limited part opens
 *   RunOnMac  the steps alone: the landing page's, each line copied on a press
 *
 * On the machine none of them draws anything. Ever.
 */
import {useEffect, useRef, useState} from 'react';
import {RUN_ON_MAC} from '../../shell/limits';
import {useLimited} from './use';
import s from './Limits.module.css';

/** The mark: a ring with a quarter of it missing. Drawn, not lit. */
export function Mark({title, className = ''}: {title?: string; className?: string}) {
  return (
    <span className={`${s.mark} ${className}`} role="img"
          aria-label={title ?? 'limited in this browser'} title={title ?? 'limited in this browser'}
          data-limit-mark="">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"
           strokeLinecap="round" aria-hidden="true">
        <path d="M6 1.4A4.6 4.6 0 1 0 10.6 6" />
        <path d="M8.6 1.9l1.5 1.5" />
      </svg>
    </span>
  );
}

/** The steps, as the landing page has them: a press on a line copies it. */
export function RunOnMac({lede = true}: {lede?: boolean}) {
  const [took, setTook] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = (text: string, i: number) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setTook(i);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setTook(-1), 1400);
    }, () => {});
  };
  const all = RUN_ON_MAC.steps.join('\n');
  return (
    <div className={s.mac} data-run-on-mac="">
      <div className={s.head}>
        <b>{RUN_ON_MAC.title}</b>
        <button type="button" className={`${s.all} ${took === RUN_ON_MAC.steps.length ? s.took : ''}`}
                onClick={(e) => { e.stopPropagation(); copy(all, RUN_ON_MAC.steps.length); }}>
          {took === RUN_ON_MAC.steps.length ? 'copied' : 'copy all'}
        </button>
      </div>
      {lede && <p className={s.lede}>{RUN_ON_MAC.lede}</p>}
      <div className={s.steps}>
        {RUN_ON_MAC.steps.map((line, i) => (
          <button key={line} type="button" className={`${s.cmd} ${took === i ? s.took : ''}`}
                  title="press to copy"
                  onClick={(e) => { e.stopPropagation(); copy(line, i); }}>
            <code>{line}</code>
          </button>
        ))}
        <p className={s.after}>{RUN_ON_MAC.after}</p>
      </div>
      <p className={s.needs}>
        {RUN_ON_MAC.needs}.{' '}
        <a href={`${RUN_ON_MAC.source}#readme`} target="_blank" rel="noreferrer">The README</a> has
        the current numbers.
      </p>
    </div>
  );
}

/** What a press on a limited part opens: the line for it, then the steps. */
export function LimitNote({id, steps = true}: {id: string; steps?: boolean}) {
  const l = useLimited(id);
  if (!l) return null;
  return (
    <div className={s.note} data-limit={l.id}>
      <p><span className={s.where}>On your Mac</span>{l.mac}</p>
      <p><span className={`${s.where} ${s.here}`}>In this browser<Mark /></span>{l.here}</p>
      {steps && <RunOnMac />}
    </div>
  );
}
