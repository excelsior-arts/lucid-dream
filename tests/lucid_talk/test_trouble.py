"""When something breaks, the game says so before the console does.

The console keeps a red dot on its knob for anything that has gone wrong since
you last looked — that is the whole of how a tool nobody remembers becomes a
tool somebody uses. It fires on a line's *level*, and every runtime failure in
this app was being logged at the level meant for ordinary news. So the model
could die, every turn after it could fail, and the only sign anywhere was a
page of urllib text you had to open the console to find.

Which is not an argument for making everything an error. A dot that lights
because a voice reference would not swap is a dot you stop believing. It is
kept for the failures that stop somebody playing.

The other half is that a failure should be said in words. "HTTPConnectionPool
(host='127.0.0.1', port=6968): Max retries exceeded" is true and is not a
sentence anybody playing a game should be shown.
"""
import threading
import unittest

from tests import clean
from lucid_talk.session import Session


class Stub:
    _llm_trouble = Session._llm_trouble
    _llm_mend = Session._llm_mend
    what_is_missing = Session.what_is_missing
    mend = Session.mend

    def __init__(self, answering=False):
        self.said = []
        self.status = {}
        self._llm_mending = False
        self.running = True
        self.started = 0
        self.llm = self
        self._answering = answering

    # standing in for the language model
    def ready(self):
        return self._answering

    def start(self):
        self.started += 1

    def wait_ready(self, *a):
        return True

    def emit(self, kind, **payload):
        self.said.append((payload.get("level", "info"), payload.get("text", "")))


class TheDotIsForThingsThatStopYouPlaying(unittest.TestCase):
    """The console marks its knob on level == 'error' and on nothing else.

    So 'error' has to mean one thing, and the thing it means is: the game is
    blocked. A model that will not answer is blocked. A voice reference that
    would not swap, a memory that did not fold, a line that could not be said
    again — none of those stop anybody playing, and a dot that lights for them
    is a dot nobody looks at twice.
    """

    # Real, and survivable. Marked in the console, no dot.
    SURVIVABLE = ("STT failed", "TTS failed", "mic failed", "voice switch failed",
                  "relation scoring failed", "scene note failed", "replay failed",
                  "memory fold failed")

    def source(self):
        import inspect
        return inspect.getsource(Session)

    def test_nothing_survivable_lights_it(self):
        src, loud = self.source(), []
        for line in src.splitlines():
            if 'level="error"' not in line:
                continue
            for what in self.SURVIVABLE:
                if what in line:
                    loud.append(line.strip())
        self.assertFalse(loud, "these do not block the game and cry wolf:\n  "
                               + "\n  ".join(loud))

    def test_but_they_are_still_marked_as_wrong(self):
        """Quietly is not the same as silently: they read as warnings."""
        src = self.source()
        for what in self.SURVIVABLE:
            for line in src.splitlines():
                if what in line and 'emit("log"' in line:
                    self.assertIn('level="warn"', line, line.strip())

    def test_and_a_turn_that_could_not_happen_does(self):
        src = self.source()
        for what in ("turn failed", "continuous stopped", "start failed"):
            hit = [l for l in src.splitlines()
                   if what in l and 'emit("log"' in l]
            self.assertTrue(hit, what)
            for line in hit:
                self.assertIn('level="error"', line, line.strip())

    def test_and_the_console_still_only_marks_on_error(self):
        """If this ever changes, everything above stops meaning anything.

        Two conditions, and the dot needs both: the line has to be an error,
        and it has to be one nobody has read yet. The second is why a reload
        does not light the knob with the whole evening again — the console is
        handed its entire ring buffer on every connection.
        """
        from pathlib import Path
        night = (Path(__file__).resolve().parents[2]
                 / "shell/static/night.js").read_text()
        i = night.index("mark(true)")
        raising = night[max(0, i - 200):i]
        self.assertIn("l.level === 'error'", raising,
                      "something other than an error can raise the dot")
        self.assertIn("l.at > seen", raising,
                      "a line already read can raise the dot")

    def test_and_reading_them_is_remembered_past_the_page(self):
        """A dot that comes back on every refresh is a dot nobody trusts."""
        from pathlib import Path
        night = (Path(__file__).resolve().parents[2]
                 / "shell/static/night.js").read_text()
        self.assertIn("localStorage.setItem(SEEN", night)
        # and a browser that refuses storage still runs
        i = night.index("localStorage.setItem(SEEN")
        self.assertIn("catch", night[i:i + 120])


class WhenTheModelIsNotThere(unittest.TestCase):
    def setUp(self):
        clean()

    def test_it_is_said_in_words(self):
        s = Stub(answering=False)
        s._llm_trouble(OSError("Connection refused"))
        level, text = s.said[0]
        self.assertEqual(level, "error")
        self.assertIn("language model has gone", text)
        self.assertNotIn("HTTPConnectionPool", text)

    def test_and_put_back(self):
        s = Stub(answering=False)
        s._llm_trouble(OSError("Connection refused"))
        for _ in range(50):
            if s.started:
                break
            threading.Event().wait(.02)
        self.assertEqual(s.started, 1, "it was left dead")

    def test_but_only_once_however_many_turns_fail(self):
        s = Stub(answering=False)
        s._llm_mending = True            # a mend already under way
        s._llm_trouble(OSError("Connection refused"))
        self.assertEqual(s.started, 0, "a second turn started a second model")

    def test_a_model_that_is_there_and_refused_is_a_different_sentence(self):
        s = Stub(answering=True)
        s._llm_trouble(ValueError("bad request"))
        level, text = s.said[0]
        self.assertEqual(level, "error")
        self.assertIn("refused", text)
        self.assertEqual(s.started, 0, "nothing was wrong with the model")


class WhatStartSaysWhenItIsAlreadyRunning(unittest.TestCase):
    """"already running" is what this app *believes*, and belief is exactly
    what is wrong when a child process has gone. Somebody typing start at the
    console is usually there because it is not running — telling them it is,
    and doing nothing, is the least useful answer available."""

    def setUp(self):
        clean()

    def test_nothing_missing_is_nothing_to_do(self):
        s = Stub(answering=True)
        self.assertEqual(s.what_is_missing(), "")

    def test_a_model_that_has_gone_is_named(self):
        s = Stub(answering=False)
        self.assertIn("language model", s.what_is_missing())

    def test_and_mending_puts_it_back(self):
        s = Stub(answering=False)
        s.mend()
        for _ in range(50):
            if s.started:
                break
            threading.Event().wait(.02)
        self.assertEqual(s.started, 1)

    def test_a_stopped_machine_is_not_missing_anything(self):
        """Nothing is expected of a machine that is not running: `start`
        should start it, not report a fault."""
        s = Stub(answering=False)
        s.running = False
        self.assertEqual(s.what_is_missing(), "")


class TheTurnThatWasLostWhenTheModelDied(unittest.TestCase):
    """A model that dies takes the turn in flight with it.

    The words are already in the transcript: somebody said their piece, watched
    nothing come back, and was told to say it again — which is asking them to
    do the machine's remembering for it. Three times in one evening, and each
    time the person typed a second line asking whether anybody was there.

    The line is at the end of the conversation, waiting. Answer it.
    """

    def setUp(self):
        clean()

    def stub(self, history):
        s = Stub(answering=True)
        s.history = list(history)
        s._replying = threading.Lock()
        s.taken = []
        s.reply_to = lambda text, hidden=False: s.taken.append((text, hidden))
        s._answer_what_was_missed = Session._answer_what_was_missed.__get__(s)
        return s

    def settle(self, s, secs=1.0):
        """A thread started from a call either exists at once or never, so a
        short wait proves the negative as well as the positive."""
        for _ in range(int(secs / .005)):
            if s.taken:
                return
            threading.Event().wait(.005)

    def test_the_last_thing_said_is_answered(self):
        s = self.stub([{"role": "assistant", "content": "a line"},
                       {"role": "user", "content": "are you there"}])
        s._answer_what_was_missed()
        self.settle(s)
        self.assertEqual(len(s.taken), 1)
        self.assertTrue(s.taken[0][1], "it was written into the transcript twice")

    def test_and_it_says_so(self):
        s = self.stub([{"role": "user", "content": "are you there"}])
        s._answer_what_was_missed()
        self.settle(s)
        self.assertTrue(any("picking up" in t for _, t in s.said), s.said)

    def test_nothing_is_owed_if_it_had_already_answered(self):
        s = self.stub([{"role": "user", "content": "hello"},
                       {"role": "assistant", "content": "hello yourself"}])
        s._answer_what_was_missed()
        self.settle(s, .1)
        self.assertEqual(s.taken, [])

    def test_nor_on_an_empty_conversation(self):
        s = self.stub([])
        s._answer_what_was_missed()
        self.settle(s, .1)
        self.assertEqual(s.taken, [])

    def test_nor_while_one_is_already_being_answered(self):
        s = self.stub([{"role": "user", "content": "are you there"}])
        s._replying.acquire()
        s._answer_what_was_missed()
        self.settle(s, .1)
        self.assertEqual(s.taken, [])


class AndTheMendingDoesIt(unittest.TestCase):
    """Tested where it is wired, not only where it is written: the whole point
    is that coming back from a dead model finishes the turn it killed."""

    def test_putting_the_model_back_picks_the_turn_up(self):
        import inspect
        src = inspect.getsource(Session._llm_mend)
        self.assertIn("_answer_what_was_missed", src,
                      "the model comes back and the turn stays lost")

    def test_and_no_longer_asks_the_person_to_repeat_themselves(self):
        import inspect
        src = inspect.getsource(Session._llm_mend)
        self.assertNotIn("say that again", src)
