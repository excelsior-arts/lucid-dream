"""The return address on everything a session says.

One stack, one conversation at a time, and every page connected hears about it
whether or not it is the page that asked — so each message carries which pill
and which conversation it belongs to, and a page keeps its own and turns away
the rest. Get that wrong and the failure never looks like a wrong address: it
looks like a Thinker page whose address bar says it is in a conversation of
Lover's, and which then turns away every real message as somebody else's and
puts up the banner saying another window has the machine.

It was wrong in the most quietly awful way available. Events cross from worker
threads to the event loop through a queue, and the address went on as the loop
*drained* the queue rather than as the message was *made* — so a line written
before a pill was swapped could be posted after it, wearing the new pill's
name over the old conversation's id. A page opening on that pill has no
conversation of its own yet, believes the first thing addressed to it, and
takes that id for its own.

None of which is reachable from a unit test through the UI, and none of which
needs to be: the defect is that a message can be stamped at a moment other
than the one it was made in, and that is arithmetic.
"""
import inspect
import queue
import unittest

from tests import clean
from lucid_talk.session import Session
from lucid_talk.server import whose_msg


class Stub:
    """A session, as far as an address is concerned."""

    emit = Session.emit

    def __init__(self, slug="lover", sid="2026-01-01T00-00-00_lover"):
        self.events = queue.Queue()
        self.persona = {"slug": slug, "pill": "Purple"}
        self.session_id = sid
        self._address = {"sid": sid, "pill": slug}

    def settle(self):
        """What open_session does at the end of every path it has."""
        self._address = {"sid": self.session_id, "pill": self.persona["slug"]}

    def posted(self):
        return list(self.events.queue)


class WhereAMessageSaysItIsFrom(unittest.TestCase):
    def setUp(self):
        clean()

    def test_it_says_where_it_was_made(self):
        s = Stub()
        s.emit("log", text="hello")
        [m] = s.posted()
        self.assertEqual((m["pill"], m["sid"]),
                         ("lover", "2026-01-01T00-00-00_lover"))

    def test_a_message_made_before_a_switch_is_not_readdressed_by_it(self):
        """The bug, in three lines. Said while Lover was here; posted after
        Thinker arrived; it is still Lover's line and must still say so."""
        s = Stub()
        s.emit("log", text="said while lover was here")
        s.persona = {"slug": "thinker", "pill": "Gold"}
        s.session_id = "2026-01-01T09-00-00_thinker"
        s.settle()
        [m] = s.posted()
        self.assertEqual(m["pill"], "lover",
                         "a line written before the switch went out under the "
                         "new pill's name")
        self.assertEqual(m["sid"], "2026-01-01T00-00-00_lover")

    def test_the_pair_is_never_half_changed(self):
        """Switching pills sets the persona and then opens that pill's
        conversation, and the two are only true together. Anything said in
        between must carry a pair that really existed — the old one — never
        the new name over the old id, which is the pair that poisons a page.
        """
        s = Stub()
        s.persona = {"slug": "thinker", "pill": "Gold"}   # mid-switch
        s.emit("log", text="stopping the run …")
        [m] = s.posted()
        self.assertEqual((m["pill"], m["sid"]),
                         ("lover", "2026-01-01T00-00-00_lover"),
                         "a message went out as the new pill in the old "
                         "conversation — a pair that never existed")

    def test_and_afterwards_it_is_the_new_one(self):
        s = Stub()
        s.persona = {"slug": "thinker", "pill": "Gold"}
        s.session_id = "2026-01-01T09-00-00_thinker"
        s.settle()
        s.emit("log", text="new session")
        [m] = s.posted()
        self.assertEqual((m["pill"], m["sid"]),
                         ("thinker", "2026-01-01T09-00-00_thinker"))

    def test_what_a_message_says_about_itself_is_kept(self):
        """A payload may name its own subject — the relation event names the
        pill it scored. Nothing here may quietly overwrite that."""
        s = Stub()
        s.emit("relation", pill="thinker", state={})
        [m] = s.posted()
        self.assertEqual(m["pill"], "thinker")


class AndWhatTheServerAddsOnTheWayOut(unittest.TestCase):
    """whose_msg fills in for what the server broadcasts on its own account —
    and must leave alone anything the session already addressed, or it undoes
    the whole of the above one queue later."""

    def test_an_addressed_message_is_left_alone(self):
        was = {"type": "log", "pill": "lover", "sid": "an-old-one", "text": "x"}
        self.assertEqual(whose_msg(dict(was)), was)

    def test_with_no_session_nothing_is_added(self):
        # server.session is None until the app starts; this must not raise.
        self.assertEqual(whose_msg({"type": "health"}), {"type": "health"})


class TheInvariantItself(unittest.TestCase):
    """Stated where somebody changing the constructor will meet it.

    Everything above is about a Session that has an address. A Session built
    without one emits messages carrying none — and a message with no address
    is one every page keeps, which is the original fault with the names taken
    off it.
    """

    def test_a_session_has_an_address_before_it_can_say_anything(self):
        import inspect
        self.assertIn("_address", inspect.getsource(Session.__init__))

    def test_and_opening_a_conversation_is_what_sets_it(self):
        self.assertIn("_address", inspect.getsource(Session.open_session))
