/* The evening, and everything about it that is timing.
 *
 * A clock that stops when the voice is paused, a run that checks the hold
 * before it takes a turn, a room noise that cost a line and owes it back, Skip
 * with nothing to go on from, hands that settle before they become a turn --
 * and the pacing, which reads the queue the page is holding and so could never
 * be checked anywhere but here.
 *
 * The turn itself is somebody else's file and has its own test: what is under
 * test here is which turns are taken, when, and what is left of the dose.
 */
import {beforeEach, expect, test, vi} from 'vitest';
import type {Playback} from '@lucid/audio';
import type {Message} from '@lucid/machine';
import type {TurnRequest} from './turn';

const said = vi.hoisted(() => [] as string[]);
vi.mock('@lucid/shell', () => ({
  hatch: {say: (line: string) => { said.push(line); }},
  /* The mute switch, which a replay reads: nothing is said into a muted room,
     because the machine would load a voice to make a clip the speaker drops. */
  sound: {hush: false},
}));

/** The conversation, and the turn -- both other files', both stubbed at the
    one door this file knocks on. */
const stub = vi.hoisted(() => ({
  history: [] as Message[],
  open: true,
  turns: [] as TurnRequest[],
  gated: false,
  waiting: [] as Array<() => void>,
  answers: true,
  fresh: 0,
  spoken: [] as string[],
  /** The store, refusing to write. */
  refuses: false,
  /** And refusing a delete because the file moved under the position it named. */
  stale: false,
  /** How many times the transcript has been read again from disk. */
  rereads: 0,
}));

vi.mock('./room', () => ({
  opened: () => (stub.open ? room() : null),
  freshSession: () => { stub.fresh += 1; return Promise.resolve(room()); },
  reread: () => { stub.rereads += 1; return Promise.resolve(); },
}));
vi.mock('./turn', () => ({
  runTurn: async (o: TurnRequest) => {
    stub.turns.push(o);
    if (stub.gated) await new Promise<void>((go) => { stub.waiting.push(go); });
    if (!o.hidden) stub.history.push({role: 'user', content: o.text});
    if (stub.answers) stub.history.push({role: 'assistant', content: 'she says something'});
  },
}));
const removed = vi.hoisted(
  () => [] as Array<{role: string; text: string; version: number}>);
vi.mock('./files', () => ({
  removeTurn: (_id: string, role: string, text: string, version: number) => {
    removed.push({role, text, version});
    if (stub.refuses) return Promise.reject(new Error('the store said no'));
    // The file is not at the version this page was following, so nothing was
    // taken out of it and the count it actually is at comes back.
    if (stub.stale) return Promise.resolve({removed: false, version: 9, stale: true});
    return Promise.resolve({removed: true, version: 3});
  },
}));

/* One object, so that "is this still the room I started in" is a question with
   an answer -- which is what everything below asks before it speaks. */
let theRoom: import('./room').Open | null = null;

function room() {
  theRoom ??= {
    slug: 'lover',
    sessionId: 'a-session',
    history: stub.history,
    foldedUpto: 0,
    version: 0,
    voice: {
      speak(text: string) {
        stub.spoken.push(text);
        return (async function* () {
          yield {pcm: 'pcm:' + text, rate: 24000, chars: text.length + 1};
        })();
      },
      stop() {}, close() {}, stats: {},
    },
  } as unknown as import('./room').Open;
  return theRoom;
}

/** A queue with a hand on it: how much is waiting to be heard is what the run
    paces itself against, and here it is set rather than played. */
function fakePlayback() {
  const q = {queued: 0, playing: 0, at: 0, put: [] as string[], credits: 0,
             stops: [] as boolean[]};
  const p = {
    enqueue: (pcm: string) => { q.put.push(pcm); },
    credit: (chars: number) => { q.credits += chars; },
    stop: (soft: boolean) => { q.stops.push(soft); q.queued = 0; q.playing = 0; },
    hold: () => {},
    get queuedS() { return q.queued; },
    get playingS() { return q.playing; },
    playedS: 0, spokenChars: 0, playing: false, held: false, stalled: false, sinceStartMs: 0,
    position: () => q.at,
    onChange: () => () => {},
    onUnheard: () => () => {},
    unlockOnce: () => () => {},
    dispose() {},
  };
  return {q, playback: p as unknown as Playback};
}

let L: typeof import('./loop');
let floor: typeof import('./floor');
let store: typeof import('../link/store');
let queue: ReturnType<typeof fakePlayback>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  said.length = 0;
  removed.length = 0;
  theRoom = null;
  stub.history = [];
  stub.open = true;
  stub.turns = [];
  stub.gated = false;
  stub.waiting = [];
  stub.answers = true;
  stub.fresh = 0;
  stub.spoken = [];
  stub.refuses = false;
  stub.stale = false;
  stub.rereads = 0;
  floor = await import('./floor');
  store = await import('../link/store');
  L = await import('./loop');
  queue = fakePlayback();
  floor.playInto(queue.playback);
});

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const seeded = () => {
  stub.history.push({role: 'user', content: 'hello'});
  stub.history.push({role: 'assistant', content: 'hello yourself'});
};

/* ---- the clock that stops ------------------------------------------------- */

test('holding freezes what is left of the dose', async () => {
  seeded();
  L.startContinuous(20);
  const was = L.continuousLeft();
  expect(L.holdContinuous(true)).toBe(true);
  await tick(3000);
  expect(L.continuousLeft(), 'the dose spent itself while held')
    .toBeCloseTo(was, 0);
});

test('and going on hands it back', async () => {
  seeded();
  L.startContinuous(20);
  L.holdContinuous(true);
  const was = L.continuousLeft();
  await tick(3000);
  expect(L.holdContinuous(false)).toBe(true);
  expect(L.continuousLeft()).toBeCloseTo(was, 1);
});

test('the run is still a run while it is held', () => {
  /* The loop's own condition is "is there time left" — a hold that answered no
     would end the run instead of pausing it. */
  seeded();
  L.startContinuous(20);
  L.holdContinuous(true);
  expect(L.continuousLeft()).toBeGreaterThan(0);
});

test('holding twice is holding once, and letting go of nothing does nothing', () => {
  seeded();
  L.startContinuous(20);
  expect(L.holdContinuous(true)).toBe(true);
  const was = L.continuousLeft();
  expect(L.holdContinuous(true)).toBe(false);
  expect(L.continuousLeft()).toBe(was);
  expect(L.holdContinuous(false)).toBe(true);
  expect(L.holdContinuous(false)).toBe(false);
});

test('pausing the voice with no run behind it', () => {
  // Ordinary pause, no tape running. There is nothing to hold and nothing to
  // say about it.
  expect(L.holdContinuous(true)).toBe(false);
  expect(store.link.getState().continuous).toBe(false);
});

test('it says so each way, so the clock on screen agrees', () => {
  seeded();
  L.startContinuous(20);
  expect(store.link.getState().continuous).toBe(true);
  expect(store.link.getState().continuous_min).toBeCloseTo(20, 1);
  L.holdContinuous(true);
  expect(store.link.getState().continuous).toBe(true);
  L.stopContinuous();
  expect(store.link.getState().continuous).toBe(false);
  expect(store.link.getState().continuous_min).toBe(0);
});

/* ---- and the room around it ----------------------------------------------- */

test('typing during a run steers rather than cutting', async () => {
  /* The line being spoken lands; what was queued behind it is dropped. Cutting
     a voice off mid-word to answer somebody reads as a machine glitching, and
     the half second it costs to finish the line is the difference between being
     interrupted and being listened to. What it must not do is nothing, which is
     what it did: the pill finished its line and carried on with its own
     evening. */
  seeded();
  L.startContinuous(20);
  queue.q.queued = 30;                     // plenty still to be heard
  expect(L.cutIn()).toBe(true);
  expect(queue.q.stops, 'it cut the sentence off instead of letting it land')
    .toEqual([true]);
  L.stopContinuous();
});

test('but held it is an ordinary interruption', () => {
  // Held, nothing is talking — so typing takes the floor the way it would with
  // nothing running at all.
  seeded();
  L.startContinuous(20);
  L.holdContinuous(true);
  const was = floor.generation();
  expect(L.cutIn()).toBe(true);
  expect(floor.generation()).toBe(was + 1);
  expect(queue.q.stops).toEqual([false]);
  L.stopContinuous();
});

/* ---- the loop stops producing --------------------------------------------- */

test('a run takes turns, and each of them is one nobody typed', async () => {
  seeded();
  L.startContinuous(20, true);
  await tick(2000);
  expect(stub.turns.length).toBeGreaterThanOrEqual(2);
  expect(stub.turns.every((t) => t.hidden)).toBe(true);
  // And each one is told where in the evening it is -- see arc.ts.
  expect(stub.turns[0]!.text).toContain('He has not said anything');
  L.stopContinuous();
});

test('held, it stops producing, and goes on when the hold does', async () => {
  seeded();
  L.startContinuous(20, true);
  await tick(1000);
  const so_far = stub.turns.length;
  expect(so_far).toBeGreaterThan(0);
  L.holdContinuous(true);
  await tick(3000);
  expect(stub.turns.length, 'held, the run went on writing turns nobody was hearing')
    .toBe(so_far);
  L.holdContinuous(false);
  await tick(1000);
  expect(stub.turns.length).toBeGreaterThan(so_far);
  L.stopContinuous();
});

test('it yields to somebody who has said something and not been answered', async () => {
  seeded();
  L.startContinuous(20, true);
  await tick(500);
  const so_far = stub.turns.length;
  stub.history.push({role: 'user', content: 'wait'});
  await tick(2000);
  expect(stub.turns.length, 'it talked over a line nobody had answered').toBe(so_far);
  stub.history.push({role: 'assistant', content: 'answered'});
  await tick(1000);
  expect(stub.turns.length).toBeGreaterThan(so_far);
  L.stopContinuous();
});

test('and to a turn that has the floor', async () => {
  seeded();
  const free = await floor.takeFloor();
  L.startContinuous(20, true);
  await tick(2000);
  expect(stub.turns).toEqual([]);
  free();
  await tick(500);
  expect(stub.turns.length).toBeGreaterThan(0);
  L.stopContinuous();
});

test('the next turn waits for the queue to drain to a turn\'s worth of lead', async () => {
  /* Start the next turn while there is still enough audio queued to cover
     generating it, so the two overlap instead of alternating -- and no sooner,
     or the machine writes ahead into a room that cannot keep up. The lead is
     what a turn has been costing, and the queue is right here. */
  seeded();
  queue.q.queued = 30;                     // half a minute still to be heard
  L.startContinuous(20, true);
  await tick(3000);
  expect(stub.turns, 'it wrote a turn into thirty seconds of unheard audio')
    .toEqual([]);
  // 2.5s a turn is where the cost starts, so the lead is 3.25s. Above it, no
  // turn; below it, one.
  queue.q.queued = 4;
  await tick(1000);
  expect(stub.turns).toEqual([]);
  queue.q.queued = 3;
  await tick(1000);
  expect(stub.turns.length).toBeGreaterThan(0);
  L.stopContinuous();
});

test('stopping lets the pill finish the line it is on and says so', async () => {
  seeded();
  stub.gated = true;
  L.startContinuous(20, true);
  await tick(500);
  expect(stub.turns).toHaveLength(1);
  L.stopContinuous();
  expect(said).toContain('tape stopped');
  // Nothing was silenced: unticking means "no more after this", not "be quiet".
  expect(queue.q.stops).toEqual([]);
  stub.waiting.shift()?.();
  await tick(2000);
  expect(stub.turns).toHaveLength(1);
});

test('a new run supersedes the old one rather than doubling it', async () => {
  seeded();
  L.startContinuous(20, true);
  await tick(300);
  L.startContinuous(20, true);
  await tick(2000);
  L.stopContinuous();
  // One loop is alive, so the turns are spaced by one loop's own breath rather
  // than by two racing.
  expect(store.link.getState().continuous).toBe(false);
});

test('keep going waits for the next reply; play does not', async () => {
  seeded();
  L.startContinuous(20);                   // the checkbox: after the next reply
  await tick(1500);
  expect(stub.turns).toEqual([]);
  stub.history.push({role: 'assistant', content: 'and one more thing'});
  await tick(1000);
  expect(stub.turns.length).toBeGreaterThan(0);
  L.stopContinuous();
});

/* ---- one turn, unasked ---------------------------------------------------- */

test('skip at rest takes one hidden turn', () => {
  seeded();
  expect(L.oneMore()).toBe(true);
  expect(stub.turns).toEqual([
    {slug: 'lover', sessionId: 'a-session', text: L.ONE_MORE, hidden: true},
  ]);
});

test('a blank tape cannot be skipped', () => {
  // The first word is always somebody's — the same rule the Play key keeps.
  expect(L.oneMore()).toBe(false);
  expect(stub.turns).toEqual([]);
});

test('nor one the pill has only talked to itself on', () => {
  stub.history.push({role: 'assistant', content: 'I was saying.'});
  expect(L.oneMore()).toBe(false);
});

test('and during a run skip is only a silencing', () => {
  seeded();
  L.startContinuous(20, true);
  stub.turns.length = 0;
  const was = floor.generation();
  L.skip();
  expect(floor.generation()).toBe(was + 1);
  // The loop is already waiting for the audio to drain before it starts the
  // next turn, so silencing this one *is* asking for the next one.
  expect(stub.turns.filter((t) => t.text === L.ONE_MORE)).toEqual([]);
  L.stopContinuous();
});

/* ---- saying a line again -------------------------------------------------- */

test('a room noise that stopped a reply gets the line put back', async () => {
  stub.history.push({role: 'user', content: 'what is it like out'});
  stub.history.push({role: 'assistant', content: 'The rain has not let up.'});
  L.putItBack();
  await tick(50);
  expect(stub.spoken).toEqual(['The rain has not let up.']);
  // Silently repeating a line is its own kind of haunted.
  expect(said.some((l) => l.includes('the room'))).toBe(true);
  // Not a turn: nothing is written down, and nothing is credited to the pacer.
  expect(stub.history).toHaveLength(2);
  expect(queue.q.credits).toBe(0);
  expect(queue.q.put).toEqual(['pcm:The rain has not let up.']);
});

test('nor when the last word was yours', async () => {
  stub.history.push({role: 'user', content: 'are you there'});
  L.putItBack();
  await tick(50);
  expect(stub.spoken).toEqual([]);
});

test('and it waits for the floor the stopped turn is still holding', async () => {
  /* The noise interrupted a reply, and that reply holds the floor until it has
     written down what it managed to say -- which is a store round trip after
     the detector has decided the noise was nothing. Refusing while the floor
     was held made this a no-op in exactly the case it exists for. */
  stub.history.push({role: 'user', content: 'x'});
  const free = await floor.takeFloor();
  L.putItBack();
  await tick(50);
  expect(stub.spoken).toEqual([]);

  // What was spoken lands, the turn lets go, and it is that line that comes back.
  stub.history.push({role: 'assistant', content: 'The rain has not let up.'});
  free();
  await tick(50);
  expect(stub.spoken).toEqual(['The rain has not let up.']);
});

test('nor when something newer is speaking by then', async () => {
  stub.history.push({role: 'assistant', content: 'The rain has not let up.'});
  const free = await floor.takeFloor();
  L.putItBack();
  queue.q.queued = 4;                       // a reply of its own, being said
  free();
  await tick(50);
  expect(stub.spoken).toEqual([]);
});

test('nor when a turn landed while it waited', async () => {
  stub.history.push({role: 'assistant', content: 'The rain has not let up.'});
  const free = await floor.takeFloor();
  L.putItBack();
  stub.history.push({role: 'user', content: 'never mind'});
  free();
  await tick(50);
  expect(stub.spoken).toEqual([]);
});

test('and a second press takes the floor from the first replay', async () => {
  stub.history.push({role: 'assistant', content: 'One. Two.'});
  void L.speakAgain('One. Two.');
  L.silence();
  await tick(50);
  // Silenced while queued: it never begins.
  expect(stub.spoken.length).toBeLessThanOrEqual(1);
});

/* ---- hands ---------------------------------------------------------------- */

test('one press becomes a turn, once the settle has gone by', async () => {
  seeded();
  L.did('(he tries the door)');
  await tick(500);
  expect(stub.turns, 'it answered before the settle was out').toEqual([]);
  await tick(1000);
  expect(stub.turns.map((t) => t.text)).toEqual(['(he tries the door)']);
});

test('a flurry arrives as one thing done', async () => {
  /* Pressing is instant and a reply is not. Four presses in a second are one
     turn, or the pill answers four times over the top of itself. */
  seeded();
  for (let i = 0; i < 4; i++) {
    L.did('(he pushes a book off the ledge)');
    await tick(100);
  }
  await tick(1500);
  expect(stub.turns).toHaveLength(1);
  expect(stub.turns[0]!.text).toContain('and again');
});

test('nothing at all is not a turn', async () => {
  seeded();
  L.did('');
  L.did('   ');
  await tick(2000);
  expect(stub.turns).toEqual([]);
});

test('a press takes the floor while the voice is going', async () => {
  /* It used to wait for the voice to finish, which is right if the wait is a
     second and a half. Replies run forty seconds and more, so the press arrived
     a topic late and read as the room ignoring it. */
  seeded();
  queue.q.queued = 5;
  const was = floor.generation();
  L.did('(he looks into the mirror)');
  expect(floor.generation(), 'it talked over its own voice').toBe(was + 1);
  await tick(1500);
  expect(stub.turns.map((t) => t.text)).toEqual(['(he looks into the mirror)']);
});

test('but a reply still being written is not interrupted, and is waited for', async () => {
  /* Only sound is worth taking the floor from. A press made while the reply is
     still being written goes in with that turn, which is better than killing a
     turn that has not used the floor yet. */
  seeded();
  const free = await floor.takeFloor();
  const was = floor.generation();
  L.did('(he knocks a cushion onto the floor)');
  await tick(3000);
  expect(floor.generation()).toBe(was);
  expect(stub.turns, 'it spoke over its own reply').toEqual([]);
  // And is answered when the reply ends: the floor says when it is free.
  free();
  await tick(1500);
  expect(stub.turns.map((t) => t.text)).toEqual(['(he knocks a cushion onto the floor)']);
});

test('a press during a run is scenery, and is not kept for afterwards', async () => {
  /* Somebody who set a scene and pressed Play is lying back for a quarter of an
     hour. Pooling it would answer a cushion knocked over ten minutes ago, once
     the dose ran out. Ignored means ignored. */
  seeded();
  L.startContinuous(20, true);
  stub.turns.length = 0;
  queue.q.queued = 30;                     // nothing is due for a while
  L.did('(he knocks a cushion onto the floor)');
  await tick(2000);
  expect(stub.turns).toEqual([]);
  L.stopContinuous();
  queue.q.queued = 0;
  await tick(3000);
  expect(stub.turns).toEqual([]);
});

test('a press before there is a room to answer in waits for one', async () => {
  stub.open = false;
  L.did('(he tries the door)');
  await tick(3000);
  expect(stub.turns).toEqual([]);
  stub.open = true;
  seeded();
  L.handsSoon();                           // what the room does on its way in
  await tick(1500);
  expect(stub.turns.map((t) => t.text)).toEqual(['(he tries the door)']);
});

test('a drum solo is not kept in full', async () => {
  seeded();
  for (let i = 0; i < 40; i++) L.did('(he pushes a book)');
  await tick(1500);
  // Twelve presses, collapsed into one line and a count of how many.
  expect(stub.turns).toHaveLength(1);
  expect(stub.turns[0]!.text).toBe('(he pushes a book) (and again, and again)');
});

/* ---- and the rest of what a room can ask for ------------------------------ */

test('a turn taken back goes from the context and from the file', async () => {
  seeded();
  room().version = 5;
  expect(await L.deleteTurn('assistant', 'hello yourself')).toBe(true);
  expect(stub.history.map((m) => m.content)).toEqual(['hello']);
  // Which line, and which version of the file it is being taken out of: a line
  // arriving between the read and the delete moves every position after it.
  expect(removed).toEqual([{role: 'assistant', text: 'hello yourself', version: 5}]);
  // The count the next append carries, from the answer rather than from a guess.
  expect(room().version).toBe(3);
});

test('and one the file moved under leaves the conversation whole', async () => {
  /* The position this page found the line at is not that line any more, so the
     store refused rather than taking whatever slid into it. Nothing is spliced
     here either: the transcript is read again, and asking a second time asks
     about the file as it now is. A console line and not a banner -- one
     command did not run; the page has not stopped meaning anything. */
  seeded();
  stub.stale = true;
  expect(await L.deleteTurn('assistant', 'hello yourself')).toBe(false);
  expect(stub.history.map((m) => m.content)).toEqual(['hello', 'hello yourself']);
  expect(room().version, 'the count it actually is at').toBe(9);
  expect(stub.rereads).toBe(1);
  expect(said.some((l) => l.includes('changed while that turn was being taken back')))
    .toBe(true);
  expect(store.link.getState().nowhere).toBe(false);
});

test('and a store that refuses leaves the conversation whole', async () => {
  /* The file is the conversation. Taken out of memory first, a refusal left
     the model being shown a transcript that is not on disk and a version a
     turn behind -- so the next thing said answered a 409. */
  seeded();
  stub.refuses = true;
  expect(await L.deleteTurn('assistant', 'hello yourself')).toBe(false);
  expect(stub.history.map((m) => m.content)).toEqual(['hello', 'hello yourself']);
  expect(room().version).toBe(0);
});

test('and a turn that is not there is not deleted', async () => {
  seeded();
  expect(await L.deleteTurn('user', 'something else')).toBe(false);
  expect(removed).toEqual([]);
});

test('a fresh conversation stops the tape and drops what hands were holding', async () => {
  seeded();
  L.startContinuous(20, true);
  L.did('(he tries the door)');
  await L.clearSession();
  expect(stub.fresh).toBe(1);
  expect(L.continuousLeft()).toBe(0);
  await tick(3000);
  expect(stub.turns.filter((t) => t.text === '(he tries the door)')).toEqual([]);
});
