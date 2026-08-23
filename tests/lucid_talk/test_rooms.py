"""What a conversation did to the room it happened in.

A room is a pure function of the conversation, the clicks and the pill's
temperature, so this file is the "clicks" — and it is the part that has to
survive the rooms themselves being redesigned. The three rules it exists to
keep are in the comment at the top of lucid_talk/rooms.py: hand-chosen names,
reads that are total, and unknown keys kept rather than dropped.
"""
import unittest

from tests import clean
from lucid_talk import rooms as ROOM
from lucid_talk.paths import ROOMS


class Keeping(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_room_that_has_never_been_touched_reads_as_nothing(self):
        self.assertEqual(ROOM.load("2026-01-01T00-00-00_lover"), {"v": ROOM.V})

    def test_what_a_hand_did_comes_back(self):
        ROOM.save("s1", {"lamp": 4, "books": [1, 2, 3]})
        got = ROOM.load("s1")
        self.assertEqual(got["lamp"], 4)
        self.assertEqual(got["books"], [1, 2, 3])

    def test_a_later_save_keeps_what_it_did_not_mention(self):
        """Rule three. A room only ever writes the objects it has; the ones it
        no longer builds are not the room's to delete."""
        ROOM.save("s1", {"lamp": 4, "shutters": "open"})
        ROOM.save("s1", {"lamp": 1})
        got = ROOM.load("s1")
        self.assertEqual(got["lamp"], 1)
        self.assertEqual(got["shutters"], "open")

    def test_a_save_from_a_room_that_no_longer_exists_is_carried_quietly(self):
        """The rooms are redesigned constantly. A save mentioning a couch that
        has since gone must not stop the room opening."""
        ROOM.save("s1", {"couch": 2, "lamp": 3})
        kept = ROOM.load("s1")
        self.assertIn("couch", kept)
        self.assertEqual(kept["lamp"], 3)

    def test_forgetting_a_room_leaves_the_conversation_alone(self):
        ROOM.save("s1", {"lamp": 4})
        self.assertTrue(ROOM.forget("s1"))
        self.assertEqual(ROOM.load("s1"), {"v": ROOM.V})
        self.assertFalse(ROOM.forget("s1"))

    def test_every_save_carries_the_version_it_was_written_by(self):
        ROOM.save("s1", {"lamp": 1})
        self.assertEqual(ROOM.load("s1")["v"], ROOM.V)


class Damage(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_half_written_file_loses_the_room_and_not_the_app(self):
        ROOM.save("s1", {"lamp": 4})
        (ROOMS / "s1.json").write_text('{"lamp": 4, "boo')
        self.assertEqual(ROOM.load("s1"), {"v": ROOM.V})

    def test_a_file_holding_something_that_is_not_a_bag_of_keys(self):
        ROOM.save("s1", {"lamp": 4})
        (ROOMS / "s1.json").write_text("[1, 2, 3]")
        self.assertEqual(ROOM.load("s1"), {"v": ROOM.V})

    def test_a_save_that_is_not_a_bag_of_keys_is_refused(self):
        self.assertFalse(ROOM.save("s1", ["lamp"]))
        self.assertFalse(ROOM.save("s1", None))

    def test_the_previous_save_survives_a_crash_midway(self):
        """It is written beside and renamed, so there is no moment where the
        file on disk is half of the new state."""
        ROOM.save("s1", {"lamp": 4})
        self.assertFalse(list(ROOMS.glob("*.new")))


class ANameFromAWebsocket(unittest.TestCase):
    """A session id arrives over a socket and is therefore somebody's input."""

    def setUp(self):
        clean()

    def test_a_name_cannot_climb_out_of_the_directory(self):
        ROOM.save("../../../etc/passwd", {"lamp": 1})
        self.assertFalse((ROOMS.parent.parent / "etc").exists())
        for p in ROOMS.glob("*"):
            self.assertEqual(p.parent, ROOMS)

    def test_a_name_of_nothing_at_all_is_refused(self):
        for bad in ("", "///", "..", None):
            self.assertFalse(ROOM.save(bad, {"lamp": 1}))
            self.assertEqual(ROOM.load(bad), {"v": ROOM.V})

    def test_a_very_long_name_is_still_a_filename(self):
        self.assertTrue(ROOM.save("x" * 4000, {"lamp": 1}))
        self.assertTrue(all(len(p.name) < 200 for p in ROOMS.glob("*")))


class EveryRoomTurnsIntoAPhoneAtTheSamePlace(unittest.TestCase):
    """One mark, or the rooms disagree about what a small screen is.

    Two marks decide it -- how tall the window is for its width, and how wide
    it is in pixels -- and either one reaching gives the close view. The first
    is easy to set wrongly: at `1` it means "portrait at all", so a window
    dragged tall on a desk went to the close view at any width whatever, and
    a thousand pixels of parlour were thrown away over an inch of height. The
    parlour did that while the library, marked `.8`, did not, and two rooms
    disagreeing about what a phone is reads as one of them being broken.

    Kept here rather than in the browser tier because it is the numbers that
    go wrong, and they are readable from the file. What they *do* to a camera
    is tools/reach.mjs and a real browser's business.
    """

    MARKS = ("upto", "narrow")

    def rooms(self):
        from lucid_talk import paths
        found = sorted(paths.PERSONAS.glob("*/room.js"))
        self.assertTrue(found, "no rooms found — the layout has moved")
        return found

    def portrait(self, text):
        """The portrait block, as far as its marks."""
        i = text.index("portrait:")
        return text[i:i + 1200]

    def test_they_all_carry_both_marks(self):
        for f in self.rooms():
            block = self.portrait(f.read_text())
            for mark in self.MARKS:
                with self.subTest(room=f.parent.name, mark=mark):
                    self.assertIn(f"{mark}:", block,
                                  f"{f.parent.name} decides on its own")

    def test_and_agree_on_them(self):
        import re
        seen = {}
        for f in self.rooms():
            block = self.portrait(f.read_text())
            seen[f.parent.name] = {
                m: re.search(rf"\b{m}:\s*([\d.]+)", block).group(1)
                for m in self.MARKS}
        first = next(iter(seen.values()))
        for room, marks in seen.items():
            self.assertEqual(marks, first,
                             f"{room} becomes a phone somewhere else: {seen}")

    def test_and_the_width_is_a_width_and_not_a_ratio(self):
        """Both marks are numbers and one of them is in pixels. Written into
        the wrong one it is silently never reached."""
        import re
        for f in self.rooms():
            block = self.portrait(f.read_text())
            wide = float(re.search(r"\bnarrow:\s*([\d.]+)", block).group(1))
            tall = float(re.search(r"\bupto:\s*([\d.]+)", block).group(1))
            with self.subTest(room=f.parent.name):
                self.assertGreater(wide, 100, "a ratio in the width mark")
                self.assertLessEqual(tall, 2, "a width in the shape mark")
