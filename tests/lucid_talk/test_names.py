"""What a conversation may be called, and what may be done with a name.

The name arrives from a page's address bar and is turned straight into a path
under sessions/. An address bar is typed into by hand, arrives in links, and on
this program comes over the wifi from a phone with nothing in front of it — so
the name is checked rather than trusted.

It is also the answer to a smaller question. A conversation nobody has spoken
in has no file at all, so a page asking for one is asking for something that is
indistinguishable from nothing. Since the name was only ever a name, the honest
answer is to let it stand.
"""
import unittest

from tests import clean
from lucid_talk import paths
from lucid_talk.store import Store, could_be, exists, named_well, whose


class WhatCountsAsAName(unittest.TestCase):
    def test_the_ones_this_program_makes(self):
        for good in ("2026-08-21T10-49-23_thinker",
                     "2026-08-21T10-49-23-2_lover",
                     "2026-01-01T00-00-00_some-pill"):
            self.assertTrue(named_well(good), good)

    def test_and_nothing_else(self):
        for bad in ("", None, "../../../etc/passwd", "thinker",
                    "2026-08-21T10-49-23_thinker/../../x",
                    "/etc/passwd", "2026-08-21_thinker", "..", "x" * 300):
            self.assertFalse(named_well(bad), repr(bad))

    def test_a_name_says_whose_it_is(self):
        self.assertEqual(whose("2026-08-21T10-49-23_thinker"), "thinker")
        self.assertEqual(whose("../../etc/passwd"), "")


class NothingEscapesTheSessionsDirectory(unittest.TestCase):
    def setUp(self):
        clean()

    def test_resuming_something_that_is_not_a_name(self):
        s = Store()
        for bad in ("../../../etc/passwd", "..", "/etc/hosts", ""):
            with self.assertRaises(FileNotFoundError):
                s.resume(bad)

    def test_and_adopting_one(self):
        s = Store()
        for bad in ("../escape_lover", "/tmp/x_lover", "..%2f_lover"):
            self.assertFalse(s.adopt(bad, "lover", "Purple"))


class ANameWithNothingBehindIt(unittest.TestCase):
    def setUp(self):
        clean()

    def test_is_taken_as_this_conversation(self):
        s = Store()
        self.assertTrue(s.adopt("2026-03-03T03-03-03_lover", "lover", "Purple"))
        self.assertEqual(s.path.name, "2026-03-03T03-03-03_lover.jsonl")

    def test_and_the_file_still_waits_for_a_first_word(self):
        """The whole reason the file is late: rooms opened and left behind
        would otherwise fill History with empty evenings."""
        s = Store()
        s.adopt("2026-03-03T03-03-03_lover", "lover", "Purple")
        self.assertFalse((paths.SESSIONS / "2026-03-03T03-03-03_lover.jsonl").exists())
        s.append("user", "there you are")
        self.assertTrue((paths.SESSIONS / "2026-03-03T03-03-03_lover.jsonl").exists())

    def test_and_it_is_a_proper_transcript_when_it_arrives(self):
        s = Store()
        s.adopt("2026-03-03T03-03-03_lover", "lover", "Purple")
        s.append("user", "there you are")
        again = Store()
        self.assertEqual(again.resume("2026-03-03T03-03-03_lover"),
                         [{"role": "user", "content": "there you are"}])
        self.assertEqual(again.persona, "lover")

    def test_but_never_over_a_conversation_that_exists(self):
        s = Store()
        sid = s.start("lover", "Purple")
        s.append("user", "something said")
        self.assertFalse(Store().adopt(sid, "lover", "Purple"),
                         "adopting a real conversation would write over it")

    def test_and_never_under_another_pill_name(self):
        self.assertFalse(Store().adopt("2026-03-03T03-03-03_thinker",
                                       "lover", "Purple"))


class WhetherThereIsAnythingToOpen(unittest.TestCase):
    """What a page's address may be pointed at.

    Two conversations can be opened: one that has been spoken in, and one that
    has only been named — a room somebody opened, said nothing in, and came
    back to. Anything else is a page pointed at something that is not there,
    and is told so rather than quietly handed a different evening.
    """

    def setUp(self):
        clean()

    def test_one_that_has_been_spoken_in(self):
        s = Store()
        sid = s.start("lover", "Purple")
        s.append("user", "there you are")
        self.assertTrue(exists(sid))
        self.assertFalse(could_be(sid, "lover"), "it is on disk; resume it")

    def test_one_that_was_only_ever_named(self):
        sid = "2026-03-03T03-03-03_lover"
        self.assertFalse(exists(sid))
        self.assertTrue(could_be(sid, "lover"))

    def test_but_not_for_the_wrong_pill(self):
        self.assertFalse(could_be("2026-03-03T03-03-03_lover", "thinker"))

    def test_and_not_something_that_is_not_a_name(self):
        for bad in ("20260621T10-49-23_thinker", "hello", "../../etc/passwd", ""):
            self.assertFalse(exists(bad), bad)
            self.assertFalse(could_be(bad, "thinker"), bad)


class TwoCopiesOnOneMac(unittest.TestCase):
    """A second instance used to be hostile to the first.

    LLMServer.stop takes whatever holds the model's port, adopted or not —
    which is right for one instance putting its own strays down, and wrong for
    two instances on one machine: the second finds the first's model, adopts
    it, and kills it on the way out. It happened three times in one afternoon
    and looked, every time, like the app falling over on its own.
    """

    def test_the_port_can_be_moved(self):
        from lucid_talk import models as M
        was = M.LLM_PORT
        try:
            M.apply_config({"llm": {"port": 8099}})
            self.assertEqual(M.LLM_PORT, 8099)
            self.assertIn(":8099", M.llm_url())
        finally:
            M.apply_config({"llm": {"port": was}})

    def test_and_defaults_to_the_one_it_always_used(self):
        from lucid_talk import models as M
        was = M.LLM_PORT
        try:
            M.apply_config({"llm": {}})
            self.assertEqual(M.LLM_PORT, was)
        finally:
            M.apply_config({"llm": {"port": was}})
