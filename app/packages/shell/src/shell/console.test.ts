import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {Hatch, appAt} from './console';

/* A socket that never leaves the room, and can be opened by hand: what matters
   here is the order of things — that a page which trips over something before
   it has dialled still gets to say so. */
class Wire {
  static made: Wire[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: {data: string}) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) { this.url = url; Wire.made.push(this); }
  send(text: string) { this.sent.push(text); }
  close() { this.readyState = 3; this.onclose?.(); }
  arrive() { this.readyState = 1; this.onopen?.(); }
  says(msg: unknown) { this.onmessage?.({data: JSON.stringify(msg)}); }
}

beforeEach(() => {
  Wire.made = [];
  localStorage.clear();
  history.pushState({}, '', '/lucid-talk/lover');
  vi.stubGlobal('WebSocket', Wire);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('where the page is standing is what it asks for', () => {
  expect(appAt('')).toBe('lucid-talk');
  expect(appAt('room')).toBe('lucid-talk/room');
  history.pushState({}, '', '/');
  expect(appAt('')).toBe('');
});

test('the socket carries where it was opened from', () => {
  new Hatch().start('room');
  expect(Wire.made[0]!.url).toContain('/shared/log/ws?at=lucid-talk%2Froom');
});

test('what a page says before it has dialled is held, not dropped', () => {
  const hatch = new Hatch();
  hatch.start('');
  const wire = Wire.made[0]!;
  hatch.say('no WebGL here', 'warn');
  expect(wire.sent).toEqual([]);

  wire.arrive();
  expect(wire.sent).toEqual([JSON.stringify({say: {text: 'no WebGL here', level: 'warn'}})]);
});

test('a server that came back keeps the old log, under a line', () => {
  const hatch = new Hatch();
  hatch.start('');
  const wire = Wire.made[0]!;
  wire.arrive();
  wire.says({type: 'backlog', lines: [{at: 1, source: 'machine', level: 'info', text: 'up'}]});
  expect(hatch.rows).toHaveLength(1);

  wire.says({type: 'backlog', lines: [{at: 2, source: 'machine', level: 'info', text: 'up again'}]});
  expect(hatch.rows.map(r => r.kind)).toEqual(['line', 'since', 'line']);
});

test('an error nobody has looked at yet marks the knob', () => {
  const hatch = new Hatch();
  hatch.start('');
  const wire = Wire.made[0]!;
  wire.arrive();
  wire.says({type: 'log', lines: [{at: 9, source: 'talk', level: 'error', text: 'it would not load'}]});
  expect(hatch.trouble).toBe(true);

  hatch.show(true);
  expect(hatch.trouble).toBe(false);
  expect(localStorage.getItem('lucid.log.seen')).toBe('9');
});

test('which build this is comes off the document, or is not guessed at', () => {
  /* The server writes it onto <html> on the way out, and the console is where
     it is read: a version is only ever wanted at one moment, by somebody
     describing what happened to somebody who has to reproduce it. */
  document.documentElement.dataset.lucid = '9.9.9';
  expect(new Hatch().build).toBe('9.9.9');
  delete document.documentElement.dataset.lucid;
  expect(new Hatch().build).toBe('');
});

test('a command the page answers itself never reaches the wire', async () => {
  const hatch = new Hatch();
  hatch.start('');
  const wire = Wire.made[0]!;
  wire.arrive();
  hatch.command('flat', 'draw the room without WebGL', () => 'flat it is');
  expect(hatch.commands().map(o => o.name)).toEqual(['flat']);

  hatch.send('/flat');
  await Promise.resolve();
  await Promise.resolve();
  expect(wire.sent).toEqual([]);
  expect(hatch.rows.at(-1)).toMatchObject({text: 'flat it is', source: 'console'});
});

test('and one it does not is passed on as typed', () => {
  const hatch = new Hatch();
  hatch.start('');
  const wire = Wire.made[0]!;
  wire.arrive();
  hatch.send('/room_clear');
  expect(wire.sent).toEqual([JSON.stringify({run: '/room_clear'})]);
});

test('a page that has moved says so, and keeps the log it is looking at', () => {
  /* Where the page is standing is sent when the socket is opened, and the
     server answers with the commands that make sense there. Set-and-return --
     which is what this did -- meant a room's own server-side commands were
     missing until something else dropped the socket. */
  const hatch = new Hatch();
  hatch.start('');
  const shelf = Wire.made[0]!;
  shelf.arrive();
  shelf.says({type: 'backlog', orders: [{name: 'ai_models_start', about: 'up'}],
              lines: [{at: 1, source: 'machine', level: 'info', text: 'up'}]});
  expect(hatch.rows).toHaveLength(1);

  hatch.start('room');
  const room = Wire.made[1]!;
  expect(room.url).toContain('at=lucid-talk%2Froom');
  room.arrive();
  room.says({type: 'backlog', orders: [{name: 'mic_barge', about: 'over her'}],
             lines: [{at: 1, source: 'machine', level: 'info', text: 'up'}]});
  // The same server and the same log: nothing said it came back, and the
  // backlog it sent again is not drawn a second time.
  expect(hatch.rows.map((r) => r.kind)).toEqual(['line']);
  expect(hatch.commands().map((o) => o.name)).toContain('mic_barge');

  // And asking for the same place again is nothing at all.
  hatch.start('room');
  expect(Wire.made).toHaveLength(2);
});
