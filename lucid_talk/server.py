"""The HTTP and websocket layer: serve the page, drain the session's events.

This is one app among however many the shell is carrying, mounted under a
route of its own. It owns its page and its websocket and nothing else — the
port, the certificate and the process belong to the shell.

Nothing about the conversation lives here. The session is built when the app
is, not when this module is imported -- importing it used to open the audio
devices and start an MLX thread as a side effect, which is why none of it
could be exercised on its own.
"""

from __future__ import annotations

import asyncio
import base64
import queue
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

from shell import config as SHELL_CFG
from shell import server as SHELL

from . import audio as A
from . import config as C
from . import memory as MEM
from . import paths
from . import personas as P
from . import relation as R
from . import rooms as ROOM
from shell import log as LOG
from . import store as S
from .session import Session

clients: set[WebSocket] = set()
session: Session | None = None


def whose_msg(msg: dict) -> dict:
    """Put a return address on it: which pill, and which conversation.

    There is one stack behind this app — one model, one voice, one mic — so
    there is one conversation at a time, and every page connected hears about
    it whether or not it is the page that asked. With two windows open that
    was a mess with no name on it: a room showing another room's transcript,
    and one pill's voice coming out over the other's. Stamped, a page can
    tell what is addressed to it and quietly ignore the rest.
    """
    if session is None:
        return msg
    # Anything the session itself said is already stamped, at the moment it
    # was said -- see Session.emit. Re-addressing it here would undo exactly
    # the thing that stamping early is for: this runs on the loop, a queue
    # later, when the pill may well have changed. What is left to address is
    # what the server broadcasts on its own account.
    if "pill" in msg:
        return msg
    # The same pair, read as one value. Reading session_id and persona
    # separately here was the original fault wearing a different hat: the
    # handshake does not go through emit -- it is sent straight down a new
    # socket -- so a page connecting while a pill was being swapped could be
    # handed its whole opening stamped with the new pill's name over the old
    # conversation's id, and take that id for its own. See Session._addressed.
    return {**session._address, **msg}


async def broadcast(msg: dict):
    msg = whose_msg(msg)
    dead = []
    for ws in list(clients):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def _health(s):
    """What the console's top bar says, in two halves.

    The models are the machine's, not this app's. They are the expensive,
    shared, breakable part — the thing somebody opens the console to look at —
    and a second app would be talking to the same three. So they go under
    "machine", which every console shows on every page, including the front
    one where no app has been opened yet.

    What is left is genuinely ours: which conversation, which pill, what it is
    doing this second. That shows only where you are standing.
    """
    lamp = {"ready": "on", "loading": "busy", "error": "bad"}
    LOG.state("machine", name="Lucid Dream",
              parts=[{"name": k.upper(), "state": lamp.get(s.status.get(k), "off"),
                      "title": f"{k}: {s.status.get(k, 'stopped')}"}
                     for k in ("llm", "stt", "tts")],
              facts=[f"{s.memory()['total_gb']:.1f} GB"])
    # The app, and then the room — which is a level down, and only true where
    # somebody is standing in one. In front of the box no pill has been taken
    # and nothing is idle or speaking, so naming one there is the console
    # reporting the server's own bookkeeping as if it were the player's
    # situation.
    LOG.state("lucid-talk", name="Lucid Talk")
    LOG.state("lucid-talk/room",
              facts=[s.state] + ([s.persona["pill"]] if s.persona else []))


async def _pump():
    """Drain worker-thread events onto every connected UI.

    Everything the page ever hears comes through here — the words, the state,
    and the audio — so this task ending is the page going dead while still
    looking connected. It used to be able to: one exception anywhere in the
    body (a snapshot taken while the models were being torn down, a socket
    that failed in a way send_json did not expect) ended the task, nothing
    restarted it, and the only sign was a line in a terminal nobody has open.
    That is the "I had to restart the server" of this program, so the loop is
    now unkillable by anything short of cancellation, and says what happened.
    """
    last_tick = 0.0
    while True:
        try:
            drained = 0
            while drained < 100:
                try:
                    await broadcast(session.events.get_nowait())
                    drained += 1
                except queue.Empty:
                    break
            now = time.monotonic()
            if now - last_tick > 0.2:
                last_tick = now
                await broadcast(session.snapshot())
                # The console's bar, on the same clock. log.state() drops
                # anything that has not actually changed, so this is a
                # comparison and not a broadcast five times a second.
                _health(session)
        except asyncio.CancelledError:
            raise                        # the app is going down; let it
        except Exception as e:
            LOG.say(f"the pump stumbled — {type(e).__name__}: {e}",
                    source="talk", level="error")
            await asyncio.sleep(0.25)    # whatever it was, do not spin on it
        await asyncio.sleep(0.05)


# ---- the commands a page can send -----------------------------------------
# One small function each, looked up by name. The chain of elifs this replaces
# had grown past ninety lines, and reaching into the session's private methods
# from the middle of it is what made them private in name only.

COMMANDS = {}


def command(name):
    def register(fn):
        COMMANDS[name] = fn
        return fn
    return register


@command("start")
async def _start(s, msg, ws):
    s.start_stack()


@command("stop_all")
async def _stop_all(s, msg, ws):
    threading.Thread(target=s.stop_all, daemon=True).start()


@command("input_mode")
async def _input_mode(s, msg, ws):
    s.set_input_mode(msg.get("mode", "mic"))


@command("mode")
async def _mode(s, msg, ws):
    s.mic.mode = msg.get("mode", "hands_free")


@command("barge")
async def _barge(s, msg, ws):
    """The page saying what its microphone granted. Advice, not an order."""
    s.set_barge(bool(msg.get("on", True)))


@command("ptt")
async def _ptt(s, msg, ws):
    s.mic.ptt_down = bool(msg.get("down"))


@command("skip")
async def _skip(s, msg, ws):
    """Enough of this one. Not enough of the evening.

    Stop is a full stop: it silences what is speaking and ends the run with
    it. This is the other thing anybody wants of a long reply — the one where
    you have got the idea and would like the next one — so it takes the floor
    away from this line and leaves the tape running. In a continuous run the
    loop is waiting for the audio to drain before it starts the next turn, so
    silencing this one *is* asking for the next one, and nothing else is
    needed.

    With nothing running there is no next one waiting to happen, so it asks
    for one: a single turn, taken without being typed. Which makes this the
    key for walking a conversation forward a step at a time — press, listen,
    press again, and press it early if the step is longer than you wanted.
    """
    s.silence()
    if s.continuous_left() <= 0:
        s.one_more()


@command("interrupt")
async def _interrupt(s, msg, ws):
    # Interrupt means silence, so it ends a continuous run too -- otherwise it
    # starts talking again a second later. The silencing is the two lines below.
    s.stop_continuous()
    s.silence()          # and drops anything queued behind it


@command("say")
async def _say(s, msg, ws):
    text = (msg.get("text") or "").strip()
    if not text:
        return
    if not s.running:
        # Typed at a cold server: show it, start the models, answer it when
        # they are up. Dropping it silently is the worst of the options.
        s.emit("user", text=text, seconds=0)
        s.pending_say = (s.pending_say + " " + text).strip()
        s.emit("log", text="starting the models first …")
        s.start_stack()
        return
    s.cut_in()
    s.emit("user", text=text, seconds=0)
    threading.Thread(target=s.reply_to, args=(text,), daemon=True).start()


@command("did")
async def _did(s, msg, ws):
    """A hand was put to something in the room.

    The room wrote the sentence — it is the only part of this that knows a
    book from a cushion — and the session decides when it becomes a turn.
    """
    s.did(msg.get("text", ""))


@command("replay")
async def _replay(s, msg, ws):
    threading.Thread(target=s.speak_again, args=(msg.get("text", ""),),
                     daemon=True).start()


@command("delete")
async def _delete(s, msg, ws):
    s.delete_turn("user" if msg.get("role") == "user" else "assistant",
                  msg.get("text", ""))


@command("clear")
async def _clear(s, msg, ws):
    s.open_session(fresh=True)


async def obey(session, msg, ws):
    """Do what one message says, and survive it not making sense.

    A command that did not like its arguments used to end the receive loop, and
    the page stayed connected to a socket that would never answer again: alive
    on screen, deaf, and only a reload would fix it. A minutes field arriving
    as null was enough -- one float() of a None, and the evening was over.

    So the page is worth more than the message. Anything a handler throws is
    said in the console, where somebody can see which command it was, and the
    loop goes back to listening.
    """
    handler = COMMANDS.get((msg or {}).get("cmd"))
    if not handler:
        return
    try:
        await handler(session, msg, ws)
    except WebSocketDisconnect:
        raise                        # the page has gone; that ends the loop
    except Exception as e:
        LOG.say(f"{(msg or {}).get('cmd')} failed: {type(e).__name__}: {e}",
                source="talk", level="error")


def orders():
    """What this app adds to the console.

    The Start/Stop button used to live in the chat panel, which meant the one
    control you need when nothing works was inside the thing that was not
    working. It is here instead, next to the log that tells you why — and
    tagged to the machine rather than to this app, because the models are
    shared and a second app would be waiting on the same three.

    Everything else here is ours. Most of it needs a conversation to be in —
    which pill, this room, this microphone — so it is tagged to the room
    rather than to the app, and does not clutter the list in front of the box
    where none of it means anything yet. /files_where does mean something
    there, so it is the app\'s.

    The names carry their object. Standing in a room, "/start" begs the
    question — start what, the conversation? the evening? — and a console you
    have to guess at is a console you do not reach for. /start_models says
    which of the two components it means, and /session_new says what it is
    about to end.
    """

    @LOG.command("ai_models_start", "load the language, speech and voice models",
                 app="machine")
    def _start(_):
        if session.running:
            # Running is what this app believes, not what is true. A child
            # process can be gone -- killed, crashed, or taken down by
            # something else on the machine -- and the app goes on saying it is
            # up and failing every turn. Answering "already running" to
            # somebody who has come to the console *because* it is not is the
            # least useful sentence available.
            missing = session.what_is_missing()
            if not missing:
                return "already running"
            session.mend()
            return f"{missing} — starting again"
        session.start_stack()
        return "starting the models…"

    @LOG.command("ai_models_stop", "unload everything and give the memory back",
                 app="machine")
    def _stop(_):
        if not session.running:
            return "nothing is running"
        threading.Thread(target=session.stop_all, daemon=True).start()
        return "stopping…"

    # A room's commands belong to the page whose room it is. There is one
    # console for every page, so anything registered here acts on whichever
    # conversation is live rather than on the one being typed into — fine for
    # the machine, which is shared, and wrong for a room, which is not.
    # /session_new is in static/index.html for that reason.

    # No /take_pill. Switching the pill from in here changed the session
    # underneath a room that stayed exactly as it was -- a room is loaded with
    # the page, from personas/<slug>/room.js, so the command left you sitting
    # in the wrong one talking to somebody else. A pill is taken by opening its
    # address, which is what the box does when you press one and what the X in
    # the corner of the panel takes you back to.

    # No /mic. The deck has a key for it, lit while it is listening and
    # beating faster when it can hear you, which is more than a command can
    # say — and a console command that duplicates a control you are looking
    # at is a second place for the same thing to be true.

    @LOG.command("room_clear", "put everything in the room back where it started",
                 app="lucid-talk/room")
    async def _room_clear(_):
        """Undo an evening of pushing things about.

        Named for the thing it clears, next to /room_state which reads it —
        and after /console_clear, which is what this console already calls emptying
        something. It was /tidy for an hour and "room_state forget" before
        that, and both were worse: an argument nobody finds by guessing, and
        then a word that does not say what it does anything to. A console is
        a list you read down; the names have to sort into pairs by themselves.

        The other half of it is that "forget" only cleared the file: the room
        you were standing in went on showing every book you had ever shoved
        until the page was reloaded, so the one person who did find it had no
        reason to believe it had worked.

        This clears the file and tells every page that is in the room, which
        rebuilds it from nothing — the same construction, with the durations at
        zero. Books come back up the spiral, cushions back onto the bed.
        """
        ROOM.forget(session.session_id)
        await broadcast(room_payload(session))
        return "the room is as it was"

    @LOG.command("room_state", "what this conversation has done to its room",
                 app="lucid-talk/room")
    def _room(rest):
        got = ROOM.load(session.session_id)
        kept = {k: v for k, v in got.items() if k != "v"}
        return str(kept) if kept else "nothing touched in here yet"

    @LOG.command("standing_state", "where this pill is holding you, in numbers",
                 app="lucid-talk")
    def _standing(_):
        slug = session.persona["slug"]
        st = R.decayed(R.load(slug))
        word, temper = R.standing(st)
        return (f"{session.persona['pill']} is {word}"
                + (f" and {temper}" if temper else "")
                + " — " + " ".join(f"{a} {st[a]:+.0f}" for a in R.AXES))

    @LOG.command("standing_set", "put this pill at a warmth, to see what it looks like",
                 app="lucid-talk", args="warmth [mood]")
    async def _standing_set(rest):
        """Somewhere to stand, without an evening of earning it.

        The room is lit by warmth and today's mood — see the grade in
        room3d.js — and the only other way to see the far ends of that is to
        edit the json by hand. Which works, and has a trap in it: every read
        goes through decayed(), so a number written next to yesterday's
        timestamp has already faded by the time it is read, and mood, whose
        half-life is six hours, is most of the way gone by morning. This
        stamps it as of now.

        Both axes, because they are not the same thing to look at: warmth is
        where you stand and moves over weeks, mood is today and is half of
        what makes a room look bright.
        """
        bits = (rest or "").replace(",", " ").split()
        if not bits:
            return "standing_set <warmth -100..100> [mood -100..100]"
        try:
            want = [max(-100.0, min(100.0, float(b))) for b in bits[:2]]
        except ValueError:
            return "numbers, between -100 and 100"
        slug = session.persona["slug"]
        st = R.decayed(R.load(slug))
        st["warmth"] = want[0]
        if len(want) > 1:
            st["mood"] = want[1]
        st["updated"] = time.time()      # as of now, or it fades before it is read
        R.save(slug, st)
        word, temper = R.standing(st)
        session.emit("relation", slug=slug,
                     state={k: round(st[k], 1) for k in R.AXES},
                     text=R.describe(st))
        await broadcast(room_payload(session))
        return (f"{session.persona['pill']} is {word}"
                + (f" and {temper}" if temper else "")
                + f" — warmth {st['warmth']:+.0f}, mood {st['mood']:+.0f}")

    @LOG.command("mic_barge", "whether talking over the pill stops it",
                 app="lucid-talk", args="on|off")
    def _barge_cmd(rest):
        """By hand, for a browser that says one thing and does another.

        Barge-in is off by itself where the microphone reports no echo
        cancellation — see micStatus in index.html — because without it the
        pill is the loudest thing in the room, hears itself, and stops
        mid-sentence believing it was interrupted. Not every browser is honest
        about what it granted, and the ones that are not leave a voice that
        cuts itself off every second sentence with nothing in the console to
        explain why.
        """
        want = (rest or "").strip().lower()
        if want in ("on", "off"):
            session.set_barge(want == "on", chosen=True)
        elif want:
            return "mic_barge on|off"
        return ("talking over the pill stops it"
                if session.mic.barge_in else
                "talking over the pill does not stop it — Skip or type instead")

    @LOG.command("mic_follow", "what the mic does when you leave the window",
                 app="lucid-talk", args="focus|hidden|never")
    def _follow_cmd(rest):
        """Live, because this is a setting you find out about by tripping it.

        The config is read when a session starts, so a value changed while one
        is running does not reach the page until the next Start -- and the
        symptom that sends anybody looking for this setting is the mic closing
        under their hand, which is not a moment for restarting anything. Sets
        it for the session and writes it down, so the answer holds.

        Written to the machine's config rather than this game's: the microphone
        belongs to the shelf, and a second game would want the same answer.
        """
        want = (rest or "").strip().lower()
        if want in ("focus", "hidden", "never"):
            session.cfg.setdefault("ui", {})["mic_follows_window"] = want
            cfg = SHELL_CFG.load()
            cfg["mic_follows_window"] = want
            SHELL_CFG.save(cfg)
        elif want:
            return "mic_follow focus|hidden|never"
        how = session.cfg.get("ui", {}).get("mic_follows_window", "hidden")
        return {
            "focus": "the mic closes whenever the window is not in front — "
                     "including while you read the menu bar's own mic menu",
            "hidden": "the mic closes only when the page is really hidden — "
                      "another tab, another app, a locked phone",
            "never": "only the Talk key closes the mic",
        }[how]

    @LOG.command("files_where", "the files this is all kept in", app="lucid-talk")
    def _where(_):
        return (f"sessions {paths.SESSIONS} · memory {paths.MEMORY} · "
                f"rooms {paths.ROOMS}")


def standing_now(s) -> dict:
    """Where the pill is holding you, as two numbers the room can be lit by.

    `warmth` is the slow axis and `temper` is today's mood -- both -100..100,
    and both zero when there is nothing to say, which is a room exactly as it
    was painted. Named `temper` on the way out because the payload it goes
    into is already called mood and means something else entirely.
    """
    if not (s.cfg.get("relation") or {}).get("enabled", False):
        return {"warmth": 0.0, "temper": 0.0}
    try:
        state = R.decayed(R.load(s.persona["slug"]))
        return {"warmth": float(state["warmth"]), "temper": float(state["mood"])}
    except Exception as e:
        LOG.say(f"could not read the standing: {type(e).__name__}: {e}",
                source="talk", level="debug")
        return {"warmth": 0.0, "temper": 0.0}


def room_payload(s) -> dict:
    """Everything the room needs to build itself, and nothing it does not.

    `state` is what hands have done in this conversation. `mood` is what the
    persona is set to *right now* — which is deliberately not stored with the
    state: reopening an old conversation at a different temperature is meant
    to keep its history and grow it in a different hand. See rooms.py.
    """
    persona = s.persona
    llm = (s.cfg.get("llm") or {})
    return {
        "type": "room",
        "session": s.session_id,
        "persona": persona["slug"],
        "state": ROOM.load(s.session_id),
        "mood": {
            # The effective one: the persona's own if it sets it, otherwise
            # whatever this machine is tuned to. The same fallback the reply
            # itself is generated with.
            "temperature": float(persona.get("temperature")
                                 if persona.get("temperature") is not None
                                 else llm.get("temperature", 0.8)),
            "top_p": float(persona.get("top_p")
                           if persona.get("top_p") is not None
                           else llm.get("top_p", 0.95)),
            # And how this pill is holding you, which is what the room is lit
            # by. Sent again after every turn -- see the relation event in
            # session.py -- so this is only the color it opens in.
            **standing_now(s),
        },
    }


@command("room_get")
async def _room_get(s, msg, ws):
    await ws.send_json(room_payload(s))


@command("room_set")
async def _room_set(s, msg, ws):
    """A hand touched something. Stored, then told to every screen watching —
    so a book pushed off a shelf on the desk falls on the phone as well."""
    state = msg.get("state")
    if not isinstance(state, dict):
        return
    ROOM.save(s.session_id, state)
    await broadcast(room_payload(s))


@command("room_forget")
async def _room_forget(s, msg, ws):
    """Put the room back to nothing without touching the conversation."""
    ROOM.forget(s.session_id)
    await broadcast(room_payload(s))


@command("relation_reset")
async def _relation_reset(s, msg, ws):
    s.reset_relation(whose(s, msg))


def whose(s, msg) -> str:
    """Which pill a request is about.

    These used to mean "the one you are talking to", which was the only
    possible answer from inside a room. The box's dashboard asks about all of
    them at once — what each remembers, what you have already said to each —
    so the slug is a parameter now, and the pill in front of you is only the
    default.

    Anything unrecognised falls back rather than failing: this arrives over a
    socket, and a bad slug should not be able to reach the filesystem.
    """
    want = (msg.get("slug") or "").strip().lower()
    if want and any(p["slug"] == want for p in P.listing()):
        return want
    return s.persona["slug"]


@command("memory_get")
async def _memory_get(s, msg, ws):
    """What a pill remembers, and whether it is being used at all.

    memory.enabled off leaves the file exactly where it is and stops it
    reaching any reply — so the sheet has to say so. Shown rather than hidden,
    because what is written there is still yours to read.
    """
    slug = whose(s, msg)
    on = (s.cfg.get("memory") or {}).get("enabled", True)
    await ws.send_json({"type": "memory", "slug": slug, "text": MEM.load(slug),
                        "off": not on})


@command("memory_save")
async def _memory_save(s, msg, ws):
    slug = whose(s, msg)
    MEM.save(slug, msg.get("text", ""))
    s.emit("log", text=f"memory saved for {slug}")


def ledger() -> dict:
    """What the box knows about you, for the sheet inside the lid.

    Counted from what is on disk rather than kept anywhere: doses are the
    conversations you have had, what a pill remembers is the lines in its
    memory file, and where it holds you is its relation state. Nothing here is
    a score — it is a record, the way a notebook is.
    """
    sessions = S.listing(limit=500)
    # From the running session if there is one, and from the file if the box
    # is being read before anything has started.
    cfg = session.cfg if session else C.load()
    standing_on = (cfg.get("relation") or {}).get("enabled", False)
    pills = []
    for persona in P.listing():
        slug = persona["slug"]
        mine = [x for x in sessions if x["persona"] == slug]
        remembered = [l for l in MEM.load(slug).splitlines() if l.strip()]
        # Off means off, whatever is still on disk from when it was not: a
        # standing nothing is moving any more is a number pretending to be one.
        word = ""
        if standing_on and R.path(slug).exists():
            word, temper = R.standing(R.decayed(R.load(slug)))
            word = f"{word} · {temper}" if temper else word
        pills.append({
            "slug": slug, "name": persona["pill"], "color": persona["color"],
            "doses": len(mine), "remembered": len(remembered),
            "standing": word, "last": mine[0]["when"] if mine else "",
        })
    return {"doses": len(sessions), "pills": pills}


@command("ledger")
async def _ledger(s, msg, ws):
    await ws.send_json({"type": "ledger", **ledger()})


@command("setup")
async def _setup(s, msg, ws):
    """How long a dose lasts, written down.

    Set on the lid of the open box, where the tally of what each pill has
    given you is — so it is a thing you change in passing rather than a
    question anybody is asked before they are allowed to take one.
    """
    minutes = max(1, min(int(msg.get("minutes", 15) or 15), 120))
    s.cfg.setdefault("ui", {})["continuous_minutes"] = minutes
    C.save(s.cfg)
    s.emit("log", text=f"a dose now lasts {minutes} minutes")
    await ws.send_json({"type": "setup", "minutes": minutes})


@command("sessions")
async def _sessions(s, msg, ws):
    # One pill's conversations. From a room that is the pill you are with;
    # from the dashboard it is whichever row was asked about. A list mixing
    # everyone in offers conversations a page cannot open without leaving it.
    slug = whose(s, msg)
    await ws.send_json({"type": "sessions", "slug": slug,
                        "items": S.listing(persona=slug)})


# No "persona" and no "resume". They were the two halves of what a page came
# for, sent a tenth of a second apart, and nothing sends them any more.
@command("open")
async def _open(s, msg, ws):
    """A page saying what it came for: this pill, and this conversation.

    Replaces a persona command followed a tenth of a second later by a resume,
    which raced with itself — see Session.open_for. On a thread because
    switching pills loads a voice.

    And the models start here, before anybody has said anything. Standing in a
    room is the first honest sign of intent, and it comes seconds ahead of the
    first word — seconds the machine can spend loading instead of making
    somebody watch it load after they have already spoken. Every other way in
    still starts the stack; this one just gets there first. Off with
    warm_on_open, for a machine that cannot afford to load on a look.
    """
    if s.cfg.get("warm_on_open", True):
        # With the slug, so a cold start comes up as the pill this page came
        # for. Without it the boot is whichever persona sorts first and the
        # first sentence is spoken in that voice — see Session.start_stack.
        s.start_stack(msg.get("slug", ""))
    threading.Thread(target=s.open_for, daemon=True,
                     args=(msg.get("slug", ""), msg.get("session") or "")).start()


@command("mic_audio")
async def _mic_audio(s, msg, ws):
    try:
        raw = base64.b64decode(msg.get("pcm", ""))
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        s.mic.feed(pcm, int(msg.get("rate", 16000)))
    except Exception as e:
        s.emit("log", text=f"mic audio rejected: {e}")


@command("audio_state")
async def _audio_state(s, msg, ws):
    """The page telling us how much it still has to play."""
    report = getattr(s.speaker, "report", None)
    if report:
        report(msg.get("queued_s", 0))


@command("continuous")
async def _continuous(s, msg, ws):
    # `now` is the deck's Play: a key that starts the tape rather than a box
    # that promises something about later. See session.start_continuous.
    s.start_continuous(msg.get("minutes", 15), at_once=bool(msg.get("now")))


@command("hold")
async def _hold(s, msg, ws):
    """Pause the run, or let it go on. Sent with the voice's own pause."""
    s.hold_continuous(bool(msg.get("on")))


@command("continuous_stop")
async def _continuous_stop(s, msg, ws):
    s.stop_continuous()
    s.emit("log", text="continuous stopped")


# ---- the app --------------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_pump())
    yield
    task.cancel()
    session.stop_all()


def create_app() -> FastAPI:
    """Build the session, then the app around it."""
    global session
    if session is None:
        session = Session(has_listeners=lambda: bool(clients))

    orders()                       # what this app adds to the console
    # Twenty gigabytes of child process. If the shell is about to replace
    # itself, these have to be put down first or they are orphaned.
    SHELL.before_restart(lambda: session.stop_all() if session.running else None)
    app = FastAPI(lifespan=lifespan)

    def card(persona: dict) -> str:
        """A pill lying in the box: its color, its name, and a word about it.

        The blurb is on the card rather than in a tooltip because there is no
        hovering on a phone, and this is the only place it is ever said.
        """
        return (
            f'<a class="pill" href="{persona["slug"]}" '
            f'style="--pill:{persona["color"]}" '
            f'data-figure="{persona.get("figure") or ""}" '
            f'aria-label="{persona["pill"]} — {persona["blurb"]}">'
            '<span class="dose" aria-hidden="true"><i></i></span>'
            f'<span class="caption"><b>{persona["pill"]}</b>'
            f'<em>{persona["blurb"]}</em></span>'
            '</a>')

    @app.get("/", response_class=HTMLResponse)
    def choose():
        """Who you came for. There is no default -- somebody has to be picked."""
        page = (paths.STATIC / "choose.html").read_text()
        page = page.replace("<!--TILES-->", "\n".join(map(card, P.listing())))
        return HTMLResponse(SHELL.stamped(page), headers=SHELL.FRESH)

    @app.get("/assets/{name}")
    def asset(name: str):
        """This app's own front-end files.

        Until now the page was one file with everything inlined and the only
        other thing it wanted came from /shared. The sheets are shared between
        two of this app's pages but belong to no other app, so they live here
        rather than in the shell — which is the same rule the rooms follow.

        Defined before /{slug}, which would otherwise swallow it: routes are
        matched in the order they are written.
        """
        f = (paths.STATIC / name).resolve()
        if f.parent != paths.STATIC.resolve() or not f.is_file():
            return HTMLResponse("no such thing", status_code=404)
        kind = {".css": "text/css", ".js": "text/javascript"}.get(f.suffix.lower())
        return FileResponse(f, media_type=kind, headers=SHELL.FRESH)

    @app.get("/{slug}/room/{name:path}")
    def room_asset(slug: str, name: str):
        """A file out of a persona's bundle: its room, or something the room
        wants. Bundles are read-only content, so these are safe to cache for a
        moment — but only a moment, since a room is edited like everything else
        here, by opening the file and saving it.
        """
        f = P.asset(slug, name)
        if not f:
            return HTMLResponse("no such thing", status_code=404)
        kind = {".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
                ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
                ".woff2": "font/woff2", ".wav": "audio/wav"}.get(f.suffix.lower())
        return FileResponse(f, media_type=kind, headers=SHELL.FRESH)

    @app.get("/{slug}")
    def talk(slug: str):
        """One page per persona, so a conversation has an address.

        Bookmark it and it is who opens; open the app itself and nobody is
        chosen for you. A draft has no route at all -- unknown names come
        back here rather than 404, because the only way to get one is a
        stale bookmark.
        """
        here = next((p for p in P.listing() if p["slug"] == slug), None)
        if not here:
            return RedirectResponse("./", status_code=303)
        # Read and stamped rather than served as a file: the asset addresses in
        # it have to carry the current version or a phone will keep yesterday's
        # stylesheet for as long as it feels like.
        page = SHELL.stamped((paths.STATIC / "index.html").read_text())
        # The room's own figure, on the page from the first byte. The mark
        # shown while the room is being built is that figure, and it is on
        # screen well before the socket has said whose room this is -- so it
        # cannot be told, it has to arrive with the document.
        if here.get("figure"):
            page = page.replace('<html lang="en" class="waking">',
                                f'<html lang="en" class="waking" '
                                f'data-figure="{here["figure"]}">', 1)
        return HTMLResponse(page, headers=SHELL.FRESH)

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        # A page from somewhere else does not get the conversation: see
        # shell.server.from_this_page. The handshake hands over the whole
        # transcript, so this is the first thing that happens here.
        if not SHELL.from_this_page(ws):
            await ws.close(code=1008)
            return
        await ws.accept()
        clients.add(ws)
        # Everything out of here is stamped as well, and the handshake most of
        # all: it is the one burst a page has no way of having asked for.
        async def tell(msg):
            await ws.send_json(whose_msg(msg))
        await tell(session.snapshot())
        try:
            await tell({"type": "ledger", **ledger()})
            await tell({"type": "setup",
                        "minutes": session.cfg.get("ui", {}).get("continuous_minutes", 15)})
            await tell({"type": "personas", "items": P.listing(),
                        "active": session.persona["slug"]})
            await tell({"type": "sessions",
                        "items": S.listing(persona=session.persona["slug"])})
            # The name rides with it: the room is sent last on purpose (below),
            # and it is the room that carries the pill's name — so without this
            # a page restoring a conversation labels all of it "the pill".
            await tell({"type": "history", "messages": session.history,
                        "persona_name": session.persona["pill"]})
            # Last, so the room is restored onto a page that already has the
            # conversation in it: most of what a room is made of is the talk.
            await tell(room_payload(session))
        except Exception as e:
            # One unreadable transcript used to kill the socket mid-handshake
            # and the page just showed a dead connection.
            await tell({"type": "log", "text": f"handshake partial: {e}"})
        try:
            while True:
                await obey(session, await ws.receive_json(), ws)
        except WebSocketDisconnect:
            pass
        finally:
            clients.discard(ws)

    return app
