/* What happens to a turn that had to wait its turn.
 *
 * Only one reply can be spoken at a time, so every other way of starting one --
 * typing, a press on something in the room, Skip, the continuous loop -- queues
 * behind a single floor and wakes up when it is free. The question each of
 * these asks is whether it should still be wanted by then, and twice it was
 * not: Stop meant stop, and five Skips in one breath took five turns.
 */
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {Playback} from '@lucid/audio';
import type {Message} from '@lucid/machine';
import type {Open} from './room';

/** The reply, with a hand on it: it answers when this test says so. */
const machine = vi.hoisted(() => ({
  asked: [] as Array<{messages: Message[]; voice: unknown}>,
  /** What warmPrefix pushed through: the messages and how many tokens it asked for. */
  warms: [] as Array<{messages: Message[]; max_tokens: number}>,
  answer: 'Hello yourself.',
  /** The answer as the model wrote it, tags and all, where that differs. */
  written: '',
  /** What the speaker has actually got out, if the page goes away mid-reply. */
  spoken: 'Hello',
  /** The reply broke off part-way (a GPU let go, the stream dropped). */
  cut: false,
  /** What it says went wrong, if anything: onTrouble, before onDone. */
  fails: null as Error | null,
  /** The pill being woken was asked for (models.start). */
  woken: 0,
  /** Says whether the pill came up, once it has been asked (awaitReady). */
  up: null as ((ok: boolean) => void) | null,
  /** Whether the answer comes as a delta first, as a streamed one does. */
  streams: false,
  gated: false,
  waiting: [] as Array<() => void>,
}));
vi.mock('@lucid/machine', async () => ({
  wholeSentences: (await vi.importActual<typeof import('@lucid/machine')>('@lucid/machine')).wholeSentences,
  tagsOnWords: (await vi.importActual<typeof import('@lucid/machine')>('@lucid/machine')).tagsOnWords,
  NotAnswering: (await vi.importActual<typeof import('@lucid/machine')>('@lucid/machine')).NotAnswering,
  Told: (await vi.importActual<typeof import('@lucid/machine')>('@lucid/machine')).Told,
  VoiceRefused: class VoiceRefused extends Error {},
  VoiceFailed: (await vi.importActual<typeof import('@lucid/machine')>('@lucid/machine')).VoiceFailed,
  models: {start: () => { machine.woken += 1; return Promise.resolve({}); }},
  awaitReady: () => new Promise<boolean>((go) => { machine.up = go; }),
  async *streamChat(o: {messages: Message[]; max_tokens: number}) {
    machine.warms.push({messages: o.messages, max_tokens: o.max_tokens});
    yield 'I';
  },
  runReply(o: {
    messages: Message[];
    voice: unknown;
    onSpeaking?: () => void;
    onDelta?: (delta: string) => void;
    onTrouble?: (e: Error) => void;
    onDone?: (text: string, spoken: string[], written: string, cut?: boolean) => void;
  }) {
    machine.asked.push({messages: o.messages, voice: o.voice});
    let stopped = false;
    const done = (async () => {
      if (machine.gated) await new Promise<void>((go) => { machine.waiting.push(go); });
      if (stopped || !machine.answer) return;
      if (machine.streams) o.onDelta?.(machine.answer);
      if (machine.fails) o.onTrouble?.(machine.fails);
      o.onSpeaking?.();
      o.onDone?.(machine.answer, [machine.answer], machine.written || machine.answer,
                 ...(machine.cut ? [true] : []));
    })();
    return {
      done,
      snapshot: () => machine.spoken,
      interrupt() { stopped = true; },
      skip() { stopped = true; },
      steer() { stopped = true; },
      hold() {},
      get holding() { return false; },
    };
  },
}));

/* The conversation on disk and what happens after a turn: both are other
   files' business and both have tests of their own. What is under test here is
   the order of the floor. */
const kept = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  room: null as unknown,
  /** A line whose append takes a moment to land, the way a real one does. */
  slow: '',
  /** And one the store will not take at all. */
  refuses: '',
  /** And one that lands nowhere: the conversation is another page's now. */
  lost: '',
}));
vi.mock('./room', () => ({
  opened: () => kept.room,
  openRoom: () => Promise.resolve(kept.room),
  lastWrote: () => {},
  Nowhere: class Nowhere extends Error {},
  // Written down when it *lands*, not when it is asked for: what is under test
  // in one of these is the order the store ends up in.
  write: (_room: unknown, row: Record<string, unknown>) => {
    if (kept.refuses && row.content === kept.refuses) {
      return Promise.reject(new Error('the store said no'));
    }
    // Nothing is written and nothing throws: the file moved on without this
    // page, which write() answers with rather than raises. See room.ts.
    if (kept.lost && row.content === kept.lost) return Promise.resolve('nowhere');
    if (kept.slow && row.content === kept.slow) {
      return new Promise<string>((go) => setTimeout(() => { kept.rows.push(row); go('written'); }, 5));
    }
    kept.rows.push(row);
    return Promise.resolve('written');
  },
  windowOf: () => 12,
}));
/* The one thing a leaving page can send: a beacon, which is the only request
   that outlives the document that started it. */
const beacons = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./files', () => ({
  beaconAppend: (_id: string, row: Record<string, unknown>) => {
    beacons.push(row);
    return true;
  },
}));
const after = vi.hoisted(() => ({turns: [] as string[], openings: 0}));
vi.mock('./after', () => ({
  afterTurn: (_room: unknown, o: {him: string}) => { after.turns.push(o.him); return Promise.resolve(); },
  sceneOpening: () => { after.openings += 1; return Promise.resolve(); },
}));

const {MACHINE, PAGE, setHost} = await import('@lucid/shell');
const {generation, floorHeld, playInto, silence, takeFloor} = await import('./floor');
const {press} = await import('./hands');
const {runTurn} = await import('./turn');
const {EMPTY, link} = await import('../link/store');

/** A queue that is always empty, so a turn is over when its words are. */
function fakePlayback(): Playback {
  return {
    enqueue() {}, credit() {}, stop() {}, hold() {},
    queuedS: 0, playingS: 0, playedS: 0, spokenChars: 0, playing: false, held: false,
    sinceStartMs: 0,
    stalled: false,
    position: () => 0,
    onChange: () => () => {},
    onUnheard: () => () => {},
    unlockOnce: () => () => {},
    dispose() {},
  } as unknown as Playback;
}

function fakeRoom(history: Message[] = []): Open {
  return {
    slug: 'lover',
    sessionId: 'a-session',
    persona: {slug: 'lover', name: 'Violet', pill: 'Violet', prompt: 'be yourself'} as Open['persona'],
    prompts: {system: 'aloud'},
    cfg: {
      memory: {enabled: true, fold_after: 4, max_bullets: 8},
      relation: {enabled: false, score: false},
      scene: {enabled: false, every_words: 300},
      llm: {context_turns: 6, context_words: 600, temperature: 0.8, top_p: 0.95},
    },
    memory: '',
    relation: null,
    scene: '',
    sceneAt: 0,
    sceneNew: true,
    history,
    foldedUpto: 0,
    folding: false,
    version: 0,
    voice: {speak: () => (async function* () {})(), stop() {}, close() {}, stats: {}},
  } as unknown as Open;
}

let room: Open;

beforeEach(() => {
  machine.asked.length = 0;
  machine.waiting.length = 0;
  machine.gated = false;
  machine.answer = 'Hello yourself.';
  machine.written = '';
  machine.spoken = 'Hello';
  machine.cut = false;
  machine.fails = null;
  machine.up = null;
  machine.woken = 0;
  machine.streams = false;
  beacons.length = 0;
  kept.rows.length = 0;
  kept.slow = '';
  kept.refuses = '';
  kept.lost = '';
  after.turns.length = 0;
  after.openings = 0;
  room = fakeRoom();
  kept.room = room;
  playInto(fakePlayback());
  link.setState({...EMPTY});
  // The pool, in case a test before this one left a press in it.
  press('');
});

afterEach(() => { setHost(MACHINE); });

/** Start a turn and let it get as far as the floor. */
const start = (o: Partial<Parameters<typeof runTurn>[0]> = {}) => {
  const running = runTurn({slug: 'lover', sessionId: 'a-session', text: 'hello', ...o});
  return running;
};
const settle = () => new Promise((go) => setTimeout(go, 0));

test('a turn says its half, is answered, and both halves are written down', async () => {
  await start({text: 'are you there'});
  expect(room.history).toEqual([
    {role: 'user', content: 'are you there'},
    {role: 'assistant', content: 'Hello yourself.'},
  ]);
  expect(kept.rows).toEqual([
    {kind: 'turn', role: 'user', content: 'are you there'},
    {kind: 'turn', role: 'assistant', content: 'Hello yourself.'},
  ]);
  expect(link.getState().state).toBe('idle');
  // And what it owes afterwards is asked for, once, off this turn's own path.
  expect(after.turns).toEqual(['are you there']);
});

test('a reply that broke off is kept as far as it got, marked cut, and shown to the model whole', async () => {
  machine.answer = 'I am here. I was thinking about the';
  machine.cut = true;
  await start({text: 'are you there'});
  // On the glass: finished (no caret), every word that came, marked.
  expect(link.getState().transcript.at(-1)).toEqual(
    {role: 'assistant', text: 'I am here. I was thinking about the', cut: true});
  // In the room and on disk the same words, marked, so a reload shows it as it was.
  expect(room.history[1]).toEqual({role: 'assistant', content: 'I am here. I was thinking about the', cut: true});
  expect(kept.rows[1]).toEqual({kind: 'turn', role: 'assistant', content: 'I am here. I was thinking about the',
                                cut: true});
  expect(link.getState().state).toBe('idle');
  expect(after.turns).toEqual(['are you there']);
  // And the next line is answered, the model shown only the sentence that ended.
  machine.cut = false;
  machine.answer = 'As I was saying.';
  await start({text: 'go on'});
  const sent = machine.asked[1]!.messages;
  expect(sent.map((m) => m.content)).toContain('I am here.');
  expect(sent.some((m) => m.content.includes('thinking about the'))).toBe(false);
});

test('one that broke off before a sentence ended is not shown to the model at all', async () => {
  machine.answer = 'I was thinking about the';
  machine.cut = true;
  await start({text: 'are you there'});
  expect(room.history[1]).toEqual({role: 'assistant', content: 'I was thinking about the', cut: true});
  // Nothing whole was said: nothing is judged or folded of it.
  expect(after.turns).toEqual([]);
  expect(link.getState().state).toBe('idle');
  machine.cut = false;
  await start({text: 'hello?'});
  const sent = machine.asked[1]!.messages.filter((m) => m.role !== 'system');
  expect(sent.map((m) => m.role)).toEqual(['user', 'user']);
  expect(sent.some((m) => m.content.includes('thinking'))).toBe(false);
});

test('a pill that stopped answering is said quietly and woken, and nothing is locked', async () => {
  const {NotAnswering} = await import('@lucid/machine');
  machine.streams = true;
  machine.answer = 'I am here. I was thinking about the';
  machine.cut = true;
  machine.fails = new NotAnswering('the language model stopped answering');
  await start({text: 'are you there'});
  // The quiet label, not the banner: Type and Talk stay lit.
  expect(link.getState().waking).toBe('waking');
  expect(link.getState().adrift).toBe(false);
  expect(machine.woken).toBe(1);
  expect(link.getState().transcript.at(-1)).toMatchObject({cut: true});
  // A line given meanwhile: the label says it is next, while it is asked...
  machine.cut = false;
  machine.fails = null;
  machine.answer = 'Here again.';
  machine.gated = true;
  const next = start({text: 'hello?'});
  await vi.waitFor(() => expect(machine.waiting).toHaveLength(1));
  expect(link.getState().waking).toBe('line');
  // ...and goes with the reply's first word.
  machine.waiting.shift()!();
  await next;
  expect(link.getState().waking).toBe('');
});

test('the label goes once the pill is up again, nobody having said a word', async () => {
  const {NotAnswering} = await import('@lucid/machine');
  machine.streams = true;
  machine.answer = 'I am here. I was thinking about the';
  machine.cut = true;
  machine.fails = new NotAnswering('the language model stopped answering');
  await start({text: 'are you there'});
  expect(link.getState().waking).toBe('waking');
  await vi.waitFor(() => expect(machine.up).not.toBeNull());
  machine.up!(true);
  await vi.waitFor(() => expect(link.getState().waking).toBe(''));
});

test('a pill that does not come up again keeps the label', async () => {
  const {NotAnswering} = await import('@lucid/machine');
  machine.streams = true;
  machine.answer = 'I was';
  machine.cut = true;
  machine.fails = new NotAnswering('the language model stopped answering');
  await start({text: 'are you there'});
  await vi.waitFor(() => expect(machine.up).not.toBeNull());
  machine.up!(false);
  await Promise.resolve();
  await Promise.resolve();
  expect(link.getState().waking).toBe('waking');
});

test('a voice that could not say a chunk is not the banner: the pill answered', async () => {
  const {VoiceFailed} = await vi.importActual<typeof import('@lucid/machine')>('@lucid/machine');
  machine.answer = 'I was here.';
  machine.fails = new VoiceFailed('no available backend found. ERR: [wasm] RuntimeError: Aborted()');
  await start({text: 'are you there'});
  expect(link.getState().adrift).toBe(false);
  expect(link.getState().waking).toBe('');
  expect(room.history.at(-1)).toMatchObject({role: 'assistant', content: 'I was here.'});
});

test('anything else that fails a reply is the banner, as before', async () => {
  machine.answer = 'I was';
  machine.cut = true;
  machine.fails = new Error('the language model answered 503');
  await start({text: 'are you there'});
  expect(link.getState().adrift).toBe(true);
  expect(link.getState().waking).toBe('');
  expect(machine.woken).toBe(0);
});

test('his line is kept as it was sent, so the next turn begins with the same bytes', async () => {
  room.cfg.scene.enabled = true;
  room.scene = 'a shop, late';
  room.prompts = {system: 'aloud', scene_intro: 'Where you are:'};
  await start({text: 'are you there'});
  await start({text: 'and now'});
  const [first, second] = machine.asked.map((a) => a.messages);
  // The room was pressed onto his line when it was sent...
  expect(first!.at(-1)!.content).toContain('a shop, late');
  // ...and is still on it the next turn, so everything in front of the new
  // line is the prompt the model server already has. That is the cache.
  expect(second!.slice(0, first!.length)).toEqual(first);
  expect(second).toHaveLength(first!.length + 2);
  // The words are what they were: on screen, on disk and in what is folded.
  expect(room.history[0]).toMatchObject({role: 'user', content: 'are you there'});
  expect(kept.rows[0]).toEqual({kind: 'turn', role: 'user', content: 'are you there'});
});

test('a reply keeps its tags for the model, and nowhere a person reads', async () => {
  room.tags = ['[laugh]'];
  room.prompts = {...room.prompts, sounds: 'Sounds: {tags}.'};
  machine.answer = 'You came back.';
  machine.written = 'You came back [laugh]';
  await start({text: 'hi'});
  expect(room.history[1]).toEqual({role: 'assistant', content: 'You came back.', sent: 'You came back [laugh]'});
  expect(kept.rows[1]).toEqual({kind: 'turn', role: 'assistant', content: 'You came back.',
                                sent: 'You came back [laugh]'});
  machine.written = '';
  await start({text: 'I did'});
  expect(machine.asked[1]!.messages.map((m) => m.content)).toContain('You came back [laugh]');
  // and a reply with nothing in it but words is kept as words, once
  expect(room.history[3]).toEqual({role: 'assistant', content: 'You came back.'});
});

test('a voice that performs no tags is asked for none and shown its replies without them', async () => {
  /* Sopro, a Mac voice that is not Turbo: the sounds as words, the history as
     read. A tag that slipped through is not shown back to it to copy. */
  room.tags = [];
  room.prompts = {system: 'aloud.{if no tags} No brackets.{end}', sounds: 'Sounds: {tags}.',
                  sounds_press: 'A sound, if the moment has one.'};
  room.persona = {...room.persona, prompt: 'Make {if tags}[laugh]{else}hah{end}.'};
  machine.answer = 'You came back.';
  machine.written = 'You came back [laugh]';
  await start({text: 'hi'});
  await start({text: 'I did'});
  const sent = machine.asked[1]!.messages;
  expect(sent[0]!.content).toBe('aloud. No brackets.\n\nMake hah.');
  expect(sent.map((m) => m.content)).toContain('You came back.');
  expect(sent.map((m) => m.content)).not.toContain('You came back [laugh]');
  expect(sent.at(-1)!.content).not.toContain('A sound');
  // What is kept still has the tag, for a voice that will perform it later.
  expect(room.history[1]).toEqual({role: 'assistant', content: 'You came back.', sent: 'You came back [laugh]'});
});

test('the prompt follows what will speak the reply: none while silent, the voice\'s tags when it is back',
  async () => {
    const {sound} = await import('@lucid/shell');
    room.tags = ['[laugh]'];
    room.prompts = {system: 'aloud.{if no tags} No brackets.{end}', sounds: 'Sounds: {tags}.'};
    await start({text: 'one'});
    sound.setHush(true);
    await start({text: 'two'});
    await start({text: 'three'});
    sound.setHush(false);
    await start({text: 'four'});
    const fronts = machine.asked.map((a) => a.messages[0]!.content);
    expect(fronts[0]).toBe('aloud.\nSounds: [laugh].\n\nbe yourself');
    expect(fronts[1]).toBe('aloud. No brackets.\n\nbe yourself');
    // Held while it holds, so the cache does: one miss each way, not one a turn.
    expect(fronts[2]).toBe(fronts[1]);
    expect(fronts[3]).toBe(fronts[0]);
  });

test('a hidden turn prompts the model without recording a user turn', async () => {
  await start({text: 'go on from where you were', hidden: true});
  expect(room.history).toEqual([{role: 'assistant', content: 'Hello yourself.'}]);
  expect(kept.rows).toEqual([{kind: 'turn', role: 'assistant', content: 'Hello yourself.'}]);
  // It is still shown to the model, on the end of the window and nowhere else.
  const last = machine.asked[0]!.messages.at(-1)!;
  expect(last.content).toContain('go on from where you were');
  // And nothing is drawn for it: the transcript stays a conversation.
  expect(link.getState().transcript.filter((t) => t.role === 'user')).toEqual([]);
});

test('five skips in one breath take one turn', async () => {
  const going: Array<Promise<void>> = [];
  const free = await takeFloor();            // the pill is mid-sentence
  for (let i = 0; i < 5; i++) {
    silence();                               // what Skip does before asking
    going.push(start({text: `skip ${i}`, hidden: true}));
  }
  await settle();
  free();
  await Promise.all(going);
  expect(machine.asked).toHaveLength(1);
  expect(machine.asked[0]!.messages.at(-1)!.content).toContain('skip 4');
});

test('stop means stop, even for something typed', async () => {
  /* With a long reply being spoken and two things typed behind it, pressing
     Stop and then hearing the machine work through the queue anyway is a key
     that does not do what it says. */
  const free = await takeFloor();
  const going = start({text: 'what did you mean by that'});
  await settle();
  silence();                                 // Stop, pressed on the voice
  free();
  await going;
  expect(machine.asked, 'it answered a line Stop had canceled').toHaveLength(0);
});

test('but the words are kept', async () => {
  /* The answer was canceled; the sentence was not. It is the part with nowhere
     else to live, and it was always going into the transcript — so it goes,
     and saying it again is what asks for an answer. */
  const free = await takeFloor();
  const going = start({text: 'what did you mean by that'});
  await settle();
  silence();
  free();
  await going;
  expect(room.history).toEqual([{role: 'user', content: 'what did you mean by that'}]);
  expect(kept.rows).toEqual([
    {kind: 'turn', role: 'user', content: 'what did you mean by that'},
  ]);
  // And it is on the glass, because it was drawn before it ever queued.
  expect(link.getState().transcript.map((t) => t.text))
    .toEqual(['what did you mean by that']);
});

test('a superseded turn nobody typed leaves nothing behind at all', async () => {
  const free = await takeFloor();
  const going = start({text: 'keep going', hidden: true});
  await settle();
  silence();
  free();
  await going;
  expect(room.history).toEqual([]);
  expect(kept.rows).toEqual([]);
});

test('every way out of a turn lets the floor go', async () => {
  /* Held past the end, nothing can ever take the floor again: the room goes
     silent and no key brings it back. Python read this out of the source
     because it had no way to ask; here it is a question the floor answers. */
  await start({text: 'hello'});
  expect(floorHeld()).toBe(false);

  machine.answer = '';                       // cut off before a token arrived
  await start({text: 'hello again'});
  expect(floorHeld()).toBe(false);

  const gen = generation();
  silence();
  await start({text: 'and again'});          // superseded before it began
  expect(floorHeld()).toBe(false);
  expect(generation()).toBe(gen + 1);
});

test('a press made while a turn was queued goes in with it', async () => {
  /* Which is what makes pressing during a reply feel like being noticed rather
     than queued: the pool is emptied inside the floor, so a press that landed
     while this turn was waiting is part of it. */
  const free = await takeFloor();
  const going = start({text: 'are you there'});
  await settle();
  press('(he pushes a book along the stone)');
  free();
  await going;
  expect(room.history[0]!.content)
    .toBe('are you there (he pushes a book along the stone)');
});

test('and one made during a run is a turn of its own beside the nudge', async () => {
  /* A nudge is machinery and stays out of the transcript; hands are not, and go
     in as the turn they are. So a run the pill is doing on its own can still be
     interrupted by somebody quietly pushing things off a shelf, and the record
     afterwards shows who did what. */
  const free = await takeFloor();
  const going = start({text: 'let it move now', hidden: true});
  await settle();
  press('(he tries the door)');
  free();
  await going;
  expect(room.history.map((m) => m.content)).toEqual([
    '(he tries the door)', 'Hello yourself.',
  ]);
});

test('the next turn cannot land on disk before the answer to this one', async () => {
  /* The assistant's line used to be written and forgotten while the floor was
     let go of in the same breath. A hands or continuous turn writes its user
     line within microseconds of that, both appends carried the same version,
     and whichever the store saw first won -- so the two halves came out
     swapped and the conversation read backwards on resume. */
  kept.slow = 'Hello yourself.';        // its append takes a moment to land
  const first = start({text: 'one'});
  const second = start({text: 'two'});
  await Promise.all([first, second]);
  expect(kept.rows.map((r) => r.content)).toEqual([
    'one', 'Hello yourself.', 'two', 'Hello yourself.',
  ]);
});

test('a muted room is a text-only one: the reply is given no voice at all',
  async () => {
    /* Not a volume of zero. Nothing is handed to the voice, so no socket is
       opened and the machine loads no voice for words nobody will hear — and
       the words still arrive, at a reading pace. See runReply, which takes
       null, and the pacer. */
    const {sound} = await import('@lucid/shell');
    await start({text: 'hello'});
    expect(machine.asked[0]?.voice).toBe(room.voice);

    sound.setHush(true);
    await start({text: 'and again'});
    expect(machine.asked[1]?.voice).toBeNull();

    // And turning it back on takes the voice with it, from the next reply.
    sound.setHush(false);
    await start({text: 'once more'});
    expect(machine.asked[2]?.voice).toBe(room.voice);
  });

test('the prefix is pushed through the model once, before anybody has spoken', async () => {
  const room = kept.room as {history: Message[]; warmed?: boolean};
  room.history.length = 0;
  const {warmPrefix} = await import('./turn');
  expect(await warmPrefix(room as never)).toBe(true);
  expect(machine.warms).toHaveLength(1);
  expect(machine.warms[0]!.max_tokens).toBe(1);
  expect(machine.warms[0]!.messages[0]!.role).toBe('system');
  // The system prompt, and a stand-in line for the template to end on.
  expect(machine.warms[0]!.messages).toHaveLength(2);
  expect(machine.warms[0]!.messages[1]!.role).toBe('user');
  // Once: the second ask costs nothing.
  expect(await warmPrefix(room as never)).toBe(false);
  expect(machine.warms).toHaveLength(1);
});

test('a reply the page left with is not written down again when the page comes back',
  async () => {
    /* `pagehide` fires for a page going into the back/forward cache as well as
       for one being closed, and what the beacon sends is the prefix that had
       been spoken by then. Come back, and the very same reply finished and
       wrote its line a second time: resume showed two assistant turns for one
       reply, and the file held the truncated one and the whole one. */
    const {keepOnLeaving} = await import('./turn');
    machine.gated = true;
    const going = start({text: 'are you there'});
    await settle();
    expect(keepOnLeaving()).toBe(true);
    expect(beacons.map((r) => r.content)).toEqual(['Hello']);

    machine.waiting.shift()!();              // the page came back; the reply lands
    await going;
    expect(room.history.filter((m) => m.role === 'assistant'))
      .toEqual([{role: 'assistant', content: 'Hello'}]);
    expect(kept.rows.filter((r) => r.role === 'assistant')).toEqual([]);
    // The glass is still finished off, or the bubble streams for ever.
    expect(link.getState().transcript.at(-1))
      .toMatchObject({role: 'assistant', text: 'Hello yourself.'});
  });

test('a line that could not be written down is a console line, not a dead machine',
  async () => {
    /* `adrift` is the amber banner and the locked keys, and it means the
       machine is not answering. A refused append is not that -- it answered,
       and the reply is on the glass -- and raising it there flashed "not
       answering" over a working machine until the next poll cleared it, with
       Talk and Type locked in between. */
    const {hatch} = await import('@lucid/shell');
    const said: string[] = [];
    const console = vi.spyOn(hatch, 'say').mockImplementation((text) => { said.push(text); });
    kept.refuses = 'Hello yourself.';
    await start({text: 'are you there'});
    console.mockRestore();
    expect(link.getState().adrift).toBe(false);
    expect(said.some((l) => l.includes('could not write that down'))).toBe(true);
  });

test('a turn whose line landed nowhere is not answered at all', async () => {
  /* Another page wrote into this conversation between the last turn and this
     one, so his line was refused and the banner is up. What used to happen
     next was the whole of a turn: the prompt assembled, a minute of the model
     spent, the answer spoken and drawn -- and its own write refused in the
     same way, so the exchange on the glass was on no disk anywhere and went
     at the next reload. */
  kept.lost = 'are you there';
  await start({text: 'are you there'});
  expect(machine.asked, 'it asked the model for a reply it cannot keep').toHaveLength(0);
  expect(kept.rows).toEqual([]);
  expect(link.getState().transcript.filter((t) => t.role === 'assistant')).toEqual([]);
  // And nothing was owed afterwards either: there was no turn.
  expect(after.turns).toEqual([]);
  expect(link.getState().state).toBe('idle');
});

test('with the scene off, on any host, the room is said once at the end of the system prompt', async () => {
  room.scene = 'a shop, late';
  room.prompts = {system: 'aloud', scene_intro: 'Where you are:'};
  await start({text: 'are you there'});
  await start({text: 'and now'});
  const [first, second] = machine.asked.map((a) => a.messages);
  expect(first![0]!.content).toMatch(/be yourself\n\nWhere you are:\na shop, late$/);
  // On none of his lines, so the window does not carry it four times over...
  expect(second!.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['are you there', 'and now']);
  // ...and the front is the same bytes turn after turn: the cache holds.
  expect(second!.slice(0, first!.length)).toEqual(first);
  // In a browser the same.
  setHost(PAGE);
  await start({text: 'in a browser'});
  expect(machine.asked[2]!.messages[0]!.content).toBe(first![0]!.content);
  // With the scene on, it is pressed onto his line as it was.
  setHost(MACHINE);
  room.cfg.scene.enabled = true;
  await start({text: 'with the scene on'});
  expect(machine.asked[3]!.messages[0]!.content).not.toContain('a shop, late');
  expect(machine.asked[3]!.messages.at(-1)!.content).toContain('a shop, late');
});

test('from a censored model, a reply it gave as itself is shown and kept, and never read again', async () => {
  setHost({...MACHINE, censored: true});
  machine.answer = "I can't continue this roleplay.";
  await start({text: 'kiss me'});
  // What was said is what was said: on the glass, in the history, on disk.
  expect(room.history[1]).toEqual({role: 'assistant', content: "I can't continue this roleplay."});
  expect(kept.rows[1]).toMatchObject({role: 'assistant', content: "I can't continue this roleplay."});
  machine.answer = 'Mm. Come here.';
  await start({text: 'come here'});
  const next = machine.asked[1]!.messages;
  // Not in the window: his line stays, her refusal does not.
  expect(next.map((m) => m.content)).toEqual(['aloud\n\nbe yourself', 'kiss me', 'come here']);
  // From a model nobody flagged it is shown back like any other reply, in a browser too.
  setHost(PAGE);
  await start({text: 'and from another'});
  expect(machine.asked[2]!.messages.map((m) => m.content)).toContain("I can't continue this roleplay.");
});

test('a heard line that goes no further says why, quietly, and never its words', async () => {
  /* 10-12: from the room, a line heard and never shown is a microphone that
     stopped working. Where the page itself drops one, it says so at debug. */
  const {hatch} = await import('@lucid/shell');
  const said: Array<[string, string | undefined]> = [];
  const console = vi.spyOn(hatch, 'say').mockImplementation((text, level) => { said.push([text, level]); });
  try {
    setHost({llm: 'none'});
    await start({text: 'are you there', heard: true});
    await start({text: 'typed, not heard'});
  } finally {
    console.mockRestore();
    setHost(MACHINE);
  }
  expect(said).toEqual([['a heard line (13 characters) dropped: there is no language model here', 'debug']]);
  expect(machine.asked).toHaveLength(0);
});
