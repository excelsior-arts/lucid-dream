"""The machine's surface, with nothing loaded behind it.

Every model here is a stub. That is not a shortcut around a slow test — it is
the only way this can be a test at all: a real stack is a language model, a
recognizer and a voice, some twenty gigabytes of it, and a suite that loads
them is a suite nobody runs before a commit.

What is worth checking without them is the shape of the surface: the frames a
page has to be able to read, the samples going in at the rate the recognizer
wants, the credit each chunk of speech carries so text can be paced against a
voice, and above all that there is *one* stack. A second Voice is a second
Chatterbox and a second Parakeet, on a Mac whose floor is thirty-two
gigabytes, and nothing about that failure is visible in a unit test unless
somebody writes the one at the bottom of this file.
"""
import asyncio
import json
import threading
import time
import unittest
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import SCRATCH, clean
from machine import config as C
from machine import shelf as S
from machine import log as LOG
from machine import machine as MACHINE
from machine import models as M
from machine import voices as V


class FakeLLM:
    """A model server that answers instantly and remembers being asked."""

    server = "mlx_lm"
    model_path = "/models/pretend"
    log_path = Path("/nowhere/llm.log")

    def __init__(self, words=("one ", "two ", "three")):
        self.words = list(words)
        self.asked = []
        self.warmed = []
        self.started = self.stopped = 0
        self.up = True

    def ready(self):
        return self.up

    def start(self):
        # Started on whatever the config says now, the way a real one is built
        # from it: what the process serves is read back off this.
        self.model_path = (C.stack().get("llm") or {}).get("model") or self.model_path
        self.started += 1
        self.up = True

    def wait_ready(self, timeout=600):
        return self.up

    def stop(self):
        self.stopped += 1
        self.up = False

    def memory_mb(self):
        return 2048.0

    def warm(self, messages, system=None):
        self.warmed.append((messages, system))
        return True

    def stream_reply(self, messages, on_delta, stop_flag, system=None,
                     temperature=None, top_p=None, max_tokens=None):
        self.asked.append({"messages": messages, "system": system,
                           "temperature": temperature, "top_p": top_p,
                           "max_tokens": max_tokens})
        said = ""
        for word in self.words:
            if stop_flag.is_set():
                break
            said += word
            on_delta(word)
        return said.strip()


class HoldingLLM(FakeLLM):
    """One token, then it waits — a reply still being written."""

    def __init__(self):
        super().__init__()
        self.let_go = threading.Event()
        self.stopped_early = None

    def stream_reply(self, messages, on_delta, stop_flag, **kw):
        on_delta("one ")
        self.let_go.wait(2.0)
        self.stopped_early = stop_flag.is_set()
        return "one"


class FakeVoice:
    """Two frames a chunk, and a note of everything it was told to do."""

    def __init__(self, frames=2):
        self.stt = self.tts = None
        self.frames = frames
        self.stats = {"gen_s": 0.4, "audio_s": 1.0, "rtf": 0.4}
        self.heard = []
        self.spoke = []
        self.refs = []
        self.spoken_in = []
        self.loaded = []
        self.unloaded = 0
        self.dropped = []
        self.warmed = 0
        self.gate: threading.Event | None = None

    def load_stt(self):
        self.stt = "parakeet"
        self.loaded.append("stt")
        return True

    def load_tts(self):
        self.tts = "chatterbox"
        self.loaded.append("tts")
        return True

    def set_reference(self, ref):
        self.refs.append(Path(ref))
        return True

    def transcribe(self, audio):
        self.heard.append(np.asarray(audio))
        return "and what did you hear"

    def warm(self):
        self.warmed += 1
        return True

    def speak(self, text, ref_path=None):
        self.spoke.append(text)
        self.spoken_in.append(Path(ref_path) if ref_path else None)
        for n in range(self.frames):
            if n and self.gate is not None:
                self.gate.wait(2.0)
            yield np.zeros(240, dtype=np.float32), 24000

    def unload(self):
        self.stt = self.tts = None
        self.unloaded += 1

    def unload_stt(self):
        self.stt = None
        self.dropped.append("stt")

    def unload_tts(self):
        self.tts = None
        self.dropped.append("tts")

    def memory_mb(self):
        return 3072.0


class Clock:
    """Monotonic seconds, moved by hand.

    A grace is ninety seconds long and a test that waited them out would be a
    test nobody runs. Handed to the stack, so the counting is the real
    arithmetic against a clock the test decides.
    """

    def __init__(self):
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def on(self, seconds: float):
        self.t += seconds


def a_shelf(names=("purple", "gold"), where="voices") -> Path:
    """A shelf of clips somewhere of its own, and the config pointed at it.

    A directory rather than a stubbed lookup: the name in a chunk becomes a
    path, and what is worth checking is that it becomes *that* path and no
    other. The files hold nothing -- no test here loads a model, and the voice
    is stubbed above.

    Named through the config, and absolute, because that is the install
    `setup.sh --models DIR` makes: every asset on a disk of its own. The shelf
    used to be nailed to the checkout, so that install fetched the clips and
    then found none of them.
    """
    shelf = SCRATCH / "elsewhere" / where
    shelf.mkdir(parents=True, exist_ok=True)
    for name in names:
        (shelf / f"{name}.wav").write_bytes(b"")
    C.note(voices={"path": str(shelf)})
    return shelf


class Machine(unittest.TestCase):
    """One app carrying only the machine's routes."""

    def setUp(self):
        clean()
        self.llm, self.voice = FakeLLM(), FakeVoice()
        self.clock = Clock()
        self.was = MACHINE.set_stack(
            MACHINE.Stack(llm=self.llm, voice=self.voice, now=self.clock))
        self.addCleanup(MACHINE.set_stack, self.was)
        # A shelf of its own, so no test depends on which clips this checkout
        # happens to have downloaded.
        self.shelf = a_shelf()
        app = FastAPI()
        MACHINE.routes(app)
        self.client = TestClient(app)


class Chat(Machine):
    def frames(self, r):
        return [line[5:].strip() for line in r.text.splitlines()
                if line.startswith("data:")]

    def test_it_streams_the_frames_a_page_already_knows_how_to_read(self):
        r = self.client.post("/machine/chat", json={
            "messages": [{"role": "user", "content": "say something"}]})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("text/event-stream"))
        frames = self.frames(r)
        self.assertEqual(frames[-1], "[DONE]")
        said = "".join(json.loads(f)["choices"][0]["delta"]["content"]
                       for f in frames[:-1])
        self.assertEqual(said, "one two three")

    def test_the_callers_own_system_message_is_the_only_one(self):
        """The machine must not add a game's system prompt to somebody else's
        prompt — see models._fronted."""
        self.client.post("/machine/chat", json={
            "messages": [{"role": "system", "content": "be brief"},
                         {"role": "user", "content": "say something"}]})
        asked = self.llm.asked[-1]
        self.assertEqual(asked["system"], "be brief")
        self.assertEqual(asked["messages"],
                         [{"role": "user", "content": "say something"}])

    def test_and_none_at_all_means_none(self):
        self.client.post("/machine/chat", json={
            "messages": [{"role": "user", "content": "say something"}]})
        self.assertEqual(self.llm.asked[-1]["system"], "")

    def test_the_sampling_the_caller_asked_for_goes_through(self):
        self.client.post("/machine/chat", json={
            "messages": [{"role": "user", "content": "x"}],
            "temperature": 0.2, "top_p": 0.5, "max_tokens": 40})
        asked = self.llm.asked[-1]
        self.assertEqual((asked["temperature"], asked["top_p"],
                          asked["max_tokens"]), (0.2, 0.5, 40))

    def test_a_model_already_up_lights_the_lamp(self):
        """It may have been started by somebody else and adopted, in which case
        nothing here has ever said it is up — and the console shows three
        lamps off next to a conversation that is working."""
        self.assertEqual(MACHINE.stack().status["llm"], "off")
        self.client.post("/machine/chat", json={
            "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(MACHINE.stack().status["llm"], "ready")
        self.assertEqual(self.llm.started, 0, "it was started twice")

    def test_a_cold_model_is_started_rather_than_refused(self):
        self.llm.up = False
        r = self.client.post("/machine/chat", json={
            "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.llm.started, 1)
        self.assertEqual(MACHINE.stack().status["llm"], "ready")

    def test_a_body_that_is_not_a_bag_of_keys_is_the_callers_bug(self):
        """A list, a number, a string, nothing at all: every one of those came
        back as a 500 out of the first `.get` on something that has none, which
        says the machine is broken about a request that simply is not one."""
        for bad in ([{"role": "user"}], "say something", 7, None):
            with self.subTest(body=bad):
                r = self.client.post("/machine/chat", json=bad)
                self.assertEqual(r.status_code, 400)
                self.assertIn("error", r.json())
        self.assertFalse(self.llm.asked)

    def test_and_one_that_will_not_come_is_a_503(self):
        self.llm.up = False
        self.llm.start = lambda: None          # it never comes up
        r = self.client.post("/machine/chat", json={
            "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(r.status_code, 503)
        self.assertIn("error", r.json())


class APageThatGoesAway(unittest.IsolatedAsyncioTestCase):
    """A tab closed mid-reply. Nothing is listening, so nothing is written."""

    def setUp(self):
        clean()
        self.llm = HoldingLLM()
        self.was = MACHINE.set_stack(MACHINE.Stack(llm=self.llm, voice=FakeVoice()))
        self.addCleanup(MACHINE.set_stack, self.was)

    async def test_closing_the_stream_stops_the_generation(self):
        stop = threading.Event()
        frames = MACHINE.chat_frames(
            {"messages": [{"role": "user", "content": "x"}]}, stop)
        first = await frames.__anext__()
        self.assertIn("one ", first)
        await frames.aclose()
        self.assertTrue(stop.is_set(), "the model was left writing to nobody")
        self.llm.let_go.set()
        for _ in range(100):
            if self.llm.stopped_early is not None:
                break
            await asyncio.sleep(0.01)
        self.assertTrue(self.llm.stopped_early,
                        "the flag was set and the model never read it")


class Transcribing(Machine):
    def test_int16_comes_back_as_words(self):
        raw = (np.zeros(1600, dtype=np.int16) + 1000).tobytes()
        r = self.client.post("/machine/stt", content=raw,
                             headers={"content-type": "application/octet-stream"})
        self.assertEqual(r.json()["text"], "and what did you hear")
        heard = self.voice.heard[-1]
        self.assertEqual(heard.size, 1600)
        self.assertAlmostEqual(float(heard[0]), 1000 / 32768.0, places=5)

    def test_and_forty_eight_thousand_is_resampled_to_sixteen(self):
        """The recognizer is trained at 16k and a page captures at whatever
        its browser felt like. Sending 48k unresampled transcribes a voice
        three times too fast, which comes back as words but not as yours."""
        raw = np.zeros(4800, dtype=np.int16).tobytes()
        self.client.post("/machine/stt?rate=48000", content=raw)
        self.assertEqual(self.voice.heard[-1].size, 1600)

    def test_nothing_at_all_is_nothing_said(self):
        r = self.client.post("/machine/stt", content=b"")
        self.assertEqual(r.json(), {"text": ""})
        self.assertFalse(self.voice.heard)

    def test_the_recognizer_loads_on_demand(self):
        self.client.post("/machine/stt", content=np.zeros(1600, np.int16).tobytes())
        self.assertIn("stt", self.voice.loaded)
        self.assertEqual(MACHINE.stack().status["stt"], "ready")


class Speaking(Machine):
    def chunk(self, ws, text, voice="purple", ends_paragraph=False):
        ws.send_json({"text": text, "voice": voice,
                      "ends_paragraph": ends_paragraph})
        out = []
        while True:
            got = ws.receive_json()
            out.append(got)
            if got.get("done") or got.get("error"):
                return out

    def test_a_chunk_comes_back_as_frames_and_a_done(self):
        with self.client.websocket_connect("/machine/tts") as ws:
            got = self.chunk(ws, "hello there")
        self.assertEqual(len(got), 3)
        self.assertEqual(got[0]["rate"], 24000)
        self.assertTrue(got[0]["pcm"])
        self.assertEqual(got[-1]["stats"], self.voice.stats)

    def test_the_credit_is_on_the_first_frame_only(self):
        """It is what the chunk covered as *written* — the page paces its text
        against the voice, and a second frame carrying it again would run the
        text out ahead of the sound."""
        with self.client.websocket_connect("/machine/tts") as ws:
            got = self.chunk(ws, "hello there")
        self.assertEqual(got[0]["chars"], len("hello there") + 1)
        self.assertEqual(got[1]["chars"], 0)

    def test_a_paragraph_is_marked_the_way_the_voice_reads_it(self):
        with self.client.websocket_connect("/machine/tts") as ws:
            self.chunk(ws, "the end of a thought", ends_paragraph=True)
            self.chunk(ws, "and the next one")
        self.assertEqual(self.voice.spoke, ["the end of a thought\n",
                                            "and the next one"])

    def test_every_chunk_carries_its_own_clip(self):
        """Nothing is set on the model between calls. Two rooms speak through
        one model, taking turns on its thread; a clip set on the model by one
        and read from it by the other put Gold's words in Purple's voice."""
        with self.client.websocket_connect("/machine/tts") as ws:
            self.chunk(ws, "one", voice="purple")
            self.chunk(ws, "two", voice="purple")
            self.chunk(ws, "three", voice="gold")
        self.assertEqual(self.voice.refs, [])
        self.assertEqual(self.voice.spoken_in, [self.shelf / "purple.wav",
                                                self.shelf / "purple.wav",
                                                self.shelf / "gold.wav"])

    def test_two_rooms_taking_turns_each_keep_their_voice(self):
        with self.client.websocket_connect("/machine/tts") as purple, \
             self.client.websocket_connect("/machine/tts") as gold:
            self.chunk(purple, "one", voice="purple")
            self.chunk(gold, "two", voice="gold")
            self.chunk(purple, "three", voice="purple")
            self.chunk(gold, "four", voice="gold")
        self.assertEqual([r.stem for r in self.voice.spoken_in],
                         ["purple", "gold", "purple", "gold"])

    def test_a_voice_that_is_not_on_the_shelf_is_refused(self):
        """Rather than spoken in whichever clip was loaded last, which is a
        pill that sounds like the previous person and cannot be debugged by
        ear."""
        with self.client.websocket_connect("/machine/tts") as ws:
            got = self.chunk(ws, "one", voice="nobody")
        self.assertEqual(self.voice.refs, [])
        self.assertIn("no voice named", got[-1]["error"])
        self.assertFalse(self.voice.spoke)

    def test_and_so_is_a_chunk_that_names_nobody(self):
        with self.client.websocket_connect("/machine/tts") as ws:
            got = self.chunk(ws, "one", voice="")
        self.assertIn("no voice named", got[-1]["error"])

    def test_a_name_cannot_climb_off_the_shelf(self):
        for bad in ("../../etc/passwd", "..", "purple/../gold"):
            with self.client.websocket_connect("/machine/tts") as ws:
                got = self.chunk(ws, "one", voice=bad)
            self.assertIn("no voice named", got[-1]["error"], bad)

    def test_the_shelf_says_what_it_has(self):
        got = self.client.get("/machine/voices")
        self.assertEqual(got.json(), {"voices": ["gold", "purple"]})

    def test_stop_abandons_the_rest_of_the_chunk(self):
        self.voice.frames = 4
        self.voice.gate = threading.Event()
        with self.client.websocket_connect("/machine/tts") as ws:
            ws.send_json({"text": "a long line", "voice": "purple"})
            first = ws.receive_json()
            self.assertIn("pcm", first)
            ws.send_json({"stop": True})
            time.sleep(0.1)              # let the socket's reader hear it
            self.voice.gate.set()        # and the voice go on making frames
            rest = []
            while True:
                got = ws.receive_json()
                rest.append(got)
                if got.get("done"):
                    break
        self.assertLess(len(rest), 4, "the frames nobody wanted were sent anyway")

    def test_every_frame_says_which_chunk_it_is_about(self):
        """The page's own name for a chunk, back on everything about it.

        Without it a stopped chunk's late `done` -- which arrives after the
        page has moved on, because the clip is finished rather than abandoned
        -- ended whatever was speaking by then, which was the first sentence
        of the next reply.
        """
        with self.client.websocket_connect("/machine/tts") as ws:
            ws.send_json({"text": "hello there", "voice": "purple", "id": "c7"})
            got = []
            while True:
                got.append(ws.receive_json())
                if got[-1].get("done"):
                    break
        self.assertEqual([m.get("id") for m in got], ["c7"] * len(got))
        self.assertTrue(got[0]["pcm"])

    def test_a_refusal_carries_the_name_too(self):
        with self.client.websocket_connect("/machine/tts") as ws:
            ws.send_json({"text": "one", "voice": "nobody", "id": "c1"})
            got = ws.receive_json()
        self.assertEqual(got["id"], "c1")
        self.assertEqual(got["refused"], "voice")

    def test_a_chunk_queued_behind_a_stop_is_not_started(self):
        """A stop reaches what is already waiting as well as what is in hand.

        The page sends the sentences of a reply one after another; when that
        reply is cut off, the ones already on the wire were asked for by a
        turn nobody wants any more. Answered, so the page's chunk ends, and
        not spoken. Anything sent after the stop is the next reply, and is.
        """
        self.voice.frames = 4
        self.voice.gate = threading.Event()
        with self.client.websocket_connect("/machine/tts") as ws:
            ws.send_json({"text": "a long line", "voice": "purple", "id": "a"})
            self.assertEqual(ws.receive_json()["id"], "a")
            ws.send_json({"text": "the next sentence", "voice": "purple", "id": "b"})
            ws.send_json({"stop": True})
            time.sleep(0.1)              # let the socket's reader hear it
            self.voice.gate.set()
            ws.send_json({"text": "a new reply", "voice": "purple", "id": "c"})
            done = []
            while len(done) < 3:
                got = ws.receive_json()
                if got.get("done"):
                    done.append(got["id"])
        self.assertEqual(done, ["a", "b", "c"])
        self.assertEqual(self.voice.spoke, ["a long line", "a new reply"])

    def test_the_voice_loads_on_demand(self):
        with self.client.websocket_connect("/machine/tts") as ws:
            self.chunk(ws, "hello")
        self.assertIn("tts", self.voice.loaded)


class TheShelfIsWhereTheModelsAre(Machine):
    """`setup.sh --models DIR` moves every asset, and the clips are assets.

    The shelf used to be `<checkout>/models/voices` whatever the config said,
    so that install fetched all of it, wrote four paths nobody could fault,
    and then refused every persona's voice by name at the moment a character
    first tried to speak -- an advertised setup path that fails an hour in.
    """

    def test_a_clip_under_a_model_root_of_its_own_is_on_the_shelf(self):
        self.assertEqual(V.names(), ["gold", "purple"])
        self.assertEqual(self.client.get("/machine/voices").json(),
                         {"voices": ["gold", "purple"]})

    def test_and_the_name_resolves_to_the_file_under_it(self):
        self.assertEqual(V.clip("purple"), self.shelf / "purple.wav")
        self.assertIsNone(V.clip("nobody"))

    def test_and_it_is_still_read_from_the_checkout_when_nothing_says_else(self):
        C.PATH.write_text("{}")
        self.assertEqual(V.shelf(), Path(C.somewhere("models/voices")))

    def test_a_shelf_moved_in_the_config_is_where_the_next_ask_looks(self):
        """Read per ask rather than held: a path settled at import is a path
        that was settled before setup.sh had written one."""
        moved = a_shelf(("bronze",), where="clips")
        self.assertEqual(V.names(), ["bronze"])
        self.assertEqual(V.clip("bronze"), moved / "bronze.wav")


class WhatTheTickCarries(Machine):
    def test_the_shape_of_it(self):
        got = self.client.get("/machine").json()
        self.assertEqual(set(got["status"]), {"llm", "stt", "tts"})
        self.assertIn("memory_mb", got)
        self.assertEqual(got["tts"], self.voice.stats)
        self.assertEqual(got["llm"]["server"], "mlx_lm")
        self.assertEqual(got["llm"]["model"], "/models/pretend")
        self.assertIsInstance(got["llm"]["port"], int)

    def test_and_the_numbers_the_page_listens_by(self):
        """The listening is the page's and the thresholds are the machine's:
        they live in its config, where the console can reach them, and a room
        reads them once on the way in. A key missing here is a page hearing by
        a default nobody set."""
        got = self.client.get("/machine").json()
        for key in ("floor_mult", "sustain_mult", "hangover_ms", "min_turn_ms",
                    "max_turn_ms", "barge_mult", "barge_grace_ms",
                    "barge_voiced", "barge_learn_ms"):
            self.assertIn(key, got["vad"])
        self.assertIsInstance(got["vad"]["floor_mult"], (int, float))


class ReadingTheDialCostsNothing(unittest.TestCase):
    """A page polls `GET /machine` for as long as it is open, including one
    with the microphone off and the sound down that will never ask to be
    spoken to. Voice's constructor starts the one MLX thread, which binds the
    GPU the moment it exists -- so nothing on this route may build it. The
    tests above hand in a stub and would never see it."""

    def setUp(self):
        clean()
        self.here = MACHINE.Stack()
        # Measured recently enough that the meter's own thread does not start;
        # it is what the memory tests are about, and it builds nothing here.
        self.here._mem_at = time.monotonic()

    def test_nothing_is_built_by_asking_what_is_loaded(self):
        facts = self.here.facts()
        self.assertIsNone(self.here._voice, "reading the dial took the GPU")
        self.assertIsNone(self.here._llm)
        self.assertFalse(self.here.made)
        self.assertEqual(facts["status"],
                         {"llm": "off", "stt": "off", "tts": "off"})

    def test_and_what_is_not_built_is_answered_for_from_the_config(self):
        """The three lamps are off and the row still says which model this
        machine would run and what would serve it."""
        facts = self.here.facts()
        self.assertEqual(facts["tts"], {})
        self.assertEqual(facts["llm"]["server"], "mlx_lm")
        self.assertEqual(facts["llm"]["model"], str(S.where(C.somewhere("models"), "llm", "lg")))


class AStopLandsInTheMiddleOfAStart(Machine):
    """Both are threads: ai_models_start and ai_models_stop each fire one, and
    the watchdog puts the machine away on its own. A start cannot hold a lock
    over a stop -- it may sit waiting on a model for ten minutes -- so the stop
    lands, and the start has to notice it did."""

    def test_the_lamp_does_not_light_over_a_model_that_was_stopped(self):
        here = MACHINE.stack()
        self.llm.up = False
        stopped = threading.Event()

        def wait_ready(timeout=600):
            here.stop()                  # the console, while this one waits
            stopped.set()
            return True                  # and the child came up regardless

        self.llm.wait_ready = wait_ready
        self.assertFalse(here.start_llm())
        self.assertTrue(stopped.is_set())
        self.assertEqual(here.status["llm"], "off")

    def test_and_what_came_up_after_it_is_put_away(self):
        """Otherwise it is twenty gigabytes with nothing left saying it is
        there: the status says off and the next start adopts it."""
        here = MACHINE.stack()
        self.llm.up = False
        self.llm.wait_ready = lambda timeout=600: (here.stop(), True)[1]
        here.start_llm()
        self.assertEqual(self.llm.stopped, 2, "the start left its model running")

    def test_a_start_nobody_interrupted_still_lights_it(self):
        here = MACHINE.stack()
        self.llm.up = False
        self.assertTrue(here.start_llm())
        self.assertEqual(here.status["llm"], "ready")


class Lifecycle(Machine):
    def test_start_brings_up_the_language_model_and_nothing_else(self):
        """A conversation being opened is not a microphone being turned on, and
        it is not the sound being on either. Those two are asked for by the
        page that wants them; this is the one that every page wants."""
        self.llm.up = False
        got = self.client.post("/machine/models/start").json()
        self.assertEqual(got, {"llm": "ready", "stt": "off", "tts": "off"})
        self.assertEqual(self.voice.loaded, [])

    def test_and_the_console_still_loads_all_three_deliberately(self):
        """Somebody typing /ai_models_start has said what they mean."""
        self.llm.up = False
        got = MACHINE.stack().start()
        self.assertEqual(got, {"llm": "ready", "stt": "ready", "tts": "ready"})
        self.assertEqual(self.voice.loaded, ["stt", "tts"])

    def test_stop_gives_the_memory_back(self):
        self.client.post("/machine/models/start")
        got = self.client.post("/machine/models/stop").json()
        self.assertEqual(got, {"llm": "off", "stt": "off", "tts": "off"})
        self.assertEqual(self.voice.unloaded, 1)
        self.assertEqual(self.llm.stopped, 1)

    def test_warming_the_voice_is_the_voice_waking_up(self):
        """Against the clip that is about to speak: the conditioning is per
        voice, so warming without one would warm the wrong thing."""
        got = self.client.post("/machine/models/warm",
                               json={"kind": "voice", "voice": "purple"})
        self.assertEqual(got.json(), {"warmed": ["voice"]})
        self.assertEqual(self.voice.warmed, 1)
        self.assertEqual(self.voice.refs, [self.shelf / "purple.wav"])

    def test_and_warming_a_voice_nobody_named_warms_nothing(self):
        got = self.client.post("/machine/models/warm", json={"kind": "voice"})
        self.assertEqual(got.json(), {"warmed": []})
        self.assertEqual(self.voice.warmed, 0)

    def test_warming_a_prompt_pushes_the_callers_own_through(self):
        got = self.client.post("/machine/models/warm", json={
            "kind": "prompt", "system": "you are nobody",
            "messages": [{"role": "user", "content": "hello"}]})
        self.assertEqual(got.json(), {"warmed": ["prompt"]})
        self.assertEqual(self.llm.warmed[-1][1], "you are nobody")

    def test_a_ping_feeds_the_watchdog(self):
        MACHINE.stack().active_at = 0.0
        got = self.client.post("/machine/ping")
        self.assertEqual(set(got.json()["status"]), {"llm", "stt", "tts"})
        self.assertGreater(MACHINE.stack().active_at, time.time() - 5)

    def test_and_a_conversation_holds_it_open(self):
        """A reply in flight is a use the clock cannot see."""
        talking = {"now": False}
        MACHINE.stack().busy_if(lambda: talking["now"])
        self.assertFalse(MACHINE.stack().busy())
        talking["now"] = True
        self.assertTrue(MACHINE.stack().busy())


class WhatAPageWants(Machine):
    """The two small models, and who decides when they are held.

    A new player's microphone is off and a muted player hears nothing, and
    neither of them should be holding several gigabytes for it. So a page says
    what it is doing -- the microphone is on, the sound is off -- and the
    machine decides what that costs. Everything below is that decision.
    """

    def want(self, model, wanted):
        r = self.client.post(f"/machine/models/{model}", json={"wanted": wanted})
        self.assertEqual(r.status_code, 200)
        return r.json()

    def ready(self, model, timeout=2.0):
        """Wait for the thread the load runs on, the way a page waits on the lamp."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if MACHINE.stack().status[model] == "ready":
                return True
            time.sleep(0.01)
        return False

    def test_wanting_it_loads_it(self):
        got = self.want("stt", True)
        self.assertIn(got["status"], ("loading", "ready"))
        self.assertTrue(self.ready("stt"))
        self.assertEqual(self.voice.loaded, ["stt"])
        # And nothing else came up with it.
        self.assertEqual(MACHINE.stack().status["tts"], "off")

    def test_and_wanting_one_that_is_already_up_costs_nothing(self):
        self.want("tts", True)
        self.assertTrue(self.ready("tts"))
        self.assertEqual(self.want("tts", True), {"status": "ready", "grace": None})
        self.assertEqual(self.voice.loaded, ["tts"])

    def test_not_wanting_it_puts_it_away_after_the_grace_and_not_before(self):
        self.want("stt", True)
        self.assertTrue(self.ready("stt"))
        self.want("tts", True)
        self.assertTrue(self.ready("tts"))
        self.assertEqual(self.want("stt", False)["grace"], MACHINE.GRACE_S)

        self.clock.on(MACHINE.GRACE_S - 1)
        MACHINE.stack().sweep()
        self.assertEqual(MACHINE.stack().status["stt"], "ready")

        self.clock.on(2)
        MACHINE.stack().sweep()
        self.assertEqual(MACHINE.stack().status["stt"], "off")
        # That one, alone. The voice is somebody else's reason to be here, and
        # the language model is everybody's.
        self.assertEqual(self.voice.dropped, ["stt"])
        self.assertEqual(MACHINE.stack().status["tts"], "ready")
        self.assertEqual(self.voice.unloaded, 0)

    def slow_load(self, model):
        """A load held at the gate, the way one waits on the MLX thread behind
        a long generation."""
        gate = threading.Event()
        real = getattr(self.voice, f"load_{model}")

        def load():
            gate.wait(2.0)
            return real()
        setattr(self.voice, f"load_{model}", load)
        return gate

    def dropped(self, model, times, timeout=2.0):
        """Wait for the load thread to have let go of what it loaded."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.voice.dropped.count(model) >= times:
                return True
            time.sleep(0.01)
        return False

    def test_a_load_that_finishes_after_a_stop_is_put_away(self):
        """Nothing cancels a load on the one MLX thread. Stop freed every
        byte, and the load then brought the model back with no grace on it."""
        gate = self.slow_load("stt")
        self.want("stt", True)
        MACHINE.stack().stop()
        self.assertEqual(MACHINE.stack().status["stt"], "off")
        gate.set()
        self.assertTrue(self.dropped("stt", 1))
        self.assertEqual(MACHINE.stack().status["stt"], "off")
        self.assertIsNone(MACHINE.stack().grace()["stt"])

    def test_and_so_is_one_a_sweep_had_already_put_away(self):
        """The grace ran out while the load was still queued: the drop landed
        behind the load, and the lamp said ready over a model that was gone."""
        gate = self.slow_load("tts")
        self.want("tts", True)
        self.assertEqual(self.want("tts", False)["grace"], MACHINE.GRACE_S)
        self.clock.on(MACHINE.GRACE_S + 1)
        MACHINE.stack().sweep()
        self.assertEqual(MACHINE.stack().status["tts"], "off")
        gate.set()
        self.assertTrue(self.dropped("tts", 2))        # the sweep's, and the load's own
        self.assertEqual(MACHINE.stack().status["tts"], "off")
        # And wanting it again starts a load, rather than trusting a lamp.
        self.assertEqual(self.want("tts", True)["status"], "loading")
        self.assertTrue(self.ready("tts"))

    def test_wanting_it_again_during_the_grace_cancels_it(self):
        self.want("tts", True)
        self.assertTrue(self.ready("tts"))
        self.want("tts", False)
        self.clock.on(10)
        self.assertEqual(self.want("tts", True), {"status": "ready", "grace": None})
        self.clock.on(MACHINE.GRACE_S + 1)
        MACHINE.stack().sweep()
        self.assertEqual(MACHINE.stack().status["tts"], "ready")
        self.assertEqual(self.voice.dropped, [])

    def test_and_so_does_asking_it_for_something(self):
        """A page that never says a word about any of this still works, and
        the one that said it was done and then transcribed something has
        changed its mind. Both arrive as a call to the model itself."""
        self.want("stt", True)
        self.assertTrue(self.ready("stt"))
        self.want("stt", False)
        self.client.post("/machine/stt", content=np.zeros(1600, np.int16).tobytes())
        self.clock.on(MACHINE.GRACE_S + 1)
        MACHINE.stack().sweep()
        self.assertEqual(MACHINE.stack().status["stt"], "ready")

    def test_the_same_for_the_voice_and_its_socket(self):
        self.want("tts", True)
        self.assertTrue(self.ready("tts"))
        self.want("tts", False)
        with self.client.websocket_connect("/machine/tts") as ws:
            ws.send_json({"text": "hello", "voice": "purple"})
            while True:
                if ws.receive_json().get("done"):
                    break
        self.clock.on(MACHINE.GRACE_S + 1)
        MACHINE.stack().sweep()
        self.assertEqual(MACHINE.stack().status["tts"], "ready")

    def test_the_tick_says_how_long_each_has_left(self):
        got = self.client.get("/machine").json()
        self.assertEqual(got["grace"], {"stt": None, "tts": None})
        self.want("stt", True)
        self.assertTrue(self.ready("stt"))
        self.want("stt", False)
        self.clock.on(30)
        got = self.client.get("/machine").json()
        self.assertEqual(got["grace"]["stt"], MACHINE.GRACE_S - 30)
        self.assertIsNone(got["grace"]["tts"])

    def test_letting_go_of_something_that_was_never_there_starts_nothing(self):
        self.assertEqual(self.want("stt", False), {"status": "off", "grace": None})

    def test_and_a_call_that_says_neither_is_refused_rather_than_guessed_at(self):
        r = self.client.post("/machine/models/stt", json={})
        self.assertEqual(r.status_code, 400)
        self.assertIn("error", r.json())
        self.assertEqual(self.voice.loaded, [])

    def test_and_one_that_says_it_in_something_other_than_yes_or_no(self):
        """`"false"` is a string, and every non-empty string is true: read
        loosely, a page with a bug in it says stop and loads twenty
        gigabytes."""
        for bad in ("false", "true", 0, 1, None, [], {"wanted": True}):
            r = self.client.post("/machine/models/stt", json={"wanted": bad})
            self.assertEqual(r.status_code, 400, repr(bad))
            self.assertIn("error", r.json(), repr(bad))
        self.assertEqual(self.voice.loaded, [])


class ThereIsOneStack(unittest.TestCase):
    """The rule the rest of this file is in service of.

    One language model and one voice per process. A second Chatterbox and a
    second Parakeet are several gigabytes on a Mac with thirty-two, and the
    only symptom would be the whole thing swapping in the middle of an
    evening. Nothing outside this one file may build either.
    """

    def setUp(self):
        clean()
        self.was = MACHINE.set_stack(MACHINE.Stack(llm=FakeLLM(), voice=FakeVoice()))
        self.addCleanup(MACHINE.set_stack, self.was)

    def test_everybody_who_asks_is_handed_the_same_one(self):
        self.assertIs(MACHINE.stack(), MACHINE.stack())
        self.assertIs(MACHINE.stack().voice, MACHINE.stack().voice)
        self.assertIs(MACHINE.stack().llm, MACHINE.stack().llm)

    def test_the_lamps_are_the_same_three_lamps(self):
        """The console reads them off the health row and a page off /machine.
        Two dicts would be two answers about one model."""
        app = FastAPI()
        MACHINE.routes(app)
        client = TestClient(app)
        client.post("/machine/models/start")
        self.assertEqual(MACHINE.stack().status["llm"], "ready")
        self.assertEqual(client.get("/machine").json()["status"]["llm"], "ready")

    def test_nothing_else_makes_a_voice_of_its_own(self):
        """One import and one constructor is all it would take to undo this,
        and nothing else in the program would complain."""
        pkg = Path(__file__).resolve().parents[2] / "machine"
        for f in sorted(pkg.glob("*.py")):
            if f.name in ("machine.py", "models.py"):
                continue
            src = f.read_text()
            self.assertNotIn("Voice(", src, f"{f.name} makes its own voice")
            self.assertNotIn("LLMServer(", src,
                             f"{f.name} makes its own language model")


class TheConfigDecidesWhatIsLaunched(unittest.TestCase):
    """Which program serves the model, and what it is handed.

    `llm.server` names mlx_lm or mlx_vlm, and the two take different launch
    lines for the same model. The supervisor was built out of the module's
    globals before anything had read the config into them -- and it is built
    from further away than a start, because measuring the memory measures the
    language model and measuring it makes it. So a machine set to mlx_vlm
    served mlx_lm for the whole run, and a setting edited between a stop and a
    start was a setting that never arrived.
    """

    def setUp(self):
        clean()
        was = {name: getattr(M, name)
               for name in ("LLM_OPTS", "LLM_PORT", "VENV_BIN")}
        self.addCleanup(lambda: [setattr(M, k, v) for k, v in was.items()])

    def quiet(self):
        """A supervisor that starts nothing. What is being asked here is what
        it would have run, which the launch line answers on its own."""
        for name, instead in (("ready", lambda self: False),
                              ("start", lambda self: None),
                              ("wait_ready", lambda self, timeout=600: True)):
            self.addCleanup(setattr, M.LLMServer, name,
                            getattr(M.LLMServer, name))
            setattr(M.LLMServer, name, instead)

    def test_each_server_is_launched_by_its_own_name_and_its_own_flags(self):
        for server, program, flag in (("mlx_lm", "mlx_lm.server",
                                       "--prompt-cache-bytes"),
                                      ("mlx_vlm", "mlx_vlm.server", "--kv-bits")):
            with self.subTest(server=server):
                C.note(llm={"server": server, "model": "models/llm/lg"})
                args = MACHINE.Stack().llm.args()
                self.assertTrue(args[0].endswith(program), args[0])
                self.assertIn(flag, args)
                self.assertIn("models/llm/lg", " ".join(args))

    def test_the_meter_reaching_it_first_does_not_settle_the_wrong_one(self):
        """`GET /machine` measures the memory on a thread, and that path
        builds the supervisor before any page has asked for a model."""
        C.note(llm={"server": "mlx_vlm", "model": "models/llm/lg",
                    "venv": "/opt/pretend/bin", "port": 6900})
        here = MACHINE.Stack(voice=FakeVoice())
        here._measure()
        self.assertEqual(here.llm.server, "mlx_vlm")
        args = here.llm.args()
        self.assertEqual(args[0], "/opt/pretend/bin/mlx_vlm.server")
        self.assertEqual(args[args.index("--port") + 1], "6900")

    def test_a_setting_changed_while_it_is_down_is_the_one_that_starts(self):
        self.quiet()
        here = MACHINE.Stack()
        C.note(llm={"server": "mlx_lm", "model": "models/llm/lg"})
        self.assertTrue(here.start_llm())
        self.assertTrue(here.llm.args()[0].endswith("mlx_lm.server"))
        here.stop()
        C.note(llm={"server": "mlx_vlm", "model": "models/other"})
        self.assertTrue(here.start_llm())
        self.assertTrue(here.llm.args()[0].endswith("mlx_vlm.server"))
        self.assertIn("models/other", " ".join(here.llm.args()))

    def test_and_a_supervisor_handed_in_is_left_alone(self):
        """A test's own, and the one place a stack is given one."""
        mine = FakeLLM()
        here = MACHINE.Stack(llm=mine, voice=FakeVoice())
        C.note(llm={"server": "mlx_vlm", "model": "models/llm/lg"})
        here._retuned()
        self.assertIs(here.llm, mine)


class TheMachineSaysHowItIsDoing(unittest.TestCase):
    """The row at the top of every console, on every page.

    It used to be a line inside the game's own event pump, which is a machine
    every game shares being reported on by one of them — and with nothing
    mounted, three lamps that never lit at all.
    """

    def setUp(self):
        clean()
        self.was = MACHINE.set_stack(MACHINE.Stack(llm=FakeLLM(), voice=FakeVoice()))
        self.addCleanup(MACHINE.set_stack, self.was)
        LOG.health.pop("machine", None)
        self.addCleanup(LOG.health.pop, "machine", None)

    def test_the_three_lamps_and_what_they_cost(self):
        MACHINE.health()
        row = LOG.health["machine"]
        self.assertEqual([p["name"] for p in row["parts"]], ["LLM", "STT", "TTS"])
        self.assertEqual([p["state"] for p in row["parts"]], ["off", "off", "off"])
        self.assertTrue(row["facts"][0].endswith("GB"))

    def test_a_model_that_is_up_is_lit(self):
        MACHINE.stack().start()
        MACHINE.health()
        by_name = {p["name"]: p for p in LOG.health["machine"]["parts"]}
        self.assertEqual(by_name["LLM"]["state"], "on")
        self.assertIn("ready", by_name["LLM"]["title"])

    def test_and_it_is_the_machine_row_every_console_shows(self):
        """Reserved, and named so: a game's own row shows only where somebody
        is standing in it, and there is no longer a game here to have one."""
        MACHINE.health()
        self.assertEqual(set(LOG.health), {"machine"})


class TheMeterCostsSomethingToRead(unittest.TestCase):
    """lsof, footprint and ps, three processes, about a tenth of a second.

    The pump runs for the life of the server whether or not anybody has a page
    open, so this used to shell out every three seconds all night for a figure
    nobody was reading. Attached is what makes it worth measuring: every page
    dials the log socket as it loads, so a watcher is a page.
    """

    def setUp(self):
        clean()
        self.was = MACHINE.set_stack(MACHINE.Stack(llm=FakeLLM(), voice=FakeVoice()))
        self.addCleanup(MACHINE.set_stack, self.was)
        self.here = MACHINE.stack()
        # The measuring itself is not what is being tested -- when it is
        # allowed to happen is.
        self.taken = []

        def instead():
            self.taken.append(time.monotonic())
            self.here._mem_at = time.monotonic()
            self.here._mem_busy = False

        self.here._measure = instead
        self.watching = set(LOG.watchers)
        LOG.watchers.clear()
        self.addCleanup(self.give_back)

    def give_back(self):
        LOG.watchers.clear()
        LOG.watchers.update(self.watching)

    def ask(self):
        self.here.memory()
        for t in threading.enumerate():
            if t.name == "machine-memory":
                t.join(2)

    def test_with_nobody_attached_it_is_read_every_fifteen_seconds(self):
        self.ask()                            # the first one always goes
        self.assertEqual(len(self.taken), 1)
        self.here._mem_at = time.monotonic() - MACHINE.WATCHED_SECS - 1
        self.ask()
        self.assertEqual(len(self.taken), 1,
                         "it shelled out with nobody looking at the dial")
        self.here._mem_at = time.monotonic() - MACHINE.QUIET_SECS - 1
        self.ask()
        self.assertEqual(len(self.taken), 2)

    def test_and_a_page_attached_brings_it_back_to_three(self):
        LOG.watchers.add(object())            # a console, which is to say a page
        self.ask()
        self.here._mem_at = time.monotonic() - MACHINE.WATCHED_SECS - 1
        self.ask()
        self.assertEqual(len(self.taken), 2)

    def test_and_the_figure_is_handed_back_either_way(self):
        """Quiet is a slower measure, not no measure: the lamp row still
        carries a number, and the first page to open finds one waiting."""
        self.assertEqual(set(self.here.memory()),
                         {"llm_gb", "app_gb", "voice_gb", "total_gb"})


class ARateIsANumberOfSamples(Machine):
    def test_one_that_is_not_is_a_400_rather_than_a_traceback(self):
        """`rate=-1` came back out of np.linspace as a 500, which says the
        machine is broken about a request that simply is not one."""
        raw = np.zeros(1600, dtype=np.int16).tobytes()
        for bad in (-1, 999, 400000):
            with self.subTest(rate=bad):
                r = self.client.post(f"/machine/stt?rate={bad}", content=raw)
                self.assertEqual(r.status_code, 400)
        self.assertFalse(self.voice.heard)

    def test_and_a_real_one_still_goes_through(self):
        raw = np.zeros(4800, dtype=np.int16).tobytes()
        self.assertEqual(self.client.post("/machine/stt?rate=48000",
                                          content=raw).status_code, 200)


class AnUtteranceHasALength(Machine):
    """A turn stops at `vad.max_turn_ms`, so anything past it was never one.

    Nothing here is authenticated and with --phone anyone on the wifi can post
    to it: an hour of audio would be held whole in memory and then resampled,
    for a request no page has ever made.
    """

    def test_more_than_a_turn_of_it_is_refused(self):
        most = MACHINE.most_audio(MACHINE.STT_RATE)
        r = self.client.post("/machine/stt", content=b"\0" * (most + 2))
        self.assertEqual(r.status_code, 413)
        self.assertFalse(self.voice.heard)

    def test_and_the_bar_is_the_rate_it_was_sent_at(self):
        """The same seconds are three times the bytes at 48k, which is what a
        page captures at when its browser feels like it."""
        self.assertEqual(MACHINE.most_audio(48000),
                         3 * MACHINE.most_audio(16000))

    def test_a_turn_still_goes_through(self):
        raw = np.zeros(MACHINE.STT_RATE * 5, dtype=np.int16).tobytes()
        self.assertEqual(self.client.post("/machine/stt", content=raw).status_code,
                         200)


class TheSizesAModelComesIn(Machine):
    """One model in three sizes, switched by name, the choice written down."""

    def sized(self):
        """A shelf of its own with two of the three checked out, laid out the
        way the manifest lays them: <org>/<repo>. Which size is up is the
        config's `llm.size`; where the shelf is is `models.dir`."""
        root = SCRATCH / "shelf"
        for name in ("sm", "md"):
            home = S.where(root, "llm", name)
            home.mkdir(parents=True, exist_ok=True)
            (home / "config.json").write_text("{}")
        C.note(models={"dir": str(root)}, llm={"size": "sm", "max_tokens": 5})
        self.llm.model_path = str(S.where(root, "llm", "sm"))   # what is serving
        return root

    def test_the_dial_says_which_size_is_up_and_which_are_here(self):
        self.sized()
        got = self.client.get("/machine").json()["llm"]
        self.assertEqual(got["size"], "sm")
        self.assertEqual(got["sizes"], {"sm": True, "md": True, "lg": False})

    def test_switching_writes_the_choice_and_starts_the_server_on_it(self):
        root = self.sized()
        r = self.client.post("/machine/models/llm", json={"size": "md"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "loading", "size": "md"})
        end = time.monotonic() + 2.0
        while time.monotonic() < end and MACHINE.stack().status["llm"] != "ready":
            time.sleep(0.01)
        self.assertEqual(MACHINE.stack().status["llm"], "ready")
        written = C.written()["llm"]
        self.assertEqual(written["size"], "md")
        self.assertNotIn("model", written)                # the size is the choice
        self.assertEqual(written["max_tokens"], 5)        # the rest of the file kept
        self.assertEqual(C.load()["llm"]["model"], str(S.where(root, "llm", "md")))
        self.assertGreaterEqual(self.llm.stopped, 1)
        self.assertGreaterEqual(self.llm.started, 1)
        self.assertEqual(self.client.get("/machine").json()["llm"]["size"], "md")

    def test_a_size_that_is_not_here_or_not_named_is_refused(self):
        self.sized()
        self.assertEqual(self.client.post("/machine/models/llm", json={"size": "lg"}).status_code, 409)
        self.assertEqual(self.client.post("/machine/models/llm", json={"size": "xl"}).status_code, 400)
        self.assertEqual(self.client.post("/machine/models/llm", json={"size": 3}).status_code, 400)
        self.assertEqual(C.written()["llm"]["size"], "sm")

    def test_a_model_of_your_own_is_a_size_of_your_own(self):
        """A build the manifest does not know, named in the config beside the
        shipped three: listed, switchable, and the one in use when the path
        says so."""
        root = self.sized()
        mine = root / "mine" / "some-build"
        mine.mkdir(parents=True)
        (mine / "config.json").write_text("{}")
        C.note(llm={"size": "sm", "sizes": {"raw": str(mine)}})
        got = self.client.get("/machine").json()["llm"]
        self.assertEqual(got["sizes"], {"sm": True, "md": True, "lg": False, "raw": True})
        self.assertEqual(self.client.post("/machine/models/llm", json={"size": "raw"}).status_code, 200)
        end = time.monotonic() + 2.0            # the switch runs on a thread
        while time.monotonic() < end and C.written()["llm"].get("size") != "raw":
            time.sleep(0.01)
        self.assertEqual(C.load()["llm"]["model"], str(mine))
        self.assertEqual(self.client.get("/machine").json()["llm"]["size"], "raw")
        # A path written straight into `model` by hand changes nothing until
        # the server is started on it: what is reported is what is serving.
        C.note(llm={"model": str(root / "elsewhere"), "sizes": {"raw": str(mine)}})
        self.assertEqual(self.client.get("/machine").json()["llm"]["size"], "raw")
        # Started on it -- a running server is not restarted by start_llm, so
        # it is stopped first, the way resize does -- the path is a size only
        # if one names it.
        self.llm.stop()
        MACHINE.stack().status["llm"] = "off"
        MACHINE.stack().start_llm()
        end = time.monotonic() + 2.0
        while time.monotonic() < end and MACHINE.stack().status["llm"] != "ready":
            time.sleep(0.01)
        self.assertEqual(self.client.get("/machine").json()["llm"]["size"], "")

    def test_the_console_says_where_things_stand(self):
        self.sized()
        line = MACHINE._model_size("")
        self.assertIn("running sm", line)
        self.assertIn("sm, md", line)
        self.assertIn("not here", MACHINE._model_size("lg"))
        self.assertIn("no size called", MACHINE._model_size("xl"))

    def test_running_means_the_process_and_a_hand_edited_config_is_named_as_drift(self):
        """What is reported is what the server was started on. A config
        edited under it says what a restart would bring, and the line says
        so rather than reporting the file as if it were running."""
        self.sized()
        MACHINE.stack().start_llm()
        end = time.monotonic() + 2.0
        while time.monotonic() < end and MACHINE.stack().status["llm"] != "ready":
            time.sleep(0.01)
        self.assertEqual(MACHINE.stack().size(), "sm")
        C.note(llm={"size": "md", "max_tokens": 5})     # by hand: no restart
        self.assertEqual(MACHINE.stack().size(), "sm")
        self.assertEqual(self.client.get("/machine").json()["llm"]["size"], "sm")
        line = MACHINE._model_size("")
        self.assertIn("running sm", line)
        self.assertIn("the config says md", line)
