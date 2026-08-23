"""Keys pressed at a machine that is not running yet.

Nothing here is up until something asks it to be — that is the whole bargain of
a program that holds twenty gigabytes while you are talking to it and none of
it while you are not. So every key that wants a voice has to mean two things at
once: start the machine, and be answered when it is up.

Which is easy to forget for exactly one key at a time, and the one that was
forgotten is the ordinary shape of an evening: come back to an old
conversation, scroll up, find the line you liked, press play on it. Nothing had
asked the models to be there, and the key that just asked was the only one that
did not count as asking.
"""
import threading
import unittest

from tests import clean
from lucid_talk.session import Session


class Stub:
    speak_again = Session.speak_again
    one_more = Session.one_more
    _boot_gave_up = Session._boot_gave_up

    def __init__(self, running=False):
        self.running = running
        self.started = 0
        self.said = []
        self._then_one_more = False
        self._then_again = ""
        self.pending_say = ""
        self.history = [{"role": "user", "content": "a seed"}]
        self._replying = threading.Lock()

    def start_stack(self):
        self.started += 1

    def emit(self, kind, **payload):
        self.said.append((kind, payload.get("text", "")))


class AColdMachine(unittest.TestCase):
    def setUp(self):
        clean()

    def test_asking_for_a_line_again_starts_it(self):
        s = Stub()
        s.speak_again("the line you liked")
        self.assertEqual(s.started, 1, "the key did nothing at all")
        self.assertEqual(s._then_again, "the line you liked",
                         "and nothing was owed once it came up")

    def test_and_says_so_rather_than_looking_broken(self):
        s = Stub()
        s.speak_again("the line you liked")
        self.assertTrue(any("starting the models" in t for _, t in s.said),
                        f"nothing said why the key was slow: {s.said}")

    def test_skip_does_the_same(self):
        s = Stub()
        self.assertTrue(s.one_more())
        self.assertEqual(s.started, 1)
        self.assertTrue(s._then_one_more)

    def test_an_empty_line_asks_for_nothing(self):
        s = Stub()
        s.speak_again("   ")
        self.assertEqual(s.started, 0)
        self.assertEqual(s._then_again, "")

    def test_and_a_start_that_gave_up_owes_nothing(self):
        """Kept, it would be spoken at the next successful start — an hour
        later, out of nowhere, in answer to a key nobody remembers pressing."""
        s = Stub()
        s.speak_again("the line you liked")
        s.one_more()
        s._boot_gave_up()
        self.assertEqual(s._then_again, "")
        self.assertFalse(s._then_one_more)


class AndWhenItIsUp(unittest.TestCase):
    """The boot flushes what was owed, and in an order: anything somebody
    actually said comes first, because it would silence a replay the moment it
    began."""

    def test_the_order_is_written_down_where_it_happens(self):
        import inspect
        tail = inspect.getsource(Session._boot_stack_inner)
        for owed in ("pending_say", "_then_one_more", "_hands", "_then_again"):
            self.assertIn(owed, tail, f"{owed} is never flushed at boot")
        self.assertLess(tail.index("pending_say"), tail.index("_then_again"),
                        "a replay would beat something somebody typed")
