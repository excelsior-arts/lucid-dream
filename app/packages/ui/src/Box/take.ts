/* ---- taking one --------------------------------------------------------
 *
 * The card comes up out of the box, turns over, and arrives in your face: by
 * the end it is the only thing on the screen, and what opens behind it is the
 * card's own color rather than a page.
 *
 * It is a copy that flies, not the card. The card is three levels deep in a
 * preserve-3d tray with a lid over it — anything it does happens inside that
 * box and at the box's scale, which is the length of a shrug. The copy is
 * fixed to the viewport, starts life exactly where the card is, and owes the
 * box nothing. Which is also why it is built by hand rather than rendered:
 * what flies is a clone of whatever the card is at the moment it is pressed.
 *
 * Says how long to wait before leaving, so the two cannot drift apart, and
 * hands back the way to take the layer down again — between documents the
 * page simply went, and in one document somebody has to sweep up.
 */
export interface Flight {
  ms: number;
  clear(): void;
}

export function take(card: HTMLElement): Flight {
  const r = card.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.id = 'taking';
  const fly = document.createElement('div');
  fly.className = 'flying';
  fly.style.cssText =
    `left:${r.left}px; top:${r.top}px; ` +
    `width:${r.width}px; height:${r.height}px; ` +
    `--card:${getComputedStyle(card).getPropertyValue('--card')}`;
  const printed = document.createElement('div');
  printed.className = 'side printed';
  const copy = card.cloneNode(true) as HTMLElement;
  copy.classList.remove('chosen');
  copy.removeAttribute('href');
  copy.removeAttribute('aria-label');
  printed.appendChild(copy);
  const plain = document.createElement('div');
  plain.className = 'side plain';
  fly.append(printed, plain);
  layer.appendChild(fly);
  document.body.appendChild(layer);

  /* Where it is going: the middle of the screen, big enough that the far
     side covers it. A card is a tall rectangle and a screen is a wide one,
     so the scale is whichever of the two dimensions needs more — plus a
     little, because a card arriving exactly the size of the window shows
     its corners. */
  const dx = innerWidth / 2 - (r.left + r.width / 2);
  const dy = innerHeight / 2 - (r.top + r.height / 2);
  const full = Math.max(innerWidth / r.width, innerHeight / r.height) * 1.3;
  const MS = 900;
  /* Turn first, then come. The two cannot overlap: a card that is already
     the size of the screen and also edge-on is a bright bar across your
     view. So the flip happens while it is still card-sized and near the
     box, it arrives at the middle of the screen by the time it is face-on
     again, and only then does it rush the last of the way and cover
     everything. */
  fly.animate(
    [
      {
        transform: 'translate(0px, 0px) rotateY(0deg) scale(1)',
        offset: 0,
        easing: 'cubic-bezier(.2,.7,.35,1)',
      },
      /* Up out of the tray, barely turning: the rise is what says it was
         lifted rather than zoomed. */
      {
        transform:
          `translate(${(dx * 0.1).toFixed(0)}px, ${(dy * 0.1 - 30).toFixed(0)}px) ` +
          'rotateY(-24deg) scale(1.16)',
        offset: 0.2,
        easing: 'cubic-bezier(.5,0,.5,1)',
      },
      // edge-on, still small, halfway to the middle
      {
        transform:
          `translate(${(dx * 0.5).toFixed(0)}px, ${(dy * 0.5).toFixed(0)}px) ` +
          'rotateY(-90deg) scale(1.5)',
        offset: 0.42,
        easing: 'cubic-bezier(.4,0,.55,1)',
      },
      // over, and now facing you with its own color
      {
        transform:
          `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) ` + 'rotateY(-180deg) scale(2.1)',
        offset: 0.64,
        easing: 'cubic-bezier(.6,0,.85,.6)',
      },
      /* Covering the window, and covering it *before* the fade begins — a
         card still short of the edges shows the box in two bars down the
         sides, and the whole point of the last third is that there is nothing
         left to see but the card. */
      {
        transform:
          `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) ` +
          `rotateY(-180deg) scale(${full.toFixed(3)})`,
        opacity: 1,
        offset: 0.8,
        easing: 'cubic-bezier(.3,.5,.5,1)',
      },
      /* And then gone. It goes on growing while it goes, so it leaves the way
         it arrived rather than dissolving on the spot, and what is underneath
         by then is black — the box has been covered for a third of a second,
         and the room opens out of the dark instead of out of a wall of
         color. */
      {
        transform:
          `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) ` +
          `rotateY(-180deg) scale(${(full * 1.3).toFixed(3)})`,
        opacity: 0,
        offset: 1,
      },
      /* Linear overall, with the shaping on the keyframes themselves. An
         easing on the animation warps where the offsets land — under a curve
         like this one, "two thirds of the way through" arrives at nine
         tenths, so the card covered the screen a third of a second before it
         was meant to and then sat there. Offsets are read in eased time; put
         the curve on the steps and they are read in real time. */
    ],
    {duration: MS, easing: 'linear', fill: 'forwards'},
  );

  /* Which side is facing you, said outright. `backface-visibility` is the
     proper way to do this and it does not survive the trip: the printed
     face is a card, a card clips its own overflow, and a clipping face is
     not culled — so the turn showed the front again, mirrored, all the way
     round. Swapping the two at the moment the card is edge-on costs one
     animation each and cannot be argued with.

     The instant is .42, which is where the rotation passes ninety degrees.
     Both numbers are here rather than one here and one in the keyframes,
     because if they ever drift the card turns into its own back. */
  const EDGE = 0.42;
  const swap = (el: HTMLElement, from: number, to: number) =>
    el.animate(
      [
        {opacity: from, offset: 0},
        {opacity: from, offset: EDGE - 0.001},
        {opacity: to, offset: EDGE},
        {opacity: to, offset: 1},
      ],
      {duration: MS, easing: 'linear', fill: 'forwards'},
    );
  swap(printed, 1, 0);
  swap(plain, 0, 1);

  /* The dark it fades into. Painted on the layer under the card rather than
     left to the page, because the page under it is a lit box on a starfield
     — fading the card out over that just puts the box back. It comes in
     while the card still covers everything, so nobody sees it arrive. */
  layer.animate(
    [
      {background: 'rgba(0,0,0,0)', offset: 0},
      {background: 'rgba(0,0,0,0)', offset: 0.62},
      {background: 'rgba(0,0,0,1)', offset: 0.82},
      {background: 'rgba(0,0,0,1)', offset: 1},
    ],
    {duration: MS, easing: 'linear', fill: 'forwards'},
  );
  // Leaving on the black, not on the color: the card is gone by then and the
  // page opening behind it is dark, so the two join without a seam.
  return {ms: MS, clear: () => layer.remove()};
}
