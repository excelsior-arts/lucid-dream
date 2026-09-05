/* The question, drawn.
 *
 * Fixed over everything, so it stays out of the room's layout. Escape or the
 * backdrop is No, so the safe answer is always the easy one; No takes the
 * focus for the same reason.
 */
import {useEffect, useRef, useState} from 'react';
import type {Question} from './ask';
import {drawnBy} from './ask';
import './ConfirmDialog.css';

export default function ConfirmDialog() {
  const [asked, setAsked] = useState<Question | null>(null);
  const no = useRef<HTMLButtonElement>(null);

  useEffect(() => drawnBy(setAsked), []);

  useEffect(() => {
    if (!asked) return;
    no.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setAsked(null);
      asked.answer(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [asked]);

  const done = (said: boolean) => {
    setAsked(null);
    asked?.answer(said);
  };

  return (
    <div id="ask" hidden={!asked} onClick={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div className="askbox">
        <h2 id="asktitle">{asked?.title}</h2>
        <p id="askbody">{asked?.body}</p>
        <div className="askrow">
          <button id="askno" ref={no} onClick={() => done(false)}>Cancel</button>
          <button id="askyes" className="danger" onClick={() => done(true)}>{asked?.yes ?? 'Reset'}</button>
        </div>
      </div>
    </div>
  );
}
