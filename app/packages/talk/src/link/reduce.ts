import type {Inbound} from './shapes';
import type {LinkState, Turn} from './store';
import {link, sayLog} from './store';

/* What a message does to the state, with the DOM taken out of it.
 *
 * Nothing here touches a socket, a document, or the clock, so every rule in it
 * is a test three lines long.
 *
 * There is no socket left to be the other end of this. The page runs the
 * conversation and writes most of its state directly; what still comes through
 * here is the transcript's own three rules -- when a bubble opens, when it
 * grows, when it settles -- said by the loop (see turn.ts) and by the debug
 * shelf's `receive`, which is the door every simulated-state picture is taken
 * through. One path to the transcript rather than two.
 */

/** A reply that broke off says so on its bubble; any other leaves it out. */
const cut = (m: {cut?: boolean}) => (m.cut ? {cut: true} : {});

export function apply(s: LinkState, m: Inbound): Partial<LinkState> {
  switch (m.type) {
    /* The whole of a page in one move. Nothing sends it: it is how the
       simulated-state walk puts a room into a state a conversation would take
       a model and five minutes to reach. */
    case 'tick':
      return {
        state: m.state,
        running: m.running,
        input_mode: m.input_mode,
        continuous: m.continuous,
        continuous_min: m.continuous_min,
        mic_follow: m.mic_follow,
        mic_barge: m.mic_barge,
        persona: m.persona,
        persona_name: m.persona_name,
        session_id: m.session_id,
        status: m.status,
        memory: m.memory,
        standing: m.standing,
      };

    case 'state':
      return {state: m.state};

    case 'user': {
      /* A reply still draining its voice is over the moment you speak. */
      const transcript = settled(s.transcript);
      transcript.push({role: 'user', text: m.text, seconds: m.seconds});
      return {transcript};
    }

    case 'assistant_delta': {
      const transcript = [...s.transcript];
      const last = transcript[transcript.length - 1];
      /* Continuous mode writes the next turn while the last one's voice is
         still draining. Its words belong in a bubble of their own. */
      if (last?.role === 'assistant' && last.streaming) {
        transcript[transcript.length - 1] = {...last, text: last.text + m.text};
      } else {
        transcript.push({role: 'assistant', text: m.text, streaming: true});
      }
      return {transcript};
    }

    case 'assistant_done': {
      const transcript = [...s.transcript];
      const last = transcript[transcript.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        // The whole reply, as it was kept: the deltas are what the model
        // streamed and this is what went into the transcript. Done with
        // nothing is a line cut before a word was heard: the bubble that
        // was streaming comes down rather than standing empty.
        // A reply that broke off is finished too, and says where it broke.
        if (m.text) transcript[transcript.length - 1] = {...last, text: m.text, streaming: false, ...cut(m)};
        else transcript.pop();
      } else if (m.text) {
        // Nothing was streaming -- a turn that came and went while this page
        // was away. It is still a thing that was said.
        transcript.push({role: 'assistant', text: m.text, ...cut(m)});
      }
      return {transcript};
    }

    case 'continuous':
      return {continuous: m.on, continuous_min: m.minutes};

    /* Where the pill is holding you, which is what the room is lit by. It
       lands after every turn that had you in it, so the room warms up or
       grays out around somebody who is sitting in it -- see the note on the
       grade in room3d.js. Kept on the room as well, because the room was
       built with the mood it opened at and would otherwise stay that colour
       all evening. */
    case 'relation': {
      if (m.slug && m.slug !== s.slug) return {};
      const out: Partial<LinkState> = {relation: {slug: m.slug, state: m.state, text: m.text}};
      // Only what actually arrived. An undefined assigned over a good value
      // reads as a pill with no opinion of you, and the room goes flat.
      const st = m.state || {};
      const heat: {warmth?: number; temper?: number} = {};
      if (typeof st.warmth === 'number') heat.warmth = st.warmth;
      if (typeof st.mood === 'number') heat.temper = st.mood;
      if (s.room && ('warmth' in heat || 'temper' in heat)) {
        out.room = {...s.room, mood: {...s.room.mood, ...heat}};
      }
      return out;
    }

    // The console is not state: a line happens once, and keeping the last one
    // as a field means a re-render can say it twice. See store.ts.
    case 'log':
      return {};
  }
}

/** The reply in flight is over, whatever it had left to say. */
export function settled(turns: readonly Turn[]): Turn[] {
  const out = [...turns];
  const last = out[out.length - 1];
  if (last?.streaming) out[out.length - 1] = {...last, streaming: false};
  return out;
}

/** One message, into the page: the reducer, and the console.
 *
 * The one door. `receive` on the debug shelf is exactly this, which is how the
 * simulated-state pictures are drawn -- a second path to the same state would
 * only ever be a second thing to keep true.
 */
export function deliver(m: Inbound): void {
  if (m.type === 'log') {
    sayLog(m);
    return;
  }
  link.setState(apply(link.getState(), m));
}
