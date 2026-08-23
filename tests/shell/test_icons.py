"""The face, and everywhere something goes looking for it.

An icon fails quietly: the tab shows a globe, the home screen shows a
screenshot of the page, and nothing anywhere says why. So the things that can
silently drift apart are checked here — the set is complete, the manifest
points at files that exist, every page links them, and the addresses a
browser tries without being told are answered.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "shell/static/icons"
PAGES = ["shell/static/index.html",
         "lucid_talk/static/choose.html",
         "lucid_talk/static/index.html"]


class TheSetIsComplete(unittest.TestCase):
    WANTED = ["favicon.ico", "icon-16.png", "icon-32.png", "icon-180.png",
              "icon-192.png", "icon-512.png", "icon-maskable-512.png"]

    def test_every_size_is_there(self):
        for name in self.WANTED:
            with self.subTest(icon=name):
                self.assertTrue((ICONS / name).exists(), f"{name} is missing")

    def test_and_each_is_the_size_its_name_claims(self):
        from PIL import Image
        for name in self.WANTED:
            if not name.endswith(".png"):
                continue
            want = int(re.search(r"(\d+)\.png$", name).group(1))
            with self.subTest(icon=name):
                self.assertEqual(Image.open(ICONS / name).size, (want, want))

    def test_and_they_are_square_to_the_edge(self):
        """No transparent margin: a platform crops these itself, and a border
        baked in here is cut through or rounded twice."""
        from PIL import Image
        for name in ("icon-512.png", "icon-maskable-512.png"):
            im = Image.open(ICONS / name)
            with self.subTest(icon=name):
                if im.mode in ("RGBA", "LA", "P"):
                    a = im.convert("RGBA").getchannel("A")
                    self.assertEqual(a.getextrema(), (255, 255),
                                     f"{name} has transparent pixels")

    def test_the_knife_is_here_even_though_the_photograph_is_not(self):
        """The set is cut from a photograph by tools/cut_icons.py, and the
        photograph is deliberately not in this repository -- it is two and a
        half megabytes, four times the weight of every other image here put
        together, and it is a build input for artwork that is not open to
        contribution anyway. Its absence is a decision, not a loss: whoever
        cuts a new set is whoever has the original.

        The script stays, because it is the part that says how the set was
        made and what shape it has to be."""
        self.assertTrue((ROOT / "tools/cut_icons.py").exists())
        self.assertFalse((ICONS / "source.jpg").exists(),
                         "the photograph is back in the repository -- see the "
                         "docstring above before keeping it")


class TheManifestAgreesWithTheFiles(unittest.TestCase):
    def setUp(self):
        self.m = json.loads((ROOT / "shell/static/manifest.webmanifest").read_text())

    def test_it_is_valid_json_with_what_a_browser_needs(self):
        for key in ("name", "start_url", "display", "background_color", "icons"):
            self.assertIn(key, self.m)

    def test_every_icon_it_names_exists(self):
        for icon in self.m["icons"]:
            path = ROOT / "shell/static" / icon["src"].removeprefix("/shared/")
            with self.subTest(src=icon["src"]):
                self.assertTrue(path.exists(), f"{icon['src']} is named and missing")

    def test_and_one_of_them_is_maskable(self):
        """Without it Android puts the whole square in a circle and takes a
        bite out of the picture."""
        self.assertTrue(any("maskable" in (i.get("purpose") or "")
                            for i in self.m["icons"]))


class EveryPageWearsIt(unittest.TestCase):
    def test_all_three_link_the_icons_and_the_manifest(self):
        for page in PAGES:
            html = (ROOT / page).read_text()
            with self.subTest(page=page):
                self.assertIn('rel="icon"', html)
                self.assertIn("apple-touch-icon", html)
                self.assertIn("manifest.webmanifest", html)


class AndTheAddressesNobodyLinks(unittest.TestCase):
    """Safari asks the root of a site whatever the page said, and an iOS
    home-screen shortcut looks for /apple-touch-icon.png with no page in the
    picture at all. Both are answered in shell/server.py."""

    def test_the_root_addresses_are_served(self):
        src = (ROOT / "shell/server.py").read_text()
        for route in ("/favicon.ico", "/apple-touch-icon.png",
                      "/apple-touch-icon-precomposed.png"):
            with self.subTest(route=route):
                self.assertIn(f'"{route}"', src)
