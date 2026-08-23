"""The box the terminal shows before this goes quiet.

It is read once, by somebody who has just run this for the first time, and it
carries the one fact nobody can work out for themselves: which address to open,
and why the other one cannot hear them.

Which makes it worth a box, and a box is worth getting right — a right-hand
edge that wanders reads as something half-finished. The catch is that a line of
it is not as long as it looks: color is a dozen invisible bytes and an OSC 8
link is a dozen more, so measuring the string measures the escapes too.
"""
import io
import os
import re
import sys
import unittest

from shell import server as S


# A link is ESC ] 8 ; ; <url> ESC \ , and color is ESC [ … m . Both are
# invisible and both are characters, which is the whole of what is under test.
LINK = re.compile("\033\\]8;;[^\033]*\033\\\\")
PAINT = re.compile(r"\033\[[0-9;]*m")


def visible(line: str) -> str:
    """What a terminal actually shows."""
    return PAINT.sub("", LINK.sub("", line))


class Tty(io.StringIO):
    def isatty(self):
        return True


def render(blocks, tty=False, **env):
    """The banner as a terminal would receive it, or as a pipe would.

    Both halves are stood up here rather than inherited. Handing the "not a
    terminal" case the real stdout makes the answer depend on how the suite
    itself was started: run from a terminal it is a tty, the banner paints, and
    a check that color stays out of a pipe fails for a reason that has nothing
    to do with the code. Under ./check.sh in a shell it failed; piped to
    anything, it passed.
    """
    was_out, was_env = sys.stdout, dict(os.environ)
    try:
        os.environ["TERM"] = "xterm-256color"
        for k, v in env.items():
            os.environ[k] = v
        os.environ.pop("NO_COLOR", None) if "NO_COLOR" not in env else None
        sys.stdout = Tty() if tty else io.StringIO()
        return S.banner(blocks)
    finally:
        sys.stdout = was_out
        os.environ.clear()
        os.environ.update(was_env)


ONE = [("this Mac", ["https://localhost:6969"], ["the microphone works here"])]
STATE = "certificates on — every address here is https"
TWO = ONE + [("phone", ["https://mac.local:6969", "https://10.0.0.1:6969"],
              ["over your local network", "MANUAL.md, the phone section"])]


class ItIsASquareBox(unittest.TestCase):
    def edges(self, text):
        return {len(visible(l)) for l in text.strip("\n").splitlines() if l.strip()}

    def test_every_line_is_the_same_width_plain(self):
        self.assertEqual(len(self.edges(render(ONE))), 1)
        self.assertEqual(len(self.edges(render(TWO))), 1)

    def test_and_with_a_state_line_in_it(self):
        """The longest line in the box is sometimes this one."""
        self.assertEqual(len(self.edges(S.banner(TWO, STATE))), 1)
        long = "certificates on — " + "x" * 90
        self.assertEqual(len(self.edges(S.banner(ONE, long))), 1)

    def test_and_when_it_is_painted_and_linked(self):
        """The one that breaks: color and links are invisible and are still
        characters, so a line laid out after they are added is wrong by their
        length and the edge steps out."""
        for blocks in (ONE, TWO):
            got = self.edges(render(blocks, tty=True))
            self.assertEqual(len(got), 1, f"the right edge wanders: {sorted(got)}")

    def test_the_addresses_are_in_it(self):
        text = visible(render(TWO, tty=True))
        for url in ("https://localhost:6969", "https://mac.local:6969"):
            self.assertIn(url, text)

    def test_and_they_are_clickable(self):
        self.assertIn("\033]8;;https://localhost:6969", render(ONE, tty=True))

    def test_but_not_when_nobody_is_watching(self):
        """Piped to a file or read by another program: no escapes at all."""
        text = render(TWO)
        self.assertNotIn("\033", text)

    def test_and_not_when_it_was_asked_not_to(self):
        text = render(TWO, tty=True, NO_COLOR="1")
        self.assertNotIn("\033[38", text)


class ItSaysWhichWayItIsServing(unittest.TestCase):
    """Somebody who has just set the phone up restarts and reaches for the
    address they have used all week. It no longer answers, the page does not
    load, and nothing anywhere says why — the scheme changed under them and it
    was only ever legible by reading the addresses carefully.
    """

    def test_the_state_is_its_own_line(self):
        text = visible(S.banner(ONE, STATE))
        self.assertIn(STATE, text)

    def test_and_sits_above_the_addresses(self):
        text = visible(S.banner(TWO, STATE))
        self.assertLess(text.index(STATE), text.index("https://localhost"))

    def test_and_is_left_out_when_there_is_nothing_to_say(self):
        self.assertEqual(visible(S.banner(ONE)).count("certificates"), 0)
