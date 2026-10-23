/* The box Lucid Trip comes in.
 *
 * The case, the tray, the card and the flight are @lucid/ui's Box -- the same
 * mechanic the box of pills opens, and the reason it is a mechanic. What this
 * page is, is the two things only Lucid Trip means: the cards in the tray, and
 * what is written on the sheet inside the lid.
 *
 * The sheet is the Talk box's table, cut to what a trip keeps: a line per
 * card, its swatch and name, and how many times it has been taken. Nothing
 * else of a trip is kept -- no memory, no standing, no record of what
 * happened -- so there is nothing else to show, and the counts are not ways in
 * the way the Talk box's are: there is no conversation behind a dose to open.
 * No total under them either while the box holds one card: a sum of one line
 * is that line again. The count is read from the store (../../doses.ts); it is
 * taken in the trip's own route, when Let it is pressed.
 */
import type {CSSProperties} from 'react';
import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import {hatch, href, startSky, usePage} from '@lucid/shell';
import type {Card} from '@lucid/ui';
import BoxOpen from '@lucid/ui/Box/Box';
import {doses, doseWords} from '../../doses';
import {TRIPS} from '../../trips';
import './Box.css';

/* What is written inside the lid: what a pill is, for every pill the box will
   ever hold, and what is kept of one. */
const TAKE =
  'Take one. Each pill is a trip of its own: a place, a stretch of music, and wherever it '
  + 'takes you. Only the doses are counted.';

/** The cards in the tray, as the box draws them: each trip's card, with the
    address it opens onto. */
const CARDS: Card[] = TRIPS.map(({card: c}) => ({
  id: c.id, title: c.title, blurb: c.blurb, color: c.color, figure: c.figure,
  href: href(`/trip/${c.id}`),
}));

export default function Box() {
  const navigate = useNavigate();
  const sky = useRef<HTMLCanvasElement>(null);

  /* How many times each card has been taken, once the store has said. Null
     until then, and the table is laid out but not shown (Box.css): a row
     reading "never taken" before the count is in would be a guess, and rows
     arriving under the copy would push it up the sheet as they landed. */
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  usePage('box');

  useEffect(() => {
    let gone = false;
    void doses().then(
      (got) => { if (!gone) setCounts(got); },
      (e: unknown) => hatch.say(`could not read the doses: ${e instanceof Error ? e.message : String(e)}`,
                                'warn'));
    return () => { gone = true; };
  }, []);

  useEffect(() => (sky.current ? startSky(sky.current) : undefined), []);

  return (
    <>
      <canvas id="sky" ref={sky} />

      <BoxOpen
        title="Lucid Trip"
        game="lucid-trip"
        cards={CARDS}
        /* Taking it starts the piece's chunk down the wire while the card is
           still in the air: Burning Man is seven megabytes of desert, and the
           flight is most of a second it would otherwise spend waiting. */
        onPress={(card) => void TRIPS.find((t) => t.card.id === card.id)?.open().catch(() => {})}
        onTake={(card) => navigate(`/trip/${card.id}`)}
        onShut={() => navigate('/')}
        lid={
          <div className={`leaf${counts ? ' ready' : ''}`}>
            <h1>Lucid Trip</h1>
            <div className="rule" />
            <div className="body">
              <div className="stack">
                <p className="note" id="lidcopy">{TAKE}</p>
                {/* A line per card, ruled like the Talk box's ledger. */}
                <div className="lines" id="lines">
                  {TRIPS.map(({card: c}) => (
                    <div className="line" key={c.id} style={{'--card': c.color} as CSSProperties}>
                      <span className="tag">
                        <i />
                        {c.title}
                      </span>
                      <span />
                      <span className="doses">{counts && doseWords(counts[c.id] ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        }
      />
    </>
  );
}
