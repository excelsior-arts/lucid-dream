"""Presses on things in the room, and when they become a turn.

A press is a turn like any other, but it arrives at whatever moment a hand
happens to move, and what happens next depends on what the machine is doing.
A dose that is playing ignores it: somebody who set a scene and pressed Play is
lying back for a quarter of an hour, and a hand brushing the screen should not
take the floor. Otherwise it is answered at once, interrupting the voice if
there is one, because whoever is pressing things while it talks is exploring
the room rather than listening. Only a reply still being written is left alone
-- that press goes in with the turn it landed on.

Every part of that is timing, and timing is the thing that fails without
raising anything: presses sit there, and turn up ten minutes later in a bundle,
and it reads as the pill having ignored you and then suddenly caught up.

Exercised through a stand-in rather than a real Session, which would want three
models and a microphone. What is under test is the arithmetic of the pooling
and the decisions about when to speak — which is all of it that can be wrong
in a way nobody sees.
"""
import threading
import time
import unittest

from lucid_talk.session import Session


class Stub:
    """Enough of a session for the hands to work on."""

    HANDS_SETTLE = .05          # the real one waits longer; this is the shape
    AGAIN = Session.AGAIN

    # the methods under test, bound to this instead
    did = Session.did
    take_hands = Session.take_hands
    speaking = Session.speaking
    _hands_soon = Session._hands_soon
    _hands_turn = Session._hands_turn

    def __init__(self, running=True, replying=False, waiting=0.0, playing=False):
        self._hands = []
        self._hands_lock = threading.Lock()
        self._hands_timer = None
        self.running = running
        self._replying = threading.Lock()
        if replying:
            self._replying.acquire()
        self.speaker = type("S", (), {"remaining_s": waiting})()
        self.said = []          # turns it decided to take
        self.logged = []
        self.started = 0
        self.silenced = 0
        self._playing = playing

    # A dose with time left on it. The real one counts seconds down; all that
    # is under test here is whether a press is taken at all.
    def continuous_left(self):
        return 60.0 if self._playing else 0.0

    def silence(self):
        self.silenced += 1
        self.speaker.remaining_s = 0

    # what the real one does with the outside world
    def touch(self):
        pass

    def emit(self, kind, **payload):
        if kind == "log":
            self.logged.append(payload.get("text", ""))

    def start_stack(self):
        self.started += 1

    def reply_to(self, text, hidden=False):
        self.said.append(text)


def settle(s, ms=400):
    """Wait for whatever it decided to do, and no longer."""
    for _ in range(int(ms / 10)):
        if s.said:
            return
        time.sleep(.01)


class WhenItIsQuiet(unittest.TestCase):
    def test_one_press_becomes_a_turn(self):
        s = Stub()
        s.did("(he tries the door)")
        settle(s)
        self.assertEqual(s.said, ["(he tries the door)"])

    def test_a_flurry_arrives_as_one_thing_done(self):
        """Pressing is instant and a reply is not. Four presses in a second
        are one turn, or the pill answers four times over the top of itself."""
        s = Stub()
        for _ in range(4):
            s.did("(he pushes a book off the ledge)")
            time.sleep(.005)
        settle(s)
        self.assertEqual(len(s.said), 1)
        self.assertIn("and again", s.said[0])

    def test_nothing_at_all_is_not_a_turn(self):
        s = Stub()
        s.did("")
        s.did("   ")
        settle(s, 120)
        self.assertEqual(s.said, [])


class WhileItIsTalking(unittest.TestCase):
    def test_a_press_waits_rather_than_interrupting(self):
        s = Stub(replying=True)
        s.did("(he knocks a cushion onto the floor)")
        settle(s, 200)
        self.assertEqual(s.said, [], "it spoke over its own reply")
        self.assertEqual(s._hands, ["(he knocks a cushion onto the floor)"])

    def test_and_is_answered_when_the_reply_ends(self):
        """The half that was missing. They pooled correctly and then sat
        there: nothing looked at the pool again until something *else* was
        pressed, so four things done ten minutes apart arrived together."""
        s = Stub(replying=True)
        s.did("(he tries the door)")
        settle(s, 150)
        self.assertEqual(s.said, [])
        s._replying.release()          # the reply is over
        s._hands_soon()                # which is what reply_to does now
        settle(s)
        self.assertEqual(s.said, ["(he tries the door)"])

    def test_a_press_takes_the_floor_while_the_voice_is_going(self):
        """It used to wait for the voice to finish, which is right if the wait
        is a second and a half. Replies run forty seconds and more, so the
        press arrived a topic late and read as the room ignoring it. Whoever
        is pressing things while it talks is exploring the room, not listening
        to the answer, and gets answered now -- the trade the microphone
        already makes."""
        s = Stub(waiting=5.0)
        s.did("(he looks into the mirror)")
        settle(s)
        self.assertEqual(s.silenced, 1, "it talked over its own voice")
        self.assertEqual(s.said, ["(he looks into the mirror)"])

    def test_but_a_reply_still_being_written_is_not_interrupted(self):
        """Only sound is worth taking the floor from. A press made while the
        reply is still being written goes in with that turn -- see take_hands
        in _reply -- which is better than killing a turn that has not used the
        floor yet."""
        s = Stub(replying=True)
        s.did("(he knocks a cushion onto the floor)")
        settle(s, 200)
        self.assertEqual(s.silenced, 0)
        self.assertEqual(s._hands, ["(he knocks a cushion onto the floor)"])


class WhileTheDoseIsPlaying(unittest.TestCase):
    """Somebody who set a scene and pressed Play is lying back for a quarter
    of an hour. A hand brushing the screen must not take the floor away."""

    def test_a_press_during_a_run_is_scenery(self):
        s = Stub(playing=True, waiting=5.0)
        s.did("(he knocks a cushion onto the floor)")
        settle(s, 200)
        self.assertEqual(s.said, [], "a press broke into a playing dose")
        self.assertEqual(s.silenced, 0, "a press silenced a playing dose")
        self.assertEqual(s._hands, [], "it was kept, and will surface later")

    def test_and_is_not_kept_for_afterwards(self):
        """Pooling it would answer a cushion knocked over ten minutes ago,
        once the dose ran out. Ignored means ignored."""
        s = Stub(playing=True)
        for _ in range(5):
            s.did("(he pushes a book)")
        self.assertEqual(s._hands, [])


class TheEndOfAReplyLooksBack(unittest.TestCase):
    """The test above proves the pool empties when it is asked to. This one
    proves somebody asks — which is the part that was missing, and which no
    stand-in can check, because the asking is done by the real reply_to."""

    def test_reply_to_wakes_the_hands_when_it_finishes(self):
        import inspect
        src = inspect.getsource(Session.reply_to)
        self.assertIn("_hands_soon", src,
                      "nothing looks at the pool when a reply ends, so a press "
                      "made while the pill was speaking waits for the next one")
        after = src[src.index("finally:"):]
        self.assertIn("_hands_soon", after,
                      "it has to be in the finally, or a reply that throws "
                      "takes the presses with it")


class WithNothingLoaded(unittest.TestCase):
    def test_a_press_on_a_cold_machine_starts_it(self):
        s = Stub(running=False)
        s.did("(he tries the door)")
        settle(s, 120)
        self.assertEqual(s.started, 1)
        self.assertEqual(s.said, [], "it answered before anything was loaded")
        self.assertEqual(s._hands, ["(he tries the door)"],
                         "the press was dropped rather than kept")

    def test_and_the_press_is_still_there_when_it_comes_up(self):
        s = Stub(running=False)
        s.did("(he tries the door)")
        settle(s, 120)
        s.running = True
        s._hands_turn()                # what the end of the boot does
        settle(s)
        self.assertEqual(s.said, ["(he tries the door)"])


class HowARunReads(unittest.TestCase):
    def test_the_same_press_over_and_over(self):
        s = Stub()
        for n, want in ((1, ""), (2, "(and again)"), (3, "(and again, twice more)"),
                        (5, "(and again, and again)")):
            s._hands = ["(he pushes a book)"] * n
            out = s.take_hands()
            self.assertEqual(out, ("(he pushes a book) " + want).strip(), f"{n} presses")

    def test_different_things_keep_their_order(self):
        s = Stub()
        s._hands = ["(a)", "(b)", "(b)", "(c)"]
        self.assertEqual(s.take_hands(), "(a) (b) (and again) (c)")

    def test_a_drum_solo_is_not_kept_in_full(self):
        s = Stub()
        for _ in range(40):
            s.did("(he pushes a book)")
        self.assertLessEqual(len(s._hands), 12)
