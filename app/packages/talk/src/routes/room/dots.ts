/* The two pairs of dots.
 *
 * Yours stands in for your words while they are being transcribed: speech
 * starts, the server says listening, and this holds the place until the
 * transcript lands. Without it the screen says nothing while you talk and the
 * reply seems to come out of nowhere.
 *
 * And the same three dots on the other side of the conversation, while it is
 * thinking and has not said anything yet. The pulse says a voice is coming
 * and the dots say a reply is; between them there was a gap where the room was
 * quietly beating at somebody with nothing on the glass to explain it.
 *
 * Both are messages on the page and neither is a turn, which is what
 * `pending` means and why the counter does not count them. They follow what
 * arrives rather than what is rendered, so this listens to the store itself.
 */
import {useEffect, useState} from 'react';
import type {LinkState} from '../../link/store';
import {link, onLog} from '../../link/store';

export interface Dots {
  heard: boolean;
  musing: boolean;
}

const NONE: Dots = {heard: false, musing: false};

/* Idle passes through for a moment between the end of your sentence and the
   transcript, so it is a wait, not a signal — transcription can take a couple
   of seconds. The server says outright when a turn is dropped ("no usable
   speech"), and this is only the backstop for a crash. */
const GIVE_UP = 20000;

export function useDots(): Dots {
  const [dots, setDots] = useState<Dots>(NONE);

  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | null = null;
    const put = (next: (was: Dots) => Dots) => setDots((was) => {
      const to = next(was);
      if (to.heard === was.heard && to.musing === was.musing) return was;
      if (!to.heard && idle) { clearTimeout(idle); idle = null; }
      return to;
    });

    const moved = (now: LinkState, was: LinkState) => {
      if (now.state !== was.state) {
        put((it) => {
          let {heard, musing} = it;
          if (now.state === 'listening') heard = true;
          if (now.state === 'speaking' || now.state === 'stopped') heard = false;
          /* A turn is beginning. Which is where the wait for a voice starts as
             well: between the sentences of one reply the voice stops for a
             moment while the next is made, and a room that started beating in
             those gaps was saying "something is coming" over and over about a
             thing that was already here. It is asked once per turn. */
          const writing = now.transcript[now.transcript.length - 1]?.streaming;
          if (now.state === 'thinking' && was.state !== 'thinking') musing = !writing;
          if (now.state !== 'thinking' && now.state !== 'speaking') musing = false;
          return {heard, musing};
        });
        if (now.state === 'idle' && !idle) {
          idle = setTimeout(() => put((it) => ({...it, heard: false})), GIVE_UP);
        } else if (now.state !== 'idle' && idle) {
          clearTimeout(idle);
          idle = null;
        }
      }
      if (now.transcript !== was.transcript) {
        // The words arrived, or the reply did: whichever pair stood in for
        // them is over.
        const last = now.transcript[now.transcript.length - 1];
        if (last?.role === 'user') put((it) => ({...it, heard: false}));
        if (last?.role === 'assistant') put((it) => ({...it, musing: false}));
      }
    };

    const off = [
      link.subscribe(moved),
      // "no usable speech", "too short to hear", "STT failed" — nothing is
      // coming, so take the dots down. The line is already in the console:
      // the server wrote it there as it sent it.
      onLog((m) => {
        if (/no usable speech|too short to hear|STT failed/.test(m.text)) {
          put((it) => ({...it, heard: false}));
        }
      }),
    ];
    return () => {
      if (idle) clearTimeout(idle);
      for (const stop of off) stop();
    };
  }, []);

  return dots;
}
