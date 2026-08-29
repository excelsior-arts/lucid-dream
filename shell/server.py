"""The shell: one page of tiles, and every app mounted under its own route.

Mounting rather than routing is deliberate. Each app is a whole FastAPI
application — its own routes, its own websocket, its own lifespan — and the
shell hands it a prefix and otherwise leaves it alone. Nothing an app does can
reach the shell, and the shell never has to learn what an app is for.

An app is imported the first time it is mounted, which is also the first time
it costs anything: opening this page loads no models and touches no device.
"""
from __future__ import annotations

import contextlib
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

import asyncio
import threading
import time

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import config as C
from . import log as L
from . import paths as P
from . import version as V
from .apps import INSTALLED, load

HERE = Path(__file__).resolve().parent
SHARED = HERE / "static"


def asset_stamp() -> str:
    """The newest thing in shell/static, as a number.

    Every page asks for /shared/night.css?v=<this>, so editing a stylesheet
    changes the address of the stylesheet. Browsers were holding the old one
    for their own heuristic lifetime -- Safari on a phone especially -- and no
    amount of restarting the server could shift it, because the server was
    never the thing being asked.
    """
    try:
        return str(int(max(f.stat().st_mtime for f in SHARED.iterdir() if f.is_file())))
    except ValueError:
        return "0"


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
    origin = (ws.headers.get("origin") or "").strip()
    if not origin:
        return True
    host = (ws.headers.get("host") or "").strip().lower()
    try:
        from urllib.parse import urlsplit
        return urlsplit(origin).netloc.lower() == host
    except Exception:
        return False


def stamped(html: str) -> str:
    """Rewrite the ?v= on every shared asset, and say which build this is.

    Both are the same job done twice over: the stamp keeps a page from running
    yesterday's script, and the version tells whoever is reading the console
    which script that is. Written onto <html>, because every page this serves
    goes through here and the console rides on all of them.
    """
    html = re.sub(r"(/shared/[\w.\-]+)\?v=[\w.\-]*",
                  lambda m: f"{m.group(1)}?v={asset_stamp()}", html)
    return re.sub(r"<html\b(?![^>]*\bdata-lucid\b)",
                  f'<html data-lucid="{V.NOW}"', html, count=1)


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
    lan = subprocess.run(["ipconfig", "getifaddr", "en0"],
                         capture_output=True, text=True).stdout.strip()
    for host in filter(None, (f"{name}.local" if name else "", lan)):
        out.append(f"{scheme}://{host}:{port}")
    return out


def secure(cfg: dict) -> bool:
    """Kept as a name here because everything in this file asks it this way;
    the answer belongs to the config, which is where the paths are read."""
    return C.secure(cfg)


# One shape, cut twice: the plate on the lid and the lock on the front. A
# diamond with its sides bowed out — drawn as a stroked path rather than a
# clip, so the brass line keeps its weight whatever size the box is.
DIAMOND = ('<svg class="cut" viewBox="0 0 100 60" preserveAspectRatio="none" '
           'aria-hidden="true"><path d="M50 1.5 Q78 13 98.5 30 Q78 47 50 58.5 '
           'Q22 47 1.5 30 Q22 13 50 1.5 Z"/></svg>')


def tile(app) -> str:
    """An app on the table: a box you open, not a rectangle you click.

    The name is engraved on the lid rather than printed under it. The faces
    are elements rather than a texture, so whatever the app puts inside its
    own page is real HTML in a real box -- which is the only reason the text
    stays text.
    """
    corners = "".join(f'<i class="bracket b{n}"></i>' for n in range(1, 5))
    return (
        f'<a class="object" href="/{app.slug}/" aria-label="{app.name} — {app.blurb}">'
        '<div class="box">'
        '<div class="face floor"></div>'
        '<div class="face w-back"></div>'
        f'<div class="face w-front"><i class="clasp">{DIAMOND}<b></b></i></div>'
        '<div class="face w-left"></div><div class="face w-right"></div>'
        '<div class="lamp"></div>'
        '<div class="contents" aria-hidden="true"><i></i><i></i><i></i></div>'
        '<div class="lid">'
        f'<div class="out">{corners}'
        f'<div class="plaque">{DIAMOND}<span>{app.name}</span></div>'
        '<i class="filigree"></i></div>'
        '<div class="in"></div></div>'
        '</div>'
        '</a>')


def create_app() -> FastAPI:
    mounted = []

    @contextlib.asynccontextmanager
    async def lifespan(_shell: FastAPI):
        """Start and stop every app we are carrying.

        Starlette does not run a mounted application's lifespan for us, and
        Lucid Talk starts its event pump in one — without this the page
        connects and then hears nothing at all.
        """
        L.bind(asyncio.get_running_loop())
        L.listen()                       # uvicorn's own voice, in our timeline
        L.say("the shell is up", source="shell")
        async with contextlib.AsyncExitStack() as stack:
            for sub in mounted:
                await stack.enter_async_context(sub.router.lifespan_context(sub))
            yield

    shell = FastAPI(lifespan=lifespan)

    # ---- the console -------------------------------------------------------
    # One socket for every page on every screen: the log so far, then each new
    # line as it happens, what each app is up to, and a way to type back. See
    # shell/log.py for why this belongs to the shell rather than to an app.
    @shell.websocket("/shared/log/ws")
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
                    # The page's own trouble, in the same timeline as ours.
                    it = msg["say"]
                    L.say(it.get("text", ""), source="page",
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
                  source="shell", level="error")
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
                  source="shell", level="error")


    # Asked for by the corner controls: whether a phone can reach this at all,
    # and at what address. Computed once — the answer changes with the wifi,
    # and a restart is the honest way to notice.
    where = {"phone": bool(phone_urls(C.load())), "urls": phone_urls(C.load())}

    @shell.get("/shared/where")
    def where_am_i():
        return where

    # The icons, at the addresses browsers look for whether or not a page
    # said where they are.
    #
    # Every page links them properly and two browsers out of three take the
    # link and are content. Safari asks the root of the site anyway — and on
    # iOS, an "add to home screen" goes looking for /apple-touch-icon.png with
    # no page involved at all, so a link in the head is not even read. These
    # are three lines of routing against a class of bug that otherwise reads
    # as "the icon does not work in Safari" and has no other symptom.
    @shell.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return FileResponse(HERE / "static/icons/favicon.ico",
                            media_type="image/x-icon", headers=FRESH)

    @shell.get("/apple-touch-icon.png", include_in_schema=False)
    @shell.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
    def touch_icon():
        return FileResponse(HERE / "static/icons/icon-180.png",
                            media_type="image/png", headers=FRESH)

    @shell.get("/", response_class=HTMLResponse)
    def index():
        page = (HERE / "static" / "index.html").read_text()
        page = page.replace("<!--TILES-->", "\n".join(tile(a) for a in INSTALLED))
        return HTMLResponse(stamped(page), headers=FRESH)

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

    shell.mount("/shared", Fresh(directory=HERE / "static"), name="shared")

    for entry in INSTALLED:
        try:
            sub = load(entry)()
            mounted.append(sub)
            shell.mount(f"/{entry.slug}", sub, name=entry.slug)
        except Exception as e:
            # One broken app should not take the door off its hinges — and the
            # console is where somebody finds out that one of them did.
            L.say(f"{entry.slug} failed to mount: {type(e).__name__}: {e}",
                  source="shell", level="error")
            print(f"[shell] {entry.slug} failed to mount: {type(e).__name__}: {e}",
                  file=sys.stderr)
    return shell


def _relaunch():
    """Replace this process with a fresh one.

    execv keeps the same pid, so whatever started us — run.sh, a terminal —
    does not notice it happened and does not need to. Python opens sockets
    non-inheritable, so the port is released as the image is replaced; there
    is no window where the old server holds it against the new one.

    The models come down first, and that is not a nicety: they are child
    processes holding twenty gigabytes, and exec would orphan them. Whoever
    owns them registered a way to stop them below.
    """
    L.say("restarting the server", source="shell", level="warn")
    for stop in list(_before_restart):
        try:
            stop()
        except Exception as e:
            L.say(f"could not close cleanly: {type(e).__name__}: {e}",
                  source="shell", level="error")
    time.sleep(1.2)                      # let the console hear it and the children go
    os.execv(sys.executable, [sys.executable, "-u", "-m", "shell"])


# What has to be put down before this process is replaced. An app with child
# processes -- a model server, a recognizer -- adds itself here.
_before_restart: list = []


def before_restart(fn):
    _before_restart.append(fn)
    return fn


@L.command("server_restart", "reload the server itself; the models come down with it")
def _restart(_):
    threading.Thread(target=_relaunch, daemon=True).start()
    return "restarting — this page will reconnect on its own"


def _shutdown(*_):
    raise SystemExit(0)


# The box's own palette, out of night.css: brass for the one thing that is
# lit, a dimmer brass for the metal it is cut into, starlight for anything
# cold, and a low ink for what is only there to be read once.
BRASS, EDGE = "\033[38;2;201;162;39m", "\033[38;2;108;87;27m"
STAR, INK, OFF = "\033[38;2;207;224;242m", "\033[38;2;160;143;116m", "\033[0m"
# The one instruction in the box rather than a fact about the machine, in the
# colour of the first pill on the shelf so it does not read as a fourth line
# of state.
PILL = "\033[38;2;205;111;184m"


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
        out += ["  " + row(paint(lead, PILL), len(lead)), "  " + row("", 0)]
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
