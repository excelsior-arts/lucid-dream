"""The machine: one page, the models behind it, and everybody's files.

There is nothing mounted here, and nothing here knows what a game is. A game
is a package in the bundle, which is where its characters, its prompts and its
words for things all live. What this serves is the page, the console, the
models, and storage — see machine/store.py, which has no vocabulary, and
machine/machine.py, which has none either.

Nothing here costs anything until it is asked for: opening this page loads no
models and touches no device.
"""
from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import sys
from pathlib import Path

import asyncio
import threading
import time
from urllib.parse import urlsplit

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config as C
from . import log as L
from . import machine as MACHINE
from . import paths as P
from . import store as STORE
from . import version as V
from . import web as W

HERE = Path(__file__).resolve().parent


def from_this_page(ws) -> bool:
    """Whether a socket was opened by a page this server served.

    Browsers apply the same-origin rule to fetch and XHR and not to websockets:
    any page open in any tab can dial ws://localhost:6969 and be handed the
    conversation, which is a good deal further than "anyone on your network can
    read it". The Origin header is the one thing that separates a page of ours
    from a page of theirs, and a browser will not let a script forge it.

    Anything with no Origin at all is a program rather than a page — curl, a
    test, the phone bridge — and is let through: this is not authentication and
    is not pretending to be. It closes the one hole a browser opens.
    """
    return ours(ws.headers.get("origin"), ws.headers.get("host"))


def ours(origin: str | None, host: str | None) -> bool:
    """Whether an Origin header names the same place as the Host it arrived on.

    No Origin is not a page: curl, a test, the phone bridge. See above.
    """
    origin = (origin or "").strip()
    if not origin:
        return True
    try:
        return urlsplit(origin).netloc.lower() == (host or "").strip().lower()
    except Exception:
        return False


# What a page of somebody else's could aim at this if nothing stopped it. A
# form post and a fetch with no preflight are both simple cross-site requests
# -- the browser sends them, and only refuses to let the page *read* what came
# back, which for "unload the models" or "append a line to a log" is no
# protection at all. See the middleware in create_app.
CHANGES = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# A page is cheap to re-fetch and expensive to have stale: it is the thing
# that names every other file.
FRESH = {"Cache-Control": "no-cache"}


def phone_urls(cfg: dict) -> list[str]:
    """Addresses this machine answers to on the wifi, for the QR code.

    The page only knows the address it was opened at, and half the time that
    is 127.0.0.1 — which is a perfectly good address that no phone on earth
    can reach. Only the server knows the other ones.
    """
    if not cfg.get("phone", True) or os.environ.get("LUCID_PHONE") == "0":
        return []                       # started with --no-phone: nothing to offer
    scheme = "https" if secure(cfg) else "http"
    port = cfg.get("port", 6969)
    out = []
    name = subprocess.run(["scutil", "--get", "LocalHostName"],
                          capture_output=True, text=True).stdout.strip()
    # en0 then en1, the same order tools/lan_bridge.py takes: on a Mac with
    # ethernet plugged in the wifi is en1, and asking only for en0 left the QR
    # code with nothing on it but the .local name.
    lan = ""
    for card in ("en0", "en1"):
        lan = subprocess.run(["ipconfig", "getifaddr", card],
                             capture_output=True, text=True).stdout.strip()
        if lan:
            break
    for host in filter(None, (f"{name}.local" if name else "", lan)):
        out.append(f"{scheme}://{host}:{port}")
    return out


def secure(cfg: dict) -> bool:
    """Kept as a name here because everything in this file asks it this way;
    the answer belongs to the config, which is where the paths are read."""
    return C.secure(cfg)


def create_app() -> FastAPI:
    # Asked once, here, and not again per request: the bundle's own directory
    # is mounted as the routes are laid down, so a build that appears while
    # this is running is one a restart picks up. The page itself is asked for
    # per request -- see W.page(), which has an answer either way.
    dist = W.built()

    @contextlib.asynccontextmanager
    async def lifespan(_shell: FastAPI):
        """What runs for as long as the server does, and what is put down after.

        One task: the machine saying how it is doing, which is the row at the
        top of every console on every page. It belongs to the server rather
        than to anything mounted in it, so the lamps are lit on the front page
        with no game open at all.

        And the models on the way out, which is not a nicety. The language
        model is a child process holding twenty gigabytes, and a server that
        exits without putting it down leaves it running with nothing to stop
        it — the next start finds it on the port, adopts it, and is then not
        allowed to end it either.
        """
        L.bind(asyncio.get_running_loop())
        L.listen()                       # uvicorn's own voice, in our timeline
        L.say("the machine is up", source="machine")
        lamps = asyncio.create_task(MACHINE.pump())
        try:
            yield
        finally:
            lamps.cancel()
            if MACHINE.stack().made:
                await asyncio.to_thread(MACHINE.stack().stop)

    # No /docs, /redoc or /openapi.json. FastAPI offers all three by default,
    # and there is nothing on this port that asks for a schema: the page is
    # built against these routes and the manual describes them in English.
    # What they would be is a map of every address, with its body shapes, to
    # anyone on the wifi -- and with --phone that is anyone on the wifi, since
    # none of this asks who you are. See tools/lan_bridge.py.
    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None,
                  openapi_url=None)

    @app.middleware("http")
    async def from_this_page_too(req: Request, call_next):
        """The same rule the sockets keep, for the routes that change things.

        The websockets have checked Origin for a while; the HTTP side had not,
        and everything expensive is on the HTTP side. Any page open in any tab
        could POST /machine/models/stop and put twenty gigabytes of somebody's
        evening down, or blind-append lines into a conversation, without ever
        being allowed to read a byte of the answer.

        Reads are left alone deliberately: they are what a browser was going
        to refuse to hand over anyway, and the page under test, the phone
        bridge and every curl in the manual are all GETs with no Origin.
        """
        if req.method in CHANGES and not ours(req.headers.get("origin"),
                                              req.headers.get("host")):
            return JSONResponse({"error": "not from this page"}, status_code=403)
        return await call_next(req)

    # ---- the console -------------------------------------------------------
    # One socket for every page on every screen: the log so far, then each new
    # line as it happens, what each app is up to, and a way to type back. See
    # machine/log.py for why this belongs to the machine rather than to an app.
    @app.websocket("/shared/log/ws")
    async def console(ws: WebSocket, at: str = ""):
        if not from_this_page(ws):
            await ws.close(code=1008)
            return
        # `at` is which app's page this console is on, so the command list can
        # be the one that makes sense from there. See log.listing().
        await ws.accept()
        L.bind(asyncio.get_running_loop())
        mine: asyncio.Queue = asyncio.Queue(maxsize=400)
        L.watchers.add(mine)
        pump = None
        try:
            await ws.send_json({"type": "backlog", "lines": list(L.ring),
                                "orders": L.listing(at),
                                "health": list(L.health.values())})
            pump = asyncio.create_task(_drain(ws, mine))
            while True:
                msg = await ws.receive_json()
                if msg.get("say"):
                    # The app's own lines, in the same timeline as ours. "app"
                    # rather than "page": it runs in a browser tab today and in
                    # a window of its own tomorrow, and it is the same program.
                    it = msg["say"]
                    L.say(it.get("text", ""), source="app",
                          level=it.get("level", "error"))
                elif msg.get("run") is not None:
                    said = await L.run(msg["run"])
                    if said:
                        L.say(said, source="console")
        except (WebSocketDisconnect, RuntimeError):
            # A page closed. Starlette raises WebSocketDisconnect for the tidy
            # version of that and RuntimeError — "need to call accept first" —
            # for the one where it went while we were still answering it.
            # Neither is news, and the second was being reported as though the
            # console itself had broken.
            pass
        except Exception as e:
            # A bug in the console is the one bug nobody would ever see: the
            # place you would look for it is the thing that broke. It still
            # reaches the ring and the file, so the next page to connect finds
            # it waiting.
            L.say(f"console socket: {type(e).__name__}: {e}",
                  source="machine", level="error")
        finally:
            L.watchers.discard(mine)
            if pump:
                pump.cancel()

    async def _drain(ws: WebSocket, q: asyncio.Queue):
        """Lines out to one page. A dead socket is ordinary — the page went
        away — so only the unexpected is worth saying."""
        try:
            while True:
                await ws.send_json(await q.get())
        except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
            pass
        except Exception as e:
            L.say(f"console drain: {type(e).__name__}: {e}",
                  source="machine", level="error")


    # Asked for by the corner controls: whether a phone can reach this at all,
    # and at what address. Computed once — the answer changes with the wifi,
    # and a restart is the honest way to notice.
    where = {"phone": bool(phone_urls(C.load())), "urls": phone_urls(C.load())}

    @app.get("/shared/where")
    def where_am_i():
        return where

    # ---- the machine, and everybody's files --------------------------------
    # Written where they are because they are long, not because they are
    # somebody else's: these are the machine's own routes, laid down here before
    # any app is mounted and long before the catch-all below claims every
    # address that is left.
    #
    # /machine is the models — chat, transcribe, speak, the voices on the shelf
    # and the lamps. It is game-agnostic on purpose: whoever calls gets the one
    # stack this Mac has room for, and two callers wait on each other rather
    # than collide.
    #
    # /store/<game>/… is storage with no words: values by path and append-only
    # logs by path, under a directory named by whatever slug was asked for. The
    # machine holds no game code and no game vocabulary at all — what a path
    # under there means is decided in the page that wrote it.
    MACHINE.routes(app)
    STORE.routes(app)

    # The icons, at the addresses browsers look for whether or not a page
    # said where they are.
    #
    # Every page links them properly and two browsers out of three take the
    # link and are content. Safari asks the root of the site anyway — and on
    # iOS, an "add to home screen" goes looking for /apple-touch-icon.png with
    # no page involved at all, so a link in the head is not even read. These
    # are three lines of routing against a class of bug that otherwise reads
    # as "the icon does not work in Safari" and has no other symptom.
    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return FileResponse(HERE / "static/icons/favicon.ico",
                            media_type="image/x-icon", headers=FRESH)

    @app.get("/apple-touch-icon.png", include_in_schema=False)
    @app.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
    def touch_icon():
        return FileResponse(HERE / "static/icons/icon-180.png",
                            media_type="image/png", headers=FRESH)

    # HEAD as well as GET: a link preview, an uptime check and half the
    # command-line tools ask that way first, and FastAPI -- unlike Starlette --
    # does not add it to a GET route, so the root answered them with a 405.
    @app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
    def index():
        # The same document every route gets: the tiles are drawn by the page
        # out of what it is told, not cut into the HTML on the way out.
        return HTMLResponse(W.page(), headers=FRESH)

    # The look of the place, served once and used by every app: an app that
    # wanted its own sky and its own brass would stop feeling like a room in
    # the same house.
    #
    # no-cache, not no-store: the browser keeps the file and asks whether it
    # changed, which is a 304 on a local socket. Without it Chrome holds the
    # stylesheet for its own heuristic lifetime and an edit to the palette
    # simply does not appear -- half an hour of "why is nothing happening".
    class Fresh(StaticFiles):
        def file_response(self, *args, **kwargs):
            r = super().file_response(*args, **kwargs)
            r.headers["Cache-Control"] = "no-cache"
            return r

    # The icons and the manifest, at the addresses the page links. app's own
    # public/shared holds a copy of exactly these, because the dev server
    # serves the page without ever asking us for anything.
    app.mount("/shared", Fresh(directory=HERE / "static"), name="shared")

    # The bundle, and the opposite policy. Every file under here is named
    # after a hash of what is in it, so the address changes whenever the
    # contents do and nothing that was fetched under an old name is ever the
    # wrong answer -- which is the one case where a year is a sane lifetime.
    class Forever(StaticFiles):
        def file_response(self, *args, **kwargs):
            r = super().file_response(*args, **kwargs)
            r.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return r

    if dist:
        app.mount("/assets", Forever(directory=dist / "assets"), name="assets")

    # Every other address, answered with the same page.
    #
    # A single-page app owns its routes in the browser, and the browser only
    # asks us about them when somebody opens one directly or reloads on it --
    # so the server's job is to hand back the document and let the page work
    # out where it is. Which includes every game's own address: a game's slug
    # and everything under it is the same document, and the page holds the list
    # of what is installed (app/src/main.tsx).
    # Written last on purpose: /{path:path} matches everything, and everything
    # that belongs to somebody else -- /shared, /store, /machine, the icons --
    # is claimed above and never reaches here.
    #
    # A name with a suffix on it is a file that is missing rather than a route
    # that is unknown, and answering it with HTML is how a missing image
    # becomes "unexpected token '<'" in a console somewhere.
    @app.api_route("/{path:path}", methods=["GET", "HEAD"],
                   include_in_schema=False)
    def anywhere(path: str):
        if "." in path.rsplit("/", 1)[-1]:
            return HTMLResponse("no such thing", status_code=404)
        return HTMLResponse(W.page(), headers=FRESH)

    return app


def _relaunch():
    """Replace this process with a fresh one.

    execv keeps the same pid, so whatever started us — run.sh, a terminal —
    does not notice it happened and does not need to. Python opens sockets
    non-inheritable, so the port is released as the image is replaced; there
    is no window where the old server holds it against the new one.

    The models come down first, and that is not a nicety: the language model
    is a child process holding twenty gigabytes, and exec would orphan it.
    There is one stack and it is the machine's, so this puts it down itself.
    """
    L.say("restarting the server", source="machine", level="warn")
    try:
        MACHINE.stack().stop()
    except Exception as e:
        L.say(f"could not close cleanly: {type(e).__name__}: {e}",
              source="machine", level="error")
    time.sleep(1.2)                      # let the console hear it and the children go
    os.execv(sys.executable, [sys.executable, "-u", "-m", "machine"])


@L.command("server_restart", "reload the server itself; the models come down with it")
def _restart(_):
    threading.Thread(target=_relaunch, daemon=True).start()
    return "restarting — this page will reconnect on its own"


def _shutdown(*_):
    raise SystemExit(0)


# The box's own palette, the same one the page is painted from -- see
# app/packages/shell/src/styles/tokens.css: brass for the one thing that is lit, a dimmer brass for the metal it is cut into, starlight for anything
# cold, and a low ink for what is only there to be read once.
BRASS, EDGE = "\033[38;2;201;162;39m", "\033[38;2;108;87;27m"
STAR, INK, OFF = "\033[38;2;207;224;242m", "\033[38;2;160;143;116m", "\033[0m"
# The one instruction in the box rather than a fact about the machine, so it is
# given a colour of its own -- the app's own accent, and none of the three the
# state lines are painted in -- rather than reading as a fourth line of state.
INVITE = "\033[38;2;205;111;184m"


def colors() -> bool:
    """Whether this terminal is worth painting.

    NO_COLOR is honoured because somebody who set it meant it, and a banner is
    exactly the sort of thing that ignores such a request.
    """
    return (sys.stdout.isatty() and os.environ.get("TERM") != "dumb"
            and not os.environ.get("NO_COLOR"))


def paint(text: str, color: str) -> str:
    return f"{color}{text}{OFF}" if colors() else text


def banner(blocks: list[tuple[str, list[str], list[str]]],
           state: str | list[str] = "", lead: str = "") -> str:
    """The one thing this program says before it goes quiet.

    Worth a box, and worth all of it being in the box. It is read once, in a
    terminal with a hundred other lines in it, by somebody who has just run
    this for the first time — and what they need is not three addresses. It is
    which one to open, and why the other one cannot hear them.

    Everything is laid out in plain text and painted afterwards. Color and
    OSC 8 are both a dozen invisible bytes, and measuring a line that has them
    in it pushes every right-hand edge out by that much.
    """
    tag = max(len(t) for t, _, _ in blocks)
    plain, kind = [], {}
    extra = [state] if isinstance(state, str) else list(state)
    extra = [x for x in extra if x]
    for n, (title, addrs, notes) in enumerate(blocks):
        if n:
            plain.append("")
        for k, url in enumerate(addrs):
            kind[len(plain)] = ("addr", title if k == 0 else "", url)
            plain.append((title if k == 0 else "").ljust(tag) + "   " + url)
        for note in notes:
            kind[len(plain)] = ("note", "", note)
            plain.append(" " * tag + "   " + note)
    head = f"{TITLE}   {V.NOW}"
    wide = max([len(x) for x in plain] + [len(head)] + [len(x) for x in extra]) + 4

    def row(body: str, width: int) -> str:
        return (paint("│", EDGE) + "  " + body + " " * (wide - 4 - width)
                + "  " + paint("│", EDGE))

    out = ["", "  " + paint("╭" + "─" * wide + "╮", EDGE),
           "  " + row("", 0),
           # Centered: it is the name of the thing, not a field in a form —
           # with the build after it, small, the way a title page carries one.
           "  " + row(" " * ((wide - 4 - len(head)) // 2)
                      + paint(TITLE, BRASS) + paint(f"   {V.NOW}", INK),
                      len(head) + (wide - 4 - len(head)) // 2),
           "  " + row("", 0)]
    if lead:
        # On its own, in its own colour, with air under it: an instruction
        # stacked with the state lines reads as a fourth fact about the
        # machine, and gets skimmed with them.
        out += ["  " + row(paint(lead, INVITE), len(lead)), "  " + row("", 0)]
    if extra:
        out += ["  " + row(paint(x, BRASS), len(x)) for x in extra]
        out += ["  " + row("", 0)]
    for n, line in enumerate(plain):
        what, label, text = kind.get(n, ("gap", "", ""))
        if what == "addr":
            body = paint(label.ljust(tag), INK) + "   " + paint(link(text), STAR)
        elif what == "note":
            body = " " * tag + "   " + paint(text, INK)
        else:
            body = ""
        out.append("  " + row(body, len(line)))
    out += ["  " + row("", 0), "  " + paint("╰" + "─" * wide + "╯", EDGE), ""]
    return "\n".join(out)


PLAY_IN_A_BROWSER = "to play, open the address below in a browser"

TITLE = "L U C I D   D R E A M"


def whose() -> str:
    """Which save file this is.

    Said every time, because nothing on the page says it: two instances on two
    ports look identical, and the one telling them apart is the terminal they
    were started from. The count is the roster — a player here is a directory
    under userdata/players/ and nothing else.
    """
    who, roster = P.WHO, len(P.players())
    return (f"{who} — one of {roster} on this Mac" if roster > 1
            else f"{who} — the only one on this Mac")


def link(url: str) -> str:
    """A URL a terminal will let you click.

    OSC 8 is the escape that carries a link, and most terminals in use now
    understand it; the ones that do not are supposed to ignore an unknown OSC
    and print what is between, which is the URL either way. Skipped entirely
    when this is not a terminal, so the banner stays plain in a pipe or a log.

    The text inside the link is the URL itself and not a word standing for it,
    for the same reason: a terminal that drops the escape still prints an
    address somebody can copy.
    """
    if not sys.stdout.isatty() or os.environ.get("TERM") == "dumb":
        return url
    return f"\033]8;;{url}\033\\{url}\033]8;;\033\\"


def main():
    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    # Whoever this instance belongs to, made before anything is read: a name
    # nobody has used yet arrives with the machine's settings and a free port.
    if not P.ELSEWHERE:
        P.welcome(P.WHO)
    cfg = C.load()
    host, port = cfg.get("host", "127.0.0.1"), cfg.get("port", 6969)
    cert, key = cfg.get("tls_cert", ""), cfg.get("tls_key", "")
    scheme = "https" if secure(cfg) else "http"

    # Which address to open matters more than it looks, and only here is it
    # known. localhost is a trustworthy origin whatever the certificate says,
    # so the microphone works there without anything being installed or
    # trusted. The wifi names are not, and a browser will not open a microphone
    # on one unless the certificate verifies -- so opening the phone's address
    # on this Mac is a room you cannot talk in, with no warning anywhere.
    # Same port either way; the address is the whole difference.
    # One box, and everything in it. Somebody running this for the first time
    # reads the terminal once, and what they need is not three addresses: it is
    # which one to open, and why the other one cannot hear them.
    blocks = [("this Mac", [f"{scheme}://localhost:{port}"],
               ["the microphone works here, with nothing to set up"])]
    phones = phone_urls(cfg)
    if phones:
        # A phone is what most people reach for, but the address is the wifi's
        # and anything on it answers -- a laptop across the room as readily as
        # the phone in your hand. Two facts in one line: the network it is
        # already on is the whole route, and nothing here asks who it is.
        notes = ["over your local network — open to anyone on it"]
        notes.append("the microphone needs a certificate that device trusts"
                     if scheme == "https"
                     else "no microphone on these devices — that needs https")
        notes.append("how: MANUAL.md, \u201cYour phone\u201d")
        blocks.append(("other devices", phones, notes))
    # Said as a state, not left to be read off the addresses. Somebody who has
    # just set the phone up restarts and reaches for the address they have been
    # using all week, which no longer answers -- the page does not load and
    # nothing anywhere says why. This is the line that says why.
    state = ("certificates on — every address here is https"
             if scheme == "https" else
             "no certificates — http, which is all this Mac needs")
    # First line in the box, before players or certificates: on a first run it
    # is the only line that matters, and a box drawn in a terminal reads as an
    # interface unless something says otherwise.
    print(banner(blocks, [whose(), state], lead=PLAY_IN_A_BROWSER))

    ssl_args = {"ssl_certfile": cert, "ssl_keyfile": key} if secure(cfg) else {}
    uvicorn.run(create_app(), host=host, port=port, log_level="warning", **ssl_args)
