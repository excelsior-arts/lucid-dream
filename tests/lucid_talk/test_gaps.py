"""The gaps inside a reply are not the room going quiet.

A reply is a run of sentences, and the next one is still being generated while
the last one finishes. In that gap the page has nothing queued and nothing
playing, so it truthfully reports zero — and the microphone gate, which reads
exactly that, opens. The pill's next sentence then arrives into an open mic.

Where the browser cancels its own echo this costs nothing: what is heard is
silence and the turn is dropped as too short. Where it does not — Firefox on a
Mac reports cancellation it is not really doing — the pill's own next sentence
is transcribed as something the person said, which cuts the reply off and then
answers it.

Barge-in is not involved, and turning barge-in off does not help. That is most
of what made it hard to place: every obvious switch is somewhere else.
"""
import unittest

from tests import clean
from lucid_talk.session import BrowserSink


class Sink(BrowserSink):
    def __init__(self):
        super().__init__(lambda *a, **k: None, lambda: True)


class TheMicrophoneGate(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_page_with_nothing_to_play_is_not_playing(self):
        s = Sink()
        s.report(0.0)
        self.assertFalse(s.playing)

    def test_but_a_gap_inside_a_reply_is(self):
        """The whole fix: the pill is mid-turn, so the gate stays shut even
        though there is genuinely nothing sounding this instant."""
        s = Sink()
        s.hold(True)
        s.report(0.0)
        self.assertTrue(s.playing, "the microphone opened between two sentences")

    def test_and_it_opens_again_when_the_turn_is_over(self):
        s = Sink()
        s.hold(True)
        s.report(0.0)
        s.hold(False)
        self.assertFalse(s.playing)

    def test_stopping_lets_go_of_it(self):
        """Silence means silence: nothing more is coming, so nothing should
        keep the gate shut waiting for it."""
        s = Sink()
        s.hold(True)
        s.stop()
        self.assertFalse(s.playing)

    def test_and_so_does_a_soft_stop(self):
        s = Sink()
        s.hold(True)
        s.stop(soft=True)
        self.assertFalse(s.playing)

    def test_holding_does_not_invent_audio_to_pace_against(self):
        """The continuous loop starts the next turn when the queue runs low.
        A hold that inflated that would keep it waiting for audio that does
        not exist."""
        s = Sink()
        s.hold(True)
        s.report(0.0)
        self.assertEqual(s.remaining_s, 0.0)


class AndEveryWayOutOfATurnLetsGo(unittest.TestCase):
    """Held past the end, the gate never opens again and the drain loop in
    _reply spins for ever: it waits on the very flag the hold is forcing."""

    def test_every_hold_has_a_release(self):
        import inspect
        from lucid_talk.session import Session
        for fn in (Session._reply, Session.speak_again):
            src = inspect.getsource(fn)
            self.assertEqual(src.count("hold(True)"), 1, fn.__name__)
            self.assertGreaterEqual(src.count("hold(False)"), 1, fn.__name__)

    def test_and_the_drain_loop_is_never_inside_one(self):
        import inspect
        from lucid_talk.session import Session
        for fn in (Session._reply, Session.speak_again):
            src = inspect.getsource(fn)
            drain = src.index("while self.speaker.playing")
            self.assertLess(src.index("hold(False)"), drain,
                            f"{fn.__name__} waits on a flag it is holding true")
