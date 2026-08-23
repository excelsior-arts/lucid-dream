"""Which build this is, and the two places that say so.

A version is only ever read at one moment: somebody describing what happened
to somebody who has to reproduce it. So it has to be somewhere both of them
can see — the terminal box as the machine comes up, and the top right of the
console on every page — and it has to be one number, in one file, that a
release script and `cat` can both read.
"""
import unittest
from pathlib import Path

from shell import server as S
from shell import version as V
from tests.shell.test_banner import visible

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
    """Written onto <html> by the one function every page goes through, so a
    second game gets it without being told."""

    def test_stamped_onto_the_page(self):
        out = S.stamped('<!doctype html>\n<html lang="en">\n<body></body>')
        self.assertIn(f'data-lucid="{V.NOW}"', out)
        self.assertIn('lang="en"', out, "and nothing else on the tag is lost")

    def test_but_never_twice(self):
        once = S.stamped('<html data-lucid="9.9.9">')
        self.assertEqual(once, '<html data-lucid="9.9.9">')

    def test_and_the_console_shows_what_it_finds(self):
        js = (ROOT / "shell" / "static" / "night.js").read_text()
        self.assertIn("dataset.lucid", js)
        self.assertIn("hatch-build", js)
        css = (ROOT / "shell" / "static" / "night.css").read_text()
        self.assertIn(".hatch-build", css)
        self.assertIn("margin-left:auto", css.split(".hatch-build")[1][:200],
                      "the build sits at the right-hand end of the bar")


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
