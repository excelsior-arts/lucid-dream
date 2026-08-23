"""This machine never holds a microphone.

The page is the only thing here that records or plays. That is not a
preference, and the two reasons both bite the moment it stops being true.

A microphone has one holder: a device taken by this process is a device the
browser is refused, and the page has nowhere else to go — so it stays refused,
and the only sign anywhere is macOS naming the terminal in the menu bar. And
the pill's voice comes out of the same page, so a microphone opened here is one
listening to a speaker with nothing canceling the echo between them, which is
a pill answering itself.

It is an easy thing to undo by accident — one import and one InputStream — and
nothing else in the program would complain. So it is written down here.
"""
import asyncio
import inspect
import re
import time
import unittest
from pathlib import Path

from tests import clean
from lucid_talk import audio as A


APP = Path(__file__).resolve().parents[2] / "lucid_talk"


class NothingHereOpensADevice(unittest.TestCase):
    def test_the_audio_module_does_not_reach_for_the_hardware(self):
        src = (APP / "audio.py").read_text()
        for smell in ("import sounddevice", "InputStream", "OutputStream",
                      "query_devices", "sd."):
            self.assertNotIn(smell, src,
                             f"audio.py has {smell!r} in it — this process is "
                             f"holding a device the browser needs")

    def test_nor_does_anything_else_in_the_app(self):
        for f in APP.glob("*.py"):
            self.assertNotIn("sounddevice", f.read_text(), f.name)

    def test_a_mic_is_a_queue_and_a_thread_and_nothing_else(self):
        m = A.Mic()
        for owned in ("device", "source", "_stream"):
            self.assertFalse(hasattr(m, owned),
                             f"Mic still carries {owned!r}, which is a device "
                             f"by another name")

    def test_starting_one_opens_nothing(self):
        """It runs on a machine with no microphone at all, which is what a
        page-fed mic means."""
        m = A.Mic()
        m.start()
        try:
            self.assertTrue(m._thread.is_alive())
        finally:
            m.close()

    def test_and_it_listens_to_what_the_page_feeds_it(self):
        import numpy as np
        m = A.Mic()
        m.start()
        try:
            m.feed(np.zeros(1600, dtype=np.float32), 16000)
            self.assertTrue(True)        # it took it without a device
        finally:
            m.close()


class AndTheServerNeverAsksForOne(unittest.TestCase):
    def setUp(self):
        clean()

    def test_there_is_no_way_to_ask_it_to(self):
        """`mic_source` used to let a page hand the microphone back to this
        process. Nothing may put it back without meeting the note above."""
        self.assertNotIn("mic_source", (APP / "server.py").read_text())
        self.assertNotIn("mic_source", (APP / "session.py").read_text())

    def test_and_the_page_does_not_offer_it_either(self):
        page = (APP / "static/index.html").read_text()
        self.assertNotIn("mic_source", page)
        self.assertNotIn("the Mac's own", page)


class TheTickCanStillBeBuilt(unittest.TestCase):
    """Every field in the tick is read off something, and the pump builds one
    five times a second. A name that no longer exists there is not a wrong
    number on a dial — it is an exception on the event loop, and the page stops
    hearing anything at all while looking perfectly connected.

    Nothing here loads a model: a Session is a store, a queue and some threads
    until somebody asks it to start.
    """

    def setUp(self):
        clean()

    def test_a_session_can_describe_itself(self):
        from lucid_talk.session import Session
        s = Session(has_listeners=lambda: False)
        try:
            tick = s.snapshot()
            self.assertIn("input_mode", tick)
            self.assertIn("running", tick)
        finally:
            s.mic.close()

    def test_and_says_nothing_about_devices(self):
        """It has none. A field here is a promise the page may act on."""
        from lucid_talk.session import Session
        s = Session(has_listeners=lambda: False)
        try:
            for gone in ("mic_device", "out_device", "mic_source"):
                self.assertNotIn(gone, s.snapshot())
        finally:
            s.mic.close()


class AKeyThatCannotWorkIsNotShown(unittest.TestCase):
    """On an address a browser does not trust — a phone reaching this Mac over
    plain http — getUserMedia is not refused, it is absent. There is nothing to
    press and nothing this side can do about it, so the key goes rather than
    sitting there grayed, or worse, lighting up and doing nothing.

    Everything else still works: the voice plays, the room is there, the line
    at the bottom sends. A remote is a perfectly good thing to be.
    """

    def page(self):
        return (APP / "static/index.html").read_text()

    def test_the_page_asks_before_it_offers(self):
        page = self.page()
        self.assertIn("function canBeHeard()", page)
        self.assertIn("isSecureContext", page)

    def test_and_hides_the_key_rather_than_disabling_it(self):
        page = self.page()
        i = page.index("if (!canBeHeard())")
        block = page[i:i + 400]
        self.assertIn("hidden = true", block)

    def test_and_typing_is_open_by_default_where_it_is_the_only_way_in(self):
        """A default, and only that. Opening the line writes it down, so a page
        that opened it at every load overwrote the choice to close it a second
        after it was made — off, refresh, on again, with no way to tell that
        from a stuck button. So it belongs with the other default, where
        anything actually chosen outranks it."""
        page = self.page()
        i = page.index("let want = !canBeHeard()")
        window = page[i:i + 300]
        self.assertIn("localStorage.getItem(TYPING)", window,
                      "the default ignores what was chosen")
        self.assertNotIn("showType(true)", page[page.index("if (!canBeHeard())"):],
                         "the line is forced open at load, which un-chooses it")

    def test_and_says_why_once(self):
        page = self.page()
        i = page.index("if (!canBeHeard())")
        self.assertIn("no microphone on this address", page[i:i + 500])


class TheAudioSessionMustAllowRecording(unittest.TestCase):
    """WebKit keeps an audio session for a page and picks a category from what
    the page has been doing. `playback` is a category a microphone cannot be
    opened in — Safari refuses with InvalidStateError and the words
    "AudioSession category is not compatible with audio capture", which is the
    only clue anywhere, and which nothing else in this program would ever
    print.

    The shell asks for `playback` on purpose: on iOS, WebAudio otherwise goes
    to the channel the ring/silent switch kills, so the interface falls silent
    on a phone that is talking. Both are right and they cannot both win, so
    the order matters: a page that is listening asks for `play-and-record`,
    which is the same media channel with a microphone attached, and nothing may
    take that away again.
    """

    def test_the_page_asks_for_it_before_capturing(self):
        page = (APP / "static/index.html").read_text()
        i = page.index("navigator.mediaDevices.getUserMedia({")
        self.assertIn("play-and-record", page[max(0, i - 1200):i],
                      "capture is asked for without setting the category first")

    def test_and_the_shell_does_not_take_it_back(self):
        night = (Path(__file__).resolve().parents[2]
                 / "shell/static/night.js").read_text()
        i = night.index("= 'playback'")
        self.assertIn("play-and-record", night[max(0, i - 400):i],
                      "the interface downgrades the category and the "
                      "microphone cannot be opened after it")


class WhoDecidesWhetherTalkingOverItStops(unittest.TestCase):
    """Two things want a say, and one of them repeats itself.

    The page reports what its microphone granted and turns barge-in off where
    there is no echo cancellation, because without it the pill is the loudest
    thing in the room and hears itself. Somebody can also say so at the
    console, which is the only remedy for a browser that reports cancellation
    and does not do any.

    The page re-reads its microphone every time it is opened. So without a
    choice outranking a report, the answer to /mic_barge off was another
    /mic_barge off — and then another the next time Talk was pressed. The
    setting was undone about twenty seconds after it was made, by a machine
    agreeing with itself.
    """

    def setUp(self):
        clean()

    def session(self):
        from lucid_talk.session import Session
        s = Session(has_listeners=lambda: False)
        self.addCleanup(s.mic.close)
        return s

    def test_the_page_may_turn_it_off(self):
        s = self.session()
        s.set_barge(False)
        self.assertFalse(s.mic.barge_in)

    def test_and_on_again(self):
        s = self.session()
        s.set_barge(False)
        s.set_barge(True)
        self.assertTrue(s.mic.barge_in)

    def test_but_not_once_somebody_has_said(self):
        s = self.session()
        s.set_barge(False, chosen=True)
        s.set_barge(True)                 # the page, opening its mic again
        self.assertFalse(s.mic.barge_in, "the page argued with a choice and won")

    def test_and_the_choice_can_be_changed_by_choosing_again(self):
        s = self.session()
        s.set_barge(False, chosen=True)
        s.set_barge(True, chosen=True)
        self.assertTrue(s.mic.barge_in)
        s.set_barge(False)                # still only advice
        self.assertTrue(s.mic.barge_in)


class WhatTheMicDoesWhenYouLookAway(unittest.TestCase):
    """The one setting somebody changes while it is doing the wrong thing.

    Under "focus" the microphone closes whenever the window is not in front,
    and in a browser that reports the menu bar taking focus as a blur, that
    includes the moment somebody clicks the system's microphone indicator to
    see who has the device. The indicator goes out under the pointer, the menu
    it belongs to closes with it, and the controls that would have fixed
    anything cannot be reached at all.

    config.json is read when a session starts, so the setting a person goes
    looking for at exactly that moment is one they cannot change without
    ending the conversation to do it. Hence a console that sets it live, and
    writes it down so it holds.
    """

    def setUp(self):
        clean()
        self.loop = asyncio.new_event_loop()
        self.addCleanup(self.loop.close)
        from lucid_talk import server as SRV
        from lucid_talk.session import Session
        self.SRV = SRV
        SRV.orders()
        self.s = Session(has_listeners=lambda: False)
        self.addCleanup(self.s.mic.close)
        self.was, SRV.session = SRV.session, self.s
        self.addCleanup(lambda: setattr(SRV, "session", self.was))

    def run_cmd(self, line):
        from shell import log as L
        return self.loop.run_until_complete(L.run(line))

    def test_it_reaches_the_page_at_all(self):
        """The page cannot read config.json; the tick is the only way there."""
        self.s.cfg.setdefault("ui", {})["mic_follows_window"] = "never"
        self.assertEqual(self.s.snapshot()["mic_follow"], "never")

    def test_and_the_console_can_change_it_without_a_restart(self):
        self.run_cmd("mic_follow hidden")
        self.assertEqual(self.s.snapshot()["mic_follow"], "hidden")
        self.run_cmd("mic_follow focus")
        self.assertEqual(self.s.snapshot()["mic_follow"], "focus",
                         "the setting was changed and the page was not told")

    def test_and_it_is_written_down(self):
        """In the machine's config, because the microphone belongs to the
        shelf rather than to one game on it."""
        from lucid_talk import config as C
        from shell import config as MACHINE
        self.run_cmd("mic_follow never")
        self.assertEqual(MACHINE.load()["mic_follows_window"], "never",
                         "it holds until the next start and then forgets")
        self.assertEqual(C.load()["ui"]["mic_follows_window"], "never",
                         "and the game is handed it, as it always was")

    def test_but_not_into_an_app_that_has_never_been_opened(self):
        """config.json existing is the record that somebody has set something
        here, and a console command asking what the setting is has not."""
        from lucid_talk import config as C
        self.assertFalse(C.exists(), "the scratch app was already set up")
        self.run_cmd("mic_follow never")
        self.assertFalse(C.exists(), "a console command finished somebody's setup")
        self.assertEqual(self.s.snapshot()["mic_follow"], "never",
                         "and it did not take effect either")

    def test_nonsense_changes_nothing(self):
        self.run_cmd("mic_follow focus")
        out = self.run_cmd("mic_follow sideways")
        self.assertIn("focus|hidden|never", out)
        self.assertEqual(self.s.snapshot()["mic_follow"], "focus")

    def test_and_asking_says_which_one_it_is(self):
        self.run_cmd("mic_follow focus")
        self.assertIn("not in front", self.run_cmd("mic_follow"))
        self.run_cmd("mic_follow hidden")
        self.assertIn("hidden", self.run_cmd("mic_follow"))

    def test_the_page_obeys_all_three_and_defaults_to_the_safe_one(self):
        """The page decides; this is where its side of the bargain is read."""
        page = (APP / "static/index.html").read_text()
        self.assertIn("if (m.mic_follow) micFollow = m.mic_follow;", page,
                      "the page never reads what the tick tells it")
        self.assertIn("let micFollow = 'hidden';", page)
        i = page.index("window.addEventListener('blur'")
        self.assertIn("micFollow !== 'focus'", page[i:i + 200],
                      "a blur closes the mic under settings that say not to")
        j = page.index("document.addEventListener('visibilitychange'")
        self.assertIn("micFollow === 'never'", page[j:j + 200],
                      "being hidden closes the mic even under never")


class Fake:
    """A speaker that is talking, and has been for as long as you say."""

    def __init__(self, ms=5000.0):
        self.playing = True
        self.since_start_ms = ms
        self.stopped = 0

    def stop(self, soft=False):
        self.stopped += 1


class TheCancellerIsGivenTimeToLearn(unittest.TestCase):
    """The first reply after the mic opens is the one the pill talks over.

    Echo cancellation is subtraction, and the canceller has to learn what to
    subtract from the far-end signal itself -- so it is at its worst on the
    first reply and good from the second on. Barge-in is armed from the first
    word, so the pill hears itself say six words, decides it has been
    interrupted, and stops in the middle of its opening line. Every browser
    does this; Safari converges within a reply, Firefox takes longer.

    So barge-in waits for playback to have been *heard*, not for a clock:
    silence teaches a canceller nothing.
    """

    def setUp(self):
        clean()
        from lucid_talk import audio as A
        self.A = A
        self.was = A.BARGE_LEARN_MS

    def tearDown(self):
        self.A.BARGE_LEARN_MS = self.was

    def mic(self, speaker):
        m = self.A.Mic()
        m.speaker = speaker
        m.floor = self.A.FLOOR_MIN
        m.start()
        self.addCleanup(m.close)
        return m

    def shout(self, m, ms):
        """The pill's own voice coming back in, loud and with a pitch."""
        import numpy as np
        rate = self.A.STT_RATE
        n = int(rate * ms / 1000)
        t = np.arange(n) / rate
        # A pitch with formants over it: periodic, and with real energy above
        # 300 Hz, which is what tells a vowel from a door closing.
        loud = sum(a * np.sin(2 * np.pi * f * t)
                   for f, a in ((140, .30), (430, .22), (760, .15), (1300, .10)))
        loud = loud.astype(np.float32)
        step = int(rate * 0.02)
        for i in range(0, n, step):
            m.feed(loud[i:i + step], rate)
        for _ in range(60):
            if m._blocks.empty():
                break
            time.sleep(0.02)
        time.sleep(0.1)

    def test_the_opening_seconds_do_not_stop_it(self):
        self.A.BARGE_LEARN_MS = 1500
        sp = Fake()
        m = self.mic(sp)
        self.shout(m, 700)
        self.assertEqual(sp.stopped, 0,
                         "the pill heard itself before the canceller had "
                         "learned its voice, and stopped")

    def test_and_then_it_does(self):
        self.A.BARGE_LEARN_MS = 300
        sp = Fake()
        m = self.mic(sp)
        self.shout(m, 1500)
        self.assertGreater(sp.stopped, 0,
                           "talking over the pill never stops it any more")

    def test_it_is_playback_heard_and_not_a_clock(self):
        """A canceller learns nothing while nothing is playing."""
        self.A.BARGE_LEARN_MS = 1500
        sp = Fake()
        sp.playing = False
        m = self.mic(sp)
        self.shout(m, 2000)          # two seconds pass, none of it playback
        sp.playing = True
        self.shout(m, 400)
        self.assertEqual(sp.stopped, 0,
                         "waiting counted as learning")

    def test_zero_trusts_the_browser_from_the_first_block(self):
        self.A.BARGE_LEARN_MS = 0
        sp = Fake()
        m = self.mic(sp)
        self.shout(m, 400)
        self.assertGreater(sp.stopped, 0)

    def test_and_it_says_so_rather_than_looking_broken(self):
        """Somebody who talks over the opening line and is ignored is owed a
        reason -- once, not once a block."""
        from shell import log as L
        self.A.BARGE_LEARN_MS = 1500
        m = self.mic(Fake())
        said = []
        m.on_event = lambda n, p: said.append(p.get("text", "")) if n == "log" else None
        self.shout(m, 900)
        learning = [t for t in said if "still learning" in t]
        self.assertEqual(len(learning), 1, f"said it {len(learning)} times")

    def test_the_config_can_turn_it_down(self):
        self.A.apply_config({"vad": {"barge_learn_ms": 250}})
        self.assertEqual(self.A.BARGE_LEARN_MS, 250)


class PressingTalkIsNotAnOpinionAboutBargeIn(unittest.TestCase):
    """A live mic wanting barge-in is a default, not a verdict.

    _apply_input_mode ran on every input_mode message and set mic.barge_in
    directly, going round set_barge and the choice it protects. So /mic_barge
    off held until the next time Talk was pressed -- which is the very next
    thing somebody does after typing it, because they turned the mic off to
    type.
    """

    def setUp(self):
        clean()

    def session(self):
        from lucid_talk.session import Session
        s = Session(has_listeners=lambda: False)
        self.addCleanup(s.mic.close)
        # Asking for the mic asks for the models behind it, and nothing in
        # this tier loads a model.
        s.start_stack = lambda *a, **k: None
        return s

    def test_a_choice_survives_the_mic_going_off_and_on(self):
        s = self.session()
        s.set_barge(False, chosen=True)
        s.set_input_mode("type")
        s.set_input_mode("mic")
        self.assertFalse(s.mic.barge_in,
                         "pressing Talk undid what the console was told")

    def test_and_so_does_the_page_telling_the_truth(self):
        """The report is not a choice, and it is still the last word.

        This is the whole of what a page knows that the machine does not: one
        browser grants echo cancellation and does none, and the page is where
        that is visible. Reported, then overruled a second later by a mic
        coming up with barging on, it went straight back to the pill hearing
        itself -- with the console line explaining the fix sitting one line
        above the interruption it did not prevent.
        """
        s = self.session()
        s.set_barge(False)               # the page, reporting no cancellation
        s.set_input_mode("mic")          # and Talk, one message later
        self.assertFalse(s.mic.barge_in,
                         "the mic came up barging over what the page reported")

    def test_and_it_survives_the_mic_being_rebuilt(self):
        """stop_all leaves a fresh Mic, and every fresh Mic barges."""
        from lucid_talk import audio as A
        s = self.session()
        s.set_barge(False)
        s.mic.close()
        s.mic = A.Mic()                  # what stop_all leaves behind
        self.addCleanup(s.mic.close)
        s.set_input_mode("mic")
        self.assertFalse(s.mic.barge_in)

    def test_but_nothing_said_at_all_leaves_it_barging(self):
        s = self.session()
        s.set_input_mode("mic")
        self.assertTrue(s.mic.barge_in,
                        "a mic you cannot talk over, by default")


class OneBrowserReportsWhatItDoesNotDo(unittest.TestCase):
    """Gecko grants echoCancellation and cancels nothing.

    Everything downstream of that report believed it: the console said
    "microphone: echo canceled", barge-in stayed armed on the strength of it,
    and the pill heard its own voice and stopped in the middle of its lines all
    evening. Waiting for the canceller to converge does not help, because it
    never does -- eleven seconds into a reply it was still interrupting itself.

    And the same browser calls the menu bar taking focus "hidden" rather than
    "unfocused", so the one gesture that reaches Voice Isolation -- the thing
    somebody goes looking for once the pill starts talking over itself -- shut
    the microphone as they reached for it, under a setting that exists to
    survive exactly that.
    """

    def page(self):
        return (APP / "static/index.html").read_text()

    def test_the_report_alone_no_longer_arms_barge_in(self):
        page = self.page()
        self.assertIn("send({cmd: 'barge', on: aec !== false && !lying});", page,
                      "barge-in is armed off a report known to be wrong")

    def test_and_only_that_browser_is_doubted(self):
        page = self.page()
        self.assertIn("const lying = SAYS_SO_ANYWAY && aec === true;", page,
                      "a browser that cancels properly lost barge-in too")

    def test_and_the_console_says_which_it_was(self):
        """"Echo canceled" while it plainly is not sends somebody looking at
        everything except the browser."""
        page = self.page()
        i = page.index("const lying =")
        self.assertIn("does not do", page[i:i + 600])

    def test_being_hidden_still_closes_the_mic_at_once_everywhere_else(self):
        page = self.page()
        i = page.index("document.addEventListener('visibilitychange'")
        block = page[i:i + 400]
        self.assertIn("if (!SAYS_SO_ANYWAY) return suspendMic('page hidden');", block,
                      "a phone going into a pocket now waits on a timer")

    def test_and_coming_back_cancels_the_wait(self):
        page = self.page()
        i = page.index("document.addEventListener('visibilitychange'")
        block = page[i:i + 400]
        self.assertIn("clearTimeout(hiding)", block)
        self.assertIn("if (!document.hidden) return resumeMic();", block)

    def test_the_wait_is_shorter_than_anybody_reading_a_menu(self):
        page = self.page()
        i = page.index("hiding = setTimeout(() => suspendMic('page hidden'), ")
        ms = re.search(r"'page hidden'\), (\d+)\)", page[i:i + 120])
        self.assertLess(int(ms.group(1)), 1500,
                        "long enough that a locked phone keeps a live mic")
