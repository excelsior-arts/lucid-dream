"""The characters, as they are on disk.

A bundle is content rather than code — a prompt, a voice, a room — so most of
what can go wrong is a bundle that no longer parses into what the rest of the
app expects to find in it, and the first anybody hears of it is a room that
will not open. These are read-only: the bundles are in git and are not the
tests' to touch.
"""
import pathlib
import unittest

from lucid_talk import personas as P
from lucid_talk import paths


class TheBundlesWeShip(unittest.TestCase):
    def test_there_are_some(self):
        self.assertTrue(P.listing(), "no pills in the box at all")

    def test_every_one_has_what_the_app_reads_off_it(self):
        for pill in P.listing():
            for key in ("slug", "name", "pill", "prompt", "color", "blurb"):
                self.assertTrue(str(pill[key]).strip(),
                                f"{pill['slug']} has no {key}")

    def test_a_colour_is_three_numbers_the_box_can_be_lit_by(self):
        for pill in P.listing():
            parts = pill["color"].split(",")
            self.assertEqual(len(parts), 3, pill["slug"])
            for n in parts:
                self.assertTrue(0 <= int(n.strip()) <= 255, pill["slug"])

    def test_a_pill_is_never_shown_the_character_s_own_name(self):
        """`name` belongs to the prompt and `pill` is what a player is handed.
        A bundle that leaves `pill` unset gets the slug titled, and the whole
        interface starts naming a character nobody was introduced to."""
        for pill in P.listing():
            self.assertNotIn(pill["pill"].lower(), ("", "none"))

    def test_the_ones_that_dress_a_room_bring_both_halves(self):
        for pill in P.listing():
            if pill["script"]:
                self.assertTrue(P.asset(pill["slug"], "room.js"))

    def test_a_voice_is_found_in_the_bundle_that_owns_it(self):
        for pill in P.listing():
            ref = P.voice_ref(pill)
            if ref is not None:
                self.assertTrue(ref.is_file())
                self.assertEqual(ref.parent.name, pill.get("voice") or pill["slug"])

    def test_the_system_prompt_puts_the_persona_last(self):
        """The model weights what it read most recently, so anything generic
        sitting after a persona quietly overrides it."""
        pill = P.listing()[0]
        built = P.system_prompt(pill)
        self.assertTrue(built.endswith(pill["prompt"].strip()))


class ANameFromASocket(unittest.TestCase):
    """A slug arrives with a page saying which pill it came for."""

    def test_a_name_that_is_not_a_pill_is_nobody(self):
        self.assertIsNone(P.get("no-such-pill"))
        self.assertIsNone(P.get(""))

    def test_a_name_cannot_climb_out_of_the_bundles(self):
        for bad in ("../../lucid_talk", "..", "../personas", "/etc"):
            self.assertIsNone(P.get(bad), bad)

    def test_a_file_from_a_bundle_cannot_either(self):
        good = P.listing()[0]["slug"]
        self.assertIsNotNone(P.asset(good, "persona.md"))
        for bad in ("../../server.py", "../../../etc/passwd", "..%2Fserver.py"):
            self.assertIsNone(P.asset(good, bad), bad)

    def test_a_directory_is_not_a_file(self):
        good = P.listing()[0]["slug"]
        self.assertIsNone(P.asset(good, "."))


class ATunable(unittest.TestCase):
    def test_only_what_is_measured_to_do_something_comes_through(self):
        """Frontmatter is not a passthrough: a key that reads like a setting
        and is wired to nothing is worse than no key."""
        pill = P.listing()[0]
        allowed = {"slug", "draft", "name", "pill", "voice", "blurb", "color",
                   "figure", "place", "prompt", "home", "file", "room",
                   "script", *P.TUNABLES}
        self.assertEqual(set(pill) - allowed, set())

    def test_and_a_figure_is_one_the_box_can_draw(self):
        """`figure` names the pattern on the back of the card. A word nothing
        recognizes is not an error -- the card comes out plain -- but it is a
        bundle asking for something it will never get, and silently."""
        page = (pathlib.Path(__file__).resolve().parents[2]
                / "lucid_talk/static/choose.html").read_text()
        for pill in P.listing():
            want = pill.get("figure")
            if not want:
                continue
            with self.subTest(pill=pill["slug"], figure=want):
                self.assertIn(f'.pill[data-figure="{want}"]', page,
                              f"nothing draws {want!r}")

    def test_a_tunable_that_is_set_is_a_number(self):
        for pill in P.listing():
            for key in P.TUNABLES:
                if pill.get(key) is not None:
                    float(pill[key])            # raises if a bundle says "loud"
