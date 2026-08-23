"""Pausing the voice pauses the run behind it.

The tape is a clock on the wall and the loop paces itself on how much is left
to be heard — and what it is told about that is what the page has queued, aged
by however long ago the page said so, because audio in a browser drains
whether anybody asks it to or not. So a paused page reads as an emptying one:
the machine writes ahead into a silence that is not coming, and the dose spends
itself while nobody is listening. Both halves of that are arithmetic, which is
why they are checked here rather than by pressing the key and watching.
"""
import threading
import time
import unittest

from lucid_talk.session import Session


class Speaker:
    """Just enough to be stopped, softly or otherwise."""
    playing = False

    def __init__(self):
        self.stopped = []

    def stop(self, soft=False):
        self.stopped.append("soft" if soft else "hard")


class Stub:
    hold_continuous = Session.hold_continuous
    continuous_left = Session.continuous_left
    _busy = Session._busy
    cut_in = Session.cut_in
    steer = Session.steer

    def __init__(self, minutes=20.0):
        self._cont_until = time.monotonic() + minutes * 60 if minutes else 0.0
        self._cont_hold = False
        self._cont_saved = 0.0
        self.said = []
        self._replying = threading.Lock()
        self.stop_reply = threading.Event()
        self.speaker = Speaker()
        self.silenced = 0

    def silence(self):
        self.silenced += 1

    def emit(self, kind, **payload):
        self.said.append((kind, payload))


class AClockThatStops(unittest.TestCase):
    def test_holding_freezes_what_is_left(self):
        s = Stub(minutes=20)
        self.assertTrue(s.hold_continuous(True))
        was = s.continuous_left()
        time.sleep(.15)
        self.assertEqual(s.continuous_left(), was, "the dose spent itself while held")

    def test_and_going_on_hands_it_back(self):
        s = Stub(minutes=20)
        s.hold_continuous(True)
        was = s.continuous_left()
        time.sleep(.15)
        self.assertTrue(s.hold_continuous(False))
        self.assertAlmostEqual(s.continuous_left(), was, delta=.05)

    def test_the_run_is_still_a_run_while_it_is_held(self):
        """The loop's own condition is "is there time left" — a hold that
        answered no would end the run instead of pausing it."""
        s = Stub(minutes=20)
        s.hold_continuous(True)
        self.assertGreater(s.continuous_left(), 0)

    def test_holding_twice_is_holding_once(self):
        s = Stub(minutes=20)
        self.assertTrue(s.hold_continuous(True))
        was = s.continuous_left()
        self.assertFalse(s.hold_continuous(True))
        self.assertEqual(s.continuous_left(), was)

    def test_and_letting_go_of_nothing_does_nothing(self):
        s = Stub(minutes=20)
        self.assertFalse(s.hold_continuous(False))

    def test_pausing_the_voice_with_no_run_behind_it(self):
        """Ordinary pause, no tape running. There is nothing to hold and
        nothing to say about it."""
        s = Stub(minutes=0)
        self.assertFalse(s.hold_continuous(True))
        self.assertEqual(s.said, [])

    def test_it_says_so_each_way_so_the_clock_on_screen_agrees(self):
        s = Stub(minutes=20)
        s.hold_continuous(True)
        s.hold_continuous(False)
        kinds = [k for k, _ in s.said]
        self.assertEqual(kinds, ["continuous", "continuous"])
        self.assertTrue(all(p.get("on") for _, p in s.said))


class TheLoopStopsProducing(unittest.TestCase):
    def test_the_run_checks_the_hold_before_taking_a_turn(self):
        """No stand-in can check this: it is a branch inside the loop."""
        import inspect
        src = inspect.getsource(Session._continuous_loop)
        self.assertIn("_cont_hold", src,
                      "held, the run goes on writing turns nobody is hearing")
        # and before it commits to a turn, not after
        self.assertLess(src.index("_cont_hold"), src.index("reply_to"))


class StoppingClearsIt(unittest.TestCase):
    def test_a_new_run_does_not_start_held(self):
        import inspect
        for fn in (Session.start_continuous, Session.stop_continuous):
            self.assertIn("_cont_hold = False", inspect.getsource(fn),
                          f"{fn.__name__} can leave a run held from last time")


class AndTheRoomAroundIt(unittest.TestCase):
    """A hold stops the run. It should not also stop everything that asks
    whether the run is going."""

    def test_a_held_run_does_not_keep_the_machine_awake(self):
        """The idle timer exists for the evening somebody walks away from, and
        pausing the voice is a very ordinary way to walk away. Held counted as
        busy, so the models sat there until morning."""
        s = Stub(minutes=20)
        self.assertTrue(s._busy(), "a running tape is company")
        s.hold_continuous(True)
        self.assertFalse(s._busy(), "a paused tape kept several gigabytes resident")

    def test_but_a_running_one_still_does(self):
        s = Stub(minutes=20)
        self.assertTrue(s._busy())

    def test_typing_during_a_run_steers_rather_than_cutting(self):
        """The line being spoken lands; what was queued behind it is dropped.

        Cutting a voice off mid-word to answer somebody reads as a machine
        glitching, and the half second it costs to finish the line is the
        difference between being interrupted and being listened to. What it
        must not do is nothing, which is what it did: the pill finished its
        line and carried on with its own evening.
        """
        s = Stub(minutes=20)
        self.assertTrue(s.cut_in(), "typing during a run did nothing at all")
        self.assertEqual(s.speaker.stopped, ["soft"],
                         "it cut the sentence off instead of letting it land")
        self.assertEqual(s.silenced, 0, "a steer is not a silencing")
        self.assertTrue(s.stop_reply.is_set(), "it would have gone on generating")

    def test_but_held_it_is_an_ordinary_interruption(self):
        """Held, nothing is talking — so typing takes the floor the way it
        would with nothing running at all."""
        s = Stub(minutes=20)
        s.hold_continuous(True)
        self.assertTrue(s.cut_in())
        self.assertEqual(s.silenced, 1)
