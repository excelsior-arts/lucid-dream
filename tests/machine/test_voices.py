"""A voice is a path on a shelf, and nothing about what the folders mean.

The shelf grammar: a folder holding voice.ref.wav is a voice named by the
folder; any other wav is a voice named by its path without the suffix; a name
beginning @<store>/ is in the player's own store. Nothing here loads a model.
"""
import unittest
from pathlib import Path

from machine import config as C
from machine import paths as P
from machine import store as S
from machine import voices as V
from tests.machine.test_machine import SCRATCH, clean


def a_tree(root: Path, *files: str) -> None:
    for f in files:
        p = root / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"RIFF")


class TheShelfIsAPath(unittest.TestCase):
    def setUp(self):
        clean()
        self.shelf = SCRATCH / "shelf"
        self.shelf.mkdir(parents=True, exist_ok=True)
        C.note(voices={"path": str(self.shelf)})
        a_tree(self.shelf,
               "lucid_talk/personas/lover/voice.ref.wav",
               "lucid_talk/personas/thinker/voice.ref.wav",
               "mine/nova.wav",
               "flat.wav",
               ".cache/huggingface/download/lucid_talk/personas/lover/voice.ref.wav",
               "README.md")

    def test_a_folder_holding_the_leaf_is_a_voice_named_by_the_folder(self):
        self.assertEqual(V.clip("lucid_talk/personas/lover"),
                         self.shelf / "lucid_talk/personas/lover/voice.ref.wav")

    def test_and_a_wav_anywhere_is_a_voice_named_by_its_path(self):
        self.assertEqual(V.clip("mine/nova"), self.shelf / "mine/nova.wav")
        self.assertEqual(V.clip("flat"), self.shelf / "flat.wav")

    def test_the_listing_has_all_of_them_and_none_of_the_bookkeeping(self):
        self.assertEqual(V.names(), ["flat", "lucid_talk/personas/lover",
                                     "lucid_talk/personas/thinker", "mine/nova"])

    def test_a_name_that_leaves_the_shelf_is_nothing(self):
        for bad in ("../shelf/flat", "lucid_talk/../flat", "/etc/passwd",
                    "mine/.nova", "a" * 300, "", "mine//nova", "a/b/c/d/e/f/g"):
            self.assertIsNone(V.clip(bad), bad)
            self.assertFalse(V.named_well(bad), bad)

    def test_a_name_nobody_has_a_clip_for_is_nothing(self):
        self.assertIsNone(V.clip("lucid_talk/personas/nobody"))
        self.assertIsNone(V.clip("mine"))          # a folder with no leaf

    def test_a_voice_in_the_players_own_store_is_named_with_the_store(self):
        mine = S.root("somegame")
        a_tree(mine, "a/b/voice.ref.wav", "loose.wav")
        self.assertEqual(V.clip("@somegame/a/b"), mine / "a/b/voice.ref.wav")
        self.assertIn("@somegame/a/b", V.names())
        # Only the leaf counts in a store: it holds whatever the game keeps
        # there, and a wav in its scratch is not a voice anybody meant.
        self.assertIsNone(V.clip("@somegame/loose"))
        self.assertNotIn("@somegame/loose", V.names())
        # And it cannot reach past that store, whatever the name says.
        for bad in ("@somegame/../a/b", "@../somegame/a/b", "@somegame/", "@/a"):
            self.assertIsNone(V.clip(bad), bad)

    def test_the_shelf_is_where_the_config_says(self):
        other = SCRATCH / "elsewhere"
        a_tree(other, "x/voice.ref.wav")
        C.note(voices={"path": str(other)})
        self.assertEqual(V.names(), ["x"])
        self.assertEqual(V.clip("x"), other / "x/voice.ref.wav")


if __name__ == "__main__":
    unittest.main()
