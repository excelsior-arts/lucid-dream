/* What a turn owes once it has been said.
 *
 * Three files nobody is supposed to open sit on the path between a
 * conversation and how the room looks: what a pill remembers, where you stand,
 * and where the two of you are. The arithmetic each of these calls into is
 * tested beside it -- memory.test.ts, relation.test.ts, scene.test.ts. What is
 * here is when the three of them run and what moves when they do.
 */
import {beforeEach, expect, test, vi} from 'vitest';
import type {Message} from '@lucid/machine';
import type {Open} from './room';

const said = vi.hoisted(() => [] as string[]);
vi.mock('@lucid/shell', () => ({
  hatch: {say: (line: string) => { said.push(line); }},
  // A model nobody flagged: the refusal guard is refusal.test's and character.test's business.
  host: () => ({llm: 'machine', censored: false}),
}));

/** A language model that says what it is told to say, and remembers what it
    was asked. */
const model = vi.hoisted(() => ({
  answers: [] as string[],
  asked: [] as Array<{system: string; user: string; temperature?: number | null;
                      max_tokens?: number | null}>,
  /** A hand on the model: with this held, an answer waits until the test lets
      it go -- which is where a person edits a memory or resets a standing. */
  gated: false,
  waiting: [] as Array<() => void>,
}));
vi.mock('@lucid/machine', () => ({
  streamChat(o: {messages: Message[]; temperature?: number | null;
                 max_tokens?: number | null}) {
    model.asked.push({
      system: o.messages[0]?.content ?? '',
      user: o.messages[1]?.content ?? '',
      temperature: o.temperature,
      max_tokens: o.max_tokens,
    });
    const answer = model.answers.shift() ?? '';
    return (async function* () {
      if (model.gated) await new Promise<void>((go) => { model.waiting.push(go); });
      yield answer;
    })();
  },
}));

const disk = vi.hoisted(() => ({
  memory: [] as string[],
  relation: [] as unknown[],
  erased: [] as string[],
}));
vi.mock('./files', () => ({
  saveMemory: (_slug: string, text: string) => {
    disk.memory.push(text);
    return Promise.resolve({text});
  },
  saveRelation: (_slug: string, state: unknown) => {
    disk.relation.push(state);
    return Promise.resolve(state);
  },
  resetRelation: (slug: string) => {
    disk.erased.push(slug);
    return Promise.resolve(true);
  },
}));

/* Which room this page is in. Every write below asks: all of this runs while
   a reply drains, and the pill can be ejected in the middle of it. */
const page = vi.hoisted(() => ({here: null as unknown}));
const rows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./room', () => ({
  opened: () => page.here,
  touched: (room: {epoch: number} | null) => { if (room) room.epoch += 1; },
  write: (_room: unknown, row: Record<string, unknown>) => {
    rows.push(row);
    return Promise.resolve();
  },
  windowOf: (cfg: {llm: {context_turns: number}}) => cfg.llm.context_turns * 2,
}));

const {afterTurn, clearStanding, maybeFold, maybeScene, saveMemory, sceneOpening,
       scoreRelation} = await import('./after');
const {EMPTY, link} = await import('../link/store');
const {blank} = await import('./relation');

const PROMPTS = {
  fold_system: 'fold what is true',
  fold_user: 'CURRENT MEMORY:\n{existing}\n\nFORGETTING:\n{dropped}\n\n{max_bullets} bullets.',
  scene_system: 'where are they',
  scene_user: '{heading}\n\n{previous}\n\nSince:\n{recent}\n\n{ask}',
  relation_system: 'judge it',
  relation_user: 'HIM:\n{him_said}\n\nHER:\n{her_said}',
};

function fakeRoom(o: Partial<Open> = {}): Open {
  const room = {
    slug: 'lover',
    sessionId: 'a-session',
    persona: {slug: 'lover', name: 'Violet', pill: 'Violet'},
    prompts: PROMPTS,
    cfg: {
      memory: {enabled: true, fold_after: 4, max_bullets: 8},
      relation: {enabled: true, score: true},
      scene: {enabled: true, every_words: 300},
      llm: {context_turns: 2, context_words: 600, temperature: 0.8, top_p: 0.95},
    },
    memory: '',
    relation: null,
    scene: '',
    sceneAt: 0,
    sceneNew: true,
    history: [],
    foldedUpto: 0,
    folding: false,
    version: 0,
    epoch: 0,
    ...o,
  } as unknown as Open;
  // The room a test makes is the room the page is in, unless it says otherwise.
  page.here = room;
  return room;
}

/** A conversation long enough that some of it has fallen out of the window. */
const talk = (n: number): Message[] =>
  Array.from({length: n}, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: i % 2 ? 'Older or younger?' : 'I have a brother',
  } as Message));

beforeEach(() => {
  said.length = 0;
  model.answers.length = 0;
  model.asked.length = 0;
  model.gated = false;
  model.waiting.length = 0;
  disk.memory.length = 0;
  disk.relation.length = 0;
  rows.length = 0;
  disk.erased.length = 0;
  page.here = null;
  link.setState({...EMPTY, slug: 'lover'});
});

/* ---- memory --------------------------------------------------------------- */

test('what the model returns is what is kept', async () => {
  const room = fakeRoom({history: talk(10)});
  model.answers.push('- he has a brother\n- he hates the cold');
  await maybeFold(room);
  expect(disk.memory).toEqual(['- he has a brother\n- he hates the cold']);
  expect(room.memory).toContain('brother');
  // Six of ten fell out of a window that holds four.
  expect(room.foldedUpto).toBe(6);
  // And the sheet inside the lid is looking at the same text.
  expect(link.getState().remembered?.text).toContain('brother');
  expect(model.asked[0]?.temperature).toBe(0.3);
  expect(model.asked[0]?.max_tokens).toBe(400);
});

test('a fold that says nothing usable says so, and the mark does not move', async () => {
  /* The caller moves its "already folded" mark on the strength of this answer.
     A fold that returned the old memory looked like a success, and those turns
     went out of the window and out of the memory both. */
  for (const empty of ['', '   ', 'Here is the updated memory:', 'Sure!']) {
    const room = fakeRoom({history: talk(10), memory: '- what was already there'});
    model.answers.push(empty);
    await maybeFold(room);
    expect(room.foldedUpto).toBe(0);
    expect(room.memory).toBe('- what was already there');
  }
  expect(disk.memory).toEqual([]);
  expect(said.some((l) => l.includes('came back empty'))).toBe(true);
});

test('nothing that has fallen out means nothing asked of the model', async () => {
  const room = fakeRoom({history: talk(4)});
  await maybeFold(room);
  expect(model.asked).toEqual([]);
});

test('the model is shown what it already knew, and who said which line', async () => {
  /* Named, not roled. Handed "user:" and "assistant:", the folder wrote its
     memories about "the assistant" — and read everything on a user: line as
     something he said about himself. */
  const room = fakeRoom({history: talk(10), memory: '- he has a brother'});
  model.answers.push('- he has a brother\n- and a sister');
  await maybeFold(room);
  expect(model.asked[0]?.user).toContain('- he has a brother');
  expect(model.asked[0]?.user).toContain('him: I have a brother');
  expect(model.asked[0]?.user).toContain('Violet: Older or younger?');
  expect(model.asked[0]?.user).toContain('8 bullets');
});

test('two folds at once are one fold', async () => {
  /* Both read the same memory and both write: the later one wins and the
     earlier fold's turns are lost for good, because the mark has already moved
     past them. */
  const room = fakeRoom({history: talk(10)});
  model.answers.push('- one', '- two');
  await Promise.all([maybeFold(room), maybeFold(room)]);
  expect(disk.memory).toEqual(['- one']);
});

test('memory switched off is a fold that never happens', async () => {
  const room = fakeRoom({history: talk(10)});
  room.cfg.memory.enabled = false;
  await maybeFold(room);
  expect(model.asked).toEqual([]);
});

/* ---- where you stand ------------------------------------------------------ */

test('a scored exchange moves the axes, writes them, and lights the room', async () => {
  const room = fakeRoom({relation: blank()});
  model.answers.push('{"warmth": 2, "trust": 1, "mood": 0, "why": "he was kind"}');
  await scoreRelation(room, 'you looked tired', 'I am, a little.');
  expect(room.relation!.warmth).toBeGreaterThan(0);
  expect(disk.relation).toHaveLength(1);
  // The room recolours off the store, through the same door the socket's own
  // relation message came in by.
  expect(link.getState().relation?.state.warmth).toBeGreaterThan(0);
  expect(link.getState().standing.word).toBeTruthy();
  expect(model.asked[0]?.temperature).toBe(0.1);
  expect(model.asked[0]?.max_tokens).toBe(48);
});

test('and it is shown the exchange and nothing else, her half clipped', async () => {
  const room = fakeRoom({relation: blank()});
  model.answers.push('{"warmth": 1}');
  await scoreRelation(room, 'you looked tired', 'x'.repeat(900));
  expect(model.asked[0]?.user).toContain('you looked tired');
  expect(model.asked[0]?.user).toContain('x'.repeat(400));
  expect(model.asked[0]?.user).not.toContain('x'.repeat(401));
});

test('a judgement that moves nothing writes nothing', async () => {
  const room = fakeRoom({relation: blank()});
  model.answers.push('{"warmth": 0, "trust": 0, "mood": 0}');
  await scoreRelation(room, 'mm', 'mm');
  expect(disk.relation).toEqual([]);
  expect(link.getState().relation).toBeNull();
});

test('an answer that is not JSON at all leaves the standing where it was', async () => {
  const room = fakeRoom({relation: blank()});
  model.answers.push('I would rather not say.');
  await scoreRelation(room, 'well?', 'nothing');
  expect(disk.relation).toEqual([]);
});

test('scoring switched off freezes the state where it is', async () => {
  const room = fakeRoom({relation: blank()});
  room.cfg.relation.score = false;
  await scoreRelation(room, 'hello', 'hello');
  expect(model.asked).toEqual([]);
});

test('and a hidden turn is never judged: there is nothing about you in it', async () => {
  const room = fakeRoom({relation: blank(), history: talk(2)});
  room.cfg.scene.enabled = false;
  await afterTurn(room, {him: 'keep going', her: 'she does', hidden: true});
  expect(model.asked).toEqual([]);
});

/* ---- the scene ------------------------------------------------------------ */

test('the opening note is written from his turn alone', async () => {
  const room = fakeRoom({history: [{role: 'user', content: 'we are on a ship'}],
                         scene: 'a library with the window open'});
  model.answers.push('Place: the deck of a ship at night');
  await sceneOpening(room);
  expect(room.scene).toBe('Place: the deck of a ship at night');
  expect(rows).toEqual([{kind: 'scene', text: 'Place: the deck of a ship at night'}]);
  expect(link.getState().scene).toBe('Place: the deck of a ship at night');
  // Only the Place line, and cheaply: this is the one thing an evening waits on.
  expect(model.asked[0]?.user).toContain('they have not spoken');
  expect(model.asked[0]?.max_tokens).toBe(40);
  // The seed is named as a guess rather than as a scene somebody took.
  expect(model.asked[0]?.user).toContain('which nobody has confirmed yet');
});

test('an evening that opens with a press keeps the seed', async () => {
  /* Hands act inside a place and never declare one: "he puts his hand out over
     the edge" means nothing without the room still being there. */
  const room = fakeRoom({history: [{role: 'user', content: '(he tries the door)'}],
                         scene: 'a library'});
  await sceneOpening(room);
  expect(model.asked).toEqual([]);
  expect(room.scene).toBe('a library');
  expect(room.sceneNew).toBe(true);
});

test('and only on the opening turn', async () => {
  const room = fakeRoom({history: talk(3), scene: 'a library'});
  await sceneOpening(room);
  expect(model.asked).toEqual([]);
});

test('the note comes early while the place is still a guess', async () => {
  /* Waiting three hundred words to replace the room's own description of itself
     meant the note pulled the conversation back to a place it had already left. */
  const room = fakeRoom({history: talk(2), scene: 'a library', sceneNew: true});
  model.answers.push('Place: a ship');
  await maybeScene(room);
  expect(room.scene).toBe('Place: a ship');
  expect(room.sceneAt).toBe(2);
  expect(model.asked[0]?.max_tokens).toBe(120);
});

test('and afterwards waits for enough to have been said', async () => {
  const room = fakeRoom({history: talk(6), scene: 'a ship', sceneNew: false, sceneAt: 2});
  await maybeScene(room);
  expect(model.asked, 'it wrote the room down again after four short turns')
    .toEqual([]);

  // Words spoken since the last note, not turns: one reply can be worth forty.
  room.history.push({role: 'assistant', content: 'word '.repeat(400)});
  model.answers.push('Place: below deck');
  await maybeScene(room);
  expect(room.scene).toBe('Place: below deck');
  // A settled place is offered as one somebody took, not as a guess.
  expect(model.asked[0]?.user).toContain('Where the scene was');
});

test('a note that says they are not anywhere carries nothing forward', async () => {
  const room = fakeRoom({history: talk(2), scene: 'a ship', sceneNew: true});
  model.answers.push('none');
  await maybeScene(room);
  expect(room.scene).toBe('a ship');       // nothing new to write down
  expect(rows).toEqual([]);
});

test('the scene switched off is a note that is never taken', async () => {
  const room = fakeRoom({history: talk(2), sceneNew: true});
  room.cfg.scene.enabled = false;
  await maybeScene(room);
  await sceneOpening(room);
  expect(model.asked).toEqual([]);
});

/* ---- and the order they go in --------------------------------------------- */

test('the fold, the room and the judgement take their turn rather than racing', async () => {
  /* They share a model that answers one request at a time, so every token one
     of them spends is a token the next reply waits for. */
  const room = fakeRoom({history: talk(10), relation: blank(), sceneNew: false, sceneAt: 0});
  room.history.push({role: 'user', content: 'word '.repeat(400)});
  model.answers.push('- a bullet', 'Place: a ship',
                     '{"warmth": 1, "trust": 0, "mood": 0}');
  await afterTurn(room, {him: 'you looked tired', her: 'I am', hidden: false});
  expect(model.asked.map((a) => a.system))
    .toEqual(['fold what is true', 'where are they', 'judge it']);
});

test('what the console is told about a judgement is the numbers, not the reason', async () => {
  /* The log rule: the scorer's `why` is a sentence written out of the exchange
     it was shown, and this game's logs never carry what was said. It is in the
     relation file, which is where somebody asking "why did it move" looks. */
  const room = fakeRoom({relation: blank()});
  model.answers.push('{"warmth": 2, "trust": 1, "mood": 0, "why": "he told her about the dog"}');
  await scoreRelation(room, 'my dog died', 'I am sorry.');
  const line = said.find((l) => l.startsWith('standing moved')) ?? '';
  expect(line).toBeTruthy();
  expect(line).not.toContain('(');
  expect(line).not.toContain('dog');
  // And the reason is kept where it belongs.
  expect(JSON.stringify(disk.relation[0])).toContain('he told her about the dog');
});

/* ---- the sheets, which are two files somebody edits by hand --------------- */

test('memory saved on the sheet is in the room as well as on disk', async () => {
  /* "*I never had a dog* removes the dog" has to hold in the sitting it was
     said in. The room read the memory on its way in and prompts from what it
     read; a save that only wrote the file was overwritten by the next fold. */
  const room = fakeRoom({memory: '- he has a dog', history: talk(10)});
  await saveMemory('lover', '- he has a brother');
  expect(disk.memory).toEqual(['- he has a brother']);
  expect(room.memory).toBe('- he has a brother');
  expect(link.getState().remembered).toEqual({slug: 'lover', text: '- he has a brother',
                                              off: false});
  // And the next fold folds over what was saved, not over what was read at the door.
  model.answers.push('- he has a brother\n- and a sister');
  await maybeFold(room);
  expect(model.asked[0]?.user).toContain('- he has a brother');
  expect(model.asked[0]?.user).not.toContain('dog');
});

test('and another pill\'s memory does not land in this room', async () => {
  const room = fakeRoom({memory: '- he has a dog'});
  await saveMemory('thinker', '- something else');
  expect(room.memory).toBe('- he has a dog');
  expect(link.getState().remembered?.slug).toBe('thinker');
});

test('a standing cleared is cleared in the room, not only in the file', async () => {
  /* The file goes and the room was still holding the old numbers: the next
     scored turn applied its deltas to those and wrote the whole thing back, so
     a reset was undone by the next thing said. */
  const room = fakeRoom({relation: blank()});
  room.relation!.warmth = 40;
  link.setState({standing: {word: 'warm'}});
  await clearStanding('lover');
  expect(disk.erased).toEqual(['lover']);
  expect(room.relation).toBeNull();
  expect(link.getState().standing).toEqual({});
  expect(link.getState().relation).toBeNull();

  // And the next turn scores from nothing rather than from the old warmth.
  model.answers.push('{"warmth": 1, "trust": 0, "mood": 0}');
  await scoreRelation(room, 'hello', 'hello');
  expect(room.relation!.warmth).toBe(1);
});

/* ---- and a room somebody has left ----------------------------------------- */

test('the fold of a room you have left does not land on the next one', async () => {
  /* All of this runs while the audio drains, so ejecting mid-drain used to put
     the old pill's memory, scene and standing onto the new pill's page and
     files. The turns are not lost: the mark only moves on a fold that wrote,
     so they are folded again after the next turn. */
  const room = fakeRoom({history: talk(10)});
  model.answers.push('- he has a brother');
  page.here = fakeRoom({slug: 'thinker'});      // the pill was ejected
  await maybeFold(room);
  expect(disk.memory).toEqual([]);
  expect(room.foldedUpto).toBe(0);
  expect(link.getState().remembered).toBeNull();
});

test('nor does its scene, its standing or the rest of what it owed', async () => {
  const room = fakeRoom({history: talk(10), relation: blank(), sceneNew: false, sceneAt: 0});
  room.history.push({role: 'user', content: 'word '.repeat(400)});
  model.answers.push('- a bullet', 'Place: a ship', '{"warmth": 3, "trust": 0, "mood": 0}');
  page.here = null;                              // the room was left
  await afterTurn(room, {him: 'you looked tired', her: 'I am', hidden: false});
  expect(model.asked).toEqual([]);
  expect(rows).toEqual([]);
  expect(disk.memory).toEqual([]);
  expect(disk.relation).toEqual([]);
  expect(link.getState().standing).toEqual({});
});

test('and a standing scored just as the room changed is not written anywhere', async () => {
  const room = fakeRoom({relation: blank()});
  model.answers.push('{"warmth": 2, "trust": 1, "mood": 0}');
  const scoring = scoreRelation(room, 'you looked tired', 'I am');
  page.here = fakeRoom({slug: 'thinker'});      // ejected while the model answered
  await scoring;
  expect(disk.relation).toEqual([]);
  expect(link.getState().relation).toBeNull();
});

/* ---- and a hand on it while the model was still thinking ------------------
 *
 * The fold and the judgement are each a model call long, and inside that
 * minute somebody can rewrite a memory on the sheet or reset a standing from
 * the console. Both of them then had an answer about the room as it was before
 * that, and wrote it: the edit went back the way it was, seconds after it was
 * made, in a file nobody is looking at. */

/** Let everything in flight get as far as the model. */
const reachTheModel = () => new Promise((go) => { setTimeout(go, 0); });

test('a memory written by hand mid-fold is the memory that stands', async () => {
  const room = fakeRoom({history: talk(10), memory: '- he has a dog'});
  model.answers.push('- he has a dog\n- and a brother');
  model.gated = true;
  const folding = maybeFold(room);
  await reachTheModel();
  await saveMemory('lover', '- he never had a dog');
  model.waiting.shift()!();
  await folding;
  expect(disk.memory, 'the fold wrote over the edit').toEqual(['- he never had a dog']);
  expect(room.memory).toBe('- he never had a dog');
  // And the turns are not lost: the mark did not move, so they are folded into
  // what was written by hand after the next turn.
  expect(room.foldedUpto).toBe(0);
  expect(said.some((l) => l.includes('written by hand'))).toBe(true);
});

test('and a standing reset mid-judgement stays reset', async () => {
  const room = fakeRoom({relation: blank()});
  room.relation!.warmth = 40;
  model.answers.push('{"warmth": 2, "trust": 1, "mood": 0, "why": "he was kind"}');
  model.gated = true;
  const scoring = scoreRelation(room, 'you looked tired', 'I am, a little.');
  await reachTheModel();
  await clearStanding('lover');
  model.waiting.shift()!();
  await scoring;
  expect(disk.relation, 'the judgement put the standing back').toEqual([]);
  expect(room.relation).toBeNull();
  expect(link.getState().standing).toEqual({});
  expect(said.some((l) => l.includes('changed while that was being judged'))).toBe(true);
});

test('a room closed under the work is the same rule', async () => {
  /* `still` catches this on its own; the count is what catches anything
     holding the record rather than asking which room is open. */
  const room = fakeRoom({history: talk(10)});
  model.answers.push('- he has a brother');
  model.gated = true;
  const folding = maybeFold(room);
  await reachTheModel();
  room.epoch += 1;                     // what leaveRoom does on the way out
  model.waiting.shift()!();
  await folding;
  expect(disk.memory).toEqual([]);
  expect(room.foldedUpto).toBe(0);
});
