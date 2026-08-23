"""One directory per person, and what that has to be worth.

The whole of the mechanism is a directory name: whoever has one has a set of
conversations and a standing with every persona, and touches nobody else's.
There is no account and no password anywhere, so the only thing keeping two
people apart is that every address either of them reads or writes goes through
`shell.paths` — which is what this file checks.

The roster is a directory of its own, `userdata/players/`, so there are no
exceptions to write down and none to forget: the certificate and the machine's
config sit beside it rather than in it, and cannot be mistaken for somebody.

Nothing here uses the real roster. Every test makes its own under a temporary
directory and hands it in, because a check that makes people and then deletes
them is one typo away from being a lossy edit of somebody's diary. That is
also why these functions take a root at all.
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from shell import paths as P


def machine() -> Path:
    """A userdata/ on scratch, with nobody on it yet."""
    return Path(tempfile.mkdtemp(prefix="lucid-machine-"))


def tree(**people) -> Path:
    """A roster on scratch: {"pete": {"llm": {"venv": "/opt"}}} is pete with
    one app tuned that way. Returns players/, not the machine's directory."""
    root = machine() / P.PLAYERS.name
    for who, app in people.items():
        (root / who / "lucid-talk").mkdir(parents=True)
        (root / who / "lucid-talk" / "config.json").write_text(json.dumps(app))
    return root


class ARosterIsADirectoryListing(unittest.TestCase):
    def test_everybody_with_a_directory_is_somebody(self):
        self.assertEqual(P.players(tree(player1={}, pete={})), ["pete", "player1"])

    def test_and_the_machine_s_own_things_are_not_in_it(self):
        """The reason players/ is a level of its own: counting the roster is
        counting directories, with no exception anybody has to remember."""
        root = tree(player1={})
        (root.parent / "config.json").write_text('{"phone": true}')
        (root.parent / "certs").mkdir()
        self.assertEqual(P.players(root), ["player1"])

    def test_and_nothing_hidden_is(self):
        """macOS drops .DS_Store into anything you have opened in Finder."""
        root = tree(player1={})
        (root / ".DS_Store").write_text("")
        (root / ".hidden").mkdir()
        self.assertEqual(P.players(root), ["player1"])

    def test_a_machine_nobody_has_played_on_has_nobody(self):
        self.assertEqual(P.players(machine() / P.PLAYERS.name), [])


class ANameHasToBeADirectoryName(unittest.TestCase):
    def test_nothing_typed_is_the_first_one(self):
        self.assertEqual(P.named(None), P.FIRST)
        self.assertEqual(P.named(""), P.FIRST)

    def test_case_is_not_a_second_person(self):
        self.assertEqual(P.named("Pete"), "pete")
        self.assertEqual(P.named("  PETE "), "pete")

    def test_a_name_that_is_a_path_is_refused(self):
        """The name is joined onto players/, so "../.." would be a way out of
        it. Refused loudly rather than cleaned up quietly: a typo that silently
        opened somebody else's conversations is worse than one that will not
        start."""
        for bad in ("../..", "a/b", ".", "..", ".hidden", "-", "a" * 33, "p ete"):
            with self.assertRaises(SystemExit, msg=f"{bad!r} was allowed"):
                P.named(bad)


class AnOlderTreeFoldsUnderTheFirstName(unittest.TestCase):
    """Before this there was one player and no name for them, so userdata/ held
    that person's apps and log directly, beside the machine's own things. What
    was theirs moves under players/player1; what was the machine's stays."""

    def test_what_was_one_person_s_moves_under_them(self):
        root = machine()
        (root / "lucid-talk" / "sessions").mkdir(parents=True)
        (root / "lucid-talk" / "sessions" / "a.jsonl").write_text("mine")
        (root / "log").mkdir()
        (root / "log" / "lucid.log").write_text("what the machine did")

        self.assertTrue(P.settle(root))
        mine = root / P.PLAYERS.name / P.FIRST
        self.assertEqual(P.players(root / P.PLAYERS.name), [P.FIRST])
        self.assertEqual((mine / "lucid-talk" / "sessions" / "a.jsonl").read_text(),
                         "mine")
        self.assertTrue((mine / "log" / "lucid.log").exists())
        self.assertFalse((root / "lucid-talk").exists())

    def test_and_the_machine_s_stays_where_it_is(self):
        """Which is what keeps a certificate written down as a path working:
        userdata/certs/lucid.pem is still userdata/certs/lucid.pem, so there is
        nothing to rewrite and nothing to get wrong."""
        root = machine()
        (root / "config.json").write_text(json.dumps(
            {"tls_cert": "userdata/certs/lucid.pem"}))
        (root / "certs").mkdir()
        (root / "certs" / "lucid.pem").write_text("a certificate")
        (root / "lucid-talk").mkdir()

        self.assertTrue(P.settle(root))
        self.assertEqual(json.loads((root / "config.json").read_text())["tls_cert"],
                         "userdata/certs/lucid.pem")
        self.assertTrue((root / "certs" / "lucid.pem").exists())

    def test_an_app_left_at_the_root_later_goes_home_too(self):
        """An instance started before a checkout was updated keeps writing to
        the addresses it bound at import, and lays them down again beside the
        roster. They are one person's, and it is the first one."""
        root = machine()
        (root / P.PLAYERS.name / "pete").mkdir(parents=True)
        (root / "lucid-talk" / "sessions").mkdir(parents=True)
        (root / "lucid-talk" / "sessions" / "late.jsonl").write_text("said after")

        self.assertTrue(P.settle(root))
        self.assertEqual(P.players(root / P.PLAYERS.name), ["pete", P.FIRST])
        self.assertTrue((root / P.PLAYERS.name / P.FIRST / "lucid-talk"
                         / "sessions" / "late.jsonl").exists())

    def test_and_lands_beside_what_is_already_there(self):
        """The person has been running all this time and has a log of their
        own. Two logs, both theirs, and which one matters is not a question
        this can answer — so neither is overwritten."""
        root = machine()
        mine = root / P.PLAYERS.name / P.FIRST
        (mine / "log").mkdir(parents=True)
        (mine / "log" / "lucid.log").write_text("mine")
        (root / "log").mkdir()
        (root / "log" / "lucid.log").write_text("the old instance's")

        self.assertTrue(P.settle(root))
        self.assertEqual((mine / "log" / "lucid.log").read_text(), "mine")
        self.assertEqual((mine / "log" / "lucid.log.strayed").read_text(),
                         "the old instance's")
        self.assertFalse((root / "log").exists())

    def test_and_a_settled_tree_is_left_alone(self):
        root = machine()
        (root / P.PLAYERS.name / "pete" / "lucid-talk").mkdir(parents=True)
        (root / "config.json").write_text('{"phone": true}')
        (root / "certs").mkdir()
        self.assertFalse(P.settle(root))
        self.assertEqual(P.players(root / P.PLAYERS.name), ["pete"])


class ANewPersonStartsFromTheMachine(unittest.TestCase):
    """What is true of the computer — the model, the voices — and nothing that
    is true of anybody."""

    def setUp(self):
        self.root = tree(player1={"llm": {"venv": "/opt/mlx/bin"}})
        old = self.root / P.FIRST / "lucid-talk"
        (old / "sessions").mkdir(parents=True)
        (old / "sessions" / "a.jsonl").write_text("a conversation")
        (old / "memory").mkdir()
        (old / "memory" / "lover.json").write_text("what it knows about me")

    def test_the_settings_come_across(self):
        mine = P.welcome("pete", root=self.root)
        app = json.loads((mine / "lucid-talk" / "config.json").read_text())
        self.assertEqual(app["llm"]["venv"], "/opt/mlx/bin")

    def test_and_nothing_anybody_said_does(self):
        mine = P.welcome("pete", root=self.root)
        self.assertFalse((mine / "lucid-talk" / "sessions").exists())
        self.assertFalse((mine / "lucid-talk" / "memory").exists())

    def test_and_nothing_of_the_machine_s_either(self):
        """Neither the certificate, which is a level up and shared, nor a
        port, which belongs to the run."""
        mine = P.welcome("pete", root=self.root)
        self.assertFalse((mine / "config.json").exists())
        self.assertFalse((mine / "certs").exists())

    def test_somebody_who_is_already_here_is_left_alone(self):
        mine = P.welcome("pete", root=self.root)
        (mine / "lucid-talk" / "sessions").mkdir(parents=True)
        (mine / "lucid-talk" / "sessions" / "b.jsonl").write_text("pete's own")
        again = P.welcome("pete", root=self.root)
        self.assertEqual((again / "lucid-talk" / "sessions" / "b.jsonl").read_text(),
                         "pete's own")

    def test_the_first_one_on_a_bare_machine_needs_nobody_to_copy(self):
        mine = P.welcome(P.FIRST, root=machine() / P.PLAYERS.name)
        self.assertTrue(mine.is_dir())
        self.assertEqual(list(mine.iterdir()), [])


class TheSwitchPicksTheDirectory(unittest.TestCase):
    """LUCID_USER is read once, at import, the way LUCID_USERDATA is — so this
    asks a fresh interpreter rather than trying to change it here."""

    def ask(self, who):
        env = {**os.environ, "LUCID_USER": who}
        env.pop("LUCID_USERDATA", None)          # the roster, not a scratch root
        out = subprocess.run(
            [sys.executable, "-c",
             "from shell import paths as P; print(P.WHO); print(P.MINE)"],
            capture_output=True, text=True, env=env,
            cwd=str(Path(__file__).resolve().parents[2]))
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout.split()

    def test_a_name_names_a_directory_under_the_roster(self):
        """Asked without the scratch root, so the answer is the checkout's own
        roster — which is also the one that must not have been touched."""
        roster = Path(__file__).resolve().parents[2] / "userdata" / P.PLAYERS.name
        who, where = self.ask("pete")
        self.assertEqual(who, "pete")
        self.assertEqual(Path(where), roster / "pete")
        self.assertFalse((roster / "pete").exists(),
                         "reading who you are must not make anybody")

    def test_and_nothing_named_is_the_first_one(self):
        env = {**os.environ}
        env.pop("LUCID_USER", None)
        env.pop("LUCID_USERDATA", None)
        out = subprocess.run([sys.executable, "-c",
                              "from shell import paths as P; print(P.WHO)"],
                             capture_output=True, text=True, env=env,
                             cwd=str(Path(__file__).resolve().parents[2]))
        self.assertEqual(out.stdout.strip(), P.FIRST)


class ThePortBelongsToTheRun(unittest.TestCase):
    """Not to the person, and not to a file. `--port` decides it for one start
    and nothing on disk remembers, so the same people are the same people on
    whatever port the machine happens to be serving."""

    def tearDown(self):
        os.environ.pop("LUCID_PORT", None)

    def test_nothing_said_is_the_one_in_the_code(self):
        from shell import config as C
        self.assertEqual(C.load()["port"], P.PORT)
        self.assertNotIn("port", C.DEFAULTS)

    def test_the_environment_wins(self):
        from shell import config as C
        os.environ["LUCID_PORT"] = "7001"
        self.assertEqual(C.load()["port"], 7001)

    def test_and_nonsense_does_not(self):
        from shell import config as C
        os.environ["LUCID_PORT"] = "later"
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            self.assertEqual(C.load()["port"], P.PORT)
        self.assertIn("LUCID_PORT", said.getvalue())

    def test_and_one_written_down_is_ignored(self):
        """Somebody's file from before this, or an editor's guess. Reading it
        would put an instance somewhere the command line did not ask for."""
        from shell import config as C
        C.PATH.parent.mkdir(parents=True, exist_ok=True)
        C.PATH.write_text(json.dumps({"port": 6666, "phone": False}))
        try:
            self.assertEqual(C.load()["port"], P.PORT)
            C.save(C.load())
            self.assertNotIn("port", json.loads(C.PATH.read_text()),
                             "saving put the run's port back into the file")
            self.assertIs(json.loads(C.PATH.read_text())["phone"], False)
        finally:
            C.PATH.unlink()


class TheTerminalSaysWhoseInstanceThisIs(unittest.TestCase):
    """Nothing on the page says it and two instances look identical, so the
    banner is the only place anybody can tell which save file they are in."""

    def test_the_name_is_in_the_box(self):
        from shell.server import whose
        self.assertIn(P.WHO, whose())
        self.assertIn("this Mac", whose())


if __name__ == "__main__":
    unittest.main()


class OneStackForEveryGame(unittest.TestCase):
    """The models and the microphone are the machine's.

    Not because a game could not want its own, but because nobody has the
    memory for two language models at once and nobody wants to set them up
    twice. A game asks for its own settings and is handed the stack with them,
    so everything downstream reads what it always read.
    """

    def tearDown(self):
        from shell import config as MACHINE
        MACHINE.PATH.unlink(missing_ok=True)
        from lucid_talk import config as GAME
        GAME.PATH.unlink(missing_ok=True)

    def test_the_machine_holds_them_and_the_game_does_not(self):
        from shell import config as MACHINE
        from lucid_talk import config as GAME
        for key in ("llm", "stt", "tts", "vad"):
            self.assertIn(key, MACHINE.DEFAULTS, f"{key} is not the machine's")
            self.assertNotIn(key, GAME.DEFAULTS, f"{key} is still the game's")
        self.assertIn("mic_follows_window", MACHINE.DEFAULTS)

    def test_but_the_game_is_handed_them(self):
        from lucid_talk import config as GAME
        cfg = GAME.load()
        self.assertTrue(cfg["llm"]["model"], "no model reached the game")
        self.assertIn("hangover_ms", cfg["vad"])
        self.assertIn("mic_follows_window", cfg["ui"])
        self.assertTrue(cfg["tts"]["voice_ref"].endswith("voice.ref.wav"),
                        "the fallback voice is a clip in one of this game's "
                        "bundles, so it is the game's to supply")

    def test_and_never_writes_them_back(self):
        """Two copies of a model path is one too many, and the stale one wins
        as often as not."""
        from shell import config as MACHINE
        from lucid_talk import config as GAME
        GAME.save(GAME.load())
        written = json.loads(GAME.PATH.read_text())
        for key in MACHINE.OURS:
            self.assertNotIn(key, written)
        self.assertNotIn("mic_follows_window", written.get("ui", {}))

    def test_a_config_from_before_the_split_moves_up(self):
        """Every game carried its own copy once. Whatever is found in one is
        the machine's, and it goes where the next game will look for it."""
        from shell import config as MACHINE
        from lucid_talk import config as GAME
        GAME.PATH.parent.mkdir(parents=True, exist_ok=True)
        GAME.PATH.write_text(json.dumps({
            "llm": {"model": "/Volumes/big/llm", "venv": "/opt/env/bin"},
            "vad": {"hangover_ms": 900},
            "ui": {"continuous_minutes": 40, "mic_follows_window": "never"},
        }))
        cfg = GAME.load()

        machine = json.loads(MACHINE.PATH.read_text())
        self.assertEqual(machine["llm"]["model"], "/Volumes/big/llm")
        self.assertEqual(machine["vad"]["hangover_ms"], 900)
        self.assertEqual(machine["mic_follows_window"], "never")

        left = json.loads(GAME.PATH.read_text())
        self.assertNotIn("llm", left)
        self.assertNotIn("vad", left)
        self.assertNotIn("mic_follows_window", left["ui"])
        self.assertEqual(left["ui"]["continuous_minutes"], 40,
                         "what was the game's stayed the game's")
        self.assertEqual(cfg["ui"]["mic_follows_window"], "never",
                         "and the session still sees it")

    def test_and_the_machine_s_own_answer_wins(self):
        from shell import config as MACHINE
        from lucid_talk import config as GAME
        MACHINE.save({**MACHINE.load(), "llm": {"model": "/already/decided"}})
        GAME.PATH.parent.mkdir(parents=True, exist_ok=True)
        GAME.PATH.write_text(json.dumps({"llm": {"model": "/from/the/game"}}))
        GAME.load()
        self.assertEqual(json.loads(MACHINE.PATH.read_text())["llm"]["model"],
                         "/already/decided")


class WhichSchemeThisMachineServes(unittest.TestCase):
    """http unless there is a certificate to serve on, and everything that
    guesses it — the banner, the QR code, check.sh — has to guess the same way
    the server does. A path written down with the file gone is how an instance
    drops back to http without anybody being told."""

    def tearDown(self):
        from shell import config as C
        C.PATH.unlink(missing_ok=True)

    def write(self, **keys):
        from shell import config as C
        C.PATH.parent.mkdir(parents=True, exist_ok=True)
        C.PATH.write_text(json.dumps(keys))

    def test_nothing_written_is_http(self):
        from shell import config as C
        self.assertEqual(C.scheme(), "http")
        self.assertFalse(C.secure())

    def test_a_certificate_that_is_there_is_https(self):
        from shell import config as C
        certs = Path(tempfile.mkdtemp())
        (certs / "lucid.pem").write_text("cert")
        (certs / "lucid-key.pem").write_text("key")
        self.write(tls_cert=str(certs / "lucid.pem"), tls_key=str(certs / "lucid-key.pem"))
        self.assertEqual(C.scheme(), "https")

    def test_and_one_that_has_gone_is_not(self):
        from shell import config as C
        self.write(tls_cert="/gone/lucid.pem", tls_key="/gone/lucid-key.pem")
        self.assertEqual(C.scheme(), "http")

    def test_the_server_asks_the_config(self):
        """One answer, in one place: the banner and the bridge both read it."""
        from shell import config as C
        from shell import server as S
        self.write(tls_cert="/gone/lucid.pem", tls_key="/gone/lucid-key.pem")
        self.assertIs(S.secure(C.load()), C.secure(C.load()))
