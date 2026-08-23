"""The seconds before anybody says anything.

The worst two seconds this program has are its first, and they are spent in
front of the person least willing to forgive them: somebody who has just taken
a pill, is standing in a room, and does not yet know whether any of this works.
Everything the machine does after that is fast. Getting there is not.

Two head starts are taken, and both of them live in the same window — the gap
between a room opening and a first word, which is seconds long and was being
spent watching. The models start loading on the way in rather than on the way
out of somebody's mouth. And once they are up, the prompt in front of them is
pushed through once with nothing to say, so the first real turn is priced as an
append to a prompt the server has already seen rather than as the whole of it.

What is tested here is mostly the *restraint*: an optimisation that overlaps a
real turn, or repeats itself on every reconnect, costs the thing it was meant
to save.
"""
import asyncio
import threading
import unittest

from pathlib import Path

from lucid_talk import server as SRV
from lucid_talk.session import Session

# A persona directory with no clip in it: voice_ref answers None, which is the
# same answer a draft persona gives, and warming does not depend on it.
NOWHERE = Path("/nonexistent/personas/stub")


def obey(session, msg):
    """One message through the real dispatch."""
    return asyncio.get_event_loop().run_until_complete(
        SRV.obey(session, msg, None))


class Room:
    """A session that remembers being asked, and nothing else."""

    warm_prompt = Session.warm_prompt
    warm_voice = Session.warm_voice
    warm_later = Session.warm_later

    def __init__(self, running=True, state="idle", warm_on_open=True):
        self.running = running
        self.state = state
        self.cfg = {"warm_on_open": warm_on_open}
        self.started = 0
        self.started_as = None
        self.warmed = []
        self._warmed = None
        self._replying = threading.Lock()
        self.llm = self
        self.history = []
        self.pending_say = ""
        self.said = []
        self.persona = {"slug": "lover", "name": "Lover", "home": NOWHERE}
        self.voice = self
        self.voices_warmed = 0
        self._warmed_voice = None

    # ---- what the session would have done ----
    def start_stack(self, slug=""):
        self.started += 1
        self.started_as = slug

    def open_for(self, *a, **k):
        pass

    def emit(self, kind, **payload):
        self.said.append((kind, payload.get("text", "")))

    def _live_persona(self):
        return {"slug": "lover", "name": "Lover", "prompt": "You are the Lover."}

    def _memory_block(self):
        return "\n\nremembered: nothing"

    def _relation_block(self):
        return "\n\nstanding: even"

    def _window(self):
        return list(self.history)

    def _unstick(self, m):
        return m

    def _state_press(self, m):
        return m

    def _scene_press(self, m):
        return m

    # ---- the model server, as far as this cares ----
    def warm(self, messages=None, system=None):
        """Both warms land here: the LLM's takes messages, the voice's does not."""
        if messages is None:
            self.voices_warmed += 1
        else:
            self.warmed.append((system, list(messages)))
        return True


class OpeningARoomStartsTheModels(unittest.TestCase):
    """The first honest sign that somebody means to play.

    It arrives seconds before the first word, and those seconds were being
    spent looking at a room while nothing loaded.
    """

    def setUp(self):
        asyncio.set_event_loop(asyncio.new_event_loop())

    def test_arriving_in_a_room_asks_for_the_stack(self):
        s = Room(running=False)
        obey(s, {"cmd": "open", "slug": "lover", "session": ""})
        self.assertEqual(s.started, 1, "the room opened and nothing began loading")

    def test_a_machine_that_cannot_afford_it_says_so(self):
        """Several gigabytes is a lot to spend on somebody having a look."""
        s = Room(running=False, warm_on_open=False)
        obey(s, {"cmd": "open", "slug": "lover", "session": ""})
        self.assertEqual(s.started, 0, "warm_on_open off, and it loaded anyway")

    def test_it_starts_as_the_pill_the_page_came_for(self):
        """A cold session is whichever persona sorts first. A page arriving on
        a Thinker link and getting Lover's voice for one sentence is what this
        prevents — see Session.start_stack."""
        s = Room(running=False)
        obey(s, {"cmd": "open", "slug": "thinker", "session": ""})
        self.assertEqual(s.started_as, "thinker",
                         "the boot was not told which pill it is")

    def test_every_other_way_in_is_untouched(self):
        """Typing at a cold machine still starts it — this adds a door, not a lock."""
        s = Room(running=False)
        obey(s, {"cmd": "say", "text": "hello"})
        self.assertEqual(s.started, 1, "the old way in stopped working")


class ThePromptIsPushedThroughOnce(unittest.TestCase):
    def test_an_open_room_warms_what_is_in_front_of_it(self):
        s = Room()
        s.warm_prompt()
        self.assertEqual(len(s.warmed), 1, "nothing was sent through")
        system, _ = s.warmed[0]
        self.assertIn("remembered", system, "the memories were left out of the warm")
        self.assertIn("standing", system, "the relation was left out of the warm")

    def test_the_same_prompt_is_not_paid_for_twice(self):
        """A reload, a reconnect, a phone waking: all of them re-open a room."""
        s = Room()
        s.warm_prompt()
        s.warm_prompt()
        s.warm_prompt()
        self.assertEqual(len(s.warmed), 1, "it warmed a prompt already in the cache")

    def test_a_conversation_that_moved_is_warmed_again(self):
        s = Room()
        s.warm_prompt()
        s.history.append({"role": "user", "content": "something happened"})
        s.warm_prompt()
        self.assertEqual(len(s.warmed), 2, "the prompt changed and nothing re-warmed")

    def test_a_warm_that_failed_is_not_remembered_as_done(self):
        s = Room()
        s.warm = lambda messages, system=None: False
        s.warm_prompt()
        s.warm = Room.warm.__get__(s)
        s.warm_prompt()
        self.assertEqual(len(s.warmed), 1, "a failed warm was recorded as a warm")


class TheVoiceIsWokenToo(unittest.TestCase):
    """What the pill will say cannot be known. What it costs to say the first
    thing is fixed, and has nothing to do with the words."""

    def test_the_voice_is_warmed_once(self):
        s = Room()
        s.warm_voice()
        s.warm_voice()
        self.assertEqual(s.voices_warmed, 1, "it woke a voice that was already awake")

    def test_a_pill_switch_owes_it_again(self):
        """The costly part is the speaker conditioning, and that is per voice."""
        s = Room()
        s.warm_voice()
        s.persona = {"slug": "thinker", "name": "Thinker", "home": NOWHERE}
        s.warm_voice()
        self.assertEqual(s.voices_warmed, 2, "a new voice was left cold")

    def test_a_turn_in_flight_keeps_the_floor(self):
        s = Room()
        s._replying.acquire()
        try:
            s.warm_voice()
        finally:
            s._replying.release()
        self.assertEqual(s.voices_warmed, 0, "a warm queued in front of somebody's turn")

    def test_the_switch_turns_it_off(self):
        s = Room(warm_on_open=False)
        s.warm_voice()
        self.assertEqual(s.voices_warmed, 0, "warm_on_open off, and it warmed anyway")


class ItStaysOutOfTheWay(unittest.TestCase):
    """Every guard here is a way this could cost rather than save."""

    def test_nothing_is_warmed_at_a_cold_machine(self):
        s = Room(running=False)
        s.warm_prompt()
        self.assertEqual(s.warmed, [], "it talked to a model server that is not up")

    def test_a_turn_in_flight_is_not_queued_behind_a_warm(self):
        """The lock is held by a real reply. Waiting for it would put this in
        front of the very thing it exists to make faster."""
        s = Room()
        s._replying.acquire()
        try:
            s.warm_prompt()
        finally:
            s._replying.release()
        self.assertEqual(s.warmed, [], "a warm queued in front of somebody's turn")

    def test_a_machine_mid_sentence_is_left_alone(self):
        for state in ("thinking", "speaking", "loading"):
            with self.subTest(state=state):
                s = Room(state=state)
                s.warm_prompt()
                self.assertEqual(s.warmed, [], f"warmed while {state}")

    def test_the_switch_turns_it_off(self):
        s = Room(warm_on_open=False)
        s.warm_prompt()
        self.assertEqual(s.warmed, [], "warm_on_open off, and it warmed anyway")


if __name__ == "__main__":
    unittest.main()
