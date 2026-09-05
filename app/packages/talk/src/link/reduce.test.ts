/* What a message does to the state.
 *
 * There is no socket on the other end of these any more: the loop writes them
 * as it goes and the debug shelf's `receive` hands them straight in, which is
 * how every picture in the simulated-state walk is taken. What is left to be
 * wrong is the transcript's three rules about bubbles, and they are the same
 * three rules either way.
 */
import {describe, expect, test} from 'vitest';
import type {Inbound, Tick} from './shapes';
import {apply} from './reduce';
import type {LinkState} from './store';
import {EMPTY} from './store';

const base: LinkState = {...EMPTY, slug: 'lover'};

/** Fold a run of messages the way the page does, and hand back the state. */
function fold(msgs: readonly Inbound[], from: LinkState = base): LinkState {
  return msgs.reduce<LinkState>((s, m) => ({...s, ...apply(s, m)}), from);
}

describe('the conversation', () => {
  test('a delta opens a bubble and the next extends it', () => {
    const s = fold([
      {type: 'assistant_delta', text: 'Come '},
      {type: 'assistant_delta', text: 'here.'},
    ]);
    expect(s.transcript).toEqual([{role: 'assistant', text: 'Come here.', streaming: true}]);
  });

  test('done finalizes it with what the server kept', () => {
    const s = fold([
      {type: 'assistant_delta', text: 'Come '},
      {type: 'assistant_done', text: 'Come here.'},
    ]);
    expect(s.transcript).toEqual([{role: 'assistant', text: 'Come here.', streaming: false}]);
  });

  test('done with nothing streaming is still a thing that was said', () => {
    const s = fold([{type: 'assistant_done', text: 'said while you were away'}]);
    expect(s.transcript).toEqual([{role: 'assistant', text: 'said while you were away'}]);
  });

  test('a line of yours ends the reply that was still draining', () => {
    const s = fold([
      {type: 'assistant_delta', text: 'half a sen'},
      {type: 'user', text: 'stop', seconds: 1.2},
    ]);
    expect(s.transcript).toEqual([
      {role: 'assistant', text: 'half a sen', streaming: false},
      {role: 'user', text: 'stop', seconds: 1.2},
    ]);
  });

  test('continuous mode starts a bubble of its own', () => {
    const s = fold([
      {type: 'assistant_delta', text: 'one'},
      {type: 'assistant_done', text: 'one'},
      {type: 'assistant_delta', text: 'two'},
    ]);
    expect(s.transcript.map((t) => t.text)).toEqual(['one', 'two']);
  });
});

const tick: Tick = {
  type: 'tick',
  state: 'speaking',
  status: {llm: 'ready', stt: 'ready', tts: 'ready'},
  tts: {},
  input_mode: 'mic',
  continuous: true,
  continuous_min: 12.5,
  mic_barge: 'auto',
  running: true,
  memory: {llm_gb: 17, app_gb: 5, voice_gb: 5, total_gb: 22},
  mic_follow: 'hidden',
  standing: {word: 'close'},
  persona: 'lover',
  persona_name: 'Purple',
  session_id: '2026-08-28T12-12-26_lover',
};

describe('the machine', () => {
  test('a tick carries the whole of it', () => {
    const s = fold([tick]);
    expect(s.state).toBe('speaking');
    expect(s.running).toBe(true);
    expect(s.continuous_min).toBe(12.5);
    expect(s.session_id).toBe('2026-08-28T12-12-26_lover');
    expect(s.standing.word).toBe('close');
    expect(s.memory.total_gb).toBe(22);
  });

  test('a relation warms the room that is already open', () => {
    const open: LinkState = {
      ...base,
      room: {
        session: 'x',
        persona: 'lover',
        state: {lamp: 2},
        mood: {temperature: 0.9, top_p: 0.95, warmth: 0, temper: 0},
      },
    };
    const s = fold([{type: 'relation', slug: 'lover', state: {warmth: 40}, text: 'fond'}],
                   open);
    expect(s.room?.mood).toEqual({temperature: 0.9, top_p: 0.95, warmth: 40, temper: 0});
  });

  test('and one about another pill is not ours to be warmed by', () => {
    const s = fold([{type: 'relation', slug: 'thinker', state: {warmth: 40}, text: ''}]);
    expect(s.relation).toBe(null);
  });

  test('the console is not state', () => {
    const s = fold([{type: 'log', text: 'no usable speech'}]);
    expect(s).toEqual(base);
  });
});
