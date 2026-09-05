"""setup.sh, against the two things it is trusted to say.

It is the program everybody runs before anything else works, and both of the
claims it makes about its own results could be wrong. "Already here" was true
of a directory holding the third shard of a nine-shard model, so an interrupted
download was skipped by every later run and the first anybody heard of it was
MLX refusing to load, hours later. And "Done" was printed after its own checks
had failed, which is the one moment a person or a build has no other way of
knowing.

Neither needs a download to check: one is a question about a directory it is
shown -- asked of machine/shelf.py, which is what setup.sh asks -- and the
other is which way the script exits.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETUP = ROOT / "setup.sh"
sys.path.insert(0, str(ROOT))

from machine import shelf as S  # noqa: E402


def whole(home: Path, rev: str = "") -> bool:
    """What setup.sh would decide about a directory: it asks the shelf."""
    return S.whole(home, rev)


def a_model(home: Path, shards: int = 2, config=True, tokenizer=True, rev="") -> Path:
    """A model directory of the shape the hub leaves behind."""
    home.mkdir(parents=True, exist_ok=True)
    names = [f"model-{n + 1:05d}-of-{shards:05d}.safetensors"
             for n in range(shards)]
    (home / "model.safetensors.index.json").write_text(json.dumps(
        {"weight_map": {f"layer.{n}": name for n, name in enumerate(names)}}))
    for name in names:
        (home / name).write_bytes(b"")
    if config:
        (home / "config.json").write_text("{}")
    if tokenizer:
        (home / "tokenizer.json").write_text("{}")
    if rev:
        meta = home / ".cache" / "huggingface" / "download"
        meta.mkdir(parents=True, exist_ok=True)
        (meta / "config.json.metadata").write_text(f"{rev}\netag\n0\n")
    return home


class AModelIsThereOrItIsHalfThere(unittest.TestCase):
    """`--check` and every later run both ask this, and both used to answer
    "already here" to the beginning of a download."""

    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="lucid-model-"))

    def test_every_shard_the_index_names_is_here(self):
        self.assertTrue(whole(a_model(self.home / "org" / "repo")))

    def test_and_one_short_of_them_is_not_a_model(self):
        home = a_model(self.home / "org" / "repo", shards=3)
        (home / "model-00002-of-00003.safetensors").unlink()
        self.assertFalse(whole(home))
        self.assertEqual(S.state(home), "half")

    def test_a_leftover_of_the_downloader_does_not_make_a_whole_model_half(self):
        """The client that reconstructs files from chunks leaves an
        `.incomplete` behind when a resumed download supersedes an earlier
        attempt; a shard that is in place is finished, whatever is in the
        scratch beside it. A shard that is not in place is still missing."""
        home = a_model(self.home / "org" / "repo")
        scratch = home / ".cache" / "huggingface" / "download"
        scratch.mkdir(parents=True)
        left = scratch / "xGOKKLRS.5fb9acd0.incomplete"
        left.write_bytes(b"x" * 10)
        self.assertTrue(whole(home))
        self.assertEqual(S.tidy(home), 10)
        self.assertFalse(left.exists())
        (home / "model-00002-of-00002.safetensors").unlink()
        self.assertFalse(whole(home))

    def test_weights_with_nothing_saying_what_they_are(self):
        for missing in ("config", "tokenizer"):
            with self.subTest(missing):
                home = a_model(self.home / missing, **{missing: False})
                self.assertFalse(whole(home))

    def test_and_a_directory_with_nothing_in_it_at_all(self):
        (self.home / "empty").mkdir()
        self.assertFalse(whole(self.home / "empty"))
        self.assertEqual(S.state(self.home / "never-fetched"), "missing")

    def test_a_whole_checkout_of_another_commit_is_outdated(self):
        """What a newer release of the game finds on a Mac that installed the
        last one: everything there, and not the model the manifest pins."""
        home = a_model(self.home / "org" / "repo", rev="a" * 40)
        self.assertTrue(whole(home, "a" * 40))
        self.assertEqual(S.state(home, "b" * 40), "outdated")
        self.assertFalse(whole(home, "b" * 40))
        # A checkout with no bookkeeping cannot be told apart: taken as whole.
        bare = a_model(self.home / "org" / "bare")
        self.assertTrue(whole(bare, "b" * 40))

    def test_what_nothing_names_is_a_stray(self):
        """The manifest's own checkouts are never strays, whatever is in them;
        another repository under one of its organisations is, and so is an
        old checkout left behind by a manifest that moved on."""
        base = self.home / "shelf"
        for label, e in S.entries():
            a_model(base / e["repo"])
        self.assertEqual(S.strays(base), [])
        org = Path(S.entries()[0][1]["repo"]).parts[0]
        old = a_model(base / org / "yesterdays-model")
        (base / "voices").mkdir()                        # the voices' own home
        (base / "notes.txt").write_text("")
        self.assertEqual(S.strays(base), [old])

    def test_the_models_this_checkout_has_are_whole(self):
        """The rule above is only useful if it says yes to a real install:
        every one of these is laid out differently, and one that has to be
        re-fetched on every run is a rule nobody will keep."""
        models = ROOT / "models"
        for label, e in S.entries():
            home = models / e["repo"]
            if not home.is_dir():
                continue                 # nothing downloaded here
            with self.subTest(label):
                self.assertEqual(S.state(home, e["rev"]), "whole")


class WhatItSaysWhenItsOwnChecksFail(unittest.TestCase):
    """It ran ./check.sh, said which way it went, and then printed "Done" and
    exited 0 either way -- so a failing suite was reported as a finished
    install to whoever, or whatever, had run it."""

    def test_a_failing_check_is_the_end_of_the_run(self):
        text = SETUP.read_text()
        after = text[text.index("if ./check.sh"):]
        failed = after[after.index("else"):after.index("\nfi")]
        self.assertIn("die ", failed,
                      "setup.sh goes on after its own checks fail")
        self.assertNotIn("Done", failed)


if __name__ == "__main__":
    unittest.main()
