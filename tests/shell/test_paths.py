"""Where everything of yours lives, and the switch that moves it.

There is one guarantee here and it is worth a file of its own: nothing under
userdata/ is ever committed, and LUCID_USERDATA moves *all* of it. The second
half is what makes the first half safe to rely on — a tool or a test that
honours the switch for the directory it writes to and keeps a fixed address
for the one it reads from is not isolated at all, it is quietly working on
somebody's real conversations. That has happened here once.
"""
import unittest
from pathlib import Path

from tests import SCRATCH, REAL
from shell import paths as SP
from lucid_talk import paths as AP


class TheSwitchTook(unittest.TestCase):
    def test_the_root_moved(self):
        self.assertTrue(SP.ELSEWHERE)
        self.assertEqual(SP.USERDATA.resolve(), SCRATCH)

    def test_and_took_everything_with_it(self):
        """Every address the app keeps, checked rather than assumed: this is
        the list that grew a new entry and lost the guarantee last time."""
        for name in ("DATA", "CONFIG", "SESSIONS", "MEMORY", "ROOMS", "TMP",
                     "LLM_LOG"):
            here = getattr(AP, name).resolve()
            self.assertTrue(str(here).startswith(str(SCRATCH)),
                            f"lucid_talk.paths.{name} is {here}, outside the "
                            f"scratch root — it does not honour LUCID_USERDATA")
            self.assertFalse(str(here).startswith(str(REAL)),
                             f"lucid_talk.paths.{name} points at real data")

    def test_the_shell_s_own_too(self):
        """The machine's things — the certificate, where to serve — sit beside
        the roster rather than in it, and the switch takes them as well."""
        for name in ("CERTS", "CONFIG", "PLAYERS", "MINE"):
            self.assertTrue(str(getattr(SP, name).resolve()).startswith(str(SCRATCH)))
        self.assertEqual(SP.CONFIG.parent.resolve(), SCRATCH)
        self.assertEqual(SP.MINE.parent.resolve(), SP.PLAYERS.resolve())

    def test_the_console_writes_its_log_under_it(self):
        from shell import log as L
        self.assertTrue(str(L.DIR.resolve()).startswith(str(SCRATCH)))

    def test_what_the_app_is_did_not_move(self):
        """The other half of the split: personas and prompts are the program,
        they live in the checkout, and they are the same on every machine."""
        checkout = Path(__file__).resolve().parents[2]
        for name in ("PERSONAS", "PROMPTS", "STATIC"):
            self.assertTrue(str(getattr(AP, name)).startswith(str(checkout / "lucid_talk")))

    def test_an_app_gets_its_own_subtree_and_nothing_else(self):
        """A second app is a directory under whoever is playing, and takes
        nothing of the first's."""
        mine = SP.home("some-other-app")
        self.assertEqual(mine.parent.resolve(), SP.MINE.resolve())
        self.assertTrue(str(mine.resolve()).startswith(str(SCRATCH)))
        self.assertTrue(mine.is_dir())
        self.assertNotEqual(mine.resolve(), AP.DATA.resolve())


class TheGuaranteeIsWrittenDown(unittest.TestCase):
    def test_userdata_is_ignored_by_git_as_a_whole(self):
        """Not a list of the things inside it that somebody has to remember to
        extend — the directory itself, so whatever gets invented next is
        covered by the line that is already there."""
        ignore = (Path(__file__).resolve().parents[2] / ".gitignore").read_text()
        self.assertRegex(ignore, r"(?m)^/?userdata/?$")


class TheTestsChooseTheirOwnGround(unittest.TestCase):
    """clean() empties the directory the tests run in, between tests.

    Which is fine while that directory is one this file made, and is a loaded
    gun the moment it is one somebody else chose. A shell that has exported
    LUCID_USERDATA for any other reason — a second instance, a scratch copy,
    conversations kept outside the checkout — used to hand the tests that
    directory to empty. The guard in tests/__init__.py would not have caught
    it: it only knows about the userdata/ in this repository.
    """

    def test_an_inherited_root_is_not_used(self):
        src = (Path(__file__).resolve().parents[1] / "__init__.py").read_text()
        self.assertNotIn('if not os.environ.get("LUCID_USERDATA")', src,
                         "an inherited LUCID_USERDATA is honoured again, and "
                         "clean() will empty whatever it points at")
        self.assertIn("mkdtemp", src)

    def test_and_what_is_running_now_is_a_temporary_one(self):
        import tempfile
        from tests import SCRATCH
        self.assertTrue(str(SCRATCH).startswith(tempfile.gettempdir())
                        or "/tmp" in str(SCRATCH) or "/var/folders" in str(SCRATCH),
                        f"the tests are running in {SCRATCH}")
        self.assertIn("lucid-tests-", SCRATCH.name)
