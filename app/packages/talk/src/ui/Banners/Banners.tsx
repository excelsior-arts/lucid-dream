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

export interface Props {
  /** The address names a conversation that is not there — or the one this
      page is in has moved on without it, which is the same thing from here. */
  nowhere: boolean;
  /** The machine is there, this page just cannot reach it. */
  adrift: boolean;
  onBack: () => void;
}

export default function Banners({nowhere, adrift, onBack}: Props) {
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
          the red of something wrong — this one comes back. */}
      <Banner id="adrift" shown={adrift}>
        the machine is not answering &mdash; still trying
      </Banner>
    </>
  );
}
