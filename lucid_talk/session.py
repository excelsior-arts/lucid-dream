"""The conversation itself: models, microphone, speaker, memory, the turn loop.

Everything here runs on worker threads and talks to the outside world through
one event queue. The server drains it; nothing in this file knows a socket
exists, which is what makes the turn loop testable on its own.
"""

from __future__ import annotations

import base64
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path

import numpy as np

from . import audio as A
from . import config as C
from . import memory as MEM
from . import models as M
from . import paths
from shell import log as LOG
from . import personas as P
from . import prompts
from . import relation as R
from . import scene as SC
from . import store as S


class BrowserSink:
    """Send generated audio to connected pages instead of the Mac's speakers.

    Keeps the same surface as Speaker (play/stop/playing/remaining_s) so the
    turn loop, the continuous pacing and the VAD gating all work unchanged.
    "playing" is estimated from how much audio has been sent and how long ago,
    since the browser does the actual playing and we never hear back.
    """

    def __init__(self, emit, has_listeners):
        self._emit = emit
        # Whether any page is connected. Passed in rather than read off the
        # server module: this class owes it one fact, not an import cycle.
        self._has_listeners = has_listeners
        self._until = 0.0
        self._started_at = 0.0
        self._holding = False
        self._reported_s = 0.0
        self._reported_at = 0.0
        self.device = None
        self.on_state = None

    def hold(self, on: bool):
        """The pill is mid-reply, whether or not a chunk is sounding.

        A reply is a run of sentences with gaps between them: the next one is
        still being generated while the last one finishes, and in that gap the
        page has nothing queued and nothing playing, so it truthfully reports
        zero. The mic reads that as the room going quiet and starts listening —
        and the next sentence arrives into an open microphone.

        With echo cancellation that costs nothing: what it hears is silence, and
        the turn is dropped as too short. Without it, the pill's own next
        sentence is transcribed as something you said, which cuts the reply off
        and then answers it. Barge-in is not involved and turning barge-in off
        does not help, which is most of what makes it hard to place.

        So the gaps are held shut for the length of the reply.
        """
        self._holding = bool(on)

    @property
    def playing(self) -> bool:
        """True while the page still has speech to play.

        This gates the microphone. Deriving it from what we *sent* let the gate
        open while the page was still playing -- the mic then transcribed its
        own voice as a user turn, the pill answered it, and it looked like a
        conversation you never took part in. remaining_s prefers what the page
        reports, so the gate follows what can actually be heard.
        """
        return self._holding or self.remaining_s > 0.05

    @property
    def remaining_s(self) -> float:
        """Seconds of speech still to be heard.

        Prefer what the page reports. The estimate below only adds up the audio
        we sent, but an <audio> element loses a little time to loading and
        decoding on every chunk, so the estimate drifts optimistic and the
        pacing loop runs further and further ahead of what you can hear.
        """
        if self._reported_at and time.monotonic() - self._reported_at < 5.0:
            spent = time.monotonic() - self._reported_at
            return max(0.0, self._reported_s - spent)
        return max(0.0, self._until - time.monotonic())

    def report(self, queued_s: float):
        """The page telling us how much it still has to play."""
        self._reported_s = max(0.0, float(queued_s))
        self._reported_at = time.monotonic()

    @property
    def since_start_ms(self) -> float:
        """How long this stretch of speech has been going.

        Returning 0 meant the VAD's barge grace never elapsed, so talking
        over it could never interrupt while audio played on the phone.
        """
        if not self.playing:
            return 0.0
        return (time.monotonic() - self._started_at) * 1000.0

    def play(self, samples, rate: int):
        if not self._has_listeners():
            # There is no other output now: with no page open, sound is lost.
            self._emit("log", text="nothing is listening — open the page to hear the pill")
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        was = self.playing
        now = time.monotonic()
        if not was:
            self._started_at = now
        self._until = max(self._until, now) + len(samples) / float(rate)
        self._emit("audio", rate=int(rate),
                   pcm=base64.b64encode(pcm).decode("ascii"))
        if not was and self.on_state:
            self.on_state(True)

    def stop(self, soft: bool = False):
        """Silence, or let the sentence land first.

        `soft` is for steering rather than stopping: cutting a voice off
        mid-word to answer somebody reads as a machine glitching, and the half
        second it costs to finish the line is the difference between being
        interrupted and being listened to. The page keeps the chunk it is
        playing and throws away everything queued behind it.
        """
        self._until = 0.0
        # And forget what the page last reported, or remaining_s keeps
        # returning that stale figure for its five-second window: the mic gate
        # stays shut, and the first seconds of the sentence you interrupted
        # it with are dropped on the floor.
        self._reported_s = 0.0
        self._reported_at = time.monotonic()
        # Nothing more is coming, so nothing should keep the gate shut waiting
        # for it. Silence means the microphone is yours again.
        self._holding = False
        self._emit("audio_stop", soft=bool(soft))
        if self.on_state:
            self.on_state(False)

    def set_device(self, device):
        pass

    def close(self):
        self.stop()


class Session:
    """One conversation and the stack behind it: models, mic, speaker, memory.

    Knows nothing about HTTP. Events go out through a queue the server drains,
    and `has_listeners` is the single fact it needs about the outside world --
    whether anyone is there to hear the pill.
    """

    # How long opening a conversation waits for the turn in flight. Silencing
    # ends one in a fraction of a second; this is for the one that does not
    # end, where late and whole still beats never.
    SETTLE_WAIT = 10.0

    def __init__(self, has_listeners=lambda: True):
        self._has_listeners = has_listeners
        self.events: queue.Queue = queue.Queue()
        self.cfg = C.load()
        # A model server that has just started has an empty cache, and a voice
        # that has just been loaded has compiled nothing — so neither is warm,
        # however recently this thought it was.
        self._warmed = None
        self._warmed_voice = None
        M.apply_config(self.cfg)
        A.apply_config(self.cfg)
        # Nobody has asked for anyone yet. Whoever opens a page says who they
        # came for -- the persona is a route, not a setting -- and this stands
        # in until they do.
        self.persona = P.listing()[0]
        self.store = S.Store()
        self.llm = M.LLMServer(self.cfg["llm"]["model"])
        self.voice = M.Voice()
        # No device is chosen here, and none is even looked up: enumerating
        # them is what macOS counts as touching the microphone, and it lights
        # the indicator for the terminal before you have said anything. The
        # page captures through the browser anyway, where the device is the
        # browser's business. Only the fallback to the Mac's own microphone
        # needs a device, and it asks for one when it starts.
        self.device_warning = ""
        self.speaker = BrowserSink(lambda name, **kw: self.emit(name, **kw),
                                   self._has_listeners)
        self.mic = A.Mic()
        self.mic.speaker = self.speaker
        self.mic.on_event = self._mic_event
        self.speaker.on_state = lambda playing: self.emit("audio_out", playing=playing)
        self.history: list[dict] = []
        self.session_id = ""
        self.folded_upto = 0
        self.scene = ""            # where this conversation has got to
        self._scene_at = 0         # how many turns ago that was worked out
        self.state = "stopped"
        self.status = {"llm": "off", "stt": "off", "tts": "off"}
        # When anything last happened between the two of you. The watchdog
        # below reads it; nothing else does.
        self.active_at = time.time()
        self._turbo_note = ""     # the persona we have already said this about
        self.pending_say = ""     # typed at a cold server, answered once it is up
        # Bumped every time the floor is taken. Anything queued behind that
        # moment checks it and gives up rather than starting to talk into a
        # silence you asked for.
        self._speech_gen = 0
        # Which pill, and which conversation -- the return address on
        # everything this session says. Held as one value and replaced as one
        # value, because the two are only ever true together: switching pills
        # sets the persona and then opens that pill's conversation, and
        # anything asking in between would get the new name with the old id.
        self._address = {"sid": "", "pill": self.persona["slug"]}
        # One conversation change at a time. Every page that opens spawns a
        # thread to say what it came for, and somebody clicking through rooms
        # has two of them in the air at once -- one setting the persona while
        # the other is still opening a conversation for the one before it. See
        # open_for.
        self._opening = threading.RLock()
        self._mem_seen = {"llm_gb": 0.0, "app_gb": 0.0, "voice_gb": 0.0, "total_gb": 0.0}
        self._mem_at = 0.0
        self._mem_busy = False
        self.stop_reply = threading.Event()
        # Off until you ask for it. Nothing listens to a room until asked;
        # capture is the browser's, so its echo cancellation handles the rest.
        self.input_mode = "type"
        # Whether somebody has said, in so many words, whether talking over the
        # pill should stop it. Until they do, the page's reading of its own
        # microphone decides; after, it does not get to argue. See set_barge.
        self._barge_chosen = False
        # And the standing answer, whoever gave it. True until told otherwise,
        # because a mic you can talk over is the one worth having.
        self._barge_want = True
        self._apply_input_mode()      # Mic() defaults to enabled; we do not
        self._replying = threading.Lock()
        self._folding = threading.Lock()
        self._gen_secs = 2.5      # rolling cost of producing one turn
        self._app_mem = 0.0
        self._app_mem_at = 0.0
        self._cont_stop = threading.Event()
        self._cont_until = 0.0
        self._cont_span = 0.0
        self._cont_gen = 0
        self._cont_thread = None
        self._cont_from = 0       # history length when keep going was ticked
        self.running = False
        self.mic_live = False
        self._worker: threading.Thread | None = None
        self._boot: threading.Thread | None = None
        self._boot_as = ""    # the pill a start named, if it named one
        self._hands: list[str] = []          # presses waiting for a turn
        self._hands_lock = threading.Lock()
        self._hands_timer: threading.Timer | None = None
        self._resuming = ""          # why we are landing in an old conversation
        self._scene_new = True       # the scene is still a guess
        self._then_one_more = False  # Skip, pressed at a cold machine
        self._then_again = ""        # and a line somebody asked to hear again
        self._llm_mending = False    # one restart at a time, not one per turn
        self._cont_hold = False      # a run held while the voice is paused
        self._cont_saved = 0.0       # and how much of it was left
        # Last, so everything it reads exists before it first looks.
        threading.Thread(target=self._idle_watch, daemon=True).start()

    # ---------- plumbing ----------

    def emit(self, kind: str, **payload):
        """Say something to every page, with the return address it was said at.

        Stamped here, where it is made, and not where it is sent. Events cross
        from worker threads to the event loop through a queue, and the loop
        used to put the address on as it drained -- so a line written before a
        pill was swapped could be posted after, and go out wearing the new
        pill's name over the old conversation's id. A page opening on that pill
        has no conversation of its own yet, believes the first thing addressed
        to it, and takes that id for its own: which is a Thinker page whose
        address bar says it is in a conversation of Lover's, and which then
        turns away every real message as somebody else's and puts up the
        banner saying another window has the machine.

        The pair goes on as one value for the same reason -- see _address.
        """
        self.events.put({**self._address, "type": kind, **payload})
        # Anything worth telling the page is worth keeping. These used to
        # exist for one moment in a status line and then be gone; the console
        # is where they live now, and where somebody looks when the evening
        # has stopped working. Never the words of a conversation -- see
        # shell/log.py for why that line is not crossed.
        if kind == "log":
            LOG.say(payload.get("text", ""), source="talk",
                    level=payload.get("level", "info"))

    def _mic_event(self, name, payload):
        if name == "listening":
            self.set_state("listening" if payload.get("active") else "idle")
        elif name == "dropped":
            self.emit("log", text=f"that was {payload.get('ms', 0)}ms — too short to hear")
            if payload.get("barged"):
                self._put_it_back()
        elif name == "barge_in":
            self.stop_reply.set()
            self.emit("log", text="barge-in — you interrupted")
        elif name == "log":
            self.emit("log", text=payload.get("text", ""))

    def _put_it_back(self):
        """A noise stopped the pill and turned out to be nothing.

        Barge-in decides in about a tenth of a second, because waiting longer
        than that to stop talking over somebody is worse than being wrong
        occasionally. A chair moving is loud and has pitch in it, so it is
        wrong occasionally — and the cost lands entirely on the person, who
        loses the end of a reply to a sound they did not make and gets nothing
        in its place.

        So the line is said again. Not the whole turn: this is a replay, the
        way the key on the deck is, so nothing is generated, nothing is
        written down, and where you stand does not move. From the top of the
        line rather than from where it was cut, because there is no knowing
        where that was -- what the page has is a whole line, and hearing one
        sentence twice is a smaller wrong than losing four.
        """
        last = self.history[-1] if self.history else None
        if not last or last.get("role") != "assistant":
            return                       # nothing was being said; nothing owed
        if self._replying.locked() or self.speaker.playing:
            return                       # already talking again on its own
        self.emit("log", text="that was the room — picking the line back up")
        threading.Thread(target=self.speak_again,
                         args=(last.get("content", ""),), daemon=True).start()

    def set_state(self, state: str):
        # Don't let a mic event stomp on an in-flight reply.
        if state == "idle" and self.state in ("thinking", "speaking"):
            return
        if state != self.state:
            self.state = state
            self.emit("state", state=state)

    def snapshot(self):
        # Derive rather than trust: a hidden turn returns before the audio has
        # drained (that is what lets the next one overlap), so nothing resets
        # the state afterwards and it would stay "speaking" for good.
        if self.state in ("speaking", "thinking") and not self._replying.locked():
            if not self.speaker.playing:
                self.state = "idle"
        return {
            "type": "tick",
            "state": self.state,
            "status": self.status,
            "level": round(self.mic.level, 5),
            "tts": self.voice.stats,
            "input_mode": self.input_mode,
            # In the tick, not just an event: a page that loads mid-run
            # otherwise shows the box unticked while the pill keeps talking.
            "continuous": self.continuous_left() > 0,
            "continuous_min": round(self.continuous_left() / 60, 1),
            "floor": round(self.mic.floor, 5),
            "mode": self.mic.mode,
            "barge_in": self.mic.barge_in,
            "running": self.running,
            "memory": self.memory(),
            # The page cannot read config.json, and this is a page decision.
            "mic_follow": self.cfg.get("ui", {}).get("mic_follows_window", "hidden"),
            "standing": self._standing(),
            "persona": self.persona["slug"],
            # What a player sees is the pill, never the character's own name:
            # the name belongs to the prompt. See personas.py.
            "persona_name": self.persona["pill"],
            "session_id": self.session_id,
        }

    def memory(self):
        """What this app is costing, in full.

        The LLM runs as a child process; everything else -- Parakeet,
        Chatterbox, audio buffers, Python itself -- lives in this one. Reporting
        only the child plus MLX's allocator left several GB uncounted, so the
        figure never matched what Activity Monitor showed.

        Measuring it costs a handful of subprocesses -- lsof, ps, footprint --
        and the page asks five times a second, on the event loop, where
        everything else is waiting: streamed audio included. Caching it made
        that rare rather than gone, and a footprint that hangs still takes the
        loop down with it for its whole five-second timeout. So the measuring
        happens on a thread of its own and this hands back the last figure it
        came home with, which is at most a few seconds old and is a number on
        a dial.
        """
        now = time.monotonic()
        if now - self._mem_at > 3.0 and not self._mem_busy:
            self._mem_busy = True
            self._mem_at = now          # before, so a slow measure is not retried
            threading.Thread(target=self._measure_memory, daemon=True).start()
        return self._mem_seen

    def _measure_memory(self):
        try:
            llm = self.llm.memory_mb()
            app = M.process_mb(os.getpid())
            vox = self.voice.memory_mb() if (self.voice.stt or self.voice.tts) else 0.0
            self._mem_seen = {"llm_gb": round(llm / 1024, 2),
                              "app_gb": round(app / 1024, 2),
                              "voice_gb": round(vox / 1024, 2),
                              "total_gb": round((llm + app) / 1024, 2)}
        except Exception as e:
            LOG.say(f"could not measure memory: {type(e).__name__}: {e}",
                    source="talk", level="debug")
        finally:
            self._mem_at = time.monotonic()
            self._mem_busy = False

    # ---------- lifecycle ----------

    def touch(self):
        """Something happened. Say so, so the machine is not put away mid-thought."""
        self.active_at = time.time()

    def _busy(self) -> bool:
        """Somebody, or something, is still using this.

        Busy is not idle, whatever the clock says: a reply in flight, a voice
        still playing, or a continuous run talking to itself.

        An open microphone is deliberately not on that list. Leaving the mic on
        is the easiest thing in the world to do on the way out of the room, and
        counting it as company would keep several gigabytes resident all
        afternoon for an empty chair. What counts is being spoken to, which is
        what touch() records.

        Nor is a held run. Pausing the voice leaves the dose stopped rather
        than spent, so a run that counted itself busy while held would hold the
        models until morning -- which is the one thing the timer is for. Pause
        it on the way out of the room and the machine still puts itself away.
        """
        return bool(self._replying.locked() or self.speaker.playing
                    or (self.continuous_left() > 0 and not self._cont_hold))

    def _idle_watch(self):
        """Put the models away when nothing has happened for a long time.

        Not a timer that ends the conversation: the transcript, the memory and
        where you stand are all untouched, and the next thing you type or say
        brings the stack back up on its own. All this reclaims is the several
        gigabytes that were sitting there in case you came back within the
        minute -- which, at four in the afternoon, you did not.
        """
        while True:
            time.sleep(15)
            minutes = float(self.cfg.get("idle_stop_minutes", 30) or 0)
            if minutes <= 0 or not self.running:
                continue
            if self._busy():
                self.touch()
                continue
            quiet = time.time() - self.active_at
            if quiet < minutes * 60:
                continue
            # Say what happened and how to undo it. Stopping closes the
            # microphone with everything else, so a page that was listening is
            # not left looking live with nothing behind it.
            self.emit("log", text=f"quiet for {int(quiet // 60)} minutes — putting the "
                                  "machine away. Type or turn the mic on to bring it back")
            # Put the switch where the truth is first: with the stack down
            # nothing is listening, and a page still showing "mic on" would be
            # a lie you only discover by talking to an empty room.
            if self.input_mode == "mic":
                self.set_input_mode("text")
            self.stop_all()

    def start_stack(self, slug: str = ""):
        """Bring the models up, optionally as a pill named by whoever asked.

        The slug matters more than it looks. A cold session is whichever
        persona sorts first — Lover — and the boot sets a voice reference from
        whatever self.persona says at the moment the voice model finishes
        loading. A page arriving on a Thinker link says so on another thread,
        and if it lands after that moment the voice has already been set to
        Lover's: the first sentence of the first reply comes out in the wrong
        voice and the rest of it, once the switch lands, in the right one.
        Naming the pill here closes the window rather than narrowing it.
        """
        if slug:
            self._boot_as = slug
        if self.running or (self._boot and self._boot.is_alive()):
            return
        self.touch()
        self._boot = threading.Thread(target=self._boot_stack, daemon=True)
        self._boot.start()

    def _boot_stack(self):
        try:
            self._boot_stack_inner()
        except Exception as e:
            # Without this the thread died silently, running stayed True, and
            # start_stack refused to retry for the rest of the process's life.
            self.running = False
            self._then_one_more = False   # nothing is owed by a start that failed
            self._then_again = ""
            self.set_state("stopped")
            self.emit("log", level="error", text=f"start failed: {type(e).__name__}: {e}")

    def _cancelled(self) -> bool:
        """Stop was pressed while we were loading."""
        return not self.running

    def _boot_gave_up(self):
        """Give up the start, owing nothing.

        A Skip pressed at a cold machine is remembered so it can be taken once
        the models are up. If the start never finishes, that turn is still owed
        and is taken at the next successful start instead -- so the machine
        starts talking to itself on a Play pressed an hour later.
        """
        self._then_one_more = False
        self._then_again = ""
        self.emit("log", text="start canceled")

    def _adopt_boot_persona(self):
        """Become the pill this start was asked for, before anything loads."""
        slug, self._boot_as = self._boot_as, ""
        if not slug or slug == self.persona["slug"]:
            return
        wanted = P.get(slug)
        if wanted:
            self.persona = wanted

    def _boot_stack_inner(self):
        self.running = True
        self.set_state("loading")
        # First, and before the session is opened or a voice is loaded: both
        # of those read self.persona, and being the wrong one here is a
        # conversation opened for the wrong pill and a voice set to it.
        self._adopt_boot_persona()

        # Re-read config.json and the persona file so edits apply on Start.
        self.cfg = C.load()
        # A model server that has just started has an empty cache, and a voice
        # that has just been loaded has compiled nothing — so neither is warm,
        # however recently this thought it was.
        self._warmed = None
        self._warmed_voice = None
        M.apply_config(self.cfg)
        A.apply_config(self.cfg)
        fresh = P.get(self.persona["slug"])
        if fresh:
            self.persona = fresh
        self.llm.model_path = Path(self.cfg["llm"]["model"])
        if not self.session_id:
            self.open_session()

        if self.device_warning:
            self.emit("log", text=self.device_warning)
        # Stop, pressed while the config was being read, has already run its
        # llm.stop(). Starting one now spawns a twenty-gigabyte child that
        # nothing owns: `running` is False, so Stop says there is nothing to
        # stop, and the next Start adopts it as the model already on the port.
        if self._cancelled():
            return self._boot_gave_up()
        self.status["llm"] = "starting"
        self.emit("log", text=f"starting the language model on :{M.LLM_PORT} …")
        if self.llm.ready():
            self.emit("log", text=f"found an LLM already on :{M.LLM_PORT}, using it")
        else:
            self.llm.start()
        ok = self.llm.wait_ready()
        self.status["llm"] = "ready" if ok else "error"
        # The console is where somebody is already looking, so the reason goes
        # there rather than being a pointer to a file they have to find. The
        # child's own output is tailed in below.
        if ok:
            self.emit("log", text="LLM ready")
        else:
            self.emit("log", level="error", text="LLM failed to start")
            for line in M.last_words(paths.LLM_LOG):
                LOG.say(line, source="llm", level="error")

        if self._cancelled():
            return self._boot_gave_up()
        self.status["stt"] = "loading"
        self.emit("log", text="loading Parakeet …")
        try:
            self.voice.load_stt()
            self.status["stt"] = "ready"
        except Exception as e:
            self.status["stt"] = "error"
            self.emit("log", level="warn", text=f"STT failed: {e}")

        if self._cancelled():
            return self._boot_gave_up()
        self.status["tts"] = "loading"
        self.emit("log", text="loading the voice …")
        try:
            self.voice.load_tts()
            self._apply_persona_style(self.persona)
            ref = P.voice_ref(self.persona)
            if ref:
                self.voice.set_reference(ref)
            else:
                # A missing clip used to fall through in silence, leaving
                # whichever voice was loaded last.
                want = self.persona.get("voice") or self.persona["slug"]
                self.emit("log", text=f"no clip for {self.persona['name']} — "
                                      f"expected personas/{want}/voice.ref.wav")
            self.status["tts"] = "ready"
        except Exception as e:
            self.status["tts"] = "error"
            self.emit("log", level="warn", text=f"TTS failed: {e}")

        if self._cancelled():
            return self._boot_gave_up()

        try:
            self._apply_input_mode()      # opens a microphone only if one is wanted
            self.mic_live = True
        except Exception as e:
            self.emit("log", level="warn", text=f"mic failed: {e}")

        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._turn_loop, daemon=True)
            self._worker.start()

        self.set_state("idle")
        self.emit("log", text="ready — just talk")

        # Something was said while this was loading. It waited rather than
        # being dropped, which is the whole point of letting you talk to a
        # cold server.
        if self.pending_say:
            text, self.pending_say = self.pending_say, ""
            threading.Thread(target=self.reply_to, args=(text,), daemon=True).start()
        elif self._then_one_more:
            self._then_one_more = False
            self.one_more()
        elif self._hands:
            # And the same for hands: the press that started an evening is
            # usually the press that started the machine, and it waited
            # through the whole load. Answering it is the difference between
            # touching something and watching a room boot.
            self._hands_turn()
        elif self._then_again:
            # Last, and so behind all of them: saying an old line again is the
            # smallest of these and the only one that is not a turn. Anything
            # somebody actually said while the models were loading comes first
            # and would silence this the moment it started.
            text, self._then_again = self._then_again, ""
            threading.Thread(target=self.speak_again, args=(text,),
                             daemon=True).start()
        else:
            # Nothing was owed, which means somebody is sitting in an open room
            # with the models up and has not spoken yet. That is the moment the
            # prompt is worth pushing through — see warm_prompt. Every branch
            # above is a real turn about to run, and a real turn does its own
            # prefill.
            self.warm_later()

    def stop_all(self):
        """Free every byte: models unloaded, child processes killed."""
        self.stop_continuous(silence=True)
        self.running = False
        self.mic.enabled = False
        self.speaker.stop()
        self.stop_reply.set()
        self.emit("log", text="stopping everything …")

        # Wait for a turn in flight. Unloading underneath one lets its queued
        # speak/transcribe job reload the models it just freed, so the UI says
        # the RAM is back while several GB become resident again.
        if not self._replying.acquire(timeout=20):
            self.emit("log", text="a reply is still running — stopping anyway")
        else:
            self._replying.release()

        self.mic.close()
        self.mic_live = False
        self.speaker.close()

        self.voice.unload()
        self.status["stt"] = self.status["tts"] = "off"

        self.llm.stop()
        self.status["llm"] = "off"

        # Rebuild the audio objects so a later Start is clean. Neither of them
        # holds anything of the machine's -- the page does the recording and the
        # playing -- so this is a fresh queue and a fresh thread and nothing
        # else. What is worth carrying across is how somebody likes to talk.
        mode, barge = self.mic.mode, self.mic.barge_in
        self.speaker = BrowserSink(lambda name, **kw: self.emit(name, **kw),
                                   self._has_listeners)
        self.speaker.on_state = lambda playing: self.emit("audio_out", playing=playing)
        self.mic = A.Mic()
        self.mic.mode, self.mic.barge_in = mode, barge
        self.mic.speaker = self.speaker
        self.mic.on_event = self._mic_event
        self._apply_input_mode()

        self.state = "stopped"
        self.emit("state", state="stopped")
        self.emit("log", text="all models unloaded, RAM released")

    # ---------- sessions ----------

    def _recent_session(self) -> str | None:
        """This persona's last conversation, if it is still the same sitting.

        A dose is a dream and each one starts new — what carries between them
        is what the pill remembers about you and how it holds you, neither of
        which lives in the transcript. But a reload, a dropped socket or a
        phone locking itself in a pocket are not new dreams, and losing the
        thread to any of them is a bug wearing a design's clothes.

        The window is minutes rather than hours, and deliberately shorter than
        the machine's own idle stop: coming back to a room that has put itself
        away is a new conversation, and quiet for longer than an interruption
        lasts is quiet somebody chose. See resume_within_minutes.
        """
        minutes = float(self.cfg.get("resume_within_minutes", 5) or 0)
        if minutes <= 0:
            return None
        last = S.latest(self.persona["slug"])
        if not last:
            return None
        try:
            quiet = time.time() - (paths.SESSIONS / f"{last}.jsonl").stat().st_mtime
        except OSError:
            return None
        if quiet > minutes * 60:
            return None
        # Said by the caller, not here: this is asked once to see whether
        # there is one and once to get it, and a line that announces itself
        # from inside the question appeared twice for every page that opened.
        self._resuming = f"picking up where you left off — {max(1, int(quiet // 60))} minutes ago"
        return last

    def open_session(self, resume_id: str | None = None, fresh: bool = False):
        """Open a conversation, once the room is quiet enough to leave.

        A reply in flight is holding the old transcript: it has written the
        user's line to it and will write the answer when the voice finishes.
        Swapping the file underneath it splits that turn across two
        conversations -- one with a question and no answer, one with an answer
        and no question -- and a transcript is the one thing here with no
        second copy. So the run is stopped, the voice is silenced, and the turn
        in flight is waited for before anything moves.
        """
        self.stop_continuous()
        self.silence()
        settled = self._replying.acquire(timeout=self.SETTLE_WAIT)
        self._opening.acquire()
        if not settled:
            self.emit("log", text="a reply is still running — opening anyway")
        try:
            return self._open_session(resume_id, fresh)
        finally:
            # A backstop, not the place it happens: _open_session addresses
            # itself the moment it knows which conversation this is, because
            # it has things to say afterwards. This catches the paths that
            # never got that far — a session file that has gone missing.
            self._addressed()
            self._opening.release()
            if settled:
                self._replying.release()

    def _addressed(self):
        """This is the conversation now — said before anything else is.

        The return address has to move at the moment the conversation does,
        not once opening it has finished. Everything after this point is *about*
        the new one, and the last thing said about it is its own transcript:
        a page that deep-linked to a conversation was sent it stamped with the
        one it replaced, turned it away as somebody else's, and sat there empty.
        Which is the ordinary way of picking an old evening out of the box.
        """
        self._address = {"sid": self.session_id, "pill": self.persona["slug"]}

    def _open_session(self, resume_id: str | None = None, fresh: bool = False):
        """Open a conversation: a named one, the one you were just in, or a new one.

        `fresh` is the difference between "carry on" and "start again", and it
        has to be asked for. Without it this picks up the recent one, which is
        what reloading a page or losing a socket wants — and is exactly what
        /session_new does not: for two hours after an evening began, asking
        for a new conversation quietly handed back the old one, said "picking
        up where you left off", and left somebody looking at a transcript they
        had just asked to be done with.
        """
        already = False
        if resume_id:
            try:
                self.history = self.store.resume(resume_id)
                self.session_id = self.store.session_id
                self.scene = self.store.scene      # pick the room back up
                # Where the scene was last written, counted in this
                # conversation's turns. Left at whatever the previous
                # conversation had reached, a shorter one resumed after a
                # longer one had "no turns since" forever, and quietly stopped
                # noticing where it had got to for the rest of the evening.
                self._scene_at = len(self.history)
            except FileNotFoundError:
                # A conversation that has been named and not yet spoken in has
                # no file -- see store.start, which does not write one until
                # there is something to write. Reloading a room nobody has
                # said anything in asks for exactly that, and so does the
                # address bar of a room somebody opened and left.
                #
                # Giving up here was worse than the missing file: the pill had
                # already been switched by the caller, so the session was left
                # answering to the new pill while holding the old one's
                # conversation -- a Thinker sitting in Lover's transcript, and
                # a page told so. It falls through instead, and opens whatever
                # this pill should have been opening anyway.
                # A conversation nobody has spoken in has no file -- see
                # store.start, which leaves the writing until there is
                # something to write. So a page whose address bar names one is
                # asking for something that is, on disk, nothing at all: an
                # empty room somebody opened and came back to.
                #
                # The address bar is the request, so the answer is to make it
                # true rather than to diverge from it. The name was only ever a
                # name and the transcript is empty either way. Told "no such
                # session" and given a different one, the page went on asking
                # after the conversation it had been promised, turned away
                # every word of the one it was actually in, and put up the
                # banner saying another window had the machine.
                if self.store.adopt(resume_id, self.persona["slug"],
                                    self.persona["pill"]):
                    self.history = []
                    self.scene = ""
                    self._scene_at = 0
                    self.session_id = resume_id
                    self._addressed()
                    self.emit("log", text=f"nothing said in {resume_id} yet")
                    resume_id = None
                    already = True
                else:
                    # Not a name of ours, or not this pill's. A new one, and
                    # deliberately not "the most recent one": that path asks
                    # the same question that just failed and would be handed
                    # the same answer, for ever.
                    self.emit("log", text=f"no such session: {resume_id}")
                    resume_id, fresh = None, True
        if already:
            pass                     # the name was adopted; nothing else to open
        elif resume_id:
            # A conversation belongs to its persona — restore that voice and prompt too.
            owner = P.get(self.store.persona)
            switched = bool(owner and owner["slug"] != self.persona["slug"])
            if switched:
                self.persona = owner
                self._apply_persona_style(owner)
            # Both halves known. Said before anything is said about them.
            self._addressed()
            self.emit("log", text=f"resumed {resume_id} ({len(self.history)} turns)")
            if switched:
                ref = P.voice_ref(owner)
                if ref and self.voice.tts is not None:
                    try:
                        self.voice.set_reference(ref)
                    except Exception as e:
                        self.emit("log", level="warn", text=f"voice switch failed: {e}")
        elif not fresh and self._recent_session():
            # Same sitting, so carry on rather than starting again. Recursing
            # once with the id takes the ordinary resume path, voice and room
            # and all.
            recent = self._recent_session()
            self.emit("log", text=self._resuming)
            return self._open_session(recent)   # already settled, above
        else:
            self.history = []
            self.scene = ""
            self._scene_at = 0
            self.session_id = self.store.start(self.persona["slug"], self.persona["pill"])
            self._addressed()          # before the first word said about it
            self.emit("log", text=f"new session {self.session_id}")
        # Whatever was pressed a moment ago was pressed in another room, or in
        # another conversation in this one. It is not this one's to answer:
        # a cushion knocked onto a floor turned up in a library, because the
        # presses were still pooled when the session changed under them.
        self.take_hands()
        # Where this begins, if nothing has said otherwise yet. The persona
        # describes the room it is in (personas.py, `place`) and that becomes
        # the scene's first value — a seed, not a fact. From the next scene
        # update on it is the conversation's own, so two people who talk
        # themselves into a dressing room are in a dressing room and the
        # library stops existing. That is the whole of how a room is
        # overruled: there is nothing to detect, because the room only ever
        # got to say the first line.
        if not self.scene:
            self.scene = self.persona.get("place") or ""
        # Whatever the scene says now is a guess — the room's description of
        # itself, or where the two of them were the last time this was put
        # down — and the first note of this sitting replaces it early.
        self._scene_new = True
        # Anything already outside the window was folded into memory in an
        # earlier run; don't fold it twice.
        window = int(self.cfg["llm"].get("context_turns", 12)) * 2
        self.folded_upto = max(0, len(self.history) - window)
        # With whose conversation it is. The page labels these as they arrive,
        # and the state that carries the pill's name reaches it later — so a
        # reopened conversation drew every line of itself as "the pill".
        self.emit("history", messages=self.history,
                  persona_name=self.persona["pill"])

    def what_is_missing(self) -> str:
        """What this app says is up and is not, in words. Empty when it is all
        there.

        Only the language model, for now, because it is the only piece that
        lives in a process of its own and can therefore go away without this
        one noticing. The voice and the transcriber are objects in here: if
        they are gone, so are we.
        """
        if not self.running:
            return ""
        return "" if self.llm.ready() else "the language model is not answering"

    def mend(self):
        """Put back whatever has gone, without stopping what has not."""
        if not self.llm.ready() and not self._llm_mending:
            self._llm_mending = True
            threading.Thread(target=self._llm_mend, daemon=True).start()

    def _llm_trouble(self, e: Exception):
        """The language model did not answer. Say which kind, and mend it.

        Two very different things arrive here as one Python traceback. The
        model can refuse a request, which is a bug in what was asked of it. Or
        the child process can be gone — killed, crashed, or shut down by
        something else on the machine — in which case the app is still lit,
        still says it is running, and fails every turn from then on with a page
        of urllib text that begins "HTTPConnectionPool" and tells somebody
        looking at a game exactly nothing.

        It is not the page's job to know what a connection pool is. If the
        model is not answering on its port, it is not there, and it is put back
        — which is a thing this program can do for itself, and did not.
        """
        if self.llm.ready():
            self.emit("log", level="error",
                      text=f"the language model refused that — {type(e).__name__}: {e}")
            return
        if self._llm_mending:
            return                       # already on its way back
        self.emit("log", level="error",
                  text="the language model has gone — putting it back")
        self.mend()

    def _llm_mend(self):
        try:
            self.status["llm"] = "starting"
            self.llm.start()
            ok = self.llm.wait_ready()
            self.status["llm"] = "ready" if ok else "error"
            if ok:
                self.emit("log", text="the language model is back")
                self._answer_what_was_missed()
            else:
                self.emit("log", level="error",
                          text="the language model would not start again")
                for line in M.last_words(paths.LLM_LOG):
                    LOG.say(line, source="llm", level="error")
        except Exception as e:
            self.emit("log", level="error",
                      text=f"could not put the language model back: {e}")
        finally:
            self._llm_mending = False

    def _answer_what_was_missed(self):
        """Something was said to a machine that could not answer. Answer it.

        A model that dies takes the turn in flight with it, and the words are
        already in the transcript -- the person said their piece, watched
        nothing come back, and was told to say it again. Which is asking them
        to do the machine's remembering for it: the line is right there, at the
        end of the conversation, waiting.

        Hidden, so nothing is written down twice. What he said is already in the
        window; this only says what to do about it.
        """
        last = self.history[-1] if self.history else None
        if not last or last.get("role") != "user":
            return                       # nothing was owed
        if self._replying.locked():
            return                       # already being answered
        self.emit("log", text="picking up the turn it could not answer")
        threading.Thread(
            target=self.reply_to, daemon=True,
            args=("Answer what he just said, as if nothing had gone wrong.",),
            kwargs={"hidden": True}).start()

    def _live_persona(self):
        """Re-read the persona file so prompt edits land on the next reply.

        The file is the thing you tune, and having to press Start to hear a
        change makes tuning slow. Only the wording and delivery are refreshed
        here -- the voice is left alone, since swapping a clone mid-conversation
        means reloading a reference for no reason.
        """
        fresh = P.get(self.persona["slug"])
        if not fresh:
            return self.persona
        fresh["voice"] = self.persona.get("voice")
        self.persona = fresh
        self._apply_persona_style(fresh)
        return fresh

    def _apply_persona_style(self, persona):
        """Apply a persona's voice tunables. Anything unset falls back to config."""
        def num(key):
            v = persona.get(key)
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                self.emit("log", text=f"{persona['slug']}: {key}={v!r} is not a number")
                return None
        self.voice.exaggeration = num("exaggeration")
        self.voice.cfg_weight = num("cfg_weight")
        self.voice.pause = num("pause")
        # Turbo is the default voice model and ignores both delivery keys, so a
        # persona that sets them looks tuned and sounds identical. Said once per
        # persona, because this runs before every reply.
        dead = [k for k in ("exaggeration", "cfg_weight") if persona.get(k) is not None]
        if dead and M.is_turbo() and self._turbo_note != persona["slug"]:
            self._turbo_note = persona["slug"]
            self.emit("log", text=f"{persona['slug']}: {' and '.join(dead)} ignored — "
                                  "Chatterbox Turbo has no delivery controls")

    def switch_persona(self, slug: str, resume: str = ""):
        """A persona change is a new voice and a new conversation.

        `resume` is which conversation to land in, for the one caller that
        knows: a page opening a deep link is asking for a pill *and* one of
        its conversations, and doing it in one move saves opening the most
        recent one first and then leaving it a moment later.
        """
        with self._opening:
            if slug == self.persona["slug"]:
                return           # the page saying who it came for; already it
            persona = P.get(slug)
            if not persona:
                self.emit("log", text=f"no such persona: {slug}")
                return
            self.persona = persona
            self._apply_persona_style(persona)
            self.open_session(resume or None)
            ref = P.voice_ref(persona)
            if ref and self.voice.tts is not None:
                try:
                    self.voice.set_reference(ref)
                    # `voice:` on a persona is the borrowing exception -- two
                    # characters that should sound alike -- and almost nothing
                    # sets it, so this line said "voice: None" every time
                    # anybody opened a room. A console is only worth reading if
                    # every line in it means something.
                    borrowed = persona.get("voice")
                    self.emit("log", text=(f"voice: {persona['pill']}"
                                           + (f", borrowed from {borrowed}" if borrowed else "")))
                except Exception as e:
                    self.emit("log", level="warn", text=f"voice switch failed: {e}")

    def open_for(self, slug: str, resume: str = ""):
        """What a page came for: this pill, and this conversation.

        One move rather than two. It was two commands sent a tenth of a second
        apart, and they raced: the persona switch opens a conversation of its
        own, so a deep link could land in the most recent one, sit there long
        enough to be drawn, and then jump to the one that had been asked for.

        And one at a time, because this is where the pages arrive and pages
        arrive in a hurry. Clicking from a room to the box to another room
        gives three of these in about a second, each on its own thread, and
        they used to overlap: one had set the persona to the pill it came for
        while another was still opening a conversation for the pill before it.
        Which produced, briefly and truthfully, a session that was Thinker's
        by name and Lover's by id -- and a page connecting in that moment was
        handed its whole opening stamped with the pair, believed it, and spent
        the evening in a conversation that was not its own.
        """
        with self._opening:
            # Asked for first, and before anything moves. A conversation that
            # cannot be opened is a page pointed at something that is not
            # there, and the answer is to say so and leave the machine exactly
            # as it was — not to switch the pill, fail to find the
            # conversation, and leave a Thinker holding Lover's transcript.
            if resume and not self.can_open(resume, slug or self.persona["slug"]):
                self.emit("no_such_session", asked=resume)
                return
            if slug and slug != self.persona["slug"]:
                self.switch_persona(slug, resume=resume)
            elif resume and resume != self.session_id:
                self.open_session(resume)
        # Outside the lock: this room is settled, and if the machine is already
        # warm the prompt in front of it is not. Costs nothing when the stack is
        # still loading — the boot warms at the end of its own run instead.
        self.warm_later()

    def can_open(self, session_id: str, slug: str) -> bool:
        """Is there a conversation of that name for this pill to open?

        Two ways there can be. One that has been spoken in is on disk and can
        be resumed. One that has only been named is not on disk at all — see
        store.start, which leaves the writing until there is something to
        write — and a page whose address bar holds that name is a room
        somebody opened and came back to, which is an ordinary thing to do.

        Anything else is a page pointed at a conversation that does not exist:
        a name of the wrong shape, or one belonging to another pill. Those get
        told, rather than quietly given a different evening and left asking
        after the one they were promised.
        """
        return bool(S.exists(session_id) or S.could_be(session_id, slug))

    # ---------- memory ----------

    def _memory_block(self) -> str:
        """What the pill remembers about you, for the system prompt.

        This belongs in front, with the persona, and that is a decision rather
        than an accident: it changes only when a fold writes a memory, which is
        a handful of times an evening. The system prompt is the front of the
        prefix the LLM server actually caches — see _window — so the test for
        putting something here is not "is it about the person" but "does it
        hold still". Memory does. The relation's *numbers* do not, which is why
        what goes in beside this is the banded prose and not the state.
        """
        if not self.cfg.get("memory", {}).get("enabled", True):
            return ""
        return MEM.as_prompt_block(self.persona["slug"])

    def _state_press(self, messages: list[dict]) -> list[dict]:
        """Put the hard rules where the model will actually act on them.

        The same lesson as _unstick: instructions in the system prompt lose to
        the persona sitting right after them, while the same words at the end
        of the user turn land. So the state describes the feeling up there and
        says what it does down here. Nothing here limits how long the reply
        may be — whatever the pill says, you get all of it.

        And it is the right place for a second reason that costs nothing to
        keep: this text moves as the relation moves, and pressing it onto the
        last user turn leaves everything before it untouched. See _scene_press.
        """
        if not self.cfg.get("relation", {}).get("enabled", False):
            return messages
        text = R.conduct(R.decayed(R.load(self.persona["slug"])))
        if not text or not messages or messages[-1]["role"] != "user":
            return messages
        out = list(messages)
        out[-1] = dict(out[-1], content=f'{out[-1]["content"]}\n\n[{text}]')
        return out

    def _scene_press(self, messages: list[dict]) -> list[dict]:
        """Put the room back in front of the pill.

        On the last user turn rather than in the system prompt, so that the
        stable prefix in front stays cached — the scene changes, the persona
        does not.

        In front of what he said rather than after it, which is the correction.
        It rode at the very end for a while, on the reasoning that what is said
        last is acted on -- and it was: the pill answered the room instead of
        the man. Once a place settles, Place is the same sentence every turn
        (measured: identical across ten turns of one evening), so the last
        thing in the context was the same room described over and over, and
        replies opened by narrating it back to somebody standing in it. Ahead
        of his words it is still present every turn, which is what folding
        needs, and the freshest thing is the person who just spoke.

        Cost of the move: nothing. Everything before the last message is
        untouched, so the cached prefix is the same length either way, and that
        final message is new tokens whichever end the block goes on.

        The second reason is worth more than it looks, because the cache is
        real: mlx_lm re-uses the longest prefix it has already processed (see
        LLMServer.args). So the rule is that anything which changes during a
        conversation goes on the last user turn and never in front of the
        history. Adding one volatile line to the system prompt costs nothing to
        write and about two seconds a turn thereafter. See _window, which is
        the one place that still breaks the rule.
        """
        block = SC.as_prompt_block(self.scene)
        if not block or not messages or messages[-1]["role"] != "user":
            return messages
        out = list(messages)
        out[-1] = dict(out[-1], content=block.strip() + "\n\n" + out[-1]["content"])
        return out

    def reset_relation(self, slug: str = ""):
        """Put a persona back to knowing nothing about you.

        Defaults to the one you are with, because that is what a room can mean;
        the dashboard says which, because it can see all of them at once.
        """
        slug = slug or self.persona["slug"]
        R.reset(slug)
        who = next((p["name"] for p in P.listing() if p["slug"] == slug), slug)
        self.emit("log", text=f"{who}: back to nothing between you")

    def _standing(self) -> dict:
        """Where you stand, in a word, for the top of the page."""
        if not self.cfg.get("relation", {}).get("enabled", False):
            return {}
        slug = self.persona["slug"]
        state = R.decayed(R.load(slug))
        word, temper = R.standing(state)
        return {"word": word, "temper": temper, "why": R.describe(state),
                "cold": state["warmth"] <= -25, "warm": state["warmth"] >= 25,
                # Nothing has happened between you yet, so there is nothing to
                # undo — the page hides the reset rather than offering a button
                # that would do nothing.
                "fresh": not R.path(slug).exists()}

    def _relation_block(self) -> str:
        """Where you stand with the pill. Facts are memory's job; this is stance."""
        if not self.cfg.get("relation", {}).get("enabled", False):
            return ""
        return R.as_prompt_block(self.persona["slug"])

    def _score_relation(self, user_text: str, reply: str):
        """Judge the exchange that just happened.

        Shares the fold's lock and its timing: this runs while the audio is
        still playing, which is the only reason it costs nothing. Hidden turns
        never reach here -- continuous mode is the pill talking to itself, and
        there is nothing about you in it to judge.
        """
        cfg = self.cfg.get("relation", {})
        if not cfg.get("enabled", False) or not cfg.get("score", True):
            return
        try:
            state = R.score(self.llm, self.persona["slug"],
                            [{"role": "user", "content": user_text},
                             {"role": "assistant", "content": reply}])
            if state:
                moved = (state.get("log") or [{}])[-1]
                self.emit("log", text=f"relation: {moved.get('moved', '')}"
                                      + (f" ({moved['why']})" if moved.get("why") else ""))
                self.emit("relation", slug=self.persona["slug"],
                          state={k: round(state[k], 1) for k in R.AXES},
                          text=R.describe(state))
        except Exception as e:
            self.emit("log", level="warn", text=f"relation scoring failed: {e}")

    def _after_turn(self, user_text: str, reply: str, hidden: bool):
        self._maybe_fold()
        self._maybe_scene()
        if not hidden:
            self._score_relation(user_text, reply)

    # Opening turns long enough to be a scenario rather than a greeting. Set
    # to 0 to write the first note from anything at all.
    SCENE_OPENING_WORDS = 0

    def _scene_opening(self):
        """Write down where he just said they are, before answering him.

        The first note used to wait for a reply to exist, which handed the seed
        one uncontested turn -- and that is the turn where his scenario is
        newest and the room's own description of itself is most wrong. Somebody
        opens by saying where they are, and the pill answers from the room it
        arrived with, because that is what the note still said. Measured: the
        reply hedges out loud, naming the room's own weather and then correcting
        itself mid-sentence. The correction does not help -- both halves are in
        the transcript now, the next reply picks the wrong half back out of it,
        and the scene writer reads that reply and writes it down as fact. The
        room nobody asked for is then part of the place they chose, and it got
        there from a seed no one ever contested.

        So the note is written from his turn alone, before the reply is built.
        The writer already knows what to do with it: being told is not
        inventing, and it follows the person in the room over the room.

        Costs one small call on the first turn of a session and nothing after.
        On a cold start it lands in the gap where the language model is up and
        the voice is still loading, so it is free; on a warm one it is the only
        turn of the evening nobody is holding a stopwatch on.
        """
        cfg = self.cfg.get("scene", {})
        if not cfg.get("enabled", True) or not self._scene_new:
            return
        # The opening turn and only that: a resumed conversation has a scene
        # of its own and _maybe_scene replaces it early enough.
        if len(self.history) != 1:
            return
        opening = self.history[0].get("content", "").strip()
        if len(opening.split()) < self.SCENE_OPENING_WORDS:
            return
        # Hands act inside a place and never declare one: the room wrote the
        # sentence, about its own furniture, and "he puts his hand out over the
        # edge" means nothing without the room still being there. So an evening
        # that opens with a press keeps the seed -- which is the one thing that
        # makes the press legible -- and the note waits for a word.
        if opening.startswith("(") and opening.endswith(")"):
            return
        self._scene_new = False
        self._scene_at = len(self.history)
        try:
            fresh = SC.update(self.llm, self.scene, self.history[:1],
                              settled=False, opening=True)
        except Exception as e:
            self.emit("log", level="warn", text=f"scene note failed: {e}")
            return
        if fresh and fresh != self.scene:
            self.scene = fresh
            self.store.append_scene(fresh)
            self.emit("scene", text=fresh)

    def _maybe_scene(self):
        """Work out where the scene has got to, every few turns.

        Every turn would be wasteful and every ten would be too late: the
        window holds about two of its replies, so the room has to be written
        down before it falls out of it. Runs on the same worker as the fold,
        while the audio is still playing.
        """
        cfg = self.cfg.get("scene", {})
        if not cfg.get("enabled", True) or not self.history:
            return
        # How much has been said since the last note, not how many turns —
        # one of its replies can be worth forty of yours.
        fresh_turns = self.history[self._scene_at:]
        said = sum(len(m.get("content", "").split()) for m in fresh_turns)
        # The first note after a conversation is opened comes early, whatever
        # has been said. Two things are riding along in the prompt until it
        # does, and both of them are guesses about a conversation that has
        # not happened yet: in a new one, the room's own description of
        # itself, put there so the pill knows where it is standing before
        # anybody has spoken; in a resumed one, wherever the two of them were
        # when it was last put down, which may be weeks ago.
        #
        # Waiting three hundred words to replace either of those meant the
        # note pulled the conversation back to a place it had already left.
        # Say "forget this room, we are on a ship" and it goes — and then on
        # the third turn the note still says the room with the open window,
        # and back it comes to the window. Two turns is enough to know
        # better, and the note is one small call.
        first = self._scene_new and len(fresh_turns) >= 2
        if said < max(50, int(cfg.get("every_words", 300))) and not first:
            return
        was_a_guess = self._scene_new
        self._scene_new = False
        recent = fresh_turns or self.history[-4:]
        self._scene_at = len(self.history)
        try:
            fresh = SC.update(self.llm, self.scene, recent[-6:],
                              settled=not was_a_guess)
        except Exception as e:
            self.emit("log", level="warn", text=f"scene note failed: {e}")
            return
        if fresh and fresh != self.scene:
            self.scene = fresh
            self.store.append_scene(fresh)
            self.emit("scene", text=fresh)

    def _maybe_fold(self):
        """Fold what just fell out of the window into long-term memory.

        Runs while the reply is still being spoken — that time is otherwise idle,
        so memory costs no extra waiting before the next answer.
        """
        cfg = self.cfg.get("memory", {})
        if not cfg.get("enabled", True):
            return
        # Two folds running at once both read the same memory and both write:
        # the later one wins and the earlier fold's turns are lost for good,
        # because folded_upto has already moved past them.
        if not self._folding.acquire(blocking=False):
            return
        try:
            window = int(self.cfg["llm"].get("context_turns", 12)) * 2
            fell_out = len(self.history) - window
            if fell_out - self.folded_upto < int(cfg.get("fold_after", 4)):
                return
            dropped = self.history[self.folded_upto:fell_out]
            try:
                kept = MEM.fold(self.llm, self.persona["slug"], dropped,
                                int(cfg.get("max_bullets", 14)))
                if not kept:
                    # Nothing was written, so nothing has been remembered, and
                    # the mark stays where it is: these turns are folded again
                    # after the next one. Moving it first — which is what this
                    # did — meant a fold interrupted by a Stop, or one the
                    # model answered with preamble, dropped those turns out of
                    # the window and out of the memory both. Silently, and for
                    # good: nothing ever looks back past this mark.
                    self.emit("log", text="memory fold came back empty — trying again "
                                          "after the next turn", level="warn")
                    return
                self.folded_upto = fell_out
                self.emit("log", text=f"memory updated ({len(dropped)} older turns folded in)")
                self.emit("memory", slug=self.persona["slug"],
                          text=MEM.load(self.persona["slug"]))
            except Exception as e:
                self.emit("log", text=f"memory fold failed: {e}", level="warn")
        finally:
            self._folding.release()

    # ---------- the turn ----------

    def _turn_loop(self):
        while True:
            try:
                utterance = self.mic.utterances.get(timeout=0.3)
            except queue.Empty:
                if not self.running and not self.mic_live:
                    return
                continue
            if not self.running:
                continue
            try:
                self._handle_audio(utterance)
            except Exception as e:
                self.emit("log", level="error", text=f"turn failed: {e}")
                self.set_state("idle")

    def _handle_audio(self, utterance):
        self.state = "thinking"
        self.emit("state", state="thinking")
        seconds = len(utterance) / A.STT_RATE
        try:
            text = self.voice.transcribe(utterance)
        except Exception as e:
            self.emit("log", level="warn", text=f"STT failed: {e}")
            self.state = "idle"
            self.emit("state", state="idle")
            return
        if M.is_junk(text):
            self.emit("log", text=f"heard {seconds:.1f}s but no usable speech — say it again, or type below")
            self.state = "idle"
            self.emit("state", state="idle")
            return
        self.cut_in()
        self.emit("user", text=text, seconds=round(seconds, 1))
        self.reply_to(text)

    def _unstick(self, messages):
        """Break the model out of copying its own short replies.

        Once one clipped reply is in context the model imitates it, and every
        turn after that is one line -- reliably, from a single one-word cue.
        Measured: with its own short replies in context it returns one sentence
        every time; with no assistant history at all the same prompt returns
        three. Instructions in the system prompt do not touch it, and the
        server ignores repetition_penalty.

        What does work is a reminder at the very end, where recency favours it,
        folded into the user turn -- a trailing system message is rejected. It
        is not stored in history, so the transcript stays clean.
        """
        if not messages or messages[-1]["role"] != "user":
            return messages          # the nudge only rides along on a user turn
        replies = [m["content"] for m in messages if m["role"] == "assistant"][-2:]
        if len(replies) < 2:
            return messages
        def sentences(t):
            return len([x for x in re.split(r"(?<=[.!?])\s+", t.strip()) if x])
        if any(sentences(r) > 1 for r in replies):
            return messages
        opener = replies[-1].split()[0].strip(".,!?").lower() if replies[-1].split() else ""
        nudge = ("Your last replies were single lines. This one is fuller: move the "
                 "scene forward and put him somewhere.")
        if opener:
            nudge += f' Do not start it with "{opener}" again.'
        out = list(messages)
        out[-1] = dict(out[-1], content=f'{out[-1]["content"]}\n\n[{nudge}]')
        return out

    # ---------- continuous mode ----------

    # The shape of a dose.
    #
    # A run used to be one instruction repeated: continue, move things forward
    # a little, so many minutes left. Which is a metronome, not a story — the
    # pill wandered pleasantly for a quarter of an hour and then stopped
    # because the clock said so, and somebody who asked for fifteen minutes got
    # fifteen minutes of middle. A number of minutes means very little to a
    # model; where it is in the thing means a great deal.
    #
    # So the run is told which part of the evening it is in. Four parts, by the
    # fraction of the dose spent, and two phrasings each so that consecutive
    # turns are not handed identical words — the surest way to get the same
    # reply twice is to ask for it the same way twice.
    #
    # Deliberately abstract, and that is the hard part. These go to every pill
    # on the shelf: the one who wants you, the one who is unimpressed by you,
    # and the ones that have not been written yet, which will not all be kind.
    # So they name what a turn is *for* — hold, open, cost, land — and never
    # what anyone does with their hands. "Touch something" is a stage direction
    # for one character and a wrong note for the rest of them; "let something
    # change" is a direction any of them can take their own way. A persona's
    # own writing decides what that looks like, and this decides when.
    #
    # The edges are not evenly spaced, and are not meant to be. A reply gets
    # shorter as the pressure rises — the pill answers in punches rather than
    # paragraphs — so turns arrive faster in the second half of a run than the
    # first. Played through at fifteen minutes, an even split gave the pushing
    # 10 turns of 26 against 5 for the settling, which is a long time to be
    # leaned on. So the middle is wide, the push is narrower than its share of
    # the clock, and the landing has room to be more than one reply.
    #
    # The numbers are not taste. Six runs were played through — both pills at
    # five, ten and fifteen minutes — and the edges were then fitted to the
    # turn times those runs actually produced, against a share of the turns
    # rather than a share of the clock: a fifth settling, a third opening out,
    # somewhat over a quarter pushing, a sixth landing. Anything re-cut here is
    # worth re-fitting the same way rather than reasoning about.
    #
    # These are the game's writing: rewrite them freely. What must survive is
    # the shape — hold, open, cost, land — and the last part, which is the only
    # place anything is told to finish.
    ARC = (
        (0.20, ("Stay with where this already is. Something small and "
                "particular, and no hurry to be anywhere else.",
                "Do not start anything new yet. Let what is here go on a little "
                "longer, and find one thing in it worth staying on.")),
        (0.58, ("Let it move now. Follow the thread you left lying, or turn it "
                "over — something has to be different by the end of this.",
                "Open it out. Take this somewhere it has not been yet, and "
                "commit to it rather than circling.")),
        (0.84, ("This is the part that costs something. Go further than is "
                "comfortable and leave it unresolved.",
                "Raise what is at stake rather than the volume. Whatever has "
                "been building, let it arrive — and do not settle it yet.")),
        (1.01, ("The time is nearly gone. Bring it to rest: finish what this "
                "turned out to be about rather than starting anything.",
                "Land it. End where it wants to end, and let the last thing you "
                "say be a last thing.")),
    )

    def continuous_nudge(self, spent: float, turn: int, last: bool = False) -> str:
        """What to tell the pill on a turn nobody asked for in words.

        `spent` is how much of the dose has gone, 0 to 1. `turn` only picks
        between phrasings, so the same part of the arc does not arrive in the
        same words twice running.

        `last` overrides the arithmetic, and is the difference between a dose
        that ends and one that finishes. Turns are coarse — one is ten or
        twenty seconds of talk — so a short dose can put its final turn at 80%
        of the way through, still being told to push, and then run out of clock
        before anything is asked to land. Whoever calls this knows how long a
        turn has been taking; when there is not time for another, this is the
        one that closes.

        The second sentence never changes and is not decoration: without it the
        model answers as though somebody had spoken, and the reply comes back
        addressed to a question nobody asked.
        """
        if last:
            spent = 1.0
        for edge, lines in self.ARC:
            if spent < edge:
                body = lines[turn % len(lines)]
                break
        else:
            body = self.ARC[-1][1][turn % len(self.ARC[-1][1])]
        return f"{body} He has not said anything; do not ask him to."

    def one_more(self) -> bool:
        """One turn, taken without being asked for in words.

        What Skip means when nothing is running. Play hands the pill the whole
        dose and lets it go; this hands it one turn and stops — so a
        conversation can be walked forward a step at a time by somebody who
        does not want to type and does not want to hand over the evening
        either. Pressed again while that turn is being spoken, it cuts it off
        and takes the next: which is the same key doing the same thing, and is
        why it is one key.

        The tape has to have been started, though. The first word is always
        somebody's — see the note on the Play key — and a room where nothing
        has been said has nothing for a pill to go on from.
        """
        if not any(m.get("role") == "user" for m in self.history):
            return False
        if not self.running:
            # Cold. Typing at a cold machine starts it and is answered when it
            # is up; so does touching something in the room; so does this. A
            # key that quietly does nothing because a model is not loaded is a
            # key somebody presses four more times.
            self.emit("log", text="starting the models first …")
            self._then_one_more = True
            self.start_stack()
            return True
        threading.Thread(target=self._one_more, daemon=True).start()
        return True

    def _one_more(self):
        # The same shape as a continuous nudge and none of its pacing: there is
        # no time left to spend, because this is one turn and not a run.
        self.reply_to(
            "Go on from where you just were. He has not said anything; do not "
            "ask him to. One reply — take it a step further, and let it land.",
            hidden=True)

    def start_continuous(self, minutes: float, at_once: bool = False):
        """Let the pill keep going on its own for a while.

        Two ways in, and they want different things. A checkbox was a mode:
        tick it and nothing happens until the next reply ends, which is what
        "keep going" says. A Play key is an action: press it and the tape
        runs, now — waiting for something else to happen first is not what
        anybody means by Play. `at_once` is which of the two this is.

        Either way you stay in control: anything you say or type is an
        ordinary turn, and the loop waits for it to finish before continuing,
        so you can steer without stopping the session.
        """
        self.stop_continuous(silence=False)
        self._cont_hold = False
        minutes = max(1.0, min(120.0, float(minutes)))
        # A key that means "go" has to start the machine, the way typing
        # always has. Opening a conversation from yesterday loads nothing --
        # nothing here is up until something is asked of it -- so Play landed
        # on a cold stack, the loop below saw `running` false and ended before
        # it had produced a single turn. Pressing it did nothing at all, which
        # is the worst answer a key can give.
        if not self.running:
            self.emit("log", text="starting the models first …")
            self.start_stack()
        # A generation number: the previous loop can still be inside a reply
        # when we start a new one, and without this it wakes up, sees the run
        # active again and either doubles the turns or ends the new run.
        self._cont_gen += 1
        gen = self._cont_gen
        # Where the loop starts counting from. Marking the history here means
        # "after the next reply"; marking it at zero means "there is already
        # something on this tape, so go" — which is what a Play key is for.
        self._cont_from = 0 if at_once else len(self.history)
        self._cont_until = time.monotonic() + minutes * 60
        # Kept as well as the deadline: where the run is in itself is what
        # decides what it is told, and a deadline alone cannot say.
        self._cont_span = minutes * 60
        self._cont_stop.clear()
        self.emit("continuous", on=True, minutes=minutes)
        self.emit("log", text=(f"playing, {minutes:.0f} min of tape — talk any time to steer"
                               if at_once else
                               f"keep going, {minutes:.0f} min — the pill carries on "
                               f"after its next reply; talk any time to steer"))
        self._cont_thread = threading.Thread(target=self._continuous_loop,
                                             args=(gen,), daemon=True)
        self._cont_thread.start()

    def stop_continuous(self, silence: bool = False):
        """Stop producing new turns. The pill finishes the one it is on.

        Unticking the box means "no more after this", not "be quiet now" --
        cutting the pill off mid-sentence is what Stop and a new message are for,
        and both do their own silencing. Callers tearing the session down pass
        silence=True.
        """
        was_running = self._cont_until > 0.0
        self._cont_until = 0.0
        self._cont_hold = False
        self._cont_stop.set()
        if getattr(self, "_cont_thread", None) and self._cont_thread.is_alive():
            self._cont_thread.join(timeout=0.2)
        if silence and was_running:
            self.stop_reply.set()
            try:
                self.speaker.stop()      # drops the page's queue as well
            except Exception as e:
                LOG.say(f"speaker would not stop: {type(e).__name__}: {e}",
                        source="talk", level="debug")
        # Said out loud, because its opposite is: start_continuous always
        # writes "playing, N min of tape", and a run that ended left no line
        # anywhere. A Play press arriving while the page thinks a tape is
        # running is sent as a stop -- so the console showed nothing at the
        # exact moment somebody was asking why nothing had happened.
        if was_running:
            self.emit("log", text="tape stopped")
        self.emit("continuous", on=False, minutes=0)

    def hold_continuous(self, on: bool) -> bool:
        """Hold a run where it is, or let it go on.

        Pausing the voice has to pause the run behind it. The tape is a clock
        on the wall and the loop paces itself on how much is left to be heard
        — and what it is told about that is what the page has queued, aged by
        however long ago the page said so, because audio in a browser drains
        whether anybody asks it to or not. A paused page therefore reads as an
        emptying one, and the machine writes ahead into a silence that is not
        coming: dose spent, six more turns waiting, none of them heard.

        So the clock stops too. What is left is kept and handed back when it
        goes on, which is the only version of a pause anybody means when they
        press it because somebody walked into the room.
        """
        if on:
            if self._cont_until <= 0 or self._cont_hold:
                return False
            self._cont_saved = max(0.0, self._cont_until - time.monotonic())
            self._cont_hold = True
        else:
            if not self._cont_hold:
                return False
            self._cont_hold = False
            self._cont_until = time.monotonic() + self._cont_saved
        self.emit("continuous", on=True, minutes=self.continuous_left() / 60)
        return True

    def continuous_left(self) -> float:
        if self._cont_hold:
            return self._cont_saved            # the clock is stopped
        return max(0.0, self._cont_until - time.monotonic())

    def _continuous_loop(self, gen: int):
        turns = 0
        pace = 0.0        # seconds a turn has been taking, lately
        began = 0.0
        while (not self._cont_stop.is_set() and self.continuous_left() > 0
               and gen == self._cont_gen):
            # Nothing has been said since you ticked it. Keep going is not a
            # way to make the pill speak first; it is a promise about what happens
            # once it has spoken.
            if len(self.history) <= self._cont_from:
                time.sleep(0.2)
                continue
            # Somebody has said something and has not been answered yet. The
            # nudge below tells the pill "he has not said anything" -- which
            # was true when it was written and is a lie the moment you type,
            # and the model believes it: the reply that came back carried on
            # with its own evening and read as though you had not spoken. Your
            # line is answered by the ordinary path, as a turn; this waits.
            if self.history and self.history[-1].get("role") == "user":
                time.sleep(0.15)
                continue
            # Yield to the person: their turn is an ordinary one, and we wait
            # for it rather than talking over it.
            if self._cont_hold:
                time.sleep(0.2)                # held: no more turns until it goes on
                continue
            if self._replying.locked():
                time.sleep(0.1)
                continue
            # Start the next turn while there is still enough audio queued to
            # cover generating it, so the two overlap instead of alternating.
            lead = max(1.5, min(8.0, self._gen_secs * 1.3))
            if self.speaker.remaining_s > lead:
                time.sleep(0.1)
                continue
            if not self.running:
                # Coming up, most likely, because this run started it. Wait
                # for it -- but only while something is actually starting, or
                # a stack that failed to load would spin here in silence for
                # the length of the tape.
                if self._boot and self._boot.is_alive():
                    time.sleep(0.2)
                    continue
                break
            left = self.continuous_left()
            if left <= 0:
                break
            span = self._cont_span or left
            spent = max(0.0, min(1.0, 1 - left / span))
            # Whether there is room for another turn after this one. Measured
            # rather than guessed: a turn is however long the last few took,
            # which depends on the model, the machine and how much the pill has
            # to say. Without this a short dose stops mid-push.
            last = pace > 0 and left <= pace * 1.25
            nudge = self.continuous_nudge(spent, turns, last=last)
            turns += 1
            began = time.monotonic()
            try:
                self.reply_to(nudge, hidden=True)
            except Exception as e:
                self.emit("log", level="error", text=f"continuous stopped: {e}")
                break
            # What that cost, so the next turn knows whether it is the last one.
            spent_s = time.monotonic() - began
            pace = spent_s if pace == 0 else pace * 0.6 + spent_s * 0.4
            # A turn that produced nothing means something is wrong rather
            # than that the pill had nothing to say -- most often a language
            # model that has gone. Without this the loop simply asked again a
            # third of a second later, and a dead model turned into six
            # hundred identical lines in the console in four minutes.
            if not (self.history and self.history[-1].get("role") == "assistant"):
                for _ in range(30):
                    if self._cont_stop.is_set():
                        break
                    time.sleep(0.1)
            # a short breath, interruptible; the real spacing comes from the
            # audio still in the queue
            for _ in range(3):
                if self._cont_stop.is_set():
                    break
                time.sleep(0.1)
        if gen != self._cont_gen:
            return                      # superseded; the new run owns the state
        if not self._cont_stop.is_set():
            self.emit("log", text="continuous session finished")
        self._cont_until = 0.0
        self.emit("continuous", on=False, minutes=0)

    def _window(self):
        """The recent messages to send, bounded by both count and size.

        context_turns alone counts messages, not their length, and a pill's vary
        from a few words to nearly two hundred -- so the prompt, and with it
        time-to-first-token, swung by roughly 5x depending on how talkative the pill
        had been. context_words puts a ceiling on that. The last exchange is
        always kept, however long it is.

        ---- and this is the one place that throws the prompt cache away ----

        mlx_lm keeps the prompts it has already processed and re-uses the
        longest matching prefix — see LLMServer.args, where the cache is sized,
        and the measurement there: 3.4s to first token against 1.6s. That is
        live, now, not a thing to plan for.

        A cache is a bet on the *prefix* holding still, and everything else in
        this prompt is built to hold it still. The persona and the memory block
        sit in the system prompt and change a handful of times an evening. The
        relation is quantised into bands, so the words only move when a band
        boundary is crossed. The scene and the conduct are pressed onto the
        *last* user turn rather than the front (see _scene_press). All of that
        is deliberate and all of it is worth keeping.

        This slides, and undoes it. `history[-turns:]` moves its start forward
        by one exchange every exchange, so once a conversation outgrows the
        window every turn changes the first token of the prompt and the cache
        matches nothing — at exactly the length where it was paying for itself.
        The word budget below trims from the same end and does the same thing.

        Measured over twelve turns at the settings in config.json: the first
        six cache 21–42 new tokens each, the seventh misses entirely (976
        tokens, 2.6s), and every turn after it is pinned to the system prompt —
        150 new tokens, 0.80s, against 0.58s. Short evenings never notice; long
        ones look like the model being slow rather than like a bug.

        Two ways out, and the second is already built:

          * cut in chunks. Let the window overrun and then drop several
            exchanges at once, so the prefix survives many turns between cuts
            and one turn in six pays for a miss instead of all of them.

          * or lean on the fold. _maybe_fold already moves what falls out of
            the window into long-term memory; a tail that only grows, re-cut
            when a fold happens and not otherwise, is a prefix that changes
            rarely and by design.

        Whichever, the thing to preserve is the shape, not the numbers: stable
        in front, append-only in the middle, volatile pressed onto the end.
        """
        turns = int(self.cfg["llm"].get("context_turns", 12)) * 2
        recent = self.history[-turns:]
        budget = int(self.cfg["llm"].get("context_words", 0))
        if budget <= 0:
            return recent
        kept, used = [], 0
        for msg in reversed(recent):
            n = len(msg.get("content", "").split())
            if kept and used + n > budget:
                break
            kept.append(msg)
            used += n
        return list(reversed(kept))

    def _apply_input_mode(self):
        """Push the remembered choice onto the mic.

        Setting it once was not enough: chosen before Start it was ANDed with
        running and lost, and stop_all builds a fresh Mic whose enabled
        defaults to True, so "typing only" came back live.

        No device is opened here or anywhere: the page captures and feeds us —
        see audio.Mic, which explains why this process must never hold a
        microphone of its own.
        """
        want = (self.input_mode == "mic") and self.running
        self.mic.enabled = want
        # The last word on barging, not a fresh True: this runs on every
        # input_mode message and on every boot, and the mic under it may be a
        # new one that defaults to barging. See set_barge.
        self.mic.barge_in = self._barge_want
        if want:
            self.mic.start()
        else:
            self.mic.close()

    def set_barge(self, on: bool, chosen: bool = False) -> bool:
        """Whether talking over the pill stops it.

        Two things want a say. The page reports what its microphone actually
        granted, and where there is no echo cancellation the pill is the
        loudest thing in the room and barge-in hears it — so the page turns it
        off by itself. And somebody can say so at the console, because a
        browser that reports cancellation is not always doing any.

        A choice wins, and keeps winning. The page re-reads its microphone
        every time it is opened, so without this the answer to /mic_barge off
        was another /mic_barge off, and then another the next time Talk was
        pressed: the setting undone twenty seconds after it was made, by a
        machine agreeing with itself.

        And the answer is kept rather than only applied, because the mic it is
        applied to does not last: stop_all builds a fresh one, and every fresh
        one barges. Told "this browser cancels no echo", the machine agreed,
        turned barge-in off, and turned it back on one second later when the
        mic came up -- a page reporting the truth and being overruled by a
        default.
        """
        if chosen:
            self._barge_chosen = True
        elif self._barge_chosen:
            return self.mic.barge_in        # asked, and already answered
        self._barge_want = bool(on)
        self.mic.barge_in = self._barge_want
        return self.mic.barge_in

    def set_input_mode(self, mode: str):
        """Two ways to talk to the pill: typing, or the mic as well.

        A live mic wants barge-in, because stopping the pill by talking over
        it is what a live mic is for. That is a default and not a verdict:
        where the browser cancels no echo the pill hears itself, so the page
        and the console can both say otherwise, and what they say outlives
        this. See set_barge.
        """
        mode = "mic" if str(mode).lower().startswith("m") else "type"
        self.input_mode = mode
        self._apply_input_mode()
        # Asking for the microphone is asking to talk, so bring the stack up
        # rather than sitting there with a live mic and nothing behind it.
        # _apply_input_mode runs again at the end of the boot, so the choice
        # made now is the one that takes effect then.
        if mode == "mic" and not self.running:
            self.emit("log", text="starting the models first …")
            self.start_stack()
        self.emit("input_mode", mode=mode)
        self.emit("log", text="mic is live" if mode == "mic" else "typing only — mic is off")

    def silence(self) -> int:
        """Stop what is speaking, and cancel what is waiting to speak.

        Returns the new generation. A queued replay compares it with the one it
        started with: if the floor has been taken since, it never begins. Stop
        used to kill exactly one queued line, because the next one along woke
        up, cleared the stop flag and carried on.
        """
        self._speech_gen += 1
        self.stop_reply.set()
        try:
            self.speaker.stop()
        except Exception as e:
            LOG.say(f"speaker would not stop: {type(e).__name__}: {e}",
                    source="talk", level="debug")
        return self._speech_gen

    def steer(self) -> bool:
        """You said something while the pill was carrying the evening.

        Not an interruption and not nothing, which were the only two things
        this could do before. During a run, talking over the pill did nothing
        at all: it finished its line, and then the loop asked it to carry on
        being told, in so many words, that you had not spoken -- so the next
        reply arrived with its own agenda and read as though you were not in
        the room.

        So it lets the line it is on land, drops the rest of what was queued,
        and stops generating more. What comes next is the answer to you, which
        is the ordinary reply your words already asked for.
        """
        self.stop_reply.set()          # no further chunks of this reply
        try:
            self.speaker.stop(soft=True)
        except Exception as e:
            LOG.say(f"speaker would not settle: {type(e).__name__}: {e}",
                    source="talk", level="debug")
        return True

    def cut_in(self):
        """A new message takes the floor — unless the pill is running a scene.

        Talking over the pill should stop it, the way it would with a person. In
        continuous mode the pill is carrying the session itself and what you say is
        a steer, not an interruption, so it finishes the beat it is on and
        works it in from the next one.
        """
        # Held is paused, not carrying the session: nothing is talking, so
        # typing takes the floor the way it would with nothing running.
        if self.continuous_left() > 0 and not self._cont_hold:
            return self.steer()
        self.silence()
        return True

    def delete_turn(self, role: str, text: str) -> bool:
        """Take a turn back: out of the context, out of the transcript.

        What it cannot reach is memory — anything already folded into
        memory/<persona>.md was written from this turn and stays there. Edit
        that by hand if the point was to make the pill forget.
        """
        want = (text or "").strip()
        if not want:
            return False
        for i in range(len(self.history) - 1, -1, -1):
            m = self.history[i]
            if m["role"] == role and (m.get("content") or "").strip() == want:
                self.history.pop(i)
                if i < self.folded_upto:
                    self.folded_upto -= 1     # keep the fold pointing where it was
                self.store.remove(role, want)
                self.emit("log", text="deleted a turn")
                return True
        return False

    def speak_again(self, text: str):
        """Say a line again, because the mic cut it off or you missed it.

        Not a turn: nothing is written to the transcript, no memory is folded,
        and where you stand with the pill does not move. It waits for a reply in
        flight rather than talking over it.
        """
        text = (text or "").strip()
        if not text:
            return
        if not self.running:
            # Cold. Everything else that asks for a voice starts the machine
            # and is answered when it is up -- typing, a press in the room,
            # Skip -- and this is the one that did not. Which is the shape of
            # an evening somebody actually has: come back to an old
            # conversation, scroll up, find the line you liked, press it. The
            # models are not up yet, because nothing has asked them to be, and
            # the key that just asked was the only one that did not count.
            self.emit("log", text="starting the models first …")
            self._then_again = text
            self.start_stack()
            return
        # Pressing play takes the floor from whatever is on it, including an
        # earlier replay: the second one you click is the one you want.
        gen = self.silence()
        with self._replying:
            if gen != self._speech_gen:
                return              # silenced, or superseded, while queued
            self.stop_reply.clear()
            self.state = "speaking"
            self.emit("state", state="speaking")
            self.speaker.hold(True)
            try:
                for chunk in M.split_for_speech(text):
                    if self.stop_reply.is_set():
                        break
                    for samples, rate in self.voice.speak(chunk):
                        if self.stop_reply.is_set():
                            break
                        self.speaker.play(samples, rate)
            except Exception as e:
                self.emit("log", level="warn", text=f"replay failed: {e}")
            self.speaker.hold(False)     # the queue is the page's now
            while self.speaker.playing and not self.stop_reply.is_set():
                time.sleep(0.1)
        self.state = "idle"
        self.emit("state", state="idle")

    # ---------- hands ----------
    #
    # A press on something in the room is a turn like any other. It arrives as
    # one plain line naming what was touched — "(he pushes the books off the
    # ledge; they fall into the dark)" — written by the room, because the room
    # is the only part of this that knows a book from a cushion.
    #
    # They pool rather than queue. Pressing is instant and a reply is not, so
    # one turn per press would be five replies talking over each other. While
    # the pill is speaking, whatever hands do is gathered and handed over at
    # the next turn; in the quiet, a short settle lets a flurry of presses
    # arrive as one thing done rather than four.

    HANDS_SETTLE = 1.3          # seconds of no further pressing before a turn

    def did(self, line: str):
        """The room reporting that a hand has been put to something."""
        line = (line or "").strip()
        if not line:
            return
        self.touch()
        # A dose that is playing is not asking to be poked. Somebody who set a
        # scene and pressed Play is lying back for a quarter of an hour, and a
        # hand brushing the screen should not take the floor away from the pill
        # mid-sentence -- the room stays a room, and the press is scenery. The
        # cost is that a cushion knocked over during a run is never remarked
        # on, which is the right way round: an evening that cannot be
        # interrupted by accident is worth more than a noticed cushion.
        if self.continuous_left() > 0:
            return
        with self._hands_lock:
            if len(self._hands) < 12:            # a flurry, not a drum solo
                self._hands.append(line)
        # Nothing is shown yet on purpose. The room has already answered the
        # press — the book moved — and the line belongs in the conversation at
        # the moment it becomes a turn, not a second and a half before it.
        if not self.running:
            # Typing at a cold machine starts it; so does touching something.
            # It loads the recognizer too, which an evening spent entirely on
            # the room will never use — the parts of the stack want starting
            # one at a time, and that is a job of its own.
            self.emit("log", text="starting the models first …")
            self.start_stack()
            return
        # Outside a run, a press takes the floor the way speaking does. It used
        # to wait for the quiet instead, on the reasoning that answering while
        # she talks is talking over her -- true, and it assumed the wait was a
        # second and a half. Replies now run forty seconds and more, so the
        # press landed a topic late, arrived out of order in the transcript,
        # and read as the room having ignored it. Whoever is pressing things
        # while it speaks is exploring the room rather than listening to the
        # answer, and wants to be answered now: the same trade the microphone
        # already makes, and the same machinery -- see silence(), which stops
        # what is speaking and drops what is queued behind it.
        if self.speaking():
            self.silence()
        self._hands_soon()

    def speaking(self) -> bool:
        """Is a voice actually coming out of the speaker right now?

        Not the same question as "is a turn in progress": a reply spends its
        first seconds being written, and a press made in that window is picked
        up by take_hands and goes in with the turn it interrupted, which is
        better than taking the floor from a turn that has not used it yet. This
        is only about sound, because sound is the thing a press would talk over.
        """
        try:
            return float(getattr(self.speaker, "remaining_s", 0) or 0) > .35
        except Exception:
            return False

    def _hands_soon(self):
        """Come back to what hands have done, once there is a gap to do it in.

        Armed by a press, and again at the end of every reply — which is the
        half that was missing. Presses made while the pill was speaking pooled
        correctly and then sat there: nothing looked at the pool again until
        somebody pressed something *else*, so four things done ten minutes
        apart arrived together, and in between it read as being ignored. A
        press made during a reply should be answered when the reply is over,
        which is when a person would answer it.
        """
        with self._hands_lock:
            if not self._hands:
                return
            if self._hands_timer:
                self._hands_timer.cancel()
            self._hands_timer = threading.Timer(self.HANDS_SETTLE, self._hands_turn)
            self._hands_timer.daemon = True
            self._hands_timer.start()

    # What a run of the same press reads as. Pressing one thing four times is
    # not four things: sent as four identical sentences it came out as a wall
    # of copy-paste, which is a strange thing for a person to hand somebody in
    # the middle of a conversation.
    AGAIN = {2: "(and again)", 3: "(and again, twice more)"}

    def take_hands(self) -> str:
        """Everything hands have done since anybody last looked.

        In order, with runs of the same thing collapsed — because that is what
        it was: one thing, done a few times over.
        """
        with self._hands_lock:
            if self._hands_timer:
                self._hands_timer.cancel()
                self._hands_timer = None
            done, self._hands[:] = list(self._hands), []
        out, i = [], 0
        while i < len(done):
            n = 1
            while i + n < len(done) and done[i + n] == done[i]:
                n += 1
            out.append(done[i])
            if n > 1:
                out.append(self.AGAIN.get(n, "(and again, and again)"))
            i += n
        return " ".join(out)

    def _hands_turn(self):
        """Answer what hands have done, if this is a moment to.

        Still writing, or still being heard? Then it is not: come back
        shortly. "When it has finished" means the voice has, not the words —
        a turn that lands while the last sentence is still coming out of the
        speaker is a turn talking over it.
        """
        if not self.running:
            return
        try:
            waiting = float(getattr(self.speaker, "remaining_s", 0) or 0)
        except Exception:
            waiting = 0.0
        if self._replying.locked() or waiting > .35:
            self._hands_soon()
            return
        text = self.take_hands()
        if not text:
            return
        self.emit("user", text=text, seconds=0)
        threading.Thread(target=self.reply_to, args=(text,), daemon=True).start()

    def warm_prompt(self):
        """Send the prompt through once with nothing to say.

        The room is open, the models are up, and nobody has spoken yet — which
        is the one moment in an evening when the machine is idle and the next
        thing it will be asked is already known. Everything in front of the
        first turn is the same as everything in front of this one: the persona,
        the memories, the relation, the conversation so far. Pushing it through
        now leaves its prefill in mlx_lm's cache, so the first thing somebody
        says is priced as an append rather than as a whole prompt.

        Three guards, and each one is a way this could cost rather than save:

          * Only when idle, and only if no turn holds the floor. A warm that
            overlaps a real turn queues in front of it at the model server, and
            the person waiting would be waiting on machinery they did not ask
            for.
          * Only once per prefix. Rooms are opened and re-opened — a reload, a
            reconnect, a phone waking — and each of those would otherwise pay
            for a prefill that is already cached.
          * Never louder than nothing. No transcript, no memory, no state, and
            failures die here: this is an optimisation, and an optimisation
            that can break an evening is not one.
        """
        if not self.running or not self.cfg.get("warm_on_open", True):
            return
        if self.state != "idle":
            return
        persona = self._live_persona()
        system = (P.system_prompt(persona) + self._memory_block()
                  + self._relation_block())
        messages = self._scene_press(self._state_press(self._unstick(self._window())))
        mark = hash((system, repr(messages)))
        if mark == self._warmed:
            return
        # Non-blocking: if a turn has the floor there is nothing to warm for,
        # and waiting for it would put this behind the very thing it exists to
        # make faster.
        if not self._replying.acquire(blocking=False):
            return
        try:
            if self.llm.warm(messages, system=system):
                self._warmed = mark
        finally:
            self._replying.release()

    def warm_voice(self):
        """Wake the voice up, so the first sentence is not the one that pays.

        The other half of the same head start. What the pill will say cannot be
        known, but what it costs to say the *first* thing is fixed and has
        nothing to do with the words: see Voice.warm. Per voice rather than per
        prompt, so it is owed again after a pill switch and not otherwise.

        Held apart from the prompt warm rather than done in one lock: together
        they are about two seconds, and somebody who types the moment they
        arrive should wait for at most one of them.
        """
        if not self.running or not self.cfg.get("warm_on_open", True):
            return
        if self.state != "idle":
            return
        ref = P.voice_ref(self.persona)
        mark = (self.persona.get("slug"), str(ref or ""))
        if mark == self._warmed_voice:
            return
        if not self._replying.acquire(blocking=False):
            return
        try:
            if self.voice.warm():
                self._warmed_voice = mark
        finally:
            self._replying.release()

    def warm_scene(self):
        """Push the scene writer's prompt through too, for the same reason.

        The note taken from his opening turn is the first thing an evening
        waits on, and it is a second prompt with a second system message --
        so warm_prompt does nothing for it, and it pays a full prefill of
        scene_system.md while somebody watches. mlx_lm keeps an LRU of
        sequences rather than one prefix (LRUPromptCache in its server), so
        this one can sit in the cache beside the conversation's without either
        evicting the other.

        The body is the same shape the real call will send and never the same
        text, which is all the cache needs: what is being bought is the front
        of it, and the front is the system message.
        """
        if not self.running or not self.cfg.get("warm_on_open", True):
            return
        if self.state != "idle":
            return
        if not (self.cfg.get("scene", {}) or {}).get("enabled", True):
            return
        if not self._replying.acquire(blocking=False):
            return
        try:
            self.llm.warm(
                [{"role": "user", "content": prompts.get("scene_user").format(
                    heading=SC.GUESS, ask=SC.ASK_PLACE,
                    previous=self.scene or "(nothing yet — this is the start)",
                    recent="he: ")}],
                system=prompts.get("scene_system"))
        finally:
            self._replying.release()

    def warm_later(self):
        """Both warms, in the order the first turn needs them, off this thread.

        The prompt first: it is the shorter of them and the one the first token
        waits on. Then the scene writer's, which the first turn now waits on
        ahead of the reply. The voice last, because nothing can be spoken until
        there are words to speak anyway.
        """
        if not self.running or not self.cfg.get("warm_on_open", True):
            return

        def both():
            # Nothing here is worth an exception. A warm that fails costs the
            # turn after it a second; a warm that throws takes a daemon thread
            # down with it and says so in a console somebody is reading for
            # real trouble.
            for step in (self.warm_prompt, self.warm_scene, self.warm_voice):
                try:
                    step()
                except Exception:
                    return

        threading.Thread(target=both, daemon=True).start()

    def reply_to(self, user_text: str, hidden: bool = False):
        """Generate and speak a reply.

        hidden=True prompts the model without recording a user turn — used by
        continuous mode, so the transcript stays a conversation rather than
        filling with machine-generated "keep going" lines.
        """
        # Whose turn this was meant to be. Anything that takes the floor while
        # we queue -- Stop, Skip, a cut-in -- moves the number on, and an
        # unprompted turn that wakes up behind one of those is no longer wanted:
        # five Skips in one breath should take one step, not five.
        gen = self._speech_gen
        # Take the floor first, then clear the flag. Clearing before the lock
        # would cancel the cut-in that was meant to stop the reply we are
        # waiting on, and it would carry on talking.
        self._replying.acquire()
        try:
            # Stop waits on this same lock before it unloads. A reply that
            # queued behind the last one and wakes up here would clear the stop
            # flag and speak, and speaking loads the models Stop just freed --
            # so the console says the RAM is back while it quietly returns.
            if not self.running:
                return
            if gen != self._speech_gen:
                if hidden:
                    return      # silenced, or superseded, while queued
                # Somebody's own words, and Stop pressed while they waited
                # their turn. Stop has to mean stop: with a long reply being
                # spoken and two things typed behind it, pressing it and then
                # hearing the machine work through the queue anyway is a key
                # that does not do what it says.
                #
                # But the words are not the answer to them, and they are the
                # part with nowhere else to live. So they go into the
                # transcript, where they were always going, and no reply is
                # made to them. Say it again and it is answered.
                self._keep_unanswered(user_text)
                return
            self.stop_reply.clear()
            self._reply(user_text, hidden)
        finally:
            self._replying.release()
            # Anything pressed while that was being said is owed an answer.
            self._hands_soon()

    def _keep_unanswered(self, user_text: str):
        """Write down what somebody said, without answering it."""
        text = (user_text or "").strip()
        if not text:
            return
        try:
            self.history.append({"role": "user", "content": text})
            self.store.append("user", text)
        except Exception as e:
            LOG.say(f"could not keep that line: {type(e).__name__}: {e}",
                    source="talk", level="warn")

    def _reply(self, user_text: str, hidden: bool):
        self.touch()
        started = time.monotonic()
        # Whatever was pressed while this turn was being got ready goes in with
        # it rather than waiting for one of its own — which is what makes
        # pressing during a reply feel like being noticed rather than queued.
        hands = self.take_hands()
        extra = []
        if hidden:
            # A nudge is machinery and stays out of the transcript; hands are
            # not, and go in as the turn they are. So a run the pill is doing
            # on its own can still be interrupted by somebody quietly pushing
            # things off a shelf, and the record afterwards shows who did what.
            extra = [{"role": "user", "content": user_text}]
            if hands:
                self.history.append({"role": "user", "content": hands})
                self.store.append("user", hands)
                self.emit("user", text=hands, seconds=0)
        else:
            if hands and hands not in user_text:
                user_text = f"{user_text} {hands}".strip()
            self.history.append({"role": "user", "content": user_text})
            self.store.append("user", user_text)
            self._scene_opening()
        self.state = "thinking"
        self.emit("state", state="thinking")
        # Held from here, not from the first chunk: the sentences of a reply
        # arrive with gaps between them, and an unheld gap is a microphone
        # opening into the pill's next sentence. See BrowserSink.hold.
        self.speaker.hold(True)

        spoken: list[str] = []
        buffer = ""
        started_speaking = False

        def flush(final: bool):
            """Speak whole sentences as soon as they exist — no waiting for the full reply."""
            nonlocal buffer, started_speaking
            # Hurry only the opening, and only until something is playing.
            chunks = M.split_for_speech(buffer, first_short=not started_speaking)
            if not final and len(chunks) <= 1:
                return
            take = chunks if final else chunks[:-1]
            rest = "" if final else chunks[-1]
            for chunk in take:
                if self.stop_reply.is_set():
                    return
                if not started_speaking:
                    started_speaking = True
                    self.state = "speaking"
                    self.emit("state", state="speaking")
                if not chunk.strip():
                    continue
                spoken.append(chunk)
                try:
                    for samples, rate in self.voice.speak(chunk):
                        if self.stop_reply.is_set():
                            return
                        self.speaker.play(samples, rate)
                except Exception as e:
                    self.emit("log", level="warn", text=f"TTS failed: {e}")
            buffer = rest

        def on_delta(delta: str):
            nonlocal buffer
            self.emit("assistant_delta", text=delta)
            buffer += delta
            flush(final=False)

        persona = self._live_persona()
        messages = self._scene_press(
            self._state_press(self._unstick(self._window() + extra)))
        try:
            full = self.llm.stream_reply(
                messages, on_delta, self.stop_reply,
                system=(P.system_prompt(persona) + self._memory_block()
                        + self._relation_block()),
                temperature=persona.get("temperature"),
                top_p=persona.get("top_p"),
                max_tokens=persona.get("max_tokens"))
        except Exception as e:
            self._llm_trouble(e)
            self.speaker.hold(False)
            self.state = "idle"
            self.emit("state", state="idle")
            return

        if not self.stop_reply.is_set():
            flush(final=True)
        # Every sentence has been handed to the page, so there are no more gaps
        # to hold shut. What is left is the page playing what it has, which
        # remaining_s already knows about — and holding past this point would
        # keep the microphone shut for ever and the drain below spinning.
        self.speaker.hold(False)
        # Keep the model's own text, line breaks and all. Rejoining the speech
        # chunks with single spaces flattened every paragraph, so a reply that
        # streamed with breaks collapsed into a block the moment it finished.
        # An interrupted reply is the exception: only what was actually spoken
        # is true, and the rest was never heard.
        if self.stop_reply.is_set():
            # Cut from what the model wrote rather than rebuilt out of the
            # pieces it was spoken in — see M.spoken_prefix, which explains what
            # rebuilding costs a transcript.
            said = (M.spoken_prefix(full, spoken).strip()
                    or " ".join(spoken).strip())
        else:
            said = full.strip() or " ".join(spoken).strip()
        if not said.strip():
            # Cut off before a single token arrived: an empty turn would go
            # into the transcript and back to the model as context.
            self.state = "idle"
            self.emit("state", state="idle")
            return
        self.history.append({"role": "assistant", "content": said})
        self.store.append("assistant", said)
        self.emit("assistant_done", text=said)

        # One worker for everything that happens after a turn: the fold and
        # the judgement share an LLM, so they take their turn rather than
        # racing for it. Both run while the audio is still draining.
        threading.Thread(target=self._after_turn, args=(user_text, said, hidden),
                         daemon=True).start()

        # Hold "speaking" until the queue actually drains, so the VAD stays gated.
        # Continuous mode skips the wait: the speaker is a queue, so the next
        # turn can be generated while this one is still playing and its audio
        # lands behind it. Otherwise every gap is generation time end to end.
        # The mic gates on speaker.playing directly, so returning early here
        # does not open the VAD.
        if hidden:
            # Remember what this cost, so the next turn can be started early
            # enough to land before the audio runs out.
            self._gen_secs = 0.7 * self._gen_secs + 0.3 * (time.monotonic() - started)
            return
        while self.speaker.playing and not self.stop_reply.is_set():
            time.sleep(0.1)
        self.state = "idle"
        self.emit("state", state="idle")


