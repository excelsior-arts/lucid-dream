"""The console: what the machine is doing, and how to tell it to do something.

Two components run this thing — the server and the models — and only one of
them is guaranteed to be up. The server is what put the page in the browser,
so the log belongs to the shell rather than to any app: it is there on the
front page before an app has been opened, it is there when an app has failed
to mount, and app number two gets it without asking.

---- what this is for -------------------------------------------------------

The people who run this are running a language model, a speech recognizer and
a voice on their own machine. When one of those will not start, the difference
between a good evening and a dead one is whether they can see *why* inside ten
seconds. So this is not a developer quirk parked in a corner. It is the tool
that turns "it's broken" into "the voice model isn't at that path", and it is
worth the same care as the rooms.

Three things arrive here:

  * events        — what the app is doing. Sessions opening, models loading,
                    a microphone rejected, a barge-in. There were already
                    dozens of these being emitted and thrown away after a
                    moment in a status line.
  * the machine   — Python's own logging, so uvicorn's complaints and any
                    traceback land in the same timeline instead of in a
                    terminal nobody has open.
  * the page      — script errors, a lost WebGL context. Sent up so there is
                    one timeline rather than two halves to correlate by eye.

And one rule, which is not negotiable: **nothing anybody said goes in here.**
Session ids, persona names, model paths, yes. The words of a conversation,
never. That is what makes a log safe to paste to a stranger who is helping
you, and this program's whole promise is that the conversation stays put.

---- what it holds ----------------------------------------------------------

A ring in memory for the backlog a page gets the instant it connects, and a
file for what has to outlive the process — because "why did it just die" is a
question asked after the thing that could answer it has gone. The file rotates
at a couple of megabytes and keeps one previous, which is a few days of
ordinary use; an unbounded log in a program people leave running all night is
a slow disk leak, and nobody reads week-old lines.

---- commands ---------------------------------------------------------------

The console takes them as well as shows them, so it is a way out of trouble
and not only a description of it. Apps register their own — `say` what it
does, and it appears in the list a page shows when somebody types "/".

There is no /help. Typing "/" is the help: it lists every command that means
anything from where you are standing, with a line each about what it does. A
command that prints the same list, less legibly, is a command that exists
because consoles are expected to have one.

A caution for whoever adds to this: the phone bridge has no password, and
anyone on the wifi can reach the server. Reading a log leaks paths and
hostnames, which is mild. A command that stops the models is not. Keep them to
things whose worst case is an inconvenience to the person sitting here, and if
that ever stops being true, this is the place that needs a lock on it.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

from .paths import MINE

# One process serves one person, so its log is theirs. When a picker means
# one process serves several, this moves up beside the machine's config --
# nothing anybody said is in here, which is what makes that safe.
DIR = MINE / "log"
FILE = DIR / "lucid.log"
WAS = DIR / "lucid.prev.log"

KEEP = 1000                  # lines held in memory, for an instant backlog
BYTES = 2 * 1024 * 1024      # and on disk, before the file turns over
WIDE = 2000                  # one line can only be so long

ring: deque[dict] = deque(maxlen=KEEP)
watchers: set = set()        # asyncio.Queue per connected console
_loop: asyncio.AbstractEventLoop | None = None
_seq = 0


def bind(loop: asyncio.AbstractEventLoop):
    """Remember the loop, so a worker thread can still reach the consoles.

    Most of what is logged happens on a thread — models load on one, audio
    runs on another — and those threads have no event loop of their own.
    """
    global _loop
    _loop = loop


# ---- writing ---------------------------------------------------------------

# The same thing, over and over. A voice model announces which tokenizer it
# used once per sentence; a page that cannot reach the server says so once a
# second until it can. Neither is wrong and neither is worth four hundred
# lines, and a console you have to scroll past is a console nobody reads at
# the moment they need it.
#
# So a run of identical lines is one line and a count of how many times it
# happened, said when the run ends — which is the moment the number is worth
# knowing. Nothing is dropped and nothing is quietened: the ring and the file
# get the same account, and it is a shorter one.
_last: tuple | None = None
_again = 0


def say(text: str, source: str = "shell", level: str = "info", **facts):
    """One line. `source` is which part said it, `level` is how much it wants
    looking at: debug, info, warn, error."""
    global _seq, _last, _again
    # An answer to something just typed is never noise, however many times it
    # is asked for. Asking for the same thing twice and being told nothing the
    # second time reads as a console that has stopped working, so replies to
    # the console skip the run-collapsing below -- and end any run in progress,
    # since the count belongs above the answer, not after it.
    if source == "console":
        if _again:
            n, _again = _again, 0
            _write_line(f"… and that again, {n} more time{'s' if n > 1 else ''}",
                        _last[0], _last[1])
        _last = None
        return _write_line(text, source, level, **facts)
    same = (str(source)[:24], level, str(text))
    if same == _last:
        _again += 1
        return ring[-1] if ring else None
    if _again:
        n, _again = _again, 0
        _write_line(f"… and that again, {n} more time{'s' if n > 1 else ''}",
                    _last[0], _last[1])
    _last = same
    return _write_line(text, source, level, **facts)


def _write_line(text: str, source: str = "shell", level: str = "info", **facts):
    global _seq
    _seq += 1
    line = {
        "n": _seq,
        "at": time.time(),
        "source": str(source)[:24],
        "level": level if level in ("debug", "info", "warn", "error") else "info",
        "text": str(text).replace("\n", " ⏎ ")[:WIDE],
    }
    if facts:
        line["facts"] = {k: v for k, v in facts.items() if v is not None}
    ring.append(line)
    _write(line)
    _push({"type": "log", "lines": [line]})
    return line


def _write(line: dict):
    try:
        DIR.mkdir(parents=True, exist_ok=True)
        if FILE.exists() and FILE.stat().st_size > BYTES:
            # One turn, one previous kept. Anything older is genuinely gone,
            # which is the point of a rotation.
            FILE.replace(WAS)
        when = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(line["at"]))
        with FILE.open("a", encoding="utf-8") as f:
            f.write(f'{when} {line["level"][:4]:<5} {line["source"]:<6} {line["text"]}\n')
    except Exception:
        # The one place that genuinely may not speak. A log that throws takes
        # the program down with it, and a log that logs its own failure to log
        # does it in a loop. Everything else in this program says what went
        # wrong; this line is the exception that earns it.
        pass


def _push(msg: dict):
    """To every console attached, from whatever thread we are on."""
    if not watchers or _loop is None:
        return
    def hand():
        for q in list(watchers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # A page that has stopped reading — a phone asleep in a
                # pocket, a laptop lid shut mid-sentence. Dropping the console
                # was the old answer, and it was the wrong one: the page comes
                # back, its socket is still open, and it sits there showing a
                # log that stopped at the moment it looked away, with nothing
                # to say why. Drop the oldest line instead and keep the
                # console; a log is allowed to lose its middle.
                try:
                    q.get_nowait()
                    q.put_nowait(msg)
                except Exception:
                    watchers.discard(q)
            except Exception:
                watchers.discard(q)
    try:
        _loop.call_soon_threadsafe(hand)
    except RuntimeError:
        pass


# ---- what the machine itself says ------------------------------------------

class Ear(logging.Handler):
    """Python's logging, into the same timeline. uvicorn shouts through this,
    and so does anything that ever calls logging.exception()."""

    # Other programs' diaries. A speech model narrating which tokenizer it
    # reached for, once per sentence, is not news about this program — and
    # asyncio noticing that a socket it was writing to has gone is a thing we
    # already handle in the one place it matters (see the console socket in
    # shell/server.py: "a page closed, which is not news").
    #
    # This is not the muting of an error. Anything either of them has to say
    # at warning or above still arrives; what is turned away is the running
    # commentary underneath it, which was four hundred lines of the last
    # thousand and pushed everything worth reading out of the ring.
    QUIET = (("mlx_audio", logging.WARNING, ""),
             ("asyncio", logging.ERROR, "socket.send() raised exception"))

    def emit(self, record: logging.LogRecord):
        try:
            for who, floor, phrase in self.QUIET:
                if (record.name.split(".")[0] == who and record.levelno < floor
                        and (not phrase or phrase in str(record.msg))):
                    return
            level = ("error" if record.levelno >= logging.ERROR else
                     "warn" if record.levelno >= logging.WARNING else
                     "info" if record.levelno >= logging.INFO else "debug")
            where = record.name.split(".")[0]
            say(record.getMessage(), source=("uvicorn" if where == "uvicorn" else where),
                level=level)
        except Exception:
            pass        # same reason as _write: this is inside the logger


def listen():
    """Attach to the root logger once."""
    root = logging.getLogger()
    if any(isinstance(h, Ear) for h in root.handlers):
        return
    root.addHandler(Ear())
    root.setLevel(logging.INFO)


# ---- what is up, and how it is doing ---------------------------------------
#
# The console's top bar, in two halves.
#
# "machine" is reserved, and it is the one every console shows on every page:
# the language model, the recognizer, the voice, the memory they are holding.
# Those are shared, expensive and breakable — the reason somebody opens this —
# and a second app would be waiting on the same three.
#
# Anything else is an app's own, and shows only where you are standing. Which
# conversation, which pill, what it is doing this second: real, but meaningless
# on a page that is not in that app.

health: dict[str, dict] = {}


def state(app: str, **facts):
    """How something is doing. `app` is "machine" or an app's own slug.

    Pushed to every console, and only when it has actually changed — this is
    called on a tick five times a second, so the comparison is the point.
    """
    was = health.get(app)
    now = {"app": app, **facts}
    if was == now:
        return
    health[app] = now
    _push({"type": "health", "of": now})


# ---- commands --------------------------------------------------------------

@dataclass(frozen=True)
class Order:
    name: str
    about: str                     # one line, shown in the "/" list
    run: Callable                  # (args: str) -> str | None
    app: str = "shell"
    args: str = ""                 # a hint, e.g. "<slug>"


orders: dict[str, Order] = {}


def command(name: str, about: str, app: str = "shell", args: str = ""):
    """Register one. The console lists whatever is here."""
    def keep(fn):
        orders[name] = Order(name=name, about=about, run=fn, app=app, args=args)
        return fn
    return keep


async def run(line: str) -> str:
    """Do what the console was told. Returns what to say back."""
    line = (line or "").strip().lstrip("/")
    if not line:
        return ""
    name, _, rest = line.partition(" ")
    order = orders.get(name.lower())
    if not order:
        return f"no such command: {name} — type / for the list"
    try:
        out = order.run(rest.strip())
        if asyncio.iscoroutine(out):
            out = await out
        return out or ""
    except Exception as e:
        return f"{name} failed: {type(e).__name__}: {e}"


# Where a command belongs, and therefore where it is offered:
#
#   shell            everywhere — this console itself
#   machine          everywhere — the models, which are shared and expensive
#                    and the reason somebody opened this in the first place
#   <app>            anywhere in that app, including its front door
#   <app>/<where>    only in that part of it
#
# The last one earns its keep: an app's front door is not one of its rooms.
# Standing in front of the box, "listen or type only" and "what this
# conversation has done to its room" are answers to questions nobody standing
# there can be asking. A page says where it is and gets the list that makes
# sense from there, by prefix — so a command for the whole app shows in its
# rooms too, and one for a room does not show at the door.
#
# The filtering is of what is *offered*, not of what is possible. Somebody who
# knows a command can still type it from anywhere and it will work — this is
# about keeping the list honest for whoever is reading it, not about locking a
# door on their own machine.
RANK = {"shell": 0, "machine": 1}


def here(app: str, at: str) -> bool:
    return app in ("shell", "machine") or at == app or at.startswith(app + "/")


def listing(at: str = "") -> list[dict]:
    return [{"name": o.name, "about": o.about, "app": o.app, "args": o.args}
            for o in sorted(orders.values(), key=lambda o: (RANK.get(o.app, 2), o.name))
            if here(o.app, at)]


@command("console_clear", "empty this console")
def _clear(_):
    ring.clear()
    _push({"type": "cleared"})
    return ""
