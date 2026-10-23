/* ---- the console -----------------------------------------------------------
   What the machine is doing along the top, everything it has said underneath,
   and a line to type into. On every page, because it is the shell's — see
   machine/log.py, which is the other end of this.

   This half is the state and the wire: the sheet that draws it is ui/Console,
   and nothing here knows where on the page that ends up.
--------------------------------------------------------------------------- */
import {backend} from '../backend';
import {routed} from '../base';
import {host} from '../host';
import {sound} from './sound';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Line {at: number; source: string; level: string; text: string}
export interface Lamp {name: string; state?: string; title?: string}
export interface Health {app: string; name?: string; parts?: Lamp[]; facts?: string[]}
export interface Order {name: string; about: string; args?: string; app?: string}

/** A line, or the rule drawn where one server ended and the next began. */
export type Row =
  | ({kind: 'line'; id: number} & Line)
  | {kind: 'since'; id: number; text: string};

interface Local {name: string; about: string; args: string; run: (rest: string) => unknown}
interface Said {say: {text: string; level: string}}
interface Ran {run: string}

type Wire =
  | {type: 'backlog'; orders?: Order[]; health?: Health[]; lines?: Line[]}
  | {type: 'log'; lines?: Line[]}
  | {type: 'health'; of: Health}
  | {type: 'cleared'};

/* Which app, and which part of it. A page may say what it is — a room, a front
   door — and the console asks for the commands that make sense there. Without
   that the box's own page was being offered a microphone and a conversation to
   reset. */
export function appAt(where: string, app?: string): string {
  /* By the game's name, not its address: the address can move (/lucid-talk
     became /talk) and can sit under a host's own path (/lucid-dream/talk).
     The first segment is the answer only for a caller that did not say. */
  const id = app ?? (routed(location.pathname).split('/')[1] || '').trim();
  return id + (where ? '/' + where : '');
}

/* How far somebody has read. Every line carries the moment it was said, so the
   dot is a question about one number: is there an error newer than the last one
   they were looking at?

   It has to outlive the page. A socket that reconnects is handed the whole ring
   again, and a reload is handed it from the first line — so without a mark of
   its own, every error of the evening lights the knob again on every refresh,
   including the ones already read and answered. Kept per browser, in whatever
   storage will have it; a machine that refuses storage falls back to "this page
   only", which is the old behavior and no worse than it was. */
const SEEN = 'lucid.log.seen';

export const clock = (at: number): string => {
  const d = new Date(at * 1000);
  return String(d.getHours()).padStart(2, '0') + ':'
       + String(d.getMinutes()).padStart(2, '0') + ':'
       + String(d.getSeconds()).padStart(2, '0');
};

export class Hatch {
  /** Bumped for anything a page draws, which is what React subscribes to. */
  version = 0;
  rows: Row[] = [];
  health = new Map<string, Health>();
  open = false;
  trouble = false;
  /** What you have typed, for arrow-up. */
  past: string[] = [];
  at = '';

  private orders: Order[] = [];
  /* Commands the page itself answers, as against the ones the server does.
     Some things only a browser can do — open a sheet, leave a room, ask a
     question and wait for the answer — and they belong in the same list as
     everything else, because the person typing does not care which side of the
     wire a thing lives on. */
  private local = new Map<string, Local>();
  private watchers = new Set<() => void>();
  private ws: WebSocket | null = null;
  private tries = 0;
  private seeded = false;
  private dialed = false;
  /** Dialling again because this page moved, rather than because the server
      went. The difference is whether the log gets a line drawn under it. */
  private moving = false;
  private newest = 0;
  private seen = 0;
  private next = 0;
  /* Held until there is a socket to put it on. The things most worth saying
     happen while the page is still starting — a room that would not load, a
     machine with no WebGL — and this used to drop them on the floor for the
     second or so before the console had dialled. */
  private outbox: (Said | Ran)[] = [];

  constructor() {
    try { this.seen = +(localStorage.getItem(SEEN) ?? 0) || 0; } catch { /* no storage */ }
  }

  subscribe(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  /** Which build this is. The server writes it onto <html>; a page served by
      something else says nothing rather than guessing. */
  get build(): string {
    return document.documentElement.dataset.lucid ?? '';
  }

  /** The machine first and always, then everything true of where this page is —
      by the same prefix rule the commands use. In a room that is the app and the
      room; in front of the box it is the app alone, because "idle" and which
      pill is in hand are answers about a room and there is no room in front of
      the box. */
  lamps(): Health[] {
    const found = [this.health.get('machine')];
    for (const [key, h] of this.health) {
      if (key === 'machine') continue;
      if (this.at === key || this.at.startsWith(key + '/')) found.push(h);
    }
    return found.filter((h): h is Health => !!h);
  }

  /** Everything that can be typed, the page's own beside the server's. */
  commands(): Order[] {
    return [...this.orders,
            ...[...this.local.values()].map(o =>
              ({name: o.name, about: o.about, args: o.args, app: 'app'}))]
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** What this page can do that the server cannot. Registered by the page
      itself, listed beside the server's own, and run here. */
  command(name: string, about: string, run: (rest: string) => unknown,
          {args = ''}: {args?: string} = {}): void {
    this.local.set(name, {name, about, run, args});
    this.changed();
  }

  /** And taking one back, which a page owes on its way out. One console serves
      every page: without this, a room's own commands went on being listed from
      the shelf after the first visit to one, pointing at a conversation nobody
      is in. */
  forget(name: string): void {
    if (this.local.delete(name)) this.changed();
  }

  /** A page's own way in. Anything an app knows and the server does not — what
      the browser's microphone is doing, whether echo cancellation is on —
      belongs in the same timeline as everything else. */
  say(text: string, level: Level = 'info'): void {
    this.tell({say: {text, level}});
  }

  show(on: boolean): void {
    this.open = on;
    if (on) {
      this.mark(false);
      this.readUpTo(this.newest);            // everything on the list has been seen
    }
    this.changed();
    sound.tick();
  }

  /** A line typed into the console: a local command, or the server's. */
  send(line: string): void {
    const said = line.trim();
    if (!said) return;
    this.past.unshift(said);
    this.draw([{at: Date.now() / 1000, source: 'you', level: 'debug', text: said}]);
    const [name = '', ...rest] = said.replace(/^\//, '').split(' ');
    const here = this.local.get(name.toLowerCase());
    if (here) {
      Promise.resolve()
        .then(() => here.run(rest.join(' ').trim()))
        .then(answer => {
          if (answer) this.draw([{at: Date.now() / 1000, source: 'console',
                                  level: 'info', text: String(answer)}]);
        })
        .catch((e: unknown) => this.draw([{at: Date.now() / 1000, source: 'console',
                                           level: 'error', text: `${name} failed: ${why(e)}`}]));
    } else {
      this.tell({run: said});
    }
    sound.tick();
  }

  /** Dials the log socket, and says where the page is standing.
   *
   * Where it is standing is sent as `?at=` when the socket is opened, and the
   * server answers with the commands that make sense there -- so a page that
   * moves from the shelf into a room has to say so again. It used to set the
   * field and return, having already dialled: the room's own server-side
   * commands were missing until something else dropped the socket. So the
   * socket is opened again, quietly, on a move. */
  start(where = '', app?: string): void {
    const at = appAt(where, app);
    /* No machine behind this page -- a static host, or a wrapper that brought
       none -- and so no log to dial. The console is this page's own then:
       what it says is drawn here, what it is asked is answered here or not
       at all, and nothing retries a socket that was never going to open. */
    if (!host().log) {
      this.at = at;
      if (!this.dialed) {
        this.dialed = true;
        const held = this.outbox.splice(0);
        for (const msg of held) this.tell(msg);
      }
      return;
    }
    if (this.dialed && at === this.at) return;
    this.at = at;
    if (!this.dialed) {
      this.dialed = true;
      this.dial();
      return;
    }
    this.moving = true;
    const old = this.ws;
    this.ws = null;
    if (old) {
      // Its own close, not the server going: no "lost the server" line, no
      // backoff, and no rule drawn under the log by the reconnect below.
      old.onclose = null;
      old.onmessage = null;
      try { old.close(); } catch { /* already gone */ }
    }
    this.dial();
  }

  // ---- the wire ----
  /** One row of lamps, from this side of the wire. A page with no machine
      behind it is its own machine -- the model it runs is the lamp -- and
      says so here rather than over a socket. */
  report(h: Health): void {
    this.health.set(h.app, h);
    this.changed();
  }

  private tell(msg: Said | Ran): void {
    if (!host().log && this.dialed) {
      const at = Date.now() / 1000;
      if ('say' in msg) this.draw([{at, source: 'page', level: msg.say.level, text: msg.say.text}]);
      else this.draw([{at, source: 'console', level: 'warn',
                       text: `${msg.run.split(' ')[0]} — there is no machine behind this page to ask`}]);
      return;
    }
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    this.outbox.push(msg);
    while (this.outbox.length > 60) this.outbox.shift();
  }

  private dial(): void {
    let ws: WebSocket;
    try {
      // Where we are standing, so the command list is the one that makes sense
      // from here: an app's pills mean nothing on the front page.
      ws = new WebSocket(backend() + '/shared/log/ws?at=' + encodeURIComponent(this.at));
    } catch { return; }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      while (this.outbox.length) ws.send(JSON.stringify(this.outbox.shift()));
    };
    ws.onmessage = e => {
      const m = JSON.parse(String(e.data)) as Wire;
      if (m.type === 'backlog') {
        this.orders = m.orders ?? [];
        this.health.clear();
        (m.health ?? []).forEach(h => this.health.set(h.app, h));
        /* Dialled again because this page moved: the same server, asked for
           the commands that make sense here. Its backlog is the log already on
           screen, so none of it is drawn -- and no rule under it either,
           because nothing came back from anywhere. */
        if (this.moving) {
          this.moving = false;
          this.changed();
          return;
        }
        /* First time, this is the whole log. On a reconnect it is a *new*
           server's log, and what is already on screen is the old one's — which
           is exactly what somebody restarting wants to keep looking at. So it
           is kept, with a line drawn under it. */
        if (this.seeded) this.rows.push({kind: 'since', id: this.next++,
                                         text: 'the server came back'});
        else this.rows = [];
        this.seeded = true;
        this.draw(m.lines ?? []);
      } else if (m.type === 'log') {
        this.draw(m.lines ?? []);
      } else if (m.type === 'health') {
        this.health.set(m.of.app, m.of);
        this.changed();
      } else if (m.type === 'cleared') {
        this.rows = [];
        this.changed();
      }
    };
    // The console is the thing you look at when the server has gone. It keeps
    // trying, slower each time, and says so in its own scrollback.
    ws.onclose = () => {
      this.ws = null;
      if (this.tries === 0) this.draw([{at: Date.now() / 1000, source: 'console',
                                        level: 'warn', text: 'lost the server — retrying'}]);
      this.tries++;
      setTimeout(() => this.dial(), Math.min(700 * this.tries, 5000));
    };
  }

  // ---- the scrollback ----
  private draw(lines: Line[]): void {
    for (const l of lines) {
      this.rows.push({kind: 'line', id: this.next++, ...l});
      if (l.at > this.newest) this.newest = l.at;
      // Read as it arrives while the console is open; otherwise it is only
      // trouble if it happened after the last thing that was read.
      if (this.open) this.readUpTo(l.at);
      else if (l.level === 'error' && l.at > this.seen) this.mark(true);
    }
    if (this.rows.length > 1200) this.rows.splice(0, this.rows.length - 1200);
    this.changed();
  }

  // A dot on the knob when something has gone wrong since you last looked.
  // Quiet until it matters is the whole idea; this is the part that tells you
  // it has started to matter.
  private mark(on: boolean): void {
    this.trouble = on;
  }

  private readUpTo(at: number): void {
    if (!(at > this.seen)) return;
    this.seen = at;
    try { localStorage.setItem(SEEN, String(at)); } catch { /* no storage */ }
  }

  private changed(): void {
    this.version++;
    for (const fn of this.watchers) fn();
  }
}

const why = (e: unknown): string =>
  (e instanceof Error ? e.message : '') || String(e);

export const hatch = new Hatch();

/* Anything the page itself trips over goes up the same wire, so there is one
   timeline and not two halves to line up by eye. Installed by the page rather
   than by importing this file, because a module that reaches for `window` as it
   loads cannot be imported by a test that has not built one yet. */
export function installErrorHandlers(to: Hatch = hatch): () => void {
  const broke = (e: ErrorEvent) => to.say(
    `${e.message} — ${(e.filename || '').split('/').pop()}:${e.lineno}`, 'error');
  /* A rejection nobody caught, at the level it deserves.
   *
   * Some of these are the browser telling you it changed its mind, not that
   * anything broke: a view transition that was skipped because another
   * navigation overtook it, a play() abandoned when the next chunk arrived, a
   * fetch cut off by leaving the page. They happen in the ordinary run of
   * things, they are already handled by whatever happens next, and raising a red
   * dot for them is what teaches somebody to stop looking at the dot.
   *
   * Matched on the browser's own words, which are stable enough for this and
   * are the only thing these have in common. Anything unrecognised is still an
   * error: an unhandled rejection is a bug until it is shown to be a shrug. */
  const SHRUG = /transition was skipped|the operation was aborted|AbortError|user aborted|interrupted by a (new )?load|removed from the document/i;
  const shrugged = (e: PromiseRejectionEvent) => {
    const said = why(e.reason);
    to.say('unhandled: ' + said, SHRUG.test(said) ? 'warn' : 'error');
  };
  addEventListener('error', broke);
  addEventListener('unhandledrejection', shrugged);
  return () => {
    removeEventListener('error', broke);
    removeEventListener('unhandledrejection', shrugged);
  };
}
