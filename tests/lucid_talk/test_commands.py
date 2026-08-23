"""A page that sends nonsense should still have a page to come back to.

Every control on the deck is a small JSON message down one socket, and one
receive loop reads all of them. That loop used to end on anything a handler
threw — and ending it does not close the socket or tell the page anything. The
connection stays open, the dot stays green, and every key from then on goes
into a socket nobody is listening to. Nothing in the console, nothing on
screen, and the only cure is a reload.

The ways in are ordinary: a minutes field arriving as null, a slug that came
through as an object, a queued-seconds field that is a string. None of them
are attacks; they are a page mid-reconnect, or a control read before its value
was set.
"""
import asyncio
import unittest

from lucid_talk import server as SRV


class Boom:
    """A session where everything asked of it goes wrong."""

    def __getattr__(self, name):
        def explode(*a, **k):
            raise ValueError(f"no: {name}")
        return explode


class Quiet:
    """A session that answers nothing and remembers being asked."""

    def __init__(self):
        self.asked = []

    def __getattr__(self, name):
        def note(*a, **k):
            self.asked.append(name)
            return None
        return note


def obey(session, msg):
    """One message through the real dispatch."""
    return asyncio.get_event_loop().run_until_complete(
        SRV.obey(session, msg, None))


class TheLoopSurvivesIt(unittest.TestCase):
    def setUp(self):
        asyncio.set_event_loop(asyncio.new_event_loop())

    def test_a_handler_that_throws_does_not_end_the_loop(self):
        for msg in ({"cmd": "continuous", "minutes": None},
                    {"cmd": "say", "text": "hello"},
                    {"cmd": "interrupt"},
                    {"cmd": "hold", "on": True}):
            with self.subTest(cmd=msg["cmd"]):
                obey(Boom(), msg)          # the assertion is that this returns

    def test_a_message_that_is_not_one_is_ignored(self):
        s = Quiet()
        for msg in ({}, {"cmd": None}, {"cmd": "no_such_command"}, None):
            obey(s, msg)
        self.assertEqual(s.asked, [], "something answered a message that said nothing")

    def test_what_went_wrong_is_said_out_loud(self):
        """Swallowed silently, this is the same bug wearing a quieter hat."""
        from shell import log as L
        before = len(L.ring)
        obey(Boom(), {"cmd": "continuous", "minutes": None})
        said = [r["text"] for r in list(L.ring)[before:]]
        self.assertTrue(any("continuous failed" in t for t in said),
                        f"nothing in the console named the command: {said}")

    def test_a_real_command_still_runs(self):
        """The guard is worth nothing if it is swallowing the ordinary case."""
        s = Quiet()
        obey(s, {"cmd": "interrupt"})
        self.assertIn("silence", s.asked)
