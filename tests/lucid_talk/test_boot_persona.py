"""Which pill a cold machine wakes up as.

A session with nothing in it is whichever persona sorts first — Lover, by an
accident of the alphabet. Everything the boot does afterwards reads that:
which conversation gets opened, and which voice reference is handed to
Chatterbox when the voice model finishes loading.

A page arriving on a Thinker link says so, but it says so over a socket, on
another thread, while the boot is already several seconds into loading. If its
word lands after the voice has been set, the reply that follows opens in
Lover's voice and changes to Thinker's partway through — one sentence in the
wrong voice, which is worse than the whole reply being wrong, because it reads
as the room being haunted rather than as a bug.

So the start is told which pill it is at the moment it is asked for, and adopts
it before anything reads self.persona.
"""
import unittest

from tests import clean
from lucid_talk import personas as P
from lucid_talk.session import Session


class Booting:
    """Just the part of a Session that decides who it is waking up as."""

    _adopt_boot_persona = Session._adopt_boot_persona
    start_stack = Session.start_stack

    def __init__(self):
        self.persona = P.listing()[0]
        self._boot_as = ""
        self.running = False
        self._boot = None
        self.touched = 0

    def touch(self):
        self.touched += 1

    def _boot_stack(self):
        """The thread start_stack spawns. Nothing here loads a model."""
        self.booted = True


class AColdStartIsWhoeverWasAskedFor(unittest.TestCase):
    def setUp(self):
        clean()

    def test_the_default_is_still_whichever_sorts_first(self):
        b = Booting()
        b._adopt_boot_persona()
        self.assertEqual(b.persona["slug"], P.listing()[0]["slug"],
                         "nothing was asked for and it changed anyway")

    def test_a_named_pill_is_adopted_before_anything_reads_it(self):
        others = [p for p in P.listing() if p["slug"] != P.listing()[0]["slug"]]
        if not others:
            self.skipTest("only one persona is on offer")
        wanted = others[0]["slug"]
        b = Booting()
        b.start_stack(wanted)
        b._adopt_boot_persona()
        self.assertEqual(b.persona["slug"], wanted,
                         "the boot woke up as the wrong pill")

    def test_it_is_asked_for_once_and_not_remembered(self):
        """The next start has no page behind it — a console Start, an idle
        machine coming back — and must not be dragged to an old link's pill."""
        others = [p for p in P.listing() if p["slug"] != P.listing()[0]["slug"]]
        if not others:
            self.skipTest("only one persona is on offer")
        b = Booting()
        b.start_stack(others[0]["slug"])
        b._adopt_boot_persona()
        b.persona = P.listing()[0]          # somebody switched back
        b._adopt_boot_persona()
        self.assertEqual(b.persona["slug"], P.listing()[0]["slug"],
                         "a stale request pulled the pill back")

    def test_a_name_that_is_not_a_pill_leaves_it_alone(self):
        b = Booting()
        was = b.persona["slug"]
        b.start_stack("../../etc/passwd")
        b._adopt_boot_persona()
        self.assertEqual(b.persona["slug"], was, "it booted as nothing at all")

    def test_starting_without_a_name_does_not_clear_one_already_asked_for(self):
        """Two ways in at once: a page names the pill, and something else asks
        for the same start a moment later. The name must survive."""
        others = [p for p in P.listing() if p["slug"] != P.listing()[0]["slug"]]
        if not others:
            self.skipTest("only one persona is on offer")
        b = Booting()
        b.start_stack(others[0]["slug"])
        b.start_stack()                      # a mic press, a typed line
        b._adopt_boot_persona()
        self.assertEqual(b.persona["slug"], others[0]["slug"],
                         "the second asker threw away the first one's name")


if __name__ == "__main__":
    unittest.main()
