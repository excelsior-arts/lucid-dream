"""Which build this is, and the two places that say so.

A version is only ever read at one moment: somebody describing what happened
to somebody who has to reproduce it. So it has to be somewhere both of them
can see — the terminal box as the machine comes up, and the top right of the
console on every page — and it has to be one number, in one file, that a
release script and `cat` can both read.
"""
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from machine import server as S
from machine import version as V
from machine import web as W
from tests.machine.test_banner import visible

ROOT = Path(__file__).resolve().parents[2]


class ThereIsOneAndItIsAFile(unittest.TestCase):
    def test_at_the_root_of_the_checkout(self):
        self.assertTrue(V.FILE.exists(), "no VERSION file")
        self.assertEqual(V.FILE, ROOT / "VERSION")

    def test_holding_a_version_and_nothing_else(self):
        raw = V.FILE.read_text()
        self.assertRegex(raw.strip(), r"^\d+\.\d+\.\d+([-+][\w.]+)?$")
        self.assertEqual(len(raw.strip().splitlines()), 1,
                         "one line, so anything can read it")
        self.assertTrue(raw.endswith("\n"), "a text file ends with a newline")

    def test_and_the_program_reads_it(self):
        self.assertEqual(V.NOW, V.FILE.read_text().strip())


class EveryPageCarriesIt(unittest.TestCase):
    """Written onto <html> by the one function every address goes through, so
    an app added later gets it without being told."""

    def a_build(self, index: str) -> str:
        """The page, as it comes out of a dist with this index.html in it."""
        dist = Path(tempfile.mkdtemp(prefix="lucid-version-"))
        self.addCleanup(shutil.rmtree, dist, True)
        (dist / "index.html").write_text(index)
        was = os.environ.get("LUCID_WEB")
        os.environ["LUCID_WEB"] = str(dist)
        self.addCleanup(lambda: os.environ.__setitem__("LUCID_WEB", was)
                        if was is not None else os.environ.pop("LUCID_WEB", None))
        return W.page()

    def test_stamped_onto_the_page(self):
        out = self.a_build('<!doctype html>\n<html lang="en">\n<body></body>')
        self.assertIn(f'data-lucid="{V.NOW}"', out)
        self.assertIn('lang="en"', out, "and nothing else on the tag is lost")

    def test_but_never_twice(self):
        out = self.a_build('<html data-lucid="9.9.9">')
        self.assertEqual(out, '<html data-lucid="9.9.9">')

    def test_and_the_page_with_no_build_behind_it_carries_it_too(self):
        """It is the page somebody is looking at when something is wrong, and
        the first question about anything wrong is which build it is."""
        was = os.environ.get("LUCID_WEB")
        os.environ["LUCID_WEB"] = "0"
        self.addCleanup(lambda: os.environ.__setitem__("LUCID_WEB", was)
                        if was is not None else os.environ.pop("LUCID_WEB", None))
        self.assertIn(f'data-lucid="{V.NOW}"', W.page())


class AndSoDoesTheTerminal(unittest.TestCase):
    def test_the_box_says_it_under_the_name(self):
        text = S.banner([("this Mac", ["http://localhost:6969"], ["it works"])])
        self.assertIn(V.NOW, text)

    def test_and_the_box_is_still_square(self):
        """The title line grew, and the box is measured off the widest line —
        a version that pushed one edge out would be the first thing anybody
        saw.

        Measured with test_banner's own `visible`, which strips the links as
        well as the color. Stripping only color passes through a pipe, where
        neither is written, and fails in a terminal, where both are — a check
        that only holds when nobody is looking at it.
        """
        text = S.banner([("this Mac", ["http://localhost:6969"], ["short"])])
        widths = {len(visible(line))
                  for line in text.strip("\n").splitlines() if line.strip()}
        self.assertEqual(len(widths), 1, f"ragged edges: {sorted(widths)}")


if __name__ == "__main__":
    unittest.main()
