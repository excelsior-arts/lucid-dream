"""Opening a conversation: this one, the last one, or a new one.

Three different things, and two of them used to be the same thing. Reloading a
page, losing a socket, or coming back from the box all mean "carry on" — and
that is the default, because losing the thread to a dropped connection is a bug
wearing a design's clothes. But /session_new means the other thing, and for two
hours after an evening began it quietly handed the old conversation back, said
"picking up where you left off", and left somebody looking at a transcript they
had just asked to be done with.

Driven through a stand-in: what is under test is which branch is taken, and the
branches are the whole of what can be wrong here.
"""
import queue
import threading
import unittest

from tests import clean
from lucid_talk.session import Session


class FakeStore:
    """The transcript, as far as open_session is concerned."""

    def __init__(self):
        self.asked = []
        self.persona = "lover"
        self.scene = ""
        self.session_id = "2026-06-06T06-06-06_lover"

    def start(self, slug, pill):
        self.asked.append("new")
        return self.session_id

    def adopt(self, sid, slug, pill):
        """The real one takes a well-formed name for this pill that has no
        file behind it. Here: anything ending in this persona's slug."""
        if not str(sid).endswith("_" + slug):
            return False
        self.asked.append("adopted " + sid)
        self.session_id = sid
        return True

    def resume(self, sid):
        self.asked.append(sid)
        # Resuming *moves* the store, the way the real one does — which is the
        # whole point of the address test below.
        self.session_id = sid
        return [{"role": "user", "content": "before"},
                {"role": "assistant", "content": "and after"}]


class Stub:
    open_session = Session.open_session
    _open_session = Session._open_session
    _addressed = Session._addressed
    emit = Session.emit

    SETTLE_WAIT = Session.SETTLE_WAIT

    def __init__(self, recent="2026-01-01T00-00-00_lover"):
        self.recent = recent
        self.settled = []
        self._replying = threading.Lock()
        self._opening = threading.RLock()
        self.events = queue.Queue()
        self._address = {"sid": "", "pill": "lover"}
        self.store = FakeStore()
        self.history = []
        self.scene = ""
        self.session_id = ""
        self._scene_at = 0
        self._scene_new = False
        self.folded_upto = 0
        self.voice = type("V", (), {"tts": None})()
        self.persona = {"slug": "lover", "pill": "Purple", "place": "a warm room"}
        self.cfg = {"llm": {"context_turns": 6}}

    @property
    def opened(self):
        return self.store.asked

    def _recent_session(self):
        self._resuming = "picking up where you left off — 1 minutes ago"
        return self.recent

    def take_hands(self):
        return ""

    def stop_continuous(self):
        self.settled.append("run stopped")

    def silence(self):
        self.settled.append("silenced")
        return 1

    def _apply_persona_style(self, p):
        pass


class WhichConversation(unittest.TestCase):
    def setUp(self):
        clean()

    def test_by_default_it_carries_on(self):
        """A reload, a dropped socket, the box's door — all of them mean the
        conversation somebody was in a moment ago."""
        s = Stub()
        s.open_session()
        self.assertIn("2026-01-01T00-00-00_lover", s.opened)
        self.assertNotIn("new", s.opened)

    def test_asked_for_a_new_one_it_starts_a_new_one(self):
        s = Stub()
        s.open_session(fresh=True)
        self.assertEqual(s.opened, ["new"],
                         "asked for a new conversation and got the old one back")

    def test_a_named_one_is_opened_whatever_else_is_recent(self):
        s = Stub()
        s.open_session("2026-05-05T05-05-05_lover")
        self.assertEqual(s.opened, ["2026-05-05T05-05-05_lover"])

    def test_with_nothing_to_carry_on_from_it_starts_one(self):
        s = Stub(recent=None)
        s.open_session()
        self.assertEqual(s.opened, ["new"])

    def test_a_new_conversation_begins_where_the_room_is(self):
        """The seed: the pill knows what it is standing in before anybody has
        said anything. A first line, not a fact — see scene.py."""
        s = Stub(recent=None)
        s.open_session()
        self.assertEqual(s.scene, "a warm room")

    def test_the_scene_is_a_guess_until_it_has_been_rewritten(self):
        """In a new conversation it is the room; in a resumed one it is
        wherever the two of them were weeks ago. Both ride along in every
        prompt until the first note replaces them."""
        for s in (Stub(recent=None), Stub()):
            s.open_session()
            self.assertTrue(s._scene_new)


class ItSaysWhoseConversationItIs(unittest.TestCase):
    """A reopened evening drew every line of itself as "the pill".

    The page labels each message as it arrives, and the name of the pill rides
    on the room — which is restored last, on purpose, so that it lands on a page
    that already has the conversation in it. Which meant the labels were always
    written before the name was known.
    """

    def setUp(self):
        clean()

    def sent(self, kind):
        s = Stub()
        s.history = [{"role": "user", "content": "hello"},
                     {"role": "assistant", "content": "you came back"}]
        s.open_session("2026-01-01T00-00-00_lover")
        out = []
        while not s.events.empty():
            out.append(s.events.get())
        return [e for e in out if e.get("type") == kind]

    def test_the_conversation_arrives_with_the_pill_that_had_it(self):
        history = self.sent("history")
        self.assertTrue(history, "no conversation was sent to the page")
        self.assertEqual(history[0].get("persona_name"), "Purple",
                         "the page has to guess whose lines these are")

    def test_and_the_conversation_itself_is_still_there(self):
        history = self.sent("history")
        self.assertEqual(len(history[0].get("messages") or []), 2)


class LeavingTheOldOneTidy(unittest.TestCase):
    """A transcript is the one thing here with no second copy.

    A reply in flight is holding the old conversation: it has already written
    the line it is answering and will write the answer when the voice finishes.
    Opening a new conversation underneath it splits that turn across two files
    — one with a question and no answer, one with an answer and no question —
    and nothing notices, because both files are perfectly well-formed.
    """

    def setUp(self):
        clean()

    def test_the_run_is_stopped_and_the_voice_silenced_first(self):
        s = Stub()
        s.open_session(fresh=True)
        self.assertEqual(s.settled, ["run stopped", "silenced"],
                         "a continuous run carried on into the new conversation")

    def test_it_waits_for_the_turn_in_flight(self):
        s = Stub()
        held = threading.Event()
        opened = threading.Event()

        s._replying.acquire()               # a reply, mid-turn
        threading.Thread(target=lambda: (s.open_session(fresh=True),
                                         opened.set()), daemon=True).start()
        self.assertFalse(opened.wait(.3),
                         "the conversation was swapped under a running reply")
        self.assertEqual(s.opened, [], "and the new file had already been made")
        s._replying.release()               # the turn finishes
        self.assertTrue(opened.wait(2))
        self.assertEqual(s.opened, ["new"])

    def test_and_hands_the_floor_back_when_it_is_done(self):
        """Held past the end, the next thing anybody said would wait forever."""
        s = Stub()
        s.open_session(fresh=True)
        self.assertTrue(s._replying.acquire(timeout=.5),
                        "opening a conversation kept the floor")

    def test_a_reply_that_will_not_stop_does_not_wedge_the_door(self):
        """Silence should end it. If something is stuck anyway, opening a
        conversation is still what was asked for — late and whole beats never.
        """
        s = Stub()
        s.SETTLE_WAIT = .2
        s._replying.acquire()
        done = threading.Event()
        threading.Thread(target=lambda: (s.open_session(fresh=True),
                                         done.set()), daemon=True).start()
        self.assertTrue(done.wait(3), "a stuck reply blocked /session_new for good")
        self.assertEqual(s.opened, ["new"])


class AndItSaysWhichConversationItIs(unittest.TestCase):
    """A conversation's own transcript, addressed to the one it replaced.

    Opening one is not a single moment: the store moves, the persona may move
    with it, and then the session says a number of things — that it resumed,
    what the room looks like, and the whole transcript. All of that is *about*
    the new conversation and must be addressed to it.

    Addressed at the end instead, after everything had been said, the last
    thing out was the transcript wearing the id of the conversation before it.
    A page that deep-linked to an old evening — the ordinary way of picking one
    out of the box — turned its own history away as somebody else's and sat
    there empty, with no error anywhere.
    """

    def setUp(self):
        clean()

    def said(self, s, kind):
        return [m for m in list(s.events.queue) if m["type"] == kind]

    def test_the_transcript_is_addressed_to_its_own_conversation(self):
        s = Stub()
        s.open_session("2026-03-03T03-03-03_lover")
        [history] = self.said(s, "history")
        self.assertEqual(history["sid"], "2026-03-03T03-03-03_lover",
                         "a page deep-linking to this conversation would turn "
                         "its own transcript away")
        self.assertEqual(len(history["messages"]), 2)

    def test_and_so_is_everything_else_said_about_it(self):
        s = Stub()
        s.open_session("2026-03-03T03-03-03_lover")
        for m in list(s.events.queue):
            self.assertEqual(m["sid"], "2026-03-03T03-03-03_lover",
                             f"{m['type']} went out under the old conversation")

    def test_a_new_conversation_is_addressed_to_itself_too(self):
        s = Stub()
        s.open_session(fresh=True)
        [history] = self.said(s, "history")
        self.assertEqual(history["sid"], s.session_id)

    def test_an_empty_conversation_keeps_the_name_the_page_asked_for(self):
        """A conversation nobody has spoken in has no file — store.start
        leaves the writing until there is something to write. So the address
        bar of a room somebody opened and came back to names, on disk, nothing
        at all.

        The address bar is the request, and the answer is to make it true: the
        name was only ever a name and the transcript is empty either way. Told
        "no such session" and handed a different one, the page went on asking
        after the conversation it had been promised and turned away every word
        of the one it was actually in.
        """
        class Empty(FakeStore):
            def resume(self, sid):
                self.asked.append(sid)
                raise FileNotFoundError(sid)
        s = Stub()
        s.store = Empty()
        s.open_session("2026-03-03T03-03-03_lover")
        self.assertEqual(s.session_id, "2026-03-03T03-03-03_lover",
                         "the page asked for a conversation and got another")
        self.assertEqual(s._address["sid"], "2026-03-03T03-03-03_lover")
        self.assertEqual(s.history, [], "an empty conversation is empty")
        self.assertNotIn("new", s.opened)

    def test_but_not_a_name_belonging_to_another_pill(self):
        """A conversation carries its pill in its name. Adopting one that ends
        in another's would put an evening in History under a pill that was
        never in it."""
        class Empty(FakeStore):
            def resume(self, sid):
                raise FileNotFoundError(sid)
        s = Stub()
        s.store = Empty()
        s.open_session("2026-03-03T03-03-03_thinker")
        self.assertIn("new", s.opened, "it did not start one instead")
        self.assertEqual(s._address, {"sid": s.session_id, "pill": "lover"})

    def test_and_it_does_not_go_hunting_for_another_evening(self):
        """Falling through to "the most recent one" asks the same question
        that just failed and is handed the same answer, for ever."""
        class Empty(FakeStore):
            def resume(self, sid):
                self.asked.append(sid)
                raise FileNotFoundError(sid)
        s = Stub()
        s.store = Empty()
        s.open_session("2026-03-03T03-03-03_thinker")
        self.assertEqual(s.opened.count("2026-03-03T03-03-03_thinker"), 1,
                         "it asked again for the one that is not there")
