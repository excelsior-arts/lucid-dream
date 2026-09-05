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
from machine import paths as SP
from machine import store as S

# Some game's name. The machine has no list of them: a game is a slug in an
# address and a directory under the player, so any word would do here.
GAME = "lucid-talk"


class TheSwitchTook(unittest.TestCase):
    def test_the_root_moved(self):
        self.assertTrue(SP.ELSEWHERE)
        self.assertEqual(SP.USERDATA.resolve(), SCRATCH)

    def test_and_took_everything_with_it(self):
        """Every address anything keeps, checked rather than assumed: this is
        the list that grew a new entry and lost the guarantee last time."""
        bags = {"a value": S.under(GAME, "config.json"),
                "a log": S.under(GAME, "sessions/a.jsonl"),
                "the game's own": SP.home(GAME),
                "scratch": SP.TMP, "llm log": SP.LLM_LOG}
        for name, path in bags.items():
            here = path.resolve()
            self.assertTrue(str(here).startswith(str(SCRATCH)),
                            f"the {name} is {here}, outside the scratch root — "
                            f"it does not honour LUCID_USERDATA")
            self.assertFalse(str(here).startswith(str(REAL)),
                             f"the {name} points at real data")

    def test_the_shell_s_own_too(self):
        """The machine's things — the certificate, where to serve — sit beside
        the roster rather than in it, and the switch takes them as well."""
        for name in ("CERTS", "CONFIG", "PLAYERS", "MINE"):
            self.assertTrue(str(getattr(SP, name).resolve()).startswith(str(SCRATCH)))
        self.assertEqual(SP.CONFIG.parent.resolve(), SCRATCH)
        self.assertEqual(SP.MINE.parent.resolve(), SP.PLAYERS.resolve())

    def test_the_console_writes_its_log_under_it(self):
        from machine import log as L
        self.assertTrue(str(L.DIR.resolve()).startswith(str(SCRATCH)))

    def test_what_a_game_is_did_not_move(self):
        """The other half of the split: what a game *is* — its characters, its
        prompts, the words in their mouths — ships in the bundle and is the
        same on every machine. Nothing under here is any of it, and there is no
        directory of games left to look in."""
        root = Path(__file__).resolve().parents[2]
        self.assertFalse((root / "games").exists())
        self.assertTrue((root / "app" / "packages" / "talk" / "content"
                         / "personas").is_dir())

    def test_a_game_gets_its_own_subtree_and_nothing_else(self):
        """A second game is a directory under whoever is playing, and takes
        nothing of the first's."""
        mine = SP.home("some-other-game")
        self.assertEqual(mine.parent.resolve(), SP.MINE.resolve())
        self.assertTrue(str(mine.resolve()).startswith(str(SCRATCH)))
        self.assertTrue(mine.is_dir())
        self.assertNotEqual(mine.resolve(), SP.home(GAME).resolve())


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
