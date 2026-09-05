/* A banner: one line above the controls, and the one thing that still works.
 *
 * Said once, over whatever it is about: the controls under it still look
 * pressable and nothing they do would land anywhere. A page that has stopped
 * meaning anything should say so rather than go quiet.
 *
 * Which banners there are is the game's — what can go wrong is a fact about
 * what the game is doing — so this is one of them and the game composes the
 * set. It keeps its own id, because that is what a room's stylesheet, a
 * screenshot walk and a browser test all reach for.
 */
import type {ReactNode} from 'react';
import './Banners.css';

export interface Action {
  /** Its own id, for the same reasons the banner has one. */
  id?: string;
  label: string;
  onPress: () => void;
}

export interface Props {
  id: string;
  /** Shown. Hidden rather than unmounted: it is a line that comes and goes. */
  shown: boolean;
  children: ReactNode;
  /* No button is a choice and not an omission. A key that duplicates
     something already happening — a page that is retrying every second — is a
     key that lies about being needed. */
  action?: Action;
}

export default function Banner({id, shown, children, action}: Props) {
  return (
    <div className="banner" id={id} hidden={!shown}>
      <span>{children}</span>
      {action && (
        <button type="button" id={action.id} onClick={action.onPress}>
          {action.label}
        </button>
      )}
    </div>
  );
}
