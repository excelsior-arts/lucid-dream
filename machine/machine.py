"""The machine: one language model, one voice, and the surface they answer on.

Everything expensive on this Mac is here, and there is exactly one of each. A
second Chatterbox and a second Parakeet are several gigabytes on a machine
whose floor is thirty-two, and two mlx_lm servers on one port is one model
being swapped in and out on alternating requests. So the stack is a
module-level thing that whoever asks is handed, and every route below is
handed the same one.

---- what is shared, and what is not ----------------------------------------

The machine is shared; conversations are not. Each page runs its own loop with
its own mic and its own speaker, and this answers whoever calls. Which means
every route here can be waiting on somebody else's turn: `Voice` runs all MLX
work on one thread and the model server serializes itself, so two pages
talking at once queue rather than collide. Nobody has to know that but the
person who notices their reply took twice as long.

Nothing here knows what a game is. It is handed messages, samples, a voice by
name, and hands back tokens, text and audio — the same shape a hosted provider
would answer from a CDN, which is the point of putting the line here.

---- the log rule -----------------------------------------------------------

Not one word of a conversation goes to the console from this file. Counts,
seconds, sample rates and names, yes; what was said, never. See machine/log.py.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
from pathlib import Path
import time

import numpy as np
from fastapi import HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import config as C
from . import log as LOG
from . import models as M
from . import shelf as S
from . import voices as V
from . import assets as A
from .store import asked, raw, too_much

# What a page sends and what comes back, in samples per second. The recognizer
# wants 16k and the voice speaks at 24k; both are the models' numbers and
# neither is negotiable, so a caller sending anything else is resampled here.
STT_RATE = 16000

# How much of an utterance this will take in one request, as a multiple of
# what a turn can be: `vad.max_turn_ms` is the length the page stops recording
# at, so anything past it was never a turn. Wide, because the margin is not
# what makes this worth having -- there is no authentication anywhere on this
# and with --phone anyone on the wifi can post to it, and one socket must not
# be able to ask for an hour of audio to be resampled.
TURNS = 2


def most_audio(rate: int) -> int:
    """The bytes one utterance may be, at the rate it was sent at.

    Two bytes a sample, mono, and the rate is the caller's: a page captures at
    whatever its browser felt like and is resampled here, so the same number
    of seconds is three times the bytes at 48k.
    """
    ms = float((C.load().get("vad") or {}).get("max_turn_ms") or 30000)
    return int(max(ms, 1000.0) / 1000.0 * rate * 2 * TURNS)


def idle_minutes() -> float:
    """How long the machine may sit loaded with nobody asking it anything.

    `idle_stop_minutes` in the machine's config, 30 unless it says otherwise,
    and 0 or less is never. Read on every look rather than once at start, the
    way the microphone's settings are, so an edit to the file is the next
    check's answer. A value that is not a number is the default rather than a
    watchdog that dies on it. The watchdog defers to any conversation that
    says it is busy, so a page that is in the middle of something is never
    put away underneath it.
    """
    got = C.load().get("idle_stop_minutes")
    try:
        return float(got)
    except (TypeError, ValueError):
        return float(C.DEFAULTS["idle_stop_minutes"])

# And how long one model stays up after the last page to want it said it was
# done. A microphone goes off between two things somebody says and the mute
# switch is flicked to answer a phone; unloading on the press and loading again
# twenty seconds later costs far more than the memory does. One number for both
# models, because the reason is the same for both.
#
# LUCID_GRACE_S shortens it. That is a hook for a test that cannot sit here for
# a minute and a half, and nothing else: there is no setting for it.
GRACE_S = float(os.environ.get("LUCID_GRACE_S") or 90)

# How often the watchdog wakes. It used to nap for fifteen seconds, which was
# fine for a thing counted in half hours and is not fine for one counted in
# seconds: a grace that fired up to fifteen seconds late reads as a machine
# that does what it was told when it feels like it. What it costs is a dict
# comparison and a subtraction.
WATCH_S = 1.0

# How often the memory meter is allowed to shell out: while a console (which
# is to say a page) is attached, and while none is. See Stack.memory.
WATCHED_SECS = 3.0
QUIET_SECS = 15.0


class Stack:
    """The one LLM server and the one Voice, and their lifecycle.

    `llm` and `voice` are built on first ask rather than in the constructor,
    so importing this costs nothing and a test can hand its own pair in.
    """

    def __init__(self, llm=None, voice=None, now=None):
        self._llm = llm
        self._voice = voice
        # What the supervisor above was built out of, for telling a settings
        # edit from a restart. None for one handed in here, which is a test's
        # and is nobody else's to rebuild. See _retuned.
        self._built: tuple | None = None
        # The clock the grace is counted on, so a test can move ninety seconds
        # without waiting ninety seconds. Monotonic, because this measures a
        # length and not a time of day.
        self._now = now or time.monotonic
        # One dict, held by whoever is looking: the conversation writes its
        # boot into it and `GET /machine` reads it, and there is no moment
        # when the two disagree about which of three things is loaded.
        self.status = {"llm": "off", "stt": "off", "tts": "off"}
        # Bumped by every stop and sweep, so a load that finished after one
        # can tell. See _unwanted, and start_llm for the language model's --
        # which is the same problem with a child process in it.
        self._load_gen = {"llm": 0, "stt": 0, "tts": 0}
        # When each of the two smaller models is due to be put away, or None
        # for one nobody has said they are done with. See want().
        self._grace: dict[str, float | None] = {"stt": None, "tts": None}
        self.active_at = time.time()
        # Re-entrant: a revive holds it across the kill and the start that
        # follows (start_llm takes it again), so a line arriving in between
        # waits for the fresh model rather than finding the old one dying.
        self._starting = threading.RLock()
        self._mending = False
        self._busy: list = []
        self._watch: threading.Thread | None = None
        self._mem_seen = {"llm_gb": 0.0, "app_gb": 0.0, "voice_gb": 0.0,
                          "total_gb": 0.0}
        self._mem_at = 0.0
        self._mem_busy = False
        # A size being brought onto the shelf, for the card that asked for it:
        # which, how far, and how it ended. None when nothing has been asked.
        # See fetch().
        self._fetch: dict | None = None
        self._fetching = threading.Lock()
        # And the voice and the ear, brought down by the same card beside the
        # language model or on their own: which, how far, how it ended.
        # See fetch_parts().
        self._parts: dict | None = None

    # ---------- the two objects ----------

    @property
    def llm(self):
        if self._llm is None:
            # The settings first, and then the thing built out of them. This
            # property is reached from further away than a start -- the memory
            # meter measures the language model, and measuring it builds it --
            # so a supervisor made here before apply() had ever run took the
            # default server and the default paths, and a machine configured
            # for mlx_vlm launched mlx_lm for the rest of the run.
            self.apply()
            self._llm = self._supervisor()
        return self._llm

    def _supervisor(self):
        """A supervisor for the language model as the config has it now."""
        llm = C.stack().get("llm") or {}
        self._built = self._launch(llm)
        return M.LLMServer(llm.get("model") or "models/llm",
                           server=str(llm.get("server") or ""))

    @staticmethod
    def _launch(llm: dict) -> tuple:
        """What a supervisor is made of. Change any of these and the child
        process is a different one: a different program, a different model, a
        different port to find it on, a different environment to run it in."""
        return tuple(str(llm.get(k) or "")
                     for k in ("model", "server", "port", "venv"))

    def _retuned(self):
        """Build it again if what it was built from has changed.

        `apply` promises that an edit applies on start, and the supervisor is
        the half of the machine that does not re-read anything: it is handed
        its program and its model once. So changing llm.server, stopping and
        starting used to start the old one again, with nothing anywhere to say
        why the vision model was never being served.

        Only one this made -- a supervisor handed in from outside is not this
        object's to replace -- and only while it is down, because what is up is
        a child process this is holding the handle to.
        """
        if self._built is None or self.llm.running():
            return
        if self._built != self._launch(C.stack().get("llm") or {}):
            self._llm = self._supervisor()

    # ---------- the sizes a language model comes in ----------

    def sizes(self) -> dict:
        """Each size by name: where it is kept, and whether it is there.

        The manifest's three, and any the config adds of its own. There is a
        directory with a config.json in it, or there is not; a size that is
        not there is listed so a console can say what could be fetched, and
        refused if asked for.
        """
        cfg = C.load()
        base = (cfg.get("models") or {}).get("dir") or C.somewhere("models")
        named = {s: str(S.where(base, "llm", s)) for s in S.sizes()}
        for name, path in ((cfg.get("llm") or {}).get("sizes") or {}).items():
            if name and path:
                named[str(name)] = C.somewhere(str(path))
        return {name: {"path": path, "here": (Path(path) / "config.json").is_file()}
                for name, path in named.items()}

    def size(self) -> str:
        """The size the model in use is, by the path of the process that is
        serving it -- what is actually running, not what the config says
        should be. The two part when the config is edited by hand and nothing
        has restarted the server; before the server has ever been built there
        is only the config to go by. A path no size names is nothing."""
        llm = self._llm
        using = (str(getattr(llm, "model_path", "")) if llm is not None
                 else str((C.load().get("llm") or {}).get("model") or ""))
        using = Path(using).resolve()
        for name, v in self.sizes().items():
            if Path(v["path"]).resolve() == using:
                return name
        return ""

    def resize(self, name: str) -> dict:
        """Put another size of the language model in use, and start it.

        Written into the config first, so the choice outlives this process,
        and only the size: the file's other settings for the model are theirs
        to keep. A model given by path is let go of -- the size is the choice
        now. Then the server is stopped and started, which is what picks the
        new path up -- see _retuned. The other two models are left exactly
        where they are.
        """
        sizes = self.sizes()
        if name not in sizes:
            raise ValueError(f"no size called {name!r} — the sizes are "
                             + ", ".join(sizes) if sizes else "none")
        if not sizes[name]["here"]:
            raise ValueError(f"the {name} model is not here: nothing at "
                             f"{sizes[name]['path']} — setup.sh fetches it")
        llm = dict(C.written().get("llm") or {})
        llm["size"] = name
        llm.pop("model", None)
        C.note(llm=llm)
        self._load_gen["llm"] += 1
        if self._llm is not None:
            self._llm.stop()
        self.status["llm"] = "off"
        self.start_llm()
        return {"status": self.status["llm"], "size": self.size()}

    def here(self) -> bool:
        """Whether the language model the config names is on this Mac.

        What the first-open card in a room asks: a machine with its model on
        disk never sees the card, and one without -- a fresh checkout, or one
        whose shelf is somewhere that has not been filled -- is offered the
        sizes to fetch. The path is the config's, not the running process's,
        because the question is what a start would find.
        """
        model = str((C.load().get("llm") or {}).get("model") or "")
        return bool(model) and (Path(model) / "config.json").is_file()

    def offer(self) -> list[dict]:
        """The sizes a page can choose between, smallest first: what each
        weighs, whether it is already here, and the one this Mac's memory is
        good for marked, by setup's rule (shelf.pick). Only the manifest's
        three: a size of somebody's own is on disk already or nowhere."""
        base = (C.load().get("models") or {}).get("dir") or C.somewhere("models")
        good = S.pick(S.ram_gb())
        # Whole, rather than a config.json in a directory: that is the first
        # file of a download to arrive, and the card said "on this Mac" over a
        # bar at 20 MB.
        return [{"size": name, "repo": S.entry("llm", name)["repo"],
                 "gb": S.entry("llm", name)["gb"],
                 "here": S.whole(S.where(base, "llm", name), S.entry("llm", name)["rev"]),
                 "suggested": name == good}
                for name in S.sizes()]

    # The two the card offers beside the language model, by the name the card
    # gives them: the voice and the ear. One of each, the manifest's.
    PARTS = {"voice": ("tts", "Chatterbox Turbo"), "ear": ("stt", "Parakeet")}

    def part_here(self, role: str) -> bool:
        """Whether the voice (tts) or the ear (stt) the config names is on
        this Mac: the manifest's checkout whole at its commit, or a path of
        somebody's own that is there at all."""
        cfg = C.load()
        base = (cfg.get("models") or {}).get("dir") or C.somewhere("models")
        model = Path(str((cfg.get(role) or {}).get("model") or ""))
        home = S.where(base, role)
        if not str(model) or model.resolve() == home.resolve():
            return S.whole(home, S.entry(role)["rev"])
        return model.is_dir()

    def parts(self) -> dict:
        """What the first-open card offers beside the sizes: the voice and
        the ear, each a row -- what it is, what it weighs, whether it is here
        -- and how a fetch of them is going."""
        out: dict = {}
        for kind, (role, name) in self.PARTS.items():
            e = S.entry(role)
            out[kind] = [{"id": role, "name": name, "repo": e["repo"], "gb": e["gb"],
                          "here": self.part_here(role), "suggested": True}]
        out["fetch"] = self.parts_fetching()
        return out

    def parts_fetching(self) -> dict | None:
        got = dict(self._parts) if self._parts else None
        if got and got.get("state") == "fetching":
            base = (C.load().get("models") or {}).get("dir") or C.somewhere("models")
            total = 0.0
            for role in got.get("roles", []):
                home = S.where(base, role)
                try:
                    total += S.size_of(home) if home.is_dir() else 0.0
                except OSError:
                    pass
            got["got_gb"] = round(total, 2)
        return got

    def fetch_parts(self, roles: list[str]) -> dict:
        """Bring the voice, the ear or both onto the shelf, as fetch() brings
        a size: shelf.fetch on a thread, one already whole left as it is.
        Nothing is started: the voice and the ear load when a room asks for
        them, as they always have."""
        bad = [r for r in roles if r not in S.ROLES]
        if not roles or bad:
            raise ValueError("the parts are " + ", ".join(S.ROLES))
        with self._fetching:
            now = self._parts
            if now and now.get("state") == "fetching":
                return dict(now)
            self._parts = {"roles": list(roles), "state": "fetching", "got_gb": 0.0,
                           "gb": round(sum(S.entry(r)["gb"] for r in roles), 2)}
        self.touch()
        threading.Thread(target=self._parts_fetched, args=(list(roles),), daemon=True,
                         name="machine-fetch-parts").start()
        return dict(self._parts)

    def _parts_fetched(self, roles: list[str]) -> None:
        base = (C.load().get("models") or {}).get("dir") or C.somewhere("models")
        named = {"tts": "the voice", "stt": "the ear"}
        for role in roles:
            e = S.entry(role)
            LOG.say(f"fetching {named[role]}, ~{e['gb']} GB …", source="machine")
            try:
                home = S.where(base, role)
                if not S.whole(home, e["rev"]):
                    home = S.fetch(base, role)
                if not S.whole(home, e["rev"]):
                    raise RuntimeError("the download finished and is still not whole")
            except Exception as err:
                self._parts = {**(self._parts or {}), "state": "error",
                               "error": f"{type(err).__name__}: {err}"}
                LOG.say(f"{named[role]} did not come down — {type(err).__name__}: {err}",
                        source="machine", level="error")
                return
            LOG.say(f"{named[role]} is on the shelf", source="machine")
        self._parts = {**(self._parts or {}), "state": "done",
                       "got_gb": self._parts.get("gb", 0.0) if self._parts else 0.0}

    def fetching(self) -> dict | None:
        """How a fetch is going, measured rather than reported: what is on
        disk under the checkout -- the downloader writes into it as it goes,
        its unfinished files included -- against what the manifest says the
        whole weighs. A copy, so a caller cannot write into it."""
        got = dict(self._fetch) if self._fetch else None
        if got and got.get("state") == "fetching":
            base = (C.load().get("models") or {}).get("dir") or C.somewhere("models")
            home = S.where(base, "llm", got["size"])
            try:
                got["got_gb"] = round(S.size_of(home), 2) if home.is_dir() else 0.0
            except OSError:
                got["got_gb"] = 0.0
        return got

    def fetch(self, name: str) -> dict:
        """Bring one of the manifest's sizes onto the shelf, then run it.

        The first-open card's download: shelf.fetch, which resumes a download
        that stopped and does nothing to one already whole, and then resize --
        the choice written into the config and the server started on it -- so
        the room that asked carries on with the model it chose. On a thread,
        because three gigabytes take what they take; `GET /machine` carries
        how far it has got. One at a time: a second ask while one is running
        is answered with the one that is.
        """
        if name not in S.sizes():
            raise ValueError(f"no size called {name!r} — the sizes are "
                             + ", ".join(S.sizes()))
        with self._fetching:
            now = self._fetch
            if now and now.get("state") in ("fetching", "starting"):
                return dict(now)
            self._fetch = {"size": name, "state": "fetching", "got_gb": 0.0,
                           "gb": S.entry("llm", name)["gb"]}
        self.touch()
        threading.Thread(target=self._fetched, args=(name,), daemon=True,
                         name="machine-fetch").start()
        return dict(self._fetch)

    def _fetched(self, name: str) -> None:
        base = (C.load().get("models") or {}).get("dir") or C.somewhere("models")
        e = S.entry("llm", name)
        LOG.say(f"fetching the {name} language model, ~{e['gb']} GB …", source="machine")
        try:
            # One already whole is only started: nothing to ask the network.
            home = S.where(base, "llm", name)
            if not S.whole(home, e["rev"]):
                home = S.fetch(base, "llm", name)
            if not S.whole(home, e["rev"]):
                raise RuntimeError("the download finished and is still not whole")
        except Exception as err:
            self._fetch = {**(self._fetch or {}), "state": "error",
                           "error": f"{type(err).__name__}: {err}"}
            LOG.say(f"the {name} model did not come down — {type(err).__name__}: {err}",
                    source="machine", level="error")
            return
        self._fetch = {**(self._fetch or {}), "state": "starting",
                       "got_gb": round(S.size_of(home), 2)}
        LOG.say(f"the {name} model is on the shelf — starting it", source="machine")
        try:
            self.resize(name)
        except Exception as err:
            self._fetch = {**self._fetch, "state": "error",
                           "error": f"{type(err).__name__}: {err}"}
            return
        ok = self.status["llm"] == "ready"
        self._fetch = {**self._fetch, "state": "done" if ok else "error",
                       **({} if ok else {"error": "the language model did not start"})}

    @property
    def voice(self):
        if self._voice is None:
            self._voice = M.Voice()
        return self._voice

    @property
    def made(self) -> bool:
        """Whether anything has asked for the models yet. Reading `.llm` to
        find out would be the thing this answers."""
        return self._llm is not None or self._voice is not None

    # ---------- who is using it ----------

    def touch(self):
        """Something happened. Say so, so the machine is not put away
        mid-thought."""
        self.active_at = time.time()

    def busy_if(self, says_so):
        """Register a way of being busy that this clock cannot see.

        A conversation with a reply in flight is using the machine whether or
        not a route has been called for a minute, and unloading underneath one
        costs the turn. A caller in the middle of one says so here and
        answers the whole question itself, so this clock governs the pages that
        only ever talk to these routes.
        """
        self._busy.append(says_so)

    def busy(self) -> bool:
        for says_so in list(self._busy):
            try:
                if says_so():
                    return True
            except Exception:
                continue
        return False

    # ---------- loading ----------

    def _watching(self):
        if self._watch is None:
            self._watch = threading.Thread(target=self._idle_watch, daemon=True,
                                           name="machine-idle")
            self._watch.start()

    def apply(self):
        """Re-read what the machine is tuned to, so an edit applies on start.

        Nothing about a voice. There is no such thing as this machine's own
        voice: a clip is named in the request that wants it, and a request that
        names nobody is refused with the name it should have said. Lending the
        first clip on the shelf meant a mistyped name came out sounding like
        somebody else, which is the one failure a person cannot debug by ear.
        """
        M.apply_config(C.stack())

    def start_llm(self, timeout: float = 600) -> bool:
        """Bring the language model up, or say that it would not come.

        Serialized, because two pages arriving at a cold machine at once is
        the ordinary case and the second one must wait for the first rather
        than spawn a twenty-gigabyte second child.

        A stop is not, and cannot be: the console's ai_models_stop and the
        watchdog both mean it now, and waiting out a start that may sit here
        for ten minutes is not stopping. So a stop is allowed to land in the
        middle of this, and what it leaves behind is a generation this start
        no longer matches -- the same arrangement the two smaller models use,
        with a child process in it. The lamp said `ready` over a model that
        had been killed underneath it, and whatever came up after the stop is
        put away here rather than left running with nothing to say it exists.
        """
        with self._starting:
            self.touch()
            self._watching()
            if self.llm.ready():
                self.status["llm"] = "ready"
                return True
            self.apply()
            self._retuned()
            # Nothing on disk to start. Said once, in words, rather than
            # launching a server that dies on a missing path and printing its
            # last lines as an error: a fresh machine is not a broken one, and
            # the page it is asked from offers the sizes to fetch. Only for a
            # size off the shelf, in a supervisor this made: a model path
            # written by hand is somebody's own and is launched as it always
            # was, and a supervisor handed in is a test's.
            if (self._built is not None and not self.here()
                    and not (C.written().get("llm") or {}).get("model")):
                if self.status["llm"] != "absent":
                    LOG.say("no language model on this Mac yet — the page offers "
                            "the sizes to fetch", source="machine", level="warn")
                self.status["llm"] = "absent"
                return False
            self.status["llm"] = "starting"
            gen = self._load_gen["llm"]
            LOG.say(f"starting the language model on :{M.LLM_PORT} …",
                    source="machine")
            self.llm.start()
            ok = self.llm.wait_ready(timeout=timeout)
            if gen != self._load_gen["llm"]:
                self.llm.stop()
                self.status["llm"] = "off"
                return False
            self.status["llm"] = "ready" if ok else "error"
            if not ok:
                LOG.say("the language model did not start", source="machine",
                        level="error")
                for line in M.last_words(self.llm.log_path):
                    LOG.say(line, source="llm", level="error")
            return ok

    def load_stt(self) -> bool:
        self.touch()
        self._watching()
        # Asking for it is wanting it, whoever asks and however: a page that
        # never says a word about lifecycles still works, and one that said it
        # was done and then transcribed something has changed its mind.
        self._grace["stt"] = None
        if self.status["stt"] != "ready":
            self.apply()
            self.status["stt"] = "loading"
        gen = self._load_gen["stt"]
        try:
            self.voice.load_stt()
            if gen != self._load_gen["stt"]:
                return self._unwanted("stt")
            self.status["stt"] = "ready"
            return True
        except Exception as e:
            self.status["stt"] = "error"
            LOG.say(f"the recognizer would not load: {type(e).__name__}: {e}",
                    source="machine", level="error")
            return False

    def load_tts(self) -> bool:
        self.touch()
        self._watching()
        self._grace["tts"] = None        # asking for it is wanting it
        if self.status["tts"] != "ready":
            self.apply()
            self.status["tts"] = "loading"
        gen = self._load_gen["tts"]
        try:
            self.voice.load_tts()
            if gen != self._load_gen["tts"]:
                return self._unwanted("tts")
            self.status["tts"] = "ready"
            return True
        except Exception as e:
            self.status["tts"] = "error"
            LOG.say(f"the voice would not load: {type(e).__name__}: {e}",
                    source="machine", level="error")
            return False

    def _unwanted(self, model: str) -> bool:
        """A load that finished after a stop or a sweep had put the model away.

        Nothing cancels a load on the one MLX thread, and one can wait there
        behind a long generation. A stop that ran meanwhile freed every byte
        and the load then brought the model back with no grace on it; a sweep
        queued its drop behind the load, and the drop landed after the lamp
        had been marked ready. Either way the answer is the one the stop gave:
        off, and the model with it.
        """
        (self.voice.unload_stt if model == "stt" else self.voice.unload_tts)()
        self.status[model] = "off"
        return False

    # ---------- what a page says it wants ----------

    def want(self, model: str, wanted: bool) -> str:
        """A page says it is using one of the two small models, or has stopped.

        The policy is here and the page only says what it is doing, which is
        the one arrangement where two pages cannot fight over several
        gigabytes: the microphone is on, the sound is off, and what that costs
        is the machine's to decide.

        Wanted, it is loaded — on a thread, because the press that asked for it
        has to answer in a fraction of the fifteen seconds a model takes, and
        the lamp on `GET /machine` is what says when it is up. Not wanted, the
        grace begins: nothing is unloaded on the press, because a microphone
        goes off between two sentences and a mute switch is flicked to answer a
        phone.

        Two pages share one of these, and neither is asked to keep count. A
        page that says it is done arms the grace over the other's microphone —
        and the other's next utterance goes through /machine/stt, which is an
        ask, which cancels it. So the model survives anybody actually using it,
        and goes when nobody is.
        """
        self.touch()
        self._watching()
        if model not in self._grace:
            raise ValueError(f"no such model: {model!r}")
        if not wanted:
            # Only something that is there can be put away, and a load already
            # under way is left to finish: it is a second away from being ready
            # and the grace it is put on will outlive it either way.
            self._grace[model] = (self._now() + GRACE_S
                                  if self.status[model] in ("ready", "loading")
                                  else None)
            return self.status[model]
        self._grace[model] = None
        if self.status[model] == "ready":
            return "ready"                # already up, and nothing to pay
        if self.status[model] != "loading":
            # Said here rather than inside the load, so that the answer to this
            # call is already "loading" and a page that polls immediately is
            # told the truth about what it started.
            self.status[model] = "loading"
            load = self.load_stt if model == "stt" else self.load_tts
            threading.Thread(target=load, daemon=True,
                             name=f"machine-load-{model}").start()
        return "loading"

    def grace(self) -> dict:
        """How long each of the two has left, in seconds, or None for staying.

        On every `GET /machine`, so that a console can see a countdown and a
        page can tell "it is going" from "it has gone".
        """
        now = self._now()
        return {k: (None if at is None else round(max(0.0, at - now), 1))
                for k, at in self._grace.items()}

    def unload(self, model: str):
        """Put one model away and leave everything else exactly as it is.

        The language model is untouched by this, and so is the other of the
        two: somebody typing with the sound on holds a voice and no recognizer,
        and reclaiming the recognizer must not cost them the voice.
        """
        self._grace[model] = None
        self._load_gen[model] += 1       # a load still under way is not wanted
        if self._voice is not None:
            (self._voice.unload_stt if model == "stt"
             else self._voice.unload_tts)()
        self.status[model] = "off"

    def sweep(self):
        """Put away whatever nobody has wanted since the grace was armed.

        Called by the watchdog, and by a test that has moved the clock.
        """
        for model, at in list(self._grace.items()):
            if at is None or self._now() < at:
                continue
            LOG.say(f"nothing has wanted the {'recognizer' if model == 'stt' else 'voice'}"
                    f" for {int(GRACE_S)} seconds — putting it away",
                    source="machine")
            self.unload(model)

    def start(self) -> dict:
        """Everything up: the model server, the recognizer, the voice."""
        self.start_llm()
        self.load_stt()
        self.load_tts()
        return dict(self.status)

    def stop(self):
        """Free every byte: models unloaded, child processes killed.

        Not serialized against a start, and deliberately: a start holds its
        lock for as long as the model takes to come up, and a stop that waited
        that out would be a stop that does nothing for ten minutes. It says so
        instead -- the generation each of the three loads carries -- and a
        start that finishes after this one ran puts its own model away rather
        than lighting a lamp over it.
        """
        for model in self._load_gen:
            self._load_gen[model] += 1
        if self._voice is not None:
            self._voice.unload()
        self.status["stt"] = self.status["tts"] = "off"
        # Nothing is owed a grace once it is gone.
        self._grace["stt"] = self._grace["tts"] = None
        if self._llm is not None:
            self._llm.stop()
        self.status["llm"] = "off"

    def warm(self, kind: str = "", messages=None, system=None,
             voice: str = "") -> list[str]:
        """Pay the first call's cost while nobody is waiting on it.

        Three kinds, and only one of them means anything to the machine on its
        own. `voice` is Voice.warm: the kernels, the buffers and the speaker
        conditioning, which are fixed and have nothing to do with the words —
        so it is warmed against the clip that is about to speak, named the way
        `/machine/tts` names one. With no name there is nothing to condition
        on, and the warm is skipped rather than guessed at.
        `prompt` and `scene` are the same call with different text — the
        caller's two prompts — so they arrive with their own messages and
        their own system, and the machine has no opinion about which is which.
        """
        did = []
        for want in ([kind] if kind else ["prompt", "voice"]):
            try:
                if want == "voice":
                    ref = V.clip(voice)
                    if ref and self.load_tts():
                        self.voice.set_reference(ref)
                        if self.voice.warm():
                            did.append("voice")
                elif messages or system:
                    if self.llm.warm(list(messages or []), system=system):
                        did.append(want)
            except Exception as e:
                LOG.say(f"warming {want} failed: {type(e).__name__}: {e}",
                        source="machine", level="debug")
        self.touch()
        return did

    # ---------- when it goes ----------

    def trouble(self, e: Exception):
        """The model did not answer. Say which kind, and put it back.

        Two very different things arrive here as one traceback: a request the
        model refused, which is a bug in what was asked of it, and a child
        process that is simply gone — killed, crashed, or shut down by
        something else on the machine — after which every call fails with a
        page of urllib text that tells somebody looking at a game nothing.
        """
        # A third: a model that took the request and stopped answering it.
        # It is still up -- its port answers -- so it reads as a refusal, and
        # was logged as one and left frozen; a retry then queued behind it
        # for good. Frozen is not refusing: it is put down and started again.
        if isinstance(e, M.Stalled):
            LOG.say(f"the language model stopped answering ({e}) — starting it again",
                    source="machine", level="warn")
            self.revive()
            return
        if self._llm is not None and self._llm.ready():
            LOG.say(f"the language model refused that — {type(e).__name__}: {e}",
                    source="machine", level="error")
            return
        LOG.say("the language model has gone — putting it back",
                source="machine", level="error")
        self.mend()

    def mend(self):
        """Put back whatever has gone, without stopping what has not."""
        if self._mending or self.llm.ready():
            return
        self._mending = True

        def work():
            try:
                self.start_llm()
            finally:
                self._mending = False

        threading.Thread(target=work, daemon=True, name="machine-mend").start()

    def revive(self):
        """Kill the model server and start it again: one that stalled.

        Not `mend`, which puts back what has gone and leaves alone what is
        up -- and a frozen server is up, by every test it has. Done on a
        thread, holding the start lock from the kill to the model being up,
        so the next line (the chat route goes through start_llm) waits for
        the fresh one. A model on the port that this did not start is
        somebody's own: it is said, and left (see LLMServer.stop).
        """
        if self._mending:
            return
        self._mending = True
        # Said before the thread runs, and never "off" on the way: a page asks
        # whether the model is up again the moment it hears of the stall, and
        # "ready" from the frozen one, or "off" between the kill and the
        # start, would answer it wrongly.
        self.status["llm"] = "starting"

        def work():
            try:
                with self._starting:
                    self.llm.stop()
                    self.start_llm()
            except Exception as e:
                LOG.say(f"the language model would not start again: {type(e).__name__}: {e}",
                        source="machine", level="error")
            finally:
                self._mending = False

        threading.Thread(target=work, daemon=True, name="machine-revive").start()

    def _idle_watch(self):
        """Put the models away when nothing has asked for them in a long time.

        Not a timer that ends anything: nothing anybody has written down is
        touched, and the next call brings the stack back up on its own. All this reclaims is the several gigabytes that
        were sitting there in case somebody came back within the minute.
        """
        while True:
            time.sleep(WATCH_S)
            # The grace first, and whatever the clock below decides: a model
            # nobody wants goes ninety seconds after it was let go of, whether
            # or not somebody else is in the middle of a conversation.
            self.sweep()
            self.idle()

    def idle(self) -> bool:
        """Put the whole machine away if it has been quiet past idle_minutes().

        Called by the watchdog, and by a test that has moved `active_at`. Says
        whether it put anything away.
        """
        if self.status == {"llm": "off", "stt": "off", "tts": "off"}:
            return False
        minutes = idle_minutes()
        if minutes <= 0:
            return False
        if self.busy():
            self.touch()
            return False
        quiet = time.time() - self.active_at
        if quiet < minutes * 60:
            return False
        LOG.say(f"quiet for {int(quiet // 60)} minutes — putting the machine "
                f"away; the next thing said brings it back", source="machine")
        self.stop()
        return True

    # ---------- the meter ----------

    def memory(self) -> dict:
        """What this app is costing, in full.

        The LLM runs as a child process; everything else — Parakeet,
        Chatterbox, audio buffers, Python itself — lives in this one, so
        reporting only the child plus MLX's allocator left several gigabytes
        uncounted and the figure never matched Activity Monitor.

        Measuring it costs a handful of subprocesses — lsof, ps, footprint —
        and a page asks five times a second, on the event loop, where
        everything else is waiting: streamed audio included. So the measuring
        happens on a thread of its own and this hands back the last figure it
        came home with, which is at most a few seconds old and is a number on
        a dial.

        And only while somebody is looking at the dial. The pump runs for the
        life of the server whether or not any page is open, so this used to
        shell out three times every three seconds forever — all night, on a
        laptop with nothing on screen, for a figure nobody was reading. A
        console attached is what "somebody is looking" means: every page dials
        the log socket as it loads, so a watcher is a page. With none, the
        number is still kept warm, at a rate that costs nothing.
        """
        now = time.monotonic()
        due = WATCHED_SECS if LOG.watchers else QUIET_SECS
        if now - self._mem_at > due and not self._mem_busy:
            self._mem_busy = True
            self._mem_at = now          # before, so a slow measure is not retried
            threading.Thread(target=self._measure, daemon=True,
                             name="machine-memory").start()
        return self._mem_seen

    def _measure(self):
        try:
            llm = self.llm.memory_mb()
            app = M.process_mb(os.getpid())
            # The attribute, not the property: measuring must not build the
            # voice, whose thread takes the GPU the moment it exists.
            voice = self._voice
            vox = (voice.memory_mb()
                   if voice is not None and (voice.stt or voice.tts) else 0.0)
            self._mem_seen = {"llm_gb": round(llm / 1024, 2),
                              "app_gb": round(app / 1024, 2),
                              "voice_gb": round(vox / 1024, 2),
                              "total_gb": round((llm + app) / 1024, 2)}
        except Exception as e:
            LOG.say(f"could not measure memory: {type(e).__name__}: {e}",
                    source="machine", level="debug")
        finally:
            self._mem_at = time.monotonic()
            self._mem_busy = False

    # ---------- what the tick carries ----------

    def facts(self) -> dict:
        mem = self.memory()
        cfg = C.load()
        # The attributes, not the properties. A page polls this for as long as
        # it is open, including one with the microphone off that will never
        # ask to be spoken to -- and building the voice starts the MLX thread,
        # which takes the GPU the moment it exists. What has not been built is
        # answered for out of the config, which is where it would come from.
        # See _measure, which learned this first.
        voice, llm = self._voice, self._llm
        mine = cfg.get("llm") or {}
        size = self.size()
        return {
            "status": dict(self.status),
            # And how long the two smaller ones have left, for a page that told
            # the machine it was done with one and a console watching it go.
            # None is "staying"; a number is seconds. See want().
            "grace": self.grace(),
            # How the page is to hear by. The listening is the page's -- it
            # holds the microphone and the speaker, and the two thresholds are
            # arithmetic on what they carry -- but the numbers are written down
            # here, where the console can reach them and where they outlive a
            # reload. Read once, when a page starts listening.
            "vad": dict(cfg.get("vad") or {}),
            # And the microphone's two standing orders, which are the machine's
            # for the same reason: whether talking over a reply stops it, and
            # what the mic does when the window goes away. They used to reach
            # the page on the tick; a page running its own loop reads them
            # here, where /mic_barge and /mic_follow write them.
            "mic_barge": cfg.get("mic_barge", "auto"),
            "mic_follow": cfg.get("mic_follows_window", "hidden"),
            "memory_mb": round(mem["total_gb"] * 1024),
            "memory": mem,
            "tts": dict(getattr(voice, "stats", {}) or {}),
            "llm": {"port": M.LLM_PORT,
                    "server": (getattr(llm, "server", "") if llm is not None
                               else mine.get("server", "")),
                    "model": (str(getattr(llm, "model_path", "")) if llm is not None
                              else mine.get("model", "")),
                    # Which size is in use, and which are on this Mac, for a
                    # console or a page that offers the choice.
                    "size": size,
                    "sizes": {k: v["here"] for k, v in self.sizes().items()},
                    # Whether the size in use is one models.json flags as
                    # answering as the model rather than as the character:
                    # the game guards its replies against it. See
                    # shelf.censored.
                    "censored": S.censored(size),
                    # And what the first-open card needs: whether the model
                    # the config names is on disk, the sizes it could fetch
                    # instead with the one for this Mac's memory marked, and
                    # how a fetch it asked for is going. See fetch().
                    "here": self.here(),
                    "offer": self.offer(),
                    "ram_gb": round(S.ram_gb()),
                    "fetch": self.fetching()},
            # The voice and the ear, for the same card: what each weighs,
            # whether it is here, and how a fetch of them is going.
            "shelf": self.parts(),
        }


_stack: Stack | None = None


def stack() -> Stack:
    """The machine. One per process, made the first time anybody asks."""
    global _stack
    if _stack is None:
        _stack = Stack()
    return _stack


def set_stack(replacement: Stack | None) -> Stack | None:
    """Put another stack in its place, and hand back the one that was there.

    For tests, which must never load a model, and for nothing else: a second
    real stack on this Mac is the several gigabytes this whole file exists to
    keep to one copy.
    """
    global _stack
    was, _stack = _stack, replacement
    return was


# ---- the top of every console ----------------------------------------------


def health():
    """The three lamps and what they are costing, for every console there is.

    Reserved to "machine", which is the row every console shows on every page
    including the front one: the language model, the recognizer and the voice
    are shared, expensive and breakable, and are the reason somebody opens the
    console at all. Anything about a conversation is the page's own and is on
    the page.

    log.state drops anything that has not actually changed, so this is a
    comparison rather than a broadcast.
    """
    here = stack()
    lamp = {"ready": "on", "loading": "busy", "starting": "busy", "error": "bad"}
    LOG.state("machine", name="Lucid Dream",
              parts=[{"name": k.upper(), "state": lamp.get(here.status.get(k), "off"),
                      "title": f"{k}: {here.status.get(k, 'stopped')}"}
                     for k in ("llm", "stt", "tts")],
              facts=[f"{here.memory()['total_gb']:.1f} GB"])


# Five times a second, which is what it was when a game's own pump carried it.
# Nothing on this row moves that fast -- a lamp changes when a model loads, and
# the meter is measured on a thread and already seconds old -- but the cost is
# a dict comparison, and the one thing that *is* worth catching quickly is a
# model coming up while somebody is watching it.
EVERY = 0.2


async def pump():
    """Say how the machine is doing, for as long as the server is up.

    The server's lifespan starts this. It used to be a line inside the game's
    own event pump, which meant the lamps were a thing one game happened to
    report about a machine every game shares -- and with no game mounted there
    was nothing lighting them at all.

    Unkillable by anything short of cancellation: this ending is every console
    in the house going quietly stale, with the only sign a line in a terminal
    nobody has open.
    """
    while True:
        try:
            health()
        except asyncio.CancelledError:
            raise                        # the server is going down; let it
        except Exception as e:
            LOG.say(f"the machine's own pump stumbled — {type(e).__name__}: {e}",
                    source="machine", level="error")
            await asyncio.sleep(1.0)     # whatever it was, do not spin on it
        await asyncio.sleep(EVERY)


# ---- what the console can ask of it -----------------------------------------
#
# The models and the microphone, and nothing else. These are tagged "machine"
# rather than to any game, so they are offered on every page: the one control
# somebody needs when nothing works must not be inside the thing that is not
# working.


@LOG.command("ai_models_start", "load the language, speech and voice models",
             app="machine")
def _start_models(_):
    here = stack()
    missing = [k for k, v in here.status.items() if v != "ready"]
    if not missing:
        # Ready is what this process believes, not what is true. A child
        # process can be gone -- killed, crashed, or taken down by something
        # else on the machine -- and this would go on saying it is up while
        # every turn failed. Asking the model itself is the difference.
        if here.llm.ready():
            return "already running"
        LOG.say("the language model has gone — putting it back",
                source="machine", level="warn")
    threading.Thread(target=here.start, daemon=True, name="machine-start").start()
    return "starting the models…"


@LOG.command("ai_models_stop", "unload everything and give the memory back",
             app="machine")
def _stop_models(_):
    here = stack()
    if not here.made or here.status == {"llm": "off", "stt": "off", "tts": "off"}:
        return "nothing is running"
    threading.Thread(target=here.stop, daemon=True, name="machine-stop").start()
    return "stopping…"


@LOG.command("ai_model_size", "which size of language model to run",
             app="machine", args="sm|md|lg")
def _model_size(rest: str) -> str:
    """The same evening on a smaller or a bigger model, to see the difference.

    Said with no size, it says which is up and which are on this Mac. Said
    with one, the choice is written down, the server is stopped and started
    on the new path, and the page's next reply comes from it -- the language
    model only; the recognizer and the voice stay as they are.
    """
    here = stack()
    sizes = here.sizes()
    want = (rest or "").strip()
    if not want:
        up = here.size() or "one the sizes do not name"
        have = ", ".join(k for k, v in sizes.items() if v["here"]) or "none"
        # The size the process is serving, and, when the config has been
        # edited under it, the one it would serve after a restart.
        told = str((C.load().get("llm") or {}).get("size") or "")
        drift = (f" — the config says {told}, which takes a restart"
                 if told and told != up and not (C.written().get("llm") or {}).get("model")
                 else "")
        return f"running {up}; on this Mac: {have}{drift}"
    if want not in sizes:
        return f"no size called {want!r} — " + ", ".join(sizes)
    if not sizes[want]["here"]:
        return f"the {want} model is not here (nothing at {sizes[want]['path']})"
    threading.Thread(target=here.resize, args=(want,), daemon=True,
                     name="machine-resize").start()
    return f"switching to {want}…"


@LOG.command("mic_barge", "whether talking over a reply stops it",
             app="machine", args="on|off|auto")
def _barge(rest: str) -> str:
    """By hand, for a browser that says one thing and does another.

    Barge-in turns itself off where the microphone reports no echo cancellation
    -- see micStatus in capture.ts -- because without it the voice is the
    loudest thing in the room, hears itself, and stops mid-sentence believing
    it was interrupted. Not every browser is honest about what it granted, and
    the ones that are not leave a voice that cuts itself off every second
    sentence with nothing in the console to explain why.

    Written down rather than only applied. The listening is the page's, and a
    page re-reads its microphone every time it is opened -- so an order that
    lived in this process would be undone twenty seconds after it was given, by
    a page reporting the truth. In the config it outranks the report, survives
    a reload, and reaches every page on its next read of /machine.

    In the machine's config, because the microphone belongs to the shelf.
    """
    want = (rest or "").strip().lower()
    if want in ("on", "off", "auto"):
        C.note(mic_barge=want)
    elif want:
        return "mic_barge on|off|auto"
    how = C.load().get("mic_barge", "auto")
    return {
        "on": "talking over a reply stops it, whatever the browser says about "
              "echo cancellation",
        "off": "talking over a reply does not stop it — use the page's own "
               "controls instead",
        "auto": "talking over a reply stops it wherever the browser cancels its "
                "own echo, and nowhere else",
    }[how]


@LOG.command("mic_follow", "what the mic does when you leave the window",
             app="machine", args="focus|hidden|never")
def _follow(rest: str) -> str:
    """Live, because this is a setting you find out about by tripping it.

    The symptom that sends anybody looking for it is the mic closing under
    their hand, which is not a moment for restarting anything. The page reads
    this every few seconds while it holds the microphone, so a change lands
    where it can be felt.
    """
    want = (rest or "").strip().lower()
    if want in ("focus", "hidden", "never"):
        C.note(mic_follows_window=want)
    elif want:
        return "mic_follow focus|hidden|never"
    how = C.load().get("mic_follows_window", "hidden")
    return {
        "focus": "the mic closes whenever the window is not in front — "
                 "including while you read the menu bar's own mic menu",
        "hidden": "the mic closes only when the page is really hidden — "
                  "another tab, another app, a locked phone",
        "never": "only the page closes the mic",
    }[how]


# ---- turning samples into something a socket can carry ----------------------


def to_pcm(samples: np.ndarray) -> str:
    """Float32 in [-1, 1] as base64 int16, which is what a page can play."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    return base64.b64encode(pcm).decode("ascii")


def from_pcm(raw: bytes, rate: int) -> np.ndarray:
    """Int16 little-endian mono at whatever rate, as float32 at 16k.

    Linear interpolation, the same as the microphone path takes for a page
    that captures at 48k — the recognizer is trained at 16k and a page has no
    business knowing that.
    """
    if len(raw) % 2:
        raw = raw[:-1]                   # half a sample is not a sample
    block = (np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0)
    if rate != STT_RATE and block.size:
        n = int(block.size * STT_RATE / rate)
        block = np.interp(np.linspace(0, block.size - 1, n),
                          np.arange(block.size), block).astype(np.float32)
    return block


def _split_system(messages: list[dict]) -> tuple[str, list[dict]]:
    """Take the caller's system message off the front, if it sent one.

    stream_reply puts one there itself, and its fallback is a game's own
    system prompt — which is exactly what this surface must not add on
    anybody's behalf. So a system message here is the caller's, and no system
    message means no system message.
    """
    msgs = [m for m in (messages or []) if isinstance(m, dict)]
    if msgs and msgs[0].get("role") == "system":
        return str(msgs[0].get("content") or ""), msgs[1:]
    return "", msgs


# One reply at a time. The model server is threaded and would take two, and
# what it does with two is generate both at once on one model with one prompt
# cache -- which is how a narrator's line stalled at three words while a
# stone and a word were asked for beside it. The docstring on `routes` has
# always promised that two callers queue; this is the queue.
_words = threading.Lock()


def chat_frames(body: dict, stop: threading.Event | None = None):
    """The SSE body of one chat call, as an async generator.

    The frames are the ones mlx_lm sends — `choices[0].delta.content`, then
    `[DONE]` — because that is what every client of a chat endpoint already
    knows how to read, and because a hosted provider will send the same.

    Generation runs on a thread and the deltas come back over the loop. The
    stop flag is set when this generator is closed, which is what a page
    closing its tab mid-reply looks like from in here: the model stops writing
    a reply nobody will hear.
    """
    stop = stop if stop is not None else threading.Event()
    system, messages = _split_system(body.get("messages"))
    here = stack()

    async def frames():
        loop = asyncio.get_running_loop()
        out: asyncio.Queue = asyncio.Queue()

        def work():
            def delta(text):
                loop.call_soon_threadsafe(out.put_nowait, ("delta", text))
            try:
                # A page that closed while this waited its turn is not
                # answered: the flag is set by then, and the model is not
                # asked to write a reply nobody will hear.
                with _words:
                    if not stop.is_set():
                        here.llm.stream_reply(
                            messages, delta, stop, system=system,
                            temperature=body.get("temperature"),
                            top_p=body.get("top_p"),
                            max_tokens=body.get("max_tokens"))
            except Exception as e:
                here.trouble(e)
                loop.call_soon_threadsafe(out.put_nowait, ("error", e))
            finally:
                loop.call_soon_threadsafe(out.put_nowait, ("end", None))

        threading.Thread(target=work, daemon=True, name="machine-chat").start()
        try:
            while True:
                kind, payload = await out.get()
                if kind == "delta":
                    yield ("data: " + json.dumps(
                        {"choices": [{"delta": {"content": payload}}]}) + "\n\n")
                elif kind == "error":
                    # A model that stopped answering says so, for the page to
                    # say quietly while it is woken (stall.ts there): not a
                    # refusal, and the next line gets a fresh model.
                    stalled = isinstance(payload, M.Stalled)
                    said = (f"the language model stopped answering ({payload}) — "
                            f"it is started again for the next line" if stalled
                            else f"{type(payload).__name__}: {payload}")
                    yield ("data: " + json.dumps(
                        {"error": said, **({"not_answering": True} if stalled else {})})
                        + "\n\n")
                else:
                    break
            yield "data: [DONE]\n\n"
        finally:
            # Closed early: the page has gone, or somebody pressed stop. The
            # flag is read inside stream_reply's own loop.
            stop.set()
            here.touch()

    return frames()


def routes(app):
    """Hang the machine's surface on an app. Called by the server, once.

    Everything here can be waiting on somebody else's turn — one MLX thread
    for the voice and the recognizer, one model server for the words — so two
    callers queue and neither breaks. Two locks in the file: one on starting
    the model, so two pages arriving at a cold machine wait on one start
    rather than each spawning a twenty-gigabyte child; and `_words`, one
    reply at a time on the model server. Nothing is ever refused for being
    second.
    """

    @app.post("/machine/chat")
    async def chat(req: Request):
        """One turn, streamed. The body is an OpenAI chat body.

        A cold machine is started rather than refused: the caller asked for
        words, and "not loaded" is not an answer they can do anything with.
        Only a start that will not come back is a 503.
        """
        body = await asked(req)
        if not isinstance(body, dict):
            return body
        here = stack()
        here.touch()
        # Through start_llm even when it is plainly up: that is where the lamp
        # is lit, and a model somebody else started -- the one already on the
        # port, adopted rather than replaced -- would otherwise answer every
        # turn with the console still saying nothing is loaded.
        if not await asyncio.to_thread(here.start_llm):
            return JSONResponse(
                {"error": "the language model is not answering and would not "
                          "start — see the console"}, status_code=503)
        return StreamingResponse(chat_frames(body),
                                 media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache",
                                          "X-Accel-Buffering": "no"})

    @app.post("/machine/stt")
    async def transcribe(req: Request, rate: int = STT_RATE):
        """A whole utterance in, its words out.

        Raw int16 little-endian mono, because a page has that already and
        base64 in a JSON body would be a third more bytes for nothing. The
        text is the model's own: no junk filter here, because what counts as
        nothing worth answering is the caller's question and not the
        machine's.
        """
        here = stack()
        here.touch()
        # A rate is a number of samples a second, and the arithmetic below
        # takes it on faith: a zero or a negative one came back out of
        # np.linspace as a 500 with a traceback in it, which reads as "the
        # machine is broken" for what is a bad address.
        rate = int(rate or STT_RATE)
        if not 1000 <= rate <= 384000:
            return JSONResponse(
                {"error": "a sample rate is between 1000 and 384000"},
                status_code=400)
        most = most_audio(rate)
        heard = await raw(req, most)
        if heard is None:
            return too_much(most)
        audio = from_pcm(heard, rate)
        if not audio.size:
            return {"text": ""}
        if not await asyncio.to_thread(here.load_stt):
            return JSONResponse({"error": "the recognizer would not load"},
                                status_code=503)
        try:
            text = await asyncio.to_thread(here.voice.transcribe, audio)
        except Exception as e:
            LOG.say(f"transcribing {audio.size / STT_RATE:.1f}s failed: "
                    f"{type(e).__name__}: {e}", source="machine", level="warn")
            return JSONResponse({"error": f"{type(e).__name__}: {e}"},
                                status_code=500)
        return {"text": text}

    @app.websocket("/machine/tts")
    async def speak(ws: WebSocket):
        """Chunks of text in, audio out, until the socket closes.

        A socket rather than a request per sentence: a reply is a run of
        sentences and the voice is quicker if it is already there, and the
        page needs the frames as they are made rather than when the last one
        is done.

        One message per chunk — `{text, voice, ends_paragraph, id}` — and one or
        more `{pcm, rate, chars}` frames back, then `{done, stats}`. `voice` is
        a name on the machine's shelf and is required: a chunk that names
        nobody, or names a clip that is not there, comes back as `{error}` and
        is not spoken. See machine/voices.py. `chars`
        is what that chunk covered *as written*, on the first frame only, so a
        page can pace its text against the voice: speak() strips bracketed
        tags and asterisks before synthesis, so counting what it produced
        would count markup nobody hears. The +1 is the whitespace the chunk
        was split on.

        ---- `id`, and why a stop needs one ---------------------------------

        A stop is heard while a chunk is being made, and the chunk finishes
        anyway: MLX is on the one thread and abandoning a clip half-made costs
        more than dropping it. So its `{done}` arrives *late* — a second or
        more after the page moved on — and by then the page has usually sent
        the first sentence of the next reply. Without a name on it, that late
        `done` is indistinguishable from the new chunk's, and the page ends the
        new one on it: the first sentence after any interrupt was made, sent,
        and dropped on the floor.

        So whatever the page puts in `id` comes back on every frame, on the
        `done` and on any `error`, and the page routes by it. Nothing here
        reads it; it is the page's own name for a chunk. A chunk sent without
        one is answered without one, which is what a probe with a `wscat` gets.

        A stop also reaches the chunks already queued behind it, which is the
        other half of the same fix: they were asked for by a reply that has
        since been cut off, and a stop that only stopped what happened to be in
        hand let the next of them start speaking into the silence somebody had
        just asked for. Each is answered with its `done` and none of it is
        spoken. Anything sent *after* the stop is a new reply and is spoken.
        """
        from .server import from_this_page
        if not from_this_page(ws):
            await ws.close(code=1008)
            return
        await ws.accept()
        here = stack()
        loop = asyncio.get_running_loop()
        inbox: asyncio.Queue = asyncio.Queue()
        stop = threading.Event()
        # How many chunks have arrived, and how far back the last stop reached.
        # Both are only ever touched on this loop, so reading one and acting on
        # it needs no lock -- only no await in between.
        taken = 0
        abandoned = 0

        async def listening():
            """Read ahead, so a stop arrives while a chunk is being made."""
            nonlocal taken, abandoned
            try:
                while True:
                    msg = await ws.receive_json()
                    if msg.get("stop"):
                        stop.set()
                        abandoned = taken     # and everything already queued
                    else:
                        taken += 1
                        await inbox.put((taken, msg))
            except Exception:
                await inbox.put((0, None))

        def stamped(cid, payload: dict) -> dict:
            """A frame with the page's name for its chunk on it, if it gave one."""
            return payload if cid is None else {"id": cid, **payload}

        reader = asyncio.create_task(listening())
        try:
            while True:
                seq, msg = await inbox.get()
                if msg is None:
                    break
                cid = msg.get("id")
                text = str(msg.get("text") or "")
                # Answered rather than dropped in silence, either way: a page
                # waiting on frames that are never coming is a room that has
                # gone quiet with nothing to say why.
                if seq <= abandoned or not text.strip():
                    await ws.send_json(
                        stamped(cid, {"done": True, "stats": here.voice.stats}))
                    continue
                # From here this chunk is the one a stop would be about. Cleared
                # before the voice is loaded rather than after, so a stop that
                # lands during the load is still heard.
                stop.clear()
                here.touch()
                # The name before the model, because this is the cheap half of
                # the two and the one that can be wrong: a chunk that names a
                # voice nobody has put on the shelf is refused rather than said
                # in whatever was loaded last, which is a character that
                # sounds like the previous person's.
                want = str(msg.get("voice") or "")
                ref = V.clip(want)
                if not ref:
                    # Named as a refusal rather than a failure: the words
                    # arrived and the shelf has no such clip, which is a
                    # tunables.json to fix and not a machine that is down.
                    await ws.send_json(stamped(cid, {
                        "error": f"no voice named {want!r} — "
                                 f"the shelf has {V.names()}",
                        "refused": "voice"}))
                    continue
                if not await asyncio.to_thread(here.load_tts):
                    await ws.send_json(
                        stamped(cid, {"error": "the voice would not load"}))
                    continue
                # The clip goes with the chunk rather than being set on the
                # model first. Two rooms in two tabs share this one model and
                # take turns on its thread; a clip set here and read there
                # was the other room's by the time the thread got to it.
                # The paragraph marker, the way the splitter writes it: speak()
                # reads a trailing newline as "a thought ended here" and puts a
                # beat after it.
                chunk = text + "\n" if msg.get("ends_paragraph") else text
                first = True
                async for kind, payload in _spoken(loop, here, chunk, ref):
                    if kind == "error":
                        await ws.send_json(stamped(cid, {
                            "error": f"{type(payload).__name__}: {payload}"}))
                        break
                    if stop.is_set():
                        break            # the rest of this chunk is not wanted
                    samples, rate = payload
                    await ws.send_json(stamped(cid, {
                        "pcm": to_pcm(samples), "rate": int(rate),
                        "chars": len(text) + 1 if first else 0}))
                    first = False
                await ws.send_json(
                    stamped(cid, {"done": True, "stats": here.voice.stats}))
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception as e:
            LOG.say(f"the voice socket stumbled — {type(e).__name__}: {e}",
                    source="machine", level="error")
        finally:
            stop.set()
            reader.cancel()

    @app.get("/machine/assets/{kind}")
    def assets(kind: str):
        """What is on one shelf, by name: the sounds, the figures.

        A game asks once and then asks for each by name below; a name that
        is not here is silence on the page, or the plain figure, which is
        what a machine with no shelf is like. See machine/assets.py.
        """
        if kind not in A.KINDS:
            raise HTTPException(404, f"no such kind of asset: {kind!r}")
        return {"assets": A.names(kind)}

    @app.get("/machine/assets/{kind}/{name:path}")
    def asset(kind: str, name: str):
        """One asset, as the file it is. Cached the way everything served
        here is -- kept, and asked about -- so a replaced shelf is seen on
        the next load."""
        path = A.asset(kind, name)
        if path is None:
            raise HTTPException(404, f"no {kind} named {name!r}")
        return FileResponse(path, media_type=A.media_type(kind))

    @app.get("/machine/voices")
    def voices():
        """The names on the shelf.

        For a console that has to say why nothing was spoken, and for anything
        that wants to know what this machine can sound like before it asks it
        to. A name here is the whole of what `/machine/tts` and a warm take:
        see machine/voices.py.

        And the delivery tags the voice performs -- "[laugh]", "[sigh]" --
        read off the model's own tokenizer whether or not it is loaded yet, so
        a page can ask for them only from a voice that makes them. Empty for
        any voice but Turbo, which strips every one. See models.voice_tags.
        """
        return {"voices": V.names(), "tags": sorted(M.voice_tags())}

    @app.get("/machine")
    def machine():
        """What is loaded, what it costs, and what the voice last managed."""
        return stack().facts()

    async def wanted(model: str, req: Request):
        """A page saying it is using one of the two small models, or is not.

        `{"wanted": true}` starts the load and comes straight back with
        `loading` or `ready`; the lamp on `GET /machine` is what says when it
        is up, because a model is fifteen seconds and the press that asked for
        it has to answer in one. `{"wanted": false}` arms the grace, and
        `GET /machine` counts it down. See Stack.want, where the policy is.
        """
        body = await asked(req)
        if not isinstance(body, dict):
            return body
        if not isinstance(body.get("wanted"), bool):
            # Refused rather than guessed at. Guessing false would put a model
            # away on a malformed request, and guessing true would load one --
            # and so does reading anything at all as a yes or a no. `bool` of
            # the JSON string "false" is true, which is a page with a bug in it
            # loading twenty gigabytes to say the opposite of what it meant.
            return JSONResponse(
                {"error": 'say which way: {"wanted": true} or {"wanted": false}'},
                status_code=400)
        here = stack()
        status = here.want(model, body["wanted"])
        return {"status": status, "grace": here.grace()[model]}

    @app.post("/machine/models/stt")
    async def models_stt(req: Request):
        return await wanted("stt", req)

    @app.post("/machine/models/tts")
    async def models_tts(req: Request):
        return await wanted("tts", req)

    @app.post("/machine/models/llm")
    async def model_size(req: Request):
        """Which size of the language model to run: `{"size": "md"}`.

        The choice is written down and the server started again on it, on a
        thread, because the load takes what a load takes; the dial says when
        it is up. See Stack.resize.
        """
        body = await asked(req)
        if not isinstance(body, dict):
            return body
        want = body.get("size")
        here = stack()
        sizes = here.sizes()
        if not isinstance(want, str) or want not in sizes:
            return JSONResponse({"error": "a size is one of " + ", ".join(sizes)},
                                status_code=400)
        if not sizes[want]["here"]:
            return JSONResponse({"error": f"the {want} model is not here"},
                                status_code=409)
        threading.Thread(target=here.resize, args=(want,), daemon=True,
                         name="machine-resize").start()
        return {"status": "loading", "size": want}

    @app.post("/machine/models/fetch")
    async def model_fetch(req: Request):
        """Bring a size of the language model onto this Mac, then run it:
        `{"size": "sm"}`. The first-open card in a room asks this when the
        model the config names is not on disk. Answered at once with where it
        stands; `GET /machine` carries `llm.fetch` while it runs, and the lamp
        says when the model is up. See Stack.fetch.
        """
        body = await asked(req)
        if not isinstance(body, dict):
            return body
        want = body.get("size")
        # And the voice and the ear beside it, each true to bring it down
        # (the card's rows; `voice` may name the row, "tts"). Either may come
        # without a size, for a machine that has its model and not them.
        roles = [role for kind, (role, _) in Stack.PARTS.items()
                 if body.get(kind) in (True, role)]
        if want is None and roles:
            return stack().fetch_parts(roles)
        if not isinstance(want, str) or want not in S.sizes():
            return JSONResponse({"error": "a size is one of " + ", ".join(S.sizes())},
                                status_code=400)
        if roles:
            stack().fetch_parts(roles)
        return stack().fetch(want)

    @app.post("/machine/models/start")
    async def models_start():
        """The language model, and only it.

        It used to bring up all three, which meant that opening a conversation
        paid for a recognizer somebody may never turn a microphone on for, and
        a voice somebody with the sound off will never hear. Those two are
        asked for by the page that wants them — the two routes above — and the
        console's own ai_models_start still loads all three, because somebody
        typing that has said what they mean.
        """
        await asyncio.to_thread(stack().start_llm)
        return dict(stack().status)

    @app.post("/machine/models/stop")
    async def models_stop():
        await asyncio.to_thread(stack().stop)
        return dict(stack().status)

    @app.post("/machine/models/warm")
    async def models_warm(req: Request):
        """Pay a first call's cost early. Warming is a request in its own right:
        `kind: "voice"` loads the voice deliberately, and a grace running
        against it is cancelled by that load — somebody warmed it, so somebody
        wants it."""
        body = {}
        try:
            body = await req.json()
        except Exception:
            pass                          # a warm with no body warms nothing
        did = await asyncio.to_thread(
            stack().warm, str(body.get("kind") or ""), body.get("messages"),
            body.get("system"), str(body.get("voice") or ""))
        return {"warmed": did}

    @app.post("/machine/ping")
    def ping():
        """Somebody is still there. Feeds the idle watchdog and nothing else."""
        stack().touch()
        return {"status": dict(stack().status)}


async def _spoken(loop, here: Stack, chunk: str, ref=None):
    """Voice.speak, as an async iterator.

    speak() blocks on the one MLX thread and yields chunks as they come, so it
    is drained on a thread of its own and the frames are handed over the loop.
    Abandoning this iterator does not abandon the job: MLX finishes the chunk
    it is on and the samples are dropped here, which is a fraction of a second
    and much cheaper than a half-cancelled generation.
    """
    out: asyncio.Queue = asyncio.Queue()

    def work():
        try:
            for pair in here.voice.speak(chunk, ref):
                loop.call_soon_threadsafe(out.put_nowait, ("frame", pair))
        except Exception as e:
            loop.call_soon_threadsafe(out.put_nowait, ("error", e))
        finally:
            loop.call_soon_threadsafe(out.put_nowait, ("end", None))

    threading.Thread(target=work, daemon=True, name="machine-tts").start()
    while True:
        kind, payload = await out.get()
        if kind == "end":
            return
        yield kind, payload
