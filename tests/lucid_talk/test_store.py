"""The transcripts. Everything else here can be rebuilt; these cannot.

A conversation is the only thing in this program with no second copy, and the
file format is the promise: append-only, one line per turn, so a crash or a
kill -9 costs the turn in flight and nothing before it. These check that the
promise holds, and that a damaged file costs one conversation rather than the
History sheet.
"""
import json
import unittest

from tests import clean
from lucid_talk import store as S
from lucid_talk.paths import SESSIONS


def said(store, *turns):
    for role, text in turns:
        store.append(role, text)


class Writing(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_session_nobody_said_anything_in_leaves_no_file(self):
        """Every restart used to leave a transcript containing nothing but its
        own header, and those buried the real conversations in History."""
        st = S.Store()
        sid = st.start("lover", "Purple")
        self.assertFalse((SESSIONS / f"{sid}.jsonl").exists())
        self.assertEqual(S.listing(), [])

    def test_what_was_said_comes_back_exactly(self):
        st = S.Store()
        sid = st.start("lover", "Purple")
        said(st, ("user", "hello"), ("assistant", "Hello.\nAnd again."),
                 ("user", "naïve café — ⏎ ok?"))
        back = S.Store().resume(sid)
        self.assertEqual([m["content"] for m in back],
                         ["hello", "Hello.\nAnd again.", "naïve café — ⏎ ok?"])
        self.assertEqual([m["role"] for m in back],
                         ["user", "assistant", "user"])

    def test_resuming_carries_the_persona_and_the_scene(self):
        st = S.Store()
        sid = st.start("thinker", "Gold")
        said(st, ("user", "hi"))
        st.append_scene("they are standing by the door")
        again = S.Store()
        again.resume(sid)
        self.assertEqual(again.persona, "thinker")
        self.assertEqual(again.scene, "they are standing by the door")

    def test_only_the_last_scene_counts(self):
        st = S.Store()
        sid = st.start("thinker", "Gold")
        said(st, ("user", "hi"))
        st.append_scene("first")
        st.append_scene("second")
        again = S.Store()
        again.resume(sid)
        self.assertEqual(again.scene, "second")

    def test_resuming_something_that_is_not_there_keeps_the_old_path_armed(self):
        """It used to clear the pending header on failure, and the turns that
        followed were appended to a previous transcript with no meta line."""
        st = S.Store()
        sid = st.start("lover", "Purple")
        said(st, ("user", "one"))
        with self.assertRaises(FileNotFoundError):
            st.resume("2019-01-01T00-00-00_nobody")
        said(st, ("user", "two"))
        self.assertEqual(len(S.Store().resume(sid)), 2)

    def test_taking_a_turn_back_out(self):
        st = S.Store()
        sid = st.start("lover", "Purple")
        said(st, ("user", "keep"), ("assistant", "drop"), ("user", "keep too"))
        self.assertTrue(st.remove("assistant", "drop"))
        self.assertEqual([m["content"] for m in S.Store().resume(sid)],
                         ["keep", "keep too"])

    def test_only_the_most_recent_copy_of_a_repeated_line_goes(self):
        st = S.Store()
        sid = st.start("lover", "Purple")
        said(st, ("user", "yes"), ("assistant", "a"), ("user", "yes"))
        st.remove("user", "yes")
        rows = S.Store().resume(sid)
        self.assertEqual([m["content"] for m in rows], ["yes", "a"])

    def test_removing_what_is_not_there_changes_nothing(self):
        st = S.Store()
        sid = st.start("lover", "Purple")
        said(st, ("user", "one"))
        self.assertFalse(st.remove("user", "two"))
        self.assertEqual(len(S.Store().resume(sid)), 1)


class Damage(unittest.TestCase):
    """Half a line at the end is what a kill -9 leaves behind."""

    def setUp(self):
        clean()

    def _wounded(self):
        st = S.Store()
        sid = st.start("lover", "Purple")
        said(st, ("user", "one"), ("assistant", "two"))
        with (SESSIONS / f"{sid}.jsonl").open("a") as f:
            f.write('{"kind": "turn", "role": "user", "cont')
        return sid

    def test_a_torn_last_line_costs_that_line_and_no_more(self):
        sid = self._wounded()
        self.assertEqual(len(S.Store().resume(sid)), 2)

    def test_a_torn_transcript_does_not_take_the_history_sheet_with_it(self):
        """One unreadable file used to be able to end the whole listing, and
        the sheet is how anybody finds any of the others."""
        self._wounded()
        good = S.Store()
        gid = good.start("thinker", "Gold")
        said(good, ("user", "still here"))
        ids = [x["id"] for x in S.listing()]
        self.assertIn(gid, ids)
        self.assertEqual(len(ids), 2)

    def test_a_file_of_pure_rubbish_is_skipped_rather_than_offered(self):
        SESSIONS.mkdir(parents=True, exist_ok=True)
        (SESSIONS / "2026-01-01T00-00-00_lover.jsonl").write_text("nonsense\n\n")
        self.assertEqual(S.listing(), [])


class TheHistorySheet(unittest.TestCase):
    def setUp(self):
        clean()

    def _three(self):
        made = []
        for slug, who in (("lover", "a"), ("thinker", "b"), ("lover", "c")):
            st = S.Store()
            sid = st.start(slug, slug.title())
            said(st, ("user", f"first thing {who}"), ("assistant", "mm"))
            made.append(sid)
        return made

    def test_newest_first(self):
        made = self._three()
        self.assertEqual([x["id"] for x in S.listing()], list(reversed(made)))

    def test_one_pill_sees_only_its_own(self):
        self._three()
        mine = S.listing(persona="lover")
        self.assertEqual(len(mine), 2)
        self.assertTrue(all(x["persona"] == "lover" for x in mine))

    def test_the_limit_counts_conversations_not_files(self):
        """Forty transcripts of somebody else used to leave the list empty."""
        self._three()
        self.assertEqual(len(S.listing(limit=2, persona="lover")), 2)

    def test_a_row_says_enough_to_choose_by(self):
        self._three()
        row = S.listing()[0]
        self.assertEqual(row["turns"], 2)
        self.assertTrue(row["when"])
        self.assertIn("first thing", row["preview"])

    def test_a_long_first_line_is_cut_rather_than_wrapped(self):
        st = S.Store()
        st.start("lover", "Purple")
        said(st, ("user", "y" * 300))
        self.assertLessEqual(len(S.listing()[0]["preview"]), 71)

    def test_the_most_recent_conversation_is_the_one_you_carry_on(self):
        made = self._three()
        self.assertEqual(S.latest(), made[-1])
        self.assertEqual(S.latest("thinker"), made[1])
        self.assertIsNone(S.latest("nobody"))

    def test_no_sessions_directory_at_all_is_not_an_error(self):
        self.assertEqual(S.listing(), [])
        self.assertIsNone(S.latest())
