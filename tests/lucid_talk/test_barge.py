"""A noise that stops the pill and turns out to be nothing.

Barge-in decides in about a tenth of a second, because waiting longer than that
to stop talking over somebody is worse than being wrong occasionally. So it is
wrong occasionally: a chair moving is loud and has pitch in it.

The cost of being wrong lands entirely on the person. They lose the end of a
reply to a sound they did not make, and get nothing in its place — the console
says "barge-in — you interrupted" and then "that was 320ms — too short to
hear", which together describe a machine that took something away for no
reason. So it is put back.
"""
import threading
import unittest

from tests import clean
from lucid_talk.session import Session


class Stub:
    _mic_event = Session._mic_event
    _put_it_back = Session._put_it_back

    def __init__(self, last=("assistant", "the rain has not let up")):
        self.history = [{"role": "user", "content": "what is it like out"}]
        if last:
            self.history.append({"role": last[0], "content": last[1]})
        self._replying = threading.Lock()
        self.stop_reply = threading.Event()
        self.speaker = type("S", (), {"playing": False})()
        self.said = []
        self.again = []
        self.state = "speaking"

    def emit(self, kind, **payload):
        self.said.append((kind, payload.get("text", "")))

    def set_state(self, state):
        self.state = state

    def speak_again(self, text):
        self.again.append(text)


def settle(s, secs=1.0):
    """Wait for the replay thread, and no longer than it takes.

    A short wait is enough to prove the negative too: the thread is started
    from the event, not scheduled, so it either exists at once or never.
    """
    for _ in range(int(secs / .005)):
        if s.again:
            return
        threading.Event().wait(.005)


class WhenTheRoomInterrupts(unittest.TestCase):
    def setUp(self):
        clean()

    def test_the_line_is_said_again(self):
        s = Stub()
        s._mic_event("dropped", {"ms": 320, "barged": True})
        settle(s)
        self.assertEqual(s.again, ["the rain has not let up"])

    def test_and_it_says_what_happened(self):
        """Silently repeating a line is its own kind of haunted."""
        s = Stub()
        s._mic_event("dropped", {"ms": 320, "barged": True})
        settle(s)
        self.assertTrue(any("the room" in t for _, t in s.said), s.said)

    def test_a_short_noise_that_stopped_nothing_is_left_alone(self):
        """No barge-in: the pill was not talking, so there is nothing owed."""
        s = Stub()
        s._mic_event("dropped", {"ms": 320, "barged": False})
        settle(s, .1)        # long enough for a thread that would fire
        self.assertEqual(s.again, [])

    def test_nor_when_the_last_word_was_yours(self):
        """Cut off before it had said anything: there is no line to put back,
        and the reply that is coming will arrive on its own."""
        s = Stub(last=None)
        s._mic_event("dropped", {"ms": 200, "barged": True})
        settle(s, .1)        # long enough for a thread that would fire
        self.assertEqual(s.again, [])

    def test_nor_when_it_is_already_talking_again(self):
        """A reply in flight beats a replay of the one before it."""
        s = Stub()
        s._replying.acquire()
        s._mic_event("dropped", {"ms": 200, "barged": True})
        settle(s, .1)        # long enough for a thread that would fire
        self.assertEqual(s.again, [])

    def test_and_a_real_turn_is_never_second_guessed(self):
        """Long enough to be a sentence: it was heard, and the pill stays
        stopped because somebody is talking to it."""
        s = Stub()
        s._mic_event("barge_in", {})
        settle(s, .1)        # long enough for a thread that would fire
        self.assertEqual(s.again, [])
