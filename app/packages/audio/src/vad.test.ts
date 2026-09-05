/* Where a voice starts and stops, and who is allowed to interrupt whom.
 *
 * Every case here was a Python test of the same name before the listening
 * moved into the page — test_sustain, test_mic, test_barge, test_gaps — and
 * the arithmetic under it is the same arithmetic. What changed is where the
 * three facts about playback come from: they are reads on the object doing the
 * playing rather than an estimate made at the far end of a socket, so the fake
 * below is a speaker rather than a report about one.
 */
import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {Speaker, Tuning, Vad, VadEvent} from './vad';
import {BLOCK, BLOCK_MS, FLOOR_MIN, TUNING, bargeAllowed, createVad, speechlike, tuning, voicedness} from './vad';

/* ---- a room, a voice, and a door ---------------------------------------- */

/** The room: white noise at the floor, which is what a mic hears of nothing. */
function room(rms: number, blocks = 1): Float32Array {
  const out = new Float32Array(BLOCK * blocks);
  // Deterministic, so a threshold that only passes on Tuesdays fails here too.
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * rms * Math.sqrt(3);
  }
  return out;
}

/** A voice: 150 Hz with harmonics over it, at the loudness asked for.
 *
 * Periodic, and with real energy above 300 Hz, which is the pair of things
 * that tells a vowel from a door closing. */
function voice(rms: number, blocks = 1, hz = 150): Float32Array {
  const n = BLOCK * blocks, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 16000;
    // A sawtooth is every harmonic at once, which is what a vocal fold is.
    const phase = (t * hz) % 1;
    let v = 0;
    for (let k = 1; k <= 8; k++) v += Math.sin(2 * Math.PI * k * phase) / k;
    out[i] = v;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += out[i]! * out[i]!;
  const scale = rms / Math.sqrt(sum / n);
  for (let i = 0; i < n; i++) out[i]! *= scale;
  return out;
}

/** A door: loud, sudden, and with no pitch in it at all. */
function door(rms: number, blocks = 1): Float32Array {
  return room(rms, blocks);
}

/** A speaker that is playing, and has been for as long as you say.
 *
 * `heard` advances only while it is actually playing, which is the whole of
 * what the learn clock measures: a canceller learns nothing from silence, and
 * nothing from a page that says it is playing and plays nothing. */
class Fake implements Speaker {
  playing = true;
  queuedS = 0;
  held = false;
  playedS = 0;
  sinceStartMs: number;
  stalled = false;
  expecting = false;
  constructor(ms = 5000) { this.sinceStartMs = ms; }
  position() { return 0; }
  /** One block of it went out through the speaker. */
  tick() { if (this.playing) this.playedS += BLOCK_MS / 1000; }
}

const quiet: Speaker = {
  playing: false, queuedS: 0, held: false, stalled: false, expecting: false, playedS: 0, sinceStartMs: 0,
  position: () => 0,
};

/** A detector, its events, and a way to feed it in blocks. */
function ear(speaker: Speaker = quiet, floor = 0.01, over: Partial<Tuning> = {}) {
  const heard: VadEvent[] = [];
  const vad = createVad({speaker, floor, tuning: {...TUNING, ...over}});
  vad.on((e) => heard.push(e));
  const say = (block: Float32Array) => {
    for (let i = 0; i + BLOCK <= block.length; i += BLOCK) {
      vad.feed(block.slice(i, i + BLOCK));
      (speaker as Fake).tick?.();
    }
  };
  return {vad, heard, say,
    kept: () => heard.filter((e) => e.type === 'utterance'),
    dropped: () => heard.filter((e) => e.type === 'dropped')};
}

/* ---- test_sustain: a sentence is not over because a syllable was quiet --- */

describe('the quiet half of a sentence is kept', () => {
  /** Loud onset, then the quiet middle every real sentence has. */
  const sentence = (floor: number) => {
    const shape = [...Array(4).fill(5.0), ...Array(12).fill(1.8),
                   ...Array(6).fill(2.4), ...Array(10).fill(1.6)];
    return shape.map((x) => voice(floor * x));
  };

  const say = (e: ReturnType<typeof ear>, blocks: Float32Array[], floor: number) => {
    for (const b of blocks) e.say(b);
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(floor * 0.2));
  };

  test('a sentence that drops after its first syllable survives', () => {
    const e = ear(quiet, 0.01);
    say(e, sentence(0.01), 0.01);
    expect(e.kept()).toHaveLength(1);
  });

  test('and it is measured as a whole sentence', () => {
    const e = ear(quiet, 0.01);
    say(e, sentence(0.01), 0.01);
    const kept = e.kept()[0] as {seconds: number};
    expect(kept.seconds * 1000).toBeGreaterThan(TUNING.minTurnMs);
  });

  test('the old single gate is what lost it', () => {
    // With sustain raised to the onset bar the bug comes back, which is the
    // proof that this is the thing that fixed it and not a coincidence.
    const e = ear(quiet, 0.01, {sustainMult: TUNING.floorMult});
    say(e, sentence(0.01), 0.01);
    expect(e.kept()).toHaveLength(0);
    expect(e.dropped().length).toBeGreaterThan(0);
  });
});

describe('the room still does not arm it', () => {
  test('the lower bar is only for staying armed', () => {
    // A fridge sits above the sustain bar all day. It must never start a turn.
    const e = ear(quiet, 0.01);
    for (let i = 0; i < 60; i++) e.say(room(0.015));
    expect(e.kept()).toHaveLength(0);
  });

  test('a real cough is still too short', () => {
    const e = ear(quiet, 0.01);
    for (let i = 0; i < 3; i++) e.say(voice(0.06));
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(0.002));
    expect(e.kept()).toHaveLength(0);
  });
});

/* ---- test_mic: the canceller is given time to learn --------------------- */

describe('the canceller is given time to learn', () => {
  /** The pill's own voice coming back in, loud and with a pitch. */
  const shout = (e: ReturnType<typeof ear>, ms: number) =>
    e.say(voice(0.3, Math.round(ms / BLOCK_MS)));

  test('the opening seconds do not stop it', () => {
    const sp = new Fake();
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 1500});
    shout(e, 700);
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(0);
  });

  test('and then it does', () => {
    const sp = new Fake();
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 300});
    shout(e, 1500);
    expect(e.heard.filter((x) => x.type === 'barge').length).toBeGreaterThan(0);
  });

  test('it is playback heard and not a clock', () => {
    // A canceller learns nothing while nothing is playing.
    const sp = new Fake();
    sp.playing = false;
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 1500});
    shout(e, 2000);                    // two seconds pass, none of it playback
    sp.playing = true;
    shout(e, 400);
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(0);
  });

  test('zero trusts the browser from the first block', () => {
    const sp = new Fake();
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 0});
    shout(e, 400);
    expect(e.heard.filter((x) => x.type === 'barge').length).toBeGreaterThan(0);
  });

  test('and it says so rather than looking broken', () => {
    // Somebody who talks over the opening line and is ignored is owed a
    // reason — once, not once a block.
    const e = ear(new Fake(), FLOOR_MIN, {bargeLearnMs: 1500});
    shout(e, 900);
    const said = e.heard.filter((x) => x.type === 'log' && /still learning/.test(x.text));
    expect(said).toHaveLength(1);
  });

  test('the config can turn it down', () => {
    expect(tuning({barge_learn_ms: 250}).bargeLearnMs).toBe(250);
    expect(tuning({}).bargeLearnMs).toBe(TUNING.bargeLearnMs);
    expect(tuning(null).floorMult).toBe(TUNING.floorMult);
  });

  test('and a door is not a voice, however loud it is', () => {
    // Loudness alone cannot tell them apart, and one of them stops the pill
    // mid-sentence.
    const e = ear(new Fake(), FLOOR_MIN, {bargeLearnMs: 0});
    e.say(door(0.3, 30));
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(0);
  });
});

describe('who decides whether talking over it stops it', () => {
  /* Two things want a say, and one of them repeats itself: the page reports
     what its microphone granted every time it is opened, and somebody at the
     console says so once. */
  const canceling = {aec: true, lying: false};
  const bare = {aec: false, lying: false};
  const claims = {aec: true, lying: true};

  test('a microphone that cancels nothing turns it off by itself', () => {
    expect(bargeAllowed('auto', canceling)).toBe(true);
    expect(bargeAllowed('auto', bare)).toBe(false);
  });

  test('and so does one that says it does and does not', () => {
    expect(bargeAllowed('auto', claims)).toBe(false);
  });

  test('a browser that does not report is not a browser that failed', () => {
    expect(bargeAllowed('auto', {aec: null, lying: false})).toBe(true);
  });

  test('but a choice outranks every report after it', () => {
    expect(bargeAllowed('off', canceling)).toBe(false);
    expect(bargeAllowed('on', bare)).toBe(true);
    expect(bargeAllowed('on', claims)).toBe(true);
  });
});

describe('pressing talk is not an opinion about barge-in', () => {
  /* The mic is re-read on every open, and the answer it gives is the same
     answer. What must not happen is that re-reading it undoes an order — which
     is what somebody does next after typing one, because they turned the mic
     off to type. */
  test('a choice survives the mic going off and on', () => {
    const mic = {aec: true, lying: false};
    expect(bargeAllowed('off', mic)).toBe(false);
    expect(bargeAllowed('off', mic)).toBe(false);      // opened again
  });

  test('and the page telling the truth is still the last word', () => {
    expect(bargeAllowed('auto', {aec: false, lying: false})).toBe(false);
  });

  test('but nothing said at all leaves it barging', () => {
    expect(bargeAllowed('auto', {aec: true, lying: false})).toBe(true);
  });
});

/* ---- test_barge: a noise that stopped the pill and was nothing ----------- */

describe('when the room interrupts', () => {
  test('a dropped turn that cost a reply says so', () => {
    /* Barge-in decides in about a tenth of a second and is sometimes wrong.
       The cost lands entirely on the person: they lose the end of a reply to a
       sound they did not make. The conversation puts the line back, and this
       is the half that tells it to. */
    const sp = new Fake();
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 0});
    e.say(voice(0.3, 4));                       // enough to take the floor
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(1);
    sp.playing = false;                          // it stopped, as it was asked
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(0.001));
    const dropped = e.dropped()[0] as {ms: number; barged: boolean};
    expect(dropped.barged).toBe(true);
    expect(dropped.ms).toBeLessThan(TUNING.minTurnMs);
  });

  test('and a noise that stopped nothing is left alone', () => {
    // Nothing was playing, so nothing is owed.
    const e = ear(quiet, 0.01);
    for (let i = 0; i < 4; i++) e.say(voice(0.06));
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(0.002));
    const dropped = e.dropped()[0] as {barged: boolean} | undefined;
    expect(dropped?.barged).toBe(false);
  });

  test('a real turn is never second guessed', () => {
    // Long enough to be a sentence: it was heard, and nothing is put back.
    const e = ear(quiet, 0.01);
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(0.002));
    expect(e.kept()).toHaveLength(1);
    expect(e.dropped()).toHaveLength(0);
  });
});

/* ---- test_gaps: the gaps inside a reply are not the room going quiet ----- */

describe('the microphone gate', () => {
  /* A reply is a run of sentences, and the next one is still being made while
     the last one finishes. In that gap nothing is playing — and a gate that
     read only "is a sound coming out" opened between two sentences and heard
     the pill's next one as something somebody said.

     The page holds the queue now, so the gap is not a fact it has to be told:
     a chunk waiting behind the one in hand is a reply still going on. */
  const midReply = (): Fake => {
    const sp = new Fake();
    sp.playing = false;
    sp.queuedS = 1.2;               // the next sentence, waiting its turn
    return sp;
  };

  test('a gap inside a reply does not open the microphone', () => {
    const sp = midReply();
    const e = ear(sp, 0.01, {bargeLearnMs: 1500});
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    expect(e.heard.filter((x) => x.type === 'listening')).toHaveLength(0);
    expect(e.kept()).toHaveLength(0);
  });

  test('a voice under the reply that is not a barge is mentioned, once', () => {
    /* Under a reply the bar is the barge bar. A voice at an ordinary level was
       dropped without a word, which twice looked like a microphone that had
       stopped working after the page came back. */
    const sp = new Fake();
    const e = ear(sp, 0.01, {bargeLearnMs: 0});
    e.vad.barge = true;
    // A canceller doing a poor job: the mic hears a good deal of the pill.
    for (let i = 0; i < 40; i++) e.say(room(0.03));
    for (let i = 0; i < 30; i++) e.say(voice(0.05));      // over the gate, under the bar
    const said = e.heard.filter((x) => x.type === 'log' && /under the reply/.test(x.text));
    expect(said).toHaveLength(1);
    expect(e.heard.filter((x) => x.type === 'listening')).toHaveLength(0);
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    expect(e.heard.filter((x) => x.type === 'log' && /under the reply/.test(x.text))).toHaveLength(1);
  });

  test('on headphones an ordinary voice over the reply interrupts it', () => {
    /* The canceller leaves nothing of the pill in the mic, so the residual is
       the quiet room, and the bar is the ordinary gate: a long sentence said
       normally over a reply used to be dropped without a word. */
    const sp = new Fake();
    const e = ear(sp, 0.01, {bargeLearnMs: 0});
    e.vad.barge = true;
    for (let i = 0; i < 20; i++) e.say(room(0.004));       // what AirPods hear of the pill
    for (let i = 0; i < 30; i++) e.say(voice(0.04));
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(1);
  });

  test('and so is a chunk the browser paused behind the page', () => {
    /* Safari stops media in a background tab without saying so. A chunk left
       in hand that way is not sound and is nothing to talk over: a person back
       at the window talking normally must be heard at the ordinary bar, not
       at the barge-in one. */
    const sp = new Fake();
    sp.playing = true;
    sp.queuedS = 2;
    sp.stalled = true;
    const e = ear(sp, 0.01, {bargeLearnMs: 1500});
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    expect(e.heard.filter((x) => x.type === 'listening').length).toBeGreaterThan(0);
  });

  test('and so is a chunk the browser dropped without a word', () => {
    /* The fault as the log showed it: back at the page, a chunk in hand that
       neither ended nor paused, and a learn-window that only heard playback
       can advance. Every word said into it was refused -- once with a note,
       then in silence. Nothing arriving for three seconds is a quiet room. */
    const sp = new Fake();
    sp.playing = true;
    sp.queuedS = 0;
    sp.tick = () => {};                       // the browser says playing; nothing comes
    const e = ear(sp, 0.01, {bargeLearnMs: 1500});
    e.vad.barge = true;
    for (let i = 0; i < 40; i++) e.say(room(0.004));
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    // Refused, with the one note about the learn-window: the reply is believed.
    expect(e.heard.filter((x) => x.type === 'listening')).toHaveLength(0);
    expect(e.heard.filter((x) => x.type === 'log' && /still learning/.test(x.text))).toHaveLength(1);
    expect(e.vad.meter.out).toBe(true);
    for (let i = 0; i < 60; i++) e.say(room(0.004));    // three seconds of nothing arriving
    expect(e.vad.meter.out).toBe(false);
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    expect(e.heard.filter((x) => x.type === 'listening').length).toBeGreaterThan(0);
  });

  test('but sound that keeps coming is believed as long as it comes', () => {
    const sp = new Fake();
    const e = ear(sp, 0.01, {bargeLearnMs: 1500});
    for (let i = 0; i < 200; i++) e.say(room(0.004));    // six seconds, all of it arriving
    expect(e.vad.meter.out).toBe(true);
  });

  test('the hole between two sentences of one reply is still the reply', () => {
    /* The voice is slower than the speaker: the first sentence has played
       out and the second is not made yet, so nothing is in hand and nothing
       is queued. Read as a quiet room, a word said into that hole began a
       turn at the ordinary gate, and the pill's next sentence was collected
       into it as the person's. The speaker says more is coming. */
    const sp = new Fake();
    sp.playing = false;
    sp.queuedS = 0;
    sp.expecting = true;
    const e = ear(sp, 0.01, {bargeLearnMs: 0});
    for (let i = 0; i < 30; i++) e.say(voice(0.03));      // over the gate, under the bar
    expect(e.heard.filter((x) => x.type === 'listening')).toHaveLength(0);
    // And once the reply is over, the room is a room again.
    sp.expecting = false;
    for (let i = 0; i < 30; i++) e.say(voice(0.06));
    expect(e.heard.filter((x) => x.type === 'listening').length).toBeGreaterThan(0);
  });

  test('but a chunk paused where a hold left it is a quiet room', () => {
    /* Held used to count as playing, and it is the opposite: a held queue is a
       room that has gone quiet on purpose. Nothing is coming out of it and
       there is nothing to talk over -- and pausing is precisely what somebody
       does in order to say something. Counted as playback, being heard took
       six times the noise floor and a voiced onset instead of three: the
       microphone was hardest of hearing at the moment it was being spoken
       to. */
    const sp = new Fake();
    sp.playing = false;
    sp.queuedS = 1.2;               // the rest of the reply, waiting on the hold
    sp.held = true;
    const e = ear(sp, 0.01, {bargeLearnMs: 1500});
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(0.002));
    expect(e.kept()).toHaveLength(1);
    // And it was heard as somebody speaking into a quiet room, not as a barge.
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(0);
  });

  test('and the floor is not learned from a room the pill is talking in', () => {
    const sp = midReply();
    const e = ear(sp, 0.01, {bargeLearnMs: 1500});
    for (let i = 0; i < 40; i++) e.say(room(0.001));
    expect(e.vad.floor).toBeCloseTo(0.01, 4);
  });

  test('it opens again when the turn is over', () => {
    const sp = midReply();
    const e = ear(sp, 0.01);
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    expect(e.kept()).toHaveLength(0);
    sp.queuedS = 0;
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) e.say(room(0.002));
    expect(e.kept()).toHaveLength(1);
  });

  test('and barge-in stays armed across the gaps of one reply', () => {
    /* The grace is measured from the start of the stretch of speech, not of
       the chunk: one that started again on every sentence would be a grace
       that never elapsed, and the pill could not be interrupted at all. */
    const sp = new Fake(5000);
    sp.playing = false;
    sp.queuedS = 1.2;
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 0});
    e.say(voice(0.3, 8));
    expect(e.heard.filter((x) => x.type === 'barge').length).toBeGreaterThan(0);
  });

  test('but the first moments of a reply are still its own', () => {
    // The grace: what it keeps out is the room's answer to the pill starting
    // to talk, and a canceller that has just been handed something to cancel.
    const sp = new Fake(100);
    const e = ear(sp, FLOOR_MIN, {bargeLearnMs: 0});
    e.say(voice(0.3, 8));
    expect(e.heard.filter((x) => x.type === 'barge')).toHaveLength(0);
  });
});

/* ---- what the two tests on a block actually measure ---------------------- */

describe('a voice against a door', () => {
  test('a vowel repeats itself and a bang does not', () => {
    expect(voicedness(voice(0.2))).toBeGreaterThan(0.6);
    expect(voicedness(door(0.2))).toBeLessThan(0.3);
  });

  test('and only one of them has formants over its pitch', () => {
    expect(speechlike(voice(0.2))).toBe(true);
    expect(speechlike(door(0.2))).toBe(false);
    // A low tone is periodic — a door closing is a decaying one — so pitch
    // alone would let it through.
    const tone = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) tone[i] = 0.2 * Math.sin((2 * Math.PI * 120 * i) / 16000);
    expect(voicedness(tone)).toBeGreaterThan(0.6);
    expect(speechlike(tone)).toBe(false);
  });

  test('and the test can be turned off, which is what a zero means', () => {
    // Not by making speechlike say yes to everything — by not asking it. A
    // door then interrupts the pill, which is the cost of turning it off.
    const e = ear(new Fake(), FLOOR_MIN, {bargeLearnMs: 0, bargeVoiced: 0});
    e.say(door(0.3, 8));
    expect(e.heard.filter((x) => x.type === 'barge').length).toBeGreaterThan(0);
    expect(voicedness(new Float32Array(BLOCK))).toBe(0);
  });
});

/* ---- blocks in, whatever the page hands over ---------------------------- */

describe('what it will take', () => {
  let vad: Vad;
  beforeEach(() => { vad = createVad({speaker: quiet}); });

  test('a half block waits for the rest of itself', () => {
    const seen = vi.fn();
    vad.onChange(seen);
    vad.feed(new Float32Array(BLOCK / 2));
    expect(seen).not.toHaveBeenCalled();
    vad.feed(new Float32Array(BLOCK / 2));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('and anything but 16 kHz is resampled on the way in', () => {
    const seen = vi.fn();
    vad.onChange(seen);
    vad.feed(new Float32Array(BLOCK * 3), 48000);      // a third of it at 16 k
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('a microphone that closed leaves no half-heard turn behind', () => {
    const heard: VadEvent[] = [];
    vad.on((e) => heard.push(e));
    for (let i = 0; i < 30; i++) vad.feed(voice(0.05));
    expect(heard.some((e) => e.type === 'listening')).toBe(true);
    vad.reset();
    // And said so: the page leaves "listening" by this and by nothing else.
    expect(heard[heard.length - 1]).toEqual({type: 'listening', active: false});
    for (let i = 0; i < TUNING.hangoverMs / BLOCK_MS + 3; i++) vad.feed(new Float32Array(BLOCK));
    expect(heard.filter((e) => e.type === 'utterance')).toHaveLength(0);
  });
});

/* ---- push to talk: the key is not an opinion about barge-in ------------- */

describe('the key, where there is one', () => {
  test('holding it takes the floor and lets it go again', () => {
    const sp = new Fake();
    const e = ear(sp, 0.01);
    e.vad.mode = 'push_to_talk';
    e.vad.ptt = true;
    for (let i = 0; i < 30; i++) e.say(voice(0.05));
    e.vad.ptt = false;
    e.say(room(0.001));
    expect(e.kept()).toHaveLength(1);
    /* It silences the page without telling the conversation it was
       interrupted: pressing a key is asking for the microphone, not talking
       over anybody. */
    const stopped = e.heard.filter((x) => x.type === 'barge') as {spoken: boolean}[];
    expect(stopped).toHaveLength(1);
    expect(stopped[0]!.spoken).toBe(false);
  });

  test('and a press too brief to be a turn is said, not lost', () => {
    const e = ear(quiet, 0.01);
    e.vad.mode = 'push_to_talk';
    e.vad.ptt = true;
    for (let i = 0; i < 5; i++) e.say(voice(0.05));      // 160 ms
    e.vad.ptt = false;
    e.say(room(0.001));
    expect(e.kept()).toHaveLength(0);
    expect(e.dropped()).toEqual([{type: 'dropped', ms: 5 * BLOCK_MS, barged: false}]);
  });
});
