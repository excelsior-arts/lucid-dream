"""That a control makes a sound without anybody remembering to make it.

There is nothing to test here at the level of audio — that is an oscillator in
a browser — but there is one structural fact worth holding still. Sounds used
to be written into handlers one at a time, so the four knobs in the corner had
a voice and everything invented after them did not. The fix was to move it to
the shell, where it applies to anything pressable, and the thing that can undo
it is somebody quietly going back to the old way.
"""
import re
import unittest
from pathlib import Path

SHELL = Path(__file__).resolve().parents[2] / "shell" / "static"
NIGHT = (SHELL / "night.js").read_text()
APPS = Path(__file__).resolve().parents[2]


class TheShellListensForPresses(unittest.TestCase):
    def test_it_hears_every_press_rather_than_the_ones_it_was_told_about(self):
        self.assertIn("addEventListener('pointerdown'", NIGHT)
        self.assertIn("CONTROLS", NIGHT)

    def test_it_hears_them_even_when_a_handler_stops_the_click(self):
        """Half the controls in the rail stop the click going further — a
        press inside a popover is not a press away from it — so this has to
        listen on the way down."""
        press = NIGHT[NIGHT.index("const CONTROLS"):]
        self.assertIn("capture: true", press)

    def test_a_key_that_is_offering_nothing_stays_silent(self):
        self.assertIn("el.disabled", NIGHT)

    def test_there_is_a_way_for_a_control_to_make_its_own_sound(self):
        self.assertIn("data-quiet", NIGHT)

    def test_something_on_its_way_can_be_said_out_loud(self):
        """The gap between a reply arriving as text and arriving as a voice."""
        self.assertIn("waiting(on)", NIGHT)
        self.assertIn("this.HOLD", NIGHT)      # a short gap is not announced
        self.assertRegex(NIGHT, r"_beats\s*>\s*\d+")   # and it gives up


class AnAppDoesNotHaveTo(unittest.TestCase):
    """A page reaching for Sound.tick() on an ordinary button is the old way
    coming back, and it plays twice now rather than once."""

    def test_no_page_ticks_for_itself(self):
        for page in (APPS / "lucid_talk" / "static").iterdir():
            if page.suffix not in (".html", ".js"):
                continue
            found = re.findall(r"(?:Lucid\.)?[Ss]ound\.(tick|latch)\(", page.read_text())
            self.assertFalse(found, f"{page.name} makes its own press sound — the "
                                    f"shell already does, and both will play")
