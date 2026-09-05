/* The one thing that is not rendered.
 *
 * A flat page of its own fixed size, and every frame the engine hands it the
 * projection that lands its four corners on the four corners of the window in
 * the room. So it leans with the wall — the words are in the room's
 * perspective rather than pasted over a picture of one — while staying real
 * text you can select, scroll and read a screen reader from.
 *
 * There is nothing in this component but the element, which is the point: the
 * engine measures it, writes --px, --glass-px and --under onto it, and the
 * conversation inside is laid out in the page's own pixels and knows nothing
 * about any of that.
 */
import type {ReactNode, RefObject} from 'react';
import './Glass.css';

export default function Glass({ref, children}: {ref: RefObject<HTMLDivElement | null>; children: ReactNode}) {
  return <div id="glass" ref={ref}>{children}</div>;
}
