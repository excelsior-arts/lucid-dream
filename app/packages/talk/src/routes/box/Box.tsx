/* The box of pills.
 *
 * The case, the tray, the cards and the flight are @lucid/ui's Box — a
 * mechanic, and the same one the next game will open. What this page is, is
 * the two things only Lucid Talk means: which cards are in the tray, and what
 * is written on the sheet inside the lid.
 *
 * The sheet is the record. A line per pill — how it is taking you, how many
 * doses, what it remembers — and every number on it is a way in as well as a
 * number. Under that, how strong a dose is, which is the one thing on this
 * page you can change.
 */
import type {CSSProperties} from 'react';
import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import {models} from '@lucid/machine';
import {hatch, sound, startSky, usePage} from '@lucid/shell';
import type {Card} from '@lucid/ui';
import BoxOpen from '@lucid/ui/Box/Box';
import Sheet from '@lucid/ui/Sheet/Sheet';
import {personas as shipped} from '../../conversation/bundle';
import {gameConfig} from '../../conversation/config';
import * as F from '../../conversation/files';
import {summary} from '../../conversation/relation';
import {link, useLink} from '../../link/store';
import {openForget, openMemory, openSessions} from '../../ui/Sheets/sheets';
import './Box.css';

const TAKE_NOTHING =
  'Take one. Each pill has a voice of its own, remembers what you told it last time, ' +
  'and takes you somewhere it chooses.';
/* Nobody has taken anything yet: say so plainly rather than showing zeros. */
const TAKE_FIRST =
  'Nothing taken yet. Whatever happens under one is written down here and nowhere else — ' +
  'what it learns about you, and how it comes to hold you.';

const say = (what: string, e: unknown) =>
  hatch.say(`${what}: ${e instanceof Error ? e.message : String(e)}`, 'warn');

export default function Box() {
  const navigate = useNavigate();
  const sky = useRef<HTMLCanvasElement>(null);

  const personas = useLink((s) => s.personas);
  const ledger = useLink((s) => s.ledger);
  const minutes = useLink((s) => s.minutes);
  /* Whether where you stand is being kept at all. Off means off, whatever is
     still on disk from when it was not — a standing nothing is moving any
     more is a number pretending to be one. */
  const [standings, setStandings] = useState(true);

  /* How long a dose lasts, as the lid last had it. Held here as well as in the
     store: the sheet is redrawn from the ledger, and a number that lives only
     in what gets redrawn is a number that can arrive stale. The `setup` reply
     can land after the ledger has been drawn, and corrects this. */
  const [dose, setDose] = useState(minutes);
  const [said, setSaid] = useState(minutes);
  if (minutes !== said) {
    setSaid(minutes);
    setDose(minutes);
  }

  usePage('box');

  useEffect(() => (sky.current ? startSky(sky.current) : undefined), []);

  /* Two reads and no socket at all. This page is not in a conversation with
     anything: it is the pills, the sheet inside the lid, and how strong a dose
     is. It used to listen to the conversation's socket without claiming it,
     which meant the box was handed a running evening's messages and had to
     ignore most of them.

     The pills are not a read at all any more — they ship with the game, and
     the tray is laid out before the lid is open. What is asked for is what
     this player has made of them. */
  useEffect(() => {
    link.setState({personas: shipped()});
    void F.ledger().then((got) => link.setState({ledger: got}),
                         (e: unknown) => say('could not read the box', e));
    void gameConfig().then((cfg) => {
      link.setState({minutes: cfg.ui.continuous_minutes});
      setStandings(cfg.relation.enabled);
    });
  }, []);

  const step = (by: number) => {
    const next = Math.max(5, Math.min(dose + by, 120));
    setDose(next);
    /* Written where the game reads it. Nothing comes back to say so: the
       number on the lid is what somebody just pressed, and redrawing it from
       an answer would make a control that lags a button press. */
    void F.saveConfig({ui: {continuous_minutes: next}})
      .catch((e: unknown) => say('could not set how strong a dose is', e));
    sound.tick();
  };

  const cards: Card[] = personas
    .filter((p) => !p.draft)
    .map((p) => ({
      id: p.slug,
      /* A character that says nothing about its colour is a character, not an
         error: the machine passes a persona file through unread, so the house
         answer for anything it left out is the page's. */
      color: p.color || '150, 140, 130',
      figure: p.figure ?? '',
      title: p.pill,
      blurb: p.blurb ?? '',
      href: `/lucid-talk/${p.slug}`,
    }));
  const remembered = ledger ? ledger.pills.reduce((n, p) => n + p.remembered, 0) : 0;

  return (
    <>
      <canvas id="sky" ref={sky} />

      <BoxOpen
        title="Lucid Talk"
        game="lucid-talk"
        cards={cards}
        note="More pills coming soon…"
        /* Taking one starts the language model, while the card is still in
           the air: it is the one thing every conversation needs, and it is the
           slowest of the three. The other two are asked for by whoever wants
           them — the recognizer when somebody presses Talk, the voice when the
           sound is on — so a pill taken by somebody who types with the sound
           off costs one model rather than three. The room's page asks again if
           this never lands. */
        onPress={() => void models.start().catch(() => {})}
        onTake={(card) => navigate(`/lucid-talk/${card.id}`)}
        onShut={() => navigate('/')}
        lid={
          <div className={`leaf${ledger ? ' ready' : ''}`}>
            <h1>Lucid Talk</h1>
            <div className="rule" />
            <div className="body">
              <div className="stack">
                <p className="note" id="lidcopy">
                  {ledger && !ledger.doses ? TAKE_FIRST : TAKE_NOTHING}
                </p>
                {/* The record: a line per pill, and a total under it.
                    Ruled like a ledger, because that is what it is. */}
                <div className="lines" id="lines">
                  {ledger?.pills.map((p) => (
                    <div
                      className="line"
                      key={p.slug}
                      style={{'--card': p.color || '150, 140, 130'} as CSSProperties}
                    >
                      <span className="tag">
                        <i />
                        {p.name}
                      </span>
                      <span />
                      {/* Each of the three is a way in as well as a number.
                          How it is taking you opens the sheet that puts that
                          back to nothing; the doses open the conversations you
                          have had, and any of them opens where you left off;
                          what it remembers opens the note it keeps and lets
                          you write in it. */}
                      <button
                        type="button"
                        className="said"
                        title={`how ${p.name} is taking you — press to start from nothing`}
                        onClick={() => openForget(p.slug, p.name)}
                      >
                        {/* One word, like every standing it stands in for —
                            frozen, cool, even, devoted. "Not yet decided about
                            you" was a sentence in a column eight characters
                            wide.

                            Made here, off the state the machine keeps: the
                            arithmetic is the game's and there is nowhere else
                            it could live now. See relation.ts. */}
                        {p.doses
                          ? (standings && summary(p.standing)) || 'undecided'
                          : 'never taken'}
                      </button>
                      <span className="count">
                        <button
                          type="button"
                          title={`conversations you have had with ${p.name}`}
                          onClick={() => openSessions(p.slug, p.name)}
                        >
                          {p.doses || 'no'} doses
                        </button>
                        {' · '}
                        {/* "memories", not "notes": it is the word the rest of
                            this speaks — the box counts what it has
                            Remembered, the sheet is a memory, and a pill
                            remembering you is the thing the whole app is
                            about. */}
                        <button
                          type="button"
                          title={`what ${p.name} remembers about you`}
                          onClick={() => openMemory(p.slug, p.name)}
                        >
                          {p.remembered
                            ? `${p.remembered} ${p.remembered === 1 ? 'memory' : 'memories'}`
                            : 'no memories'}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* The one control on this sheet goes first; the tally, which is
                only something to read, sits away on the right. */}
            <div className="totals" id="totals">
              <span className="dosebox">
                Strength
                <button type="button" aria-label="weaker" onClick={() => step(-5)}>
                  &minus;
                </button>
                <b id="dosenow">{dose}</b> min
                <button type="button" aria-label="stronger" onClick={() => step(5)}>
                  +
                </button>
              </span>
              {/* One element, not two: as separate spans they wrapped
                  independently and "Remembered" ended up on its own line under
                  the strength control. */}
              <span className="tally">
                Doses <b>{ledger?.doses ?? 0}</b> &middot; Remembered <b>{remembered}</b>
              </span>
            </div>
          </div>
        }
      />

      <Sheet />
    </>
  );
}
