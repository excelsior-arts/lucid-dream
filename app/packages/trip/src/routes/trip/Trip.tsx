/* The card, turned over: a trip on the whole screen.
 *
 * One route for every card. The id in the address names the trip, the trip
 * opens its piece, and this page is only the frame the piece is mounted in:
 * an element for it to build its stage in, mounted when the route arrives and
 * let go of when the route leaves -- the back button, the wordmark, the lid
 * of the box next door. Everything a piece is (Burning Man's desert, music,
 * keys and camera) is its own and is read about under trips/.
 *
 * Three things the frame does for a piece. A link in it marked as the way back
 * (`a.wordmark`, in Burning Man's masthead) goes to the box as a route change
 * rather than a page load, so the click is caught here and handed to the
 * router -- with the modifier keys left alone, because ⌘-click on a link is a
 * tab and should stay one. The host is marked quiet: the shell sounds a
 * press on every button in the house, and a piece has its own idea of what
 * its first button should sound like.
 *
 * And a dose is counted here, the one thing Lucid Trip keeps (../../doses.ts).
 * Counted when the trip begins -- the stage's one button, `#start` (Let it),
 * pressed -- and not when the card is turned over: an address opened and left
 * at the invitation, a reload, a bookmark looked at are not a trip taken, the
 * way a Talk room opened and left without a word is not a dose there. Once
 * per turning-over: the invitation is still fading for a moment after the
 * press, and a second press inside it is the same trip. The button is the
 * stage's (@lucid/world's buildStage), so every trip has it under that name;
 * it is disabled until the piece is up, and a disabled button sends no click.
 */
import {useEffect, useRef} from 'react';
import type {MouseEvent} from 'react';
import {Navigate, useNavigate, useParams} from 'react-router';
import {expose, hatch, RESTING_LEVEL, sound, usePage} from '@lucid/shell';
import {takeDose} from '../../doses';
import {tripOf} from '../../trips';
import type {Piece} from '../../trips';

export default function TripPage() {
  const {card} = useParams();
  const trip = tripOf(card);
  const navigate = useNavigate();
  const host = useRef<HTMLDivElement>(null);
  /* Which card this turning-over has counted already: a dose a trip. */
  const dosed = useRef<string | null>(null);

  usePage('trip');

  useEffect(() => {
    const el = host.current;
    if (!el || !trip) return;
    /* The chunk may still be on the wire when the route leaves again; a piece
       that arrives after that is disposed on arrival rather than mounted. */
    let piece: Piece | null = null;
    let left = false;
    dosed.current = null;
    const hear = () => piece?.hear?.(sound.level / RESTING_LEVEL, sound.hush);
    document.addEventListener('lucid:volume', hear);
    document.addEventListener('lucid:hush', hear);
    void trip.open().then(
      ({mount}) => {
        if (left) return;
        piece = mount(el);
        // The rail's speaker is the piece's volume: the knob where it rests is
        // the piece's own mix, and the hush is its silence.
        hear();
        // The one door onto window, for a browser test to ask the piece how it is.
        expose('trip', piece);
        piece.ready.catch((e: unknown) => {
          // Left before it was up is the back button, not a fault.
          if (e instanceof DOMException && e.name === 'AbortError') return;
          hatch.say(`${trip.card.title} could not load: ${e instanceof Error ? e.message : String(e)}`, 'error');
        });
      },
      (e: unknown) => {
        if (!left) hatch.say(`${trip.card.title} did not arrive: ${e instanceof Error ? e.message : String(e)}`, 'error');
      });
    return () => {
      left = true;
      document.removeEventListener('lucid:volume', hear);
      document.removeEventListener('lucid:hush', hear);
      piece?.dispose();
      // And the test's door with it: left open, it held the last piece, all of it.
      if (piece) expose('trip', null);
      // The stage goes with the piece: the next mount builds its own.
      el.replaceChildren();
      el.className = '';
    };
  }, [trip]);

  if (!trip) return <Navigate to="/trip" replace />;

  const press = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('#start')) {
      if (dosed.current === trip.card.id) return;
      dosed.current = trip.card.id;
      const {id, title} = trip.card;
      void takeDose(id).catch((err: unknown) =>
        hatch.say(`could not count that dose of ${title}: ${err instanceof Error ? err.message : String(err)}`,
                  'warn'));
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest('a.wordmark');
    if (!link) return;
    e.preventDefault();
    navigate('/trip');
  };

  return <div ref={host} data-quiet onClick={press} />;
}
