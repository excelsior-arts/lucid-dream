/* The models panel's doors: whether a room should ask, and asking. The panel
   itself is ModelCard.tsx. */
import {closeSheet, openSheet} from '@lucid/ui';
import {status} from '@lucid/machine';
import {host} from '@lucid/shell';
import type {CardSection} from '@lucid/shell';
import ModelCard from './ModelCard';

/** Open the panel. `onReady` once what was chosen is here (and the model
    up); `onLeave` when it is put away without. `onBox`, from a room: where
    no model can run here at all, the card's way back to the box, its
    put-away being to step into the room anyway. `focus` is a part somebody
    reached for and found missing: the voice's switch, the microphone. */
export function openModelCard(o: {
  onReady: () => void; onLeave: () => void; onBox?: () => void; focus?: CardSection;
}): void {
  const mac = host().machine;
  openSheet({
    title: o.focus === 'voice' ? (mac ? 'a voice for this Mac' : 'a voice in this browser')
      : o.focus === 'ear' ? (mac ? 'a microphone for this Mac' : 'the microphone')
        : mac ? 'models on this Mac' : 'models in this browser',
    body: <ModelCard focus={o.focus} onReady={() => { closeSheet(); o.onReady(); }}
                onLeave={() => { closeSheet(); o.onLeave(); }}
                onBox={o.onBox && (() => { closeSheet(); o.onBox?.(); })} />,
  });
}

/** The gear's press: the panel, asked for, with nothing waiting on it. */
export const openModelPanel = (focus?: CardSection): void =>
  openModelCard({onReady: () => {}, onLeave: () => {}, focus});

/** Whether a room should ask: nothing is on disk (or in this browser) to run. */
export async function modelWanted(): Promise<boolean> {
  if (host().llm === 'none') return true;
  try {
    const llm = (await status()).llm;
    return llm?.here === false;
  } catch {
    return false;          // a machine that will not say is not asked about
  }
}
