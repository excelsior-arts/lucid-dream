/* A page that arrives with its game.
 *
 * React.lazy would do all of this except the one frame that matters: the shelf
 * changes the address inside a synchronous flush, under a view transition, and
 * a lazy component that suspends there is photographed as an empty page. So
 * what has been loaded is kept where a render can read it without suspending,
 * and `warm` is what the shelf calls while the lid is still going up.
 */
import {use} from 'react';
import type {ComponentType} from 'react';
import type {GameRoute} from '../manifest';

export interface Lazy {
  /** The route element. Suspends only if nobody warmed it first. */
  Page: ComponentType;
  /** Start fetching. Saying it again while it is in flight is nothing. */
  warm: () => void;
}

// One per door, so warming and rendering are talking about the same fetch.
const doors = new Map<GameRoute['load'], Lazy>();

/* Doors whose fetch failed, and the way to make each of them ask again.
 *
 * A fetch that failed is not an answer to keep: `use` re-throws a cached
 * rejection on every render, so a chunk that could not be fetched -- a rebuild
 * mid-evening, a dropped connection at exactly the wrong second -- would be a
 * blank page for the life of the tab. But forgetting it in the rejection
 * itself only asks again immediately, and for ever: the render that hears the
 * refusal is the render that starts the next fetch, and nothing ever reaches
 * the boundary that would say so. So it is forgotten on a press. */
const broken = new Set<() => void>();

/** Ask every door that failed to try again. See Doorway. */
export function askAgain(): void {
  for (const anew of broken) anew();
  broken.clear();
}

export function lazyPage(load: GameRoute['load']): Lazy {
  const known = doors.get(load);
  if (known) return known;
  let here: ComponentType | null = null;
  let asked: Promise<ComponentType> | null = null;
  const anew = () => { asked = null; };
  const bring = (): Promise<ComponentType> => (asked ??= load().then(
    (m) => (here = m.default),
    (e: unknown) => {
      broken.add(anew);
      throw e;
    }));
  const door: Lazy = {
    warm: () => void bring(),
    Page() {
      const Loaded = here ?? use(bring());
      return <Loaded />;
    },
  };
  doors.set(load, door);
  return door;
}
