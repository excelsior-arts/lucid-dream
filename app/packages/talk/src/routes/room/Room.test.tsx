/* The route: what it opens, what it presses, and what it gives back.
 *
 * Nothing is stubbed but the conversation itself, at the doors the route
 * knocks on — a room to open, a turn to answer, a loop to press keys against.
 * Everything else here is the code the page runs: the store the deck reads,
 * the microphone, the detector, the line at the bottom of the screen.
 *
 * There is no socket to stub. Every key is answered in this page, and the one
 * thing worth holding still is that each of them reaches the right door.
 */
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Link, MemoryRouter, Route, Routes} from 'react-router';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import type {PersonaCard} from '../../link/shapes';
import {EMPTY, link} from '../../link/store';

/* The conversation, stubbed at the two doors the route uses: a room to open,
   and a turn to answer. What is under test is which door a press reaches, and
   never what is behind it. */
const conversation = vi.hoisted(() => ({
  turns: [] as Array<{slug: string; sessionId: string; text: string}>,
  opened: [] as string[],
  /** How many times a page going away asked for the reply to be kept. */
  kept: 0,
}));
vi.mock('../../conversation/turn', () => ({
  runTurn: (o: {slug: string; sessionId: string; text: string}) => {
    conversation.turns.push(o);
    return Promise.resolve();
  },
  openRoom: (slug: string, want: string) => {
    conversation.opened.push(`${slug}|${want}`);
    return Promise.resolve({slug, sessionId: want || 'a-fresh-one',
                            cfg: {ui: {continuous_minutes: 15}}});
  },
  playInto: () => {},
  leaveRoom: () => {},
  current: () => null,
  keepOnLeaving: () => {
    conversation.kept += 1;
    return true;
  },
}));

/* And the loop it hands the evening to, stubbed at every door the route knocks
   on -- see loop.test.ts for what is behind each of them. */
const loop = vi.hoisted(() => ({calls: [] as string[]}));
vi.mock('../../conversation/loop', () => ({
  cutIn: () => { loop.calls.push('cut'); return true; },
  clearSession: () => {
    loop.calls.push('clear');
    return Promise.resolve({sessionId: 'a-new-one'});
  },
  deleteTurn: (role: string, text: string) => {
    loop.calls.push(`delete ${role} ${text}`);
    return Promise.resolve(true);
  },
  did: (text: string) => loop.calls.push(`did ${text}`),
  handsSoon: () => loop.calls.push('hands'),
  holdContinuous: (on: boolean) => { loop.calls.push(`hold ${on}`); return true; },
  leaveLoop: () => loop.calls.push('leave'),
  putItBack: () => loop.calls.push('back'),
  skip: () => loop.calls.push('skip'),
  speakAgain: (text: string) => { loop.calls.push(`again ${text}`); return Promise.resolve(); },
  startContinuous: (minutes: number, atOnce: boolean) => {
    loop.calls.push(`play ${minutes} ${atOnce}`);
    return true;
  },
  stop: () => loop.calls.push('stop'),
  stopContinuous: () => loop.calls.push('stop tape'),
}));
vi.mock('../../conversation/room', () => ({
  Nowhere: class Nowhere extends Error {},
  opened: () => null,
  forgetRoomState: () => {
    loop.calls.push('room clear');
    return Promise.resolve();
  },
  saveRoomState: (state: unknown) => {
    loop.calls.push('room ' + JSON.stringify(state));
    return Promise.resolve({});
  },
  refreshPersona: () => {
    loop.calls.push('persona again');
    return Promise.resolve();
  },
}));

/* The character's own two files, in a bag. Everything above them is the real
   thing -- the layering in conversation/persona.ts and the words the game
   ships -- because what is under test is the four commands reaching a
   character, and a stubbed character would only test the stub. */
const bag = vi.hoisted(() => ({files: new Map<string, string>(), wrote: [] as string[]}));
const at = (slug: string, name: string) => `personas/${slug}/${name}`;
vi.mock('../../conversation/files', () => ({
  config: () => Promise.resolve({}),
  memory: () => Promise.resolve(''),
  personaPrompt: (slug: string) =>
    Promise.resolve(bag.files.get(at(slug, 'prompt.md')) ?? null),
  savePersonaPrompt: (slug: string, text: string) => {
    bag.wrote.push(`prompt ${slug}`);
    bag.files.set(at(slug, 'prompt.md'), text.trim() + '\n');
    return Promise.resolve();
  },
  forgetPersonaPrompt: (slug: string) => {
    bag.wrote.push(`prompt gone ${slug}`);
    return Promise.resolve(bag.files.delete(at(slug, 'prompt.md')));
  },
  personaTunables: (slug: string) => {
    const raw = bag.files.get(at(slug, 'tunables.json'));
    return Promise.resolve(raw === undefined ? null : JSON.parse(raw));
  },
  savePersonaTunables: (slug: string, tuned: unknown) => {
    bag.wrote.push(`tunables ${slug}`);
    bag.files.set(at(slug, 'tunables.json'), JSON.stringify(tuned));
    return Promise.resolve();
  },
  forgetPersonaTunables: (slug: string) => {
    bag.wrote.push(`tunables gone ${slug}`);
    return Promise.resolve(bag.files.delete(at(slug, 'tunables.json')));
  },
}));

const {default: Room} = await import('./Room');
const {all} = await import('../../conversation/bundle');
const {forget} = await import('../../conversation/persona');
const {hatch, sound} = await import('@lucid/shell');

const PILL = {slug: 'lover', name: 'Violet', figure: 'diamond'} as unknown as PersonaCard;

const show = (at = '/talk/lover') => render(
  <MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path="/talk" element={<div>the box</div>} />
      <Route path="/talk/:slug" element={<Room />} />
    </Routes>
  </MemoryRouter>);

beforeEach(() => {
  // jsdom has no media element to speak of, and the unlock a press buys is a
  // silent play() on one.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  conversation.turns.length = 0;
  conversation.opened.length = 0;
  conversation.kept = 0;
  loop.calls.length = 0;
  bag.files.clear();
  bag.wrote.length = 0;
  hatch.rows.length = 0;
  forget();
  localStorage.clear();
  // The mute switch outlives a render — it is the shell's, not a room's — so
  // it is put back rather than left where the last test left it.
  sound.setHush(false);
  link.setState({...EMPTY});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('it opens the pill in the address, and the conversation with it', async () => {
  show('/talk/lover?session=2026-01-02T03-04-05_lover');
  await waitFor(() => expect(conversation.opened)
    .toEqual(['lover|2026-01-02T03-04-05_lover']));
});

test('and gives the conversation back on the way out', async () => {
  const shown = show();
  await waitFor(() => expect(conversation.opened).toHaveLength(1));
  shown.unmount();
  expect(loop.calls).toContain('leave');
});

test('the page says what it is, on the document itself', () => {
  const shown = show();
  const root = document.documentElement;
  expect(root.dataset.page).toBe('room');
  expect(root.dataset.room).toBe('lover');
  shown.unmount();
  expect(root.dataset.page).toBeUndefined();
  expect(root.classList.contains('waking')).toBe(false);
});

test('a pill that is not in the box goes back to where the pills are', async () => {
  link.setState({personas: [PILL]});
  show('/talk/blunt');
  await waitFor(() => expect(screen.getByText('the box')).toBeInTheDocument());
  // Nothing was opened for it: there is nothing there to open.
  expect(conversation.opened).toHaveLength(0);
});

test('every key is answered here', () => {
  link.setState({
    slug: 'lover', sid: 'a-session', minutes: 20, running: true, state: 'speaking',
    transcript: [{role: 'user', text: 'hello'}, {role: 'assistant', text: 'hello yourself'}],
  });
  show();
  // By id, not by name: the tools on a bubble say "say it again" too.
  const press = (key: string) => fireEvent.click(document.getElementById('t-' + key)!);
  press('back');
  press('play');
  press('skip');
  press('stop');
  press('pause');
  // A line typed, a line deleted, and a line asked for again from the glass.
  const box = document.getElementById('text') as HTMLTextAreaElement;
  fireEvent.change(box, {target: {value: 'are you there'}});
  fireEvent.keyDown(box, {key: 'Enter'});
  fireEvent.click(document.querySelector('#chat .msg .replay')!);
  fireEvent.click(document.querySelectorAll('#chat .msg')[1]!.querySelector('.del')!);

  expect(loop.calls).toEqual(expect.arrayContaining([
    'again hello yourself', 'play 20 true', 'skip', 'stop',
    'delete assistant hello yourself',
    // And the mark on a bubble asks for the same line the same way.
    'again hello yourself',
  ]));
  expect(conversation.turns).toEqual([
    {slug: 'lover', sessionId: 'a-session', text: 'are you there'},
  ]);
});

test('play lets a running tape go rather than starting a second one', () => {
  link.setState({transcript: [{role: 'user', text: 'hello'}], continuous: true});
  show();
  fireEvent.click(document.getElementById('t-play')!);
  expect(loop.calls).toContain('stop tape');
});

test('the type key opens the line, and the line says what you typed', () => {
  link.setState({slug: 'lover', sid: 'a-session'});
  show();
  /* Shut, unless you left it open — or unless there is no microphone on this
     address, which is every jsdom: then typing is the only way in and the line
     is waiting. So this presses the key twice, and lands where it started. */
  const type = () => fireEvent.click(document.getElementById('t-type')!);
  type();
  expect(document.getElementById('say')).toHaveAttribute('hidden');
  type();
  expect(document.getElementById('say')).not.toHaveAttribute('hidden');
  const box = document.getElementById('text') as HTMLTextAreaElement;
  fireEvent.change(box, {target: {value: 'the window'}});
  fireEvent.keyDown(box, {key: 'Enter'});
  expect(conversation.turns).toEqual([
    {slug: 'lover', sessionId: 'a-session', text: 'the window'},
  ]);
});

test('where nothing can be heard the line is waiting, and a choice outranks it', () => {
  /* Every jsdom is an address with no microphone — getUserMedia is not merely
     refused, it is absent — which is also a phone reaching this Mac over plain
     http. Typing is the only way in there, and a line waiting is the kindest
     thing there is. It is still only a default: shut once, on purpose, and it
     stays shut. */
  show();
  expect(document.getElementById('say')).not.toHaveAttribute('hidden');
  cleanup();

  localStorage.setItem('lucid:typing', '0');
  show();
  expect(document.getElementById('say')).toHaveAttribute('hidden');
});

test('a conversation that is not there says so, and offers the way back', () => {
  link.setState({nowhere: true});
  show();
  expect(document.getElementById('gone')).not.toHaveAttribute('hidden');
  // And there is no third banner about another window any more: the machine is
  // shared and conversations are not.
  expect(document.getElementById('taken')).toBeNull();
});

test('a deleted turn goes from the glass once it is off the file', async () => {
  link.setState({transcript: [{role: 'user', text: 'hello'},
                              {role: 'assistant', text: 'hello yourself'}]});
  show();
  fireEvent.click(document.querySelectorAll('#chat .msg')[1]!.querySelector('.del')!);
  expect(loop.calls).toContain('delete assistant hello yourself');
  // The file answers first: the bubble used to go on the press, so a store
  // that refused left the glass short of a conversation that is still whole.
  expect(link.getState().transcript).toHaveLength(2);
  await waitFor(() =>
    expect(link.getState().transcript).toEqual([{role: 'user', text: 'hello'}]));
});

test('anything a hand did on the way in is asked for once the room is open', async () => {
  show();
  await waitFor(() => expect(conversation.opened).toHaveLength(1));
  expect(loop.calls).toContain('hands');
});

/* Enough of a microphone for the key to open one. jsdom has neither
   getUserMedia nor an AudioContext, and what is worth holding still here is
   the loop: the key opens the device, the device feeds the detector, and a
   turn the detector finishes becomes a line in the conversation. */
class FakeProcessor {
  onaudioprocess: ((ev: {inputBuffer: {getChannelData: () => Float32Array}}) => void) | null = null;
  connect() {}
  disconnect() {}
}
class FakeCtx {
  static made: FakeCtx[] = [];
  state = 'running';
  sampleRate = 16000;
  destination = {};
  node = new FakeProcessor();
  constructor() { FakeCtx.made.push(this); }
  createMediaStreamSource() { return {connect: () => {}, disconnect: () => {}}; }
  createGain() { return {gain: {value: 1}, connect() {}, disconnect() {}}; }
  createScriptProcessor() { return this.node; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

/** A voice: 150 Hz with harmonics over it, loud enough to arm the detector. */
function voice(rms: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = ((i / 16000) * 150) % 1;
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

test('the talk key opens the microphone, and what it hears becomes a turn', async () => {
  const stub = (what: string, value: unknown, on: object = navigator) =>
    Object.defineProperty(on, what, {value, configurable: true, writable: true});
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('isSecureContext', true);
  /* Answered by address rather than by one shape for everything: this page
     asks the machine what it hears by as well as for the words of a turn. The
     pills are not asked for at all -- they ship with the game. */
  vi.stubGlobal('fetch', (url: string) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(
      String(url).endsWith('/machine') ? {status: {}, vad: {}}
      // The recognizer, which the press asks for before it opens the device.
      // Already up here: what the loading key looks like is the deck's own
      // test, and what the press asks for is audio.test.ts's.
      : String(url).includes('/machine/models/') ? {status: 'ready', grace: null}
      : {text: 'are you there'}),
  }));
  stub('mediaDevices', {
    getUserMedia: () => Promise.resolve({
      getAudioTracks: () => [{getSettings: () => ({echoCancellation: true})}],
      getTracks: () => [{stop: () => {}}],
    }),
  });
  link.setState({slug: 'lover', sid: 'a-session'});
  show();
  fireEvent.click(document.getElementById('t-rec')!);
  await waitFor(() => expect(link.getState().input_mode).toBe('mic'));

  /* Through the device, not around it: the same callback the browser calls,
     with a sentence and then the room going quiet after it. */
  const play = (block: Float32Array) =>
    FakeCtx.made.at(-1)!.node.onaudioprocess!({inputBuffer: {getChannelData: () => block}});
  for (let i = 0; i < 8; i++) play(voice(0.05, 4096));
  for (let i = 0; i < 4; i++) play(new Float32Array(4096));

  await waitFor(() => expect(conversation.turns).toHaveLength(1));
  const line = conversation.turns[0] as unknown as
    {text: string; heard: boolean; seconds: number};
  expect(line).toMatchObject({text: 'are you there', heard: true});
  expect(line.seconds).toBeGreaterThan(0.5);
  vi.unstubAllGlobals();
});

test('muting the room hands the voice back, and unmuting asks for it again',
  async () => {
    /* A muted room is a text-only one, and several gigabytes of voice have
       no business being held for it. What the machine does with the news — a grace, in case the
       switch was a flinch — is the machine's. */
    const asked: Array<{url: string; body?: string}> = [];
    vi.stubGlobal('fetch', (url: string, init?: {body?: string}) => {
      asked.push({url: String(url), body: init?.body});
      return Promise.resolve({ok: true, json: () => Promise.resolve({status: {}, vad: {}})});
    });
    const wanted = () => asked.filter((a) => a.url.includes('/machine/models/tts'))
      .map((a) => (JSON.parse(a.body ?? '{}') as {wanted?: boolean}).wanted);

    show();
    // Opened with the sound on: the voice is wanted, before the reply that
    // will want it rather than in front of it.
    await waitFor(() => expect(wanted()).toEqual([true]));
    sound.setHush(true);
    await waitFor(() => expect(wanted()).toEqual([true, false]));
    sound.setHush(false);
    await waitFor(() => expect(wanted()).toEqual([true, false, true]));
    /* And the knob at zero is the same silence (10-08): nothing heard is no
       voice held. Dragged on down from one past zero, nothing more is said. */
    sound.setLevel(0);
    await waitFor(() => expect(wanted()).toEqual([true, false, true, false]));
    sound.setHush(true);
    sound.setHush(false);
    sound.setLevel(0.3);
    await waitFor(() => expect(wanted()).toEqual([true, false, true, false, true]));
    sound.setLevel(0.7);
    vi.unstubAllGlobals();
  });

/* ---- tuning the character through the game ---------------------------------
 *
 * The four commands are the whole of §2.5's door: what a player changes about
 * a pill is theirs, kept beside their memories, and set from in here. What is
 * checked below is that each one reaches the character -- the layering has its
 * own test in conversation/persona.test.ts -- and the one rule the console has:
 * it never carries what a pill says.
 */

/** Everything the console has drawn, as one blob. */
const said = () => hatch.rows.map((r) => ('text' in r ? r.text : '')).join('\n');

/** The words the game ships for the pill these are all about. */
const SHIPPED = all().find((p) => p.slug === 'lover')?.prompt ?? '';

/** The editing sheet's box, once it is drawing this character.
 *
 * Waited for rather than read: a card that is closing is still drawn for the
 * length of its fade (see @lucid/ui's Sheet), and this is the one test file
 * that opens two of them in a row fast enough to see it. */
const editing = (words: string) => waitFor(() => {
  const box = screen.getByPlaceholderText(
    'the words this character speaks in') as HTMLTextAreaElement;
  expect(box.value).toBe(words);
  return box;
});

test('a room offers the four commands a character is tuned with', () => {
  show();
  expect(hatch.commands().map((c) => c.name)).toEqual(expect.arrayContaining(
    ['persona_show', 'persona_set', 'persona_reset', 'persona_tune']));
});

test('and takes them with it when it goes', () => {
  /* One console serves every page. A room's commands used to be listed from
     the shelf ever after the first visit to a pill -- offering to reset a
     conversation nobody is in, and answering "this is not a room" if anybody
     took them up on it. */
  const room = ['persona_set', 'session_new', 'memory_show', 'room_clear', 'mic_meter'];
  const listed = () => hatch.commands().map((c) => c.name);
  for (const name of room) expect(listed()).not.toContain(name);
  const shown = show();
  expect(listed()).toEqual(expect.arrayContaining(room));
  shown.unmount();
  for (const name of room) expect(listed()).not.toContain(name);
});

test('persona_show says which parts are yours, and never what the pill says', async () => {
  bag.files.set(at('lover', 'prompt.md'), 'You always mention the rain.\n');
  show();
  hatch.send('/persona_show');
  await waitFor(() => expect(said()).toContain('prompt overridden'));
  // The console is a log, and this game's logs do not carry what was said.
  expect(said()).not.toContain('rain');
});

test('persona_set opens the character as it stands, and Save writes it', async () => {
  show();
  hatch.send('/persona_set');
  // What is in the box is what is actually being said, not an empty page.
  const box = await editing(SHIPPED);
  fireEvent.change(box, {target: {value: `${SHIPPED}\n\nYou always mention the rain.`}});
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(bag.wrote).toContain('prompt lover'));
  expect(bag.files.get(at('lover', 'prompt.md'))).toContain('You always mention the rain.');
  // And the room takes it, so the next turn is assembled with it.
  expect(loop.calls).toContain('persona again');
});

test('an empty save is a reset rather than a character with nothing to say', async () => {
  bag.files.set(at('lover', 'prompt.md'), 'You always mention the rain.\n');
  show();
  hatch.send('/persona_set');
  const box = await editing('You always mention the rain.');
  fireEvent.change(box, {target: {value: '   '}});
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(bag.files.size).toBe(0));
});

test('persona_tune writes one setting, and the room takes that too', async () => {
  show();
  hatch.send('/persona_tune temperature 0.4');
  await waitFor(() => expect(bag.wrote).toContain('tunables lover'));
  expect(JSON.parse(bag.files.get(at('lover', 'tunables.json')) ?? '{}'))
    .toEqual({temperature: 0.4});
  expect(loop.calls).toContain('persona again');
  // And with nothing after it, it says what there is to tune.
  hatch.send('/persona_tune');
  await waitFor(() => expect(said()).toContain('temperature 0.4 (yours)'));
});

test('persona_reset asks first, and takes both files when it is answered', async () => {
  bag.files.set(at('lover', 'prompt.md'), 'You always mention the rain.\n');
  bag.files.set(at('lover', 'tunables.json'), '{"temperature":0.4}');
  show();

  // Cancel leaves everything exactly where it was.
  hatch.send('/persona_reset');
  await waitFor(() => expect(document.getElementById('ask')).not.toHaveAttribute('hidden'));
  fireEvent.click(document.getElementById('askno')!);
  await waitFor(() => expect(document.getElementById('ask')).toHaveAttribute('hidden'));
  expect(bag.files.size).toBe(2);

  hatch.send('/persona_reset');
  await waitFor(() => expect(document.getElementById('ask')).not.toHaveAttribute('hidden'));
  fireEvent.click(document.getElementById('askyes')!);
  await waitFor(() => expect(bag.files.size).toBe(0));
  expect(bag.wrote).toEqual(expect.arrayContaining(
    ['prompt gone lover', 'tunables gone lover']));
});

test('a page going away mid-reply keeps what was spoken of it', async () => {
  /* His line is on disk before the model is asked and the answer is written
     when it finishes; a reload between the two left a conversation whose last
     turn was a question nobody answered. */
  show();
  await waitFor(() => expect(conversation.opened).toHaveLength(1));
  fireEvent(window, new Event('pagehide'));
  expect(conversation.kept).toBe(1);
});

test('and a conversation opened from History opens, without a reload', async () => {
  /* The route element is keyed by path, so nothing remounts when only the
     query changes: the room went on showing the conversation it had, and the
     row somebody pressed in the History sheet did nothing at all until a
     reload. The link below is the one that sheet draws. */
  render(
    <MemoryRouter initialEntries={['/talk/lover?session=2026-01-02T03-04-05_lover']}>
      <Routes>
        <Route path="/talk" element={<div>the box</div>} />
        <Route
          path="/talk/:slug"
          element={
            <>
              <Room />
              <Link to="/talk/lover?session=2026-02-02T03-04-05_lover">another evening</Link>
            </>
          }
        />
      </Routes>
    </MemoryRouter>);
  await waitFor(() => expect(conversation.opened)
    .toEqual(['lover|2026-01-02T03-04-05_lover']));
  fireEvent.click(screen.getByText('another evening'));
  await waitFor(() => expect(conversation.opened)
    .toEqual(['lover|2026-01-02T03-04-05_lover', 'lover|2026-02-02T03-04-05_lover']));
  // And the one it was in was given back on the way, the way leaving gives it back.
  expect(loop.calls.filter((c) => c === 'leave')).toHaveLength(1);
});
