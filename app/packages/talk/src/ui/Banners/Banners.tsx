/* The two ways this page can stop meaning anything.
 *
 * Said once, above the keys: the keys still look pressable and nothing they
 * do would reach this conversation. A page that has stopped meaning anything
 * should say so rather than go quiet.
 *
 * A banner is @lucid/ui's; which ones there are is Lucid Talk's, because what
 * can go wrong here is a fact about a conversation that lives in a file.
 *
 * There were three. The first said another window had the machine, and it went
 * with the machine being a thing one window at a time could hold: each page
 * runs its own conversation now, and two rooms open at once are two evenings
 * rather than one being fought over.
 */
import Banner from '@lucid/ui/Banners/Banners';
import {host} from '@lucid/shell';
import type {Waking} from '../../link/store';

export interface Props {
  /** The address names a conversation that is not there — or the one this
      page is in has moved on without it, which is the same thing from here. */
  nowhere: boolean;
  /** The machine is there, this page just cannot reach it. */
  adrift: boolean;
  /** In a browser, why the pill did not answer where the page has its own
      words for it: the GPU letting go of it, a stall (Told). */
  said?: string;
  /** The pill stopped answering part-way and is being woken, and whether a
      line waits on it: not a banner (see below). */
  waking?: Waking;
  onBack: () => void;
}

/** What the quiet line says: the pill being woken, and a line waiting on it. */
const WAKING: Record<Exclude<Waking, ''>, string> = {
  waking: 'the pill isn’t answering — waking it',
  line: 'the pill isn’t answering — waking it, your line is next',
};

export default function Banners({nowhere, adrift, said, waking = '', onBack}: Props) {
  return (
    <>
      {/* A page pointed at nothing: an address naming a conversation that is
          not there. A page that has quietly stopped meaning anything should
          say so, and offer the one thing that still works. */}
      <Banner id="gone" shown={nowhere}
              action={{id: 'goback', label: 'back to the box', onPress: onBack}}>
        this conversation is not here
      </Banner>
      {/* And the other: the machine is there, this page just cannot reach it.
          No button, because the page is already retrying every second and a
          key that duplicates what is happening anyway is a key that lies about
          being needed. Said in the amber of something temporary rather than
          the red of something wrong — this one comes back.

          A page with nothing behind it has no machine to be not answering:
          what put this up is the pill in this browser failing a reply (a
          model that would not start, one that stalled), and nothing is
          retrying it -- the next read of the page's own status takes the
          banner down a few seconds later, and the next line is the retry.
          Where the page knows why, it says that instead: the GPU in this
          browser that let go of the pill, a pill that stalled. */}
      <Banner id="adrift" shown={adrift}>
        {host().machine
          ? <>the machine is not answering &mdash; still trying</>
          : said || <>the pill didn&rsquo;t answer &mdash; try again in a moment</>}
      </Banner>
      {/* Not a banner: a reply that broke off part-way -- a stall, the GPU
          letting go, the stream dropped -- is already finished on the glass,
          its last words fading where it broke, and what is left to say is
          that the pill is being woken. Said small, in the room's own muted
          voice, just over the keys, and nothing is locked: a line typed or
          said meanwhile is answered once it is up. Gone with the next
          reply's first word, and under either banner, which says more. */}
      <p id="not-answering" role="status"
         hidden={!waking || nowhere || adrift}>
        {waking ? WAKING[waking] : ''}
      </p>
    </>
  );
}
