/* What the shell is handed, and nothing behind it.
 *
 * A manifest is the whole of what one game tells the app about itself, so this
 * is a small test on purpose: the two doors, the identity the shelf warms them
 * by, and the one question the console asks a game about an address.
 */
import {expect, test} from 'vitest';
import {trip} from './manifest';
import {TRIPS, tripOf} from './trips';

test('two doors, at the game\'s address, under its own name', () => {
  expect(trip.slug).toBe('lucid-trip');
  expect(trip.path).toBe('trip');
  expect(trip.was).toEqual(['lucid-trip']);
  expect(trip.name).toBe('Lucid Trip');
  expect(trip.routes().map((r) => r.path)).toEqual(['', ':card']);
});

test('every card in the box is a trip, found by its id', () => {
  expect(TRIPS.map((t) => t.card.id)).toEqual(['burning-man']);
  expect(tripOf('burning-man')?.card.title).toBe('Burning Man');
  // A card that is not in the box is no trip, not the first one.
  expect(tripOf('day')).toBeUndefined();
  expect(tripOf(undefined)).toBeUndefined();
});

test('the same doors twice, by identity', () => {
  /* The shelf warms a door by the identity of the function that opens it, so
     two calls to routes() have to hand back the same ones — a loader made on
     the way past is a chunk fetched again on every render of the shelf. */
  const [first, second] = [trip.routes(), trip.routes()];
  expect(first[0]?.load).toBe(second[0]?.load);
  expect(first[1]?.load).toBe(second[1]?.load);
});

test('the console is told which page it is standing on', () => {
  expect(trip.where('/trip')).toBe('');
  expect(trip.where('/trip/burning-man')).toBe('burning-man');
});

test('on a card the rail is the trip\'s; in front of the box it is the house\'s', () => {
  expect(trip.rail?.('/trip')).toEqual({});
  expect(trip.rail?.('/trip/burning-man')).toEqual({offline: false, speaker: 'How loud the trip is.', inline: true});
});

test('an address that is nobody else\'s', () => {
  /* The machine answers these itself and never hands them to the page, and a
     static build writes files under them (static-host.ts): a game at one of
     them would be a game nobody could reach. */
  const TAKEN = ['shared', 'assets', 'machine', 'store', 'og', 'favicon.ico', 'apple-touch-icon.png'];
  expect(TAKEN).not.toContain(trip.path);
  expect(trip.path).toMatch(/^[a-z][a-z0-9-]*$/);
});
