"""Skip: one more turn, and cut this one short if it is still going.

Two things wearing one key, and they are the same thing — with a voice going
it ends this line and takes the next, with nothing going it takes the next. So
what has to be right is *when there is a next to take*, and that is arithmetic
about the history rather than anything a person can see happening.
"""
import threading
import time
import unittest

from lucid_talk.session import Session


class Stub:
    one_more = Session.one_more

    def __init__(self, running=True, history=None):
        self.running = running
        self.history = history if history is not None else [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "Hello yourself."}]
        self._then_one_more = False
        self.started = 0
        self.turns = []
        self.logged = []

    def emit(self, kind, **payload):
        if kind == "log":
            self.logged.append(payload.get("text", ""))

    def start_stack(self):
        self.started += 1

    def _one_more(self):
        self.turns.append("nudged")


def settle(s, ms=300):
    for _ in range(int(ms / 10)):
        if s.turns:
            return
        time.sleep(.01)


class WhenThereIsSomethingToGoOnFrom(unittest.TestCase):
    def test_it_takes_a_turn(self):
        s = Stub()
        self.assertTrue(s.one_more())
        settle(s)
        self.assertEqual(s.turns, ["nudged"])

    def test_a_blank_tape_cannot_be_skipped(self):
        """The first word is always somebody's — the same rule the Play key
        keeps. A room where nothing has been said has nothing to go on from."""
        s = Stub(history=[])
        self.assertFalse(s.one_more())
        settle(s, 80)
        self.assertEqual(s.turns, [])
        self.assertEqual(s.started, 0)

    def test_nor_one_the_pill_has_only_talked_to_itself_on(self):
        s = Stub(history=[{"role": "assistant", "content": "I was saying."}])
        self.assertFalse(s.one_more())
        self.assertEqual(s.turns, [])


class AtAColdMachine(unittest.TestCase):
    """A key that quietly does nothing because a model is not loaded is a key
    somebody presses four more times."""

    def test_it_starts_the_machine_and_remembers_why(self):
        s = Stub(running=False)
        self.assertTrue(s.one_more())
        self.assertEqual(s.started, 1)
        self.assertTrue(s._then_one_more)
        settle(s, 80)
        self.assertEqual(s.turns, [], "it answered before anything was loaded")
        self.assertTrue(any("models" in l for l in s.logged))

    def test_and_takes_the_turn_once_it_is_up(self):
        s = Stub(running=False)
        s.one_more()
        s.running = True
        # what the end of the boot does
        if s._then_one_more:
            s._then_one_more = False
            s.one_more()
        settle(s)
        self.assertEqual(s.turns, ["nudged"])

    def test_a_cold_machine_with_a_blank_tape_starts_nothing(self):
        s = Stub(running=False, history=[])
        self.assertFalse(s.one_more())
        self.assertEqual(s.started, 0)


class TheEndOfTheBootLooksBack(unittest.TestCase):
    def test_boot_takes_the_turn_that_was_asked_for(self):
        """No stand-in can check this: the asking is done by the real boot."""
        import inspect
        src = inspect.getsource(Session._boot_stack_inner)
        self.assertIn("_then_one_more", src,
                      "Skip at a cold machine starts it and is then forgotten")
