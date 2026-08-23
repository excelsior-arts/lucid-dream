"""That the page and the server still speak the same language.

Nothing here loads a model or opens a socket: it reads the source of both
sides and compares the names they use on each other. That is enough to catch
the one failure this pair keeps having — a command renamed or removed on one
side, which does not raise anything anywhere. The page sends it, the server
looks it up, finds nothing, and returns to the loop. The button just stops
doing anything, and the console says nothing at all because nothing went
wrong.

It happened with `persona` and `resume`, which became `open`, and the live
scripts under tests/live went on sending the old names for a while afterwards.
"""
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "lucid_talk"
SERVER = (APP / "server.py").read_text()
PAGES = [p for p in (APP / "static").iterdir() if p.suffix in (".html", ".js")]

# Registered by the app for its own websocket.
TAKES = set(re.findall(r'^@command\("([a-z_]+)"\)', SERVER, re.M))
# And what the pages actually send, wherever they say it.
SENDS = {m for p in PAGES
         for m in re.findall(r"""cmd:\s*['"]([a-z_]+)['"]""", p.read_text())}
SENDS |= {m for p in PAGES
          for m in re.findall(r"""["']cmd["']\s*:\s*['"]([a-z_]+)['"]""", p.read_text())}

# Registered, and nothing on any page sends it. Every one of these is reached
# from the console instead, by typing it, or is kept for a reason written here
# — and the point of the list is that adding to it is a decision somebody made
# rather than a thing that quietly happened.
#
#   mode, ptt          the mic's other manners. No control on any page offers
#                      them since the panel became a deck; the machinery is
#                      still there and still works when typed.
#   (clear was here until the console's /session_new moved onto the page and
#    started sending it, which is what this check is for.)
#   room_forget        the console clears a room with /room_clear, which does
#                      it directly rather than over this socket.
#   ledger             sent once at the handshake, unasked; the box's counts
#                      come with the page rather than being fetched.
#   stop_all           no page has a control for putting the models away: the
#                      console does it with /ai_models_stop, which calls it
#                      directly rather than over this socket. Kept because the
#                      scripts in tests/live drive a running server through
#                      this wire and stop it again when they are done.
UNSENT = {"mode", "ptt", "room_forget", "ledger", "stop_all"}


class TheyStillAgree(unittest.TestCase):
    def test_every_command_a_page_sends_is_one_the_server_takes(self):
        missing = SENDS - TAKES
        self.assertFalse(missing, f"the page sends {sorted(missing)} and nothing "
                                  f"answers it — a control that silently does nothing")

    def test_nothing_is_registered_that_nobody_can_reach(self):
        unused = TAKES - SENDS - UNSENT
        self.assertFalse(unused, f"{sorted(unused)} is registered and nothing sends "
                                 f"it. Wire it up, or write it into UNSENT above "
                                 f"with the reason it is kept")

    def test_the_list_of_known_unused_commands_is_still_true(self):
        stale = UNSENT & SENDS
        self.assertFalse(stale, f"{sorted(stale)} is listed as unsent and the page "
                                f"sends it — take it out of UNSENT")
        gone = UNSENT - TAKES
        self.assertFalse(gone, f"{sorted(gone)} is listed as unsent and no longer "
                               f"exists at all — take it out of UNSENT")

    def test_the_live_scripts_have_not_been_left_behind(self):
        """They are run by hand, months apart, and a stale command in one
        looks exactly like the feature it is testing being broken."""
        live = Path(__file__).resolve().parents[1] / "live"
        for f in live.glob("*.py"):
            for cmd in re.findall(r"""["']cmd["']\s*:\s*["']([a-z_]+)["']""", f.read_text()):
                self.assertIn(cmd, TAKES, f"tests/live/{f.name} sends '{cmd}', "
                                          f"which the server no longer takes")


class TheAddressOfAConversation(unittest.TestCase):
    """Every message out of the app is stamped with whose conversation it is
    about — see whose_msg in server.py. Two windows open without it was one
    room drawing another room's transcript and one pill's voice coming out of
    the other's speakers."""

    def test_the_stamp_is_still_put_on(self):
        self.assertIn("def whose_msg", SERVER)
        self.assertRegex(SERVER, r"msg = whose_msg\(msg\)")

    def test_the_handshake_is_stamped_too(self):
        """It is the one burst a page has no way of having asked for."""
        handshake = SERVER[SERVER.index("async def ws_endpoint"):]
        handshake = handshake[:handshake.index("while True")]
        # Exactly one, and it is the one inside tell(). Anything else is a
        # message leaving without a return address on it.
        self.assertEqual(handshake.count("ws.send_json("), 1,
                         "something in the handshake goes out unstamped")
        self.assertIn("await ws.send_json(whose_msg(msg))", handshake)

    def test_the_page_knows_which_conversation_is_its_own(self):
        page = (APP / "static" / "index.html").read_text()
        self.assertIn("function mine(", page)
        self.assertIn("if (!mine(m))", page)


class WhereTheModelsAre(unittest.TestCase):
    """A model path is read from the checkout unless it says otherwise.

    The models come down into `models/` beside the code, so the config says
    `models/llm` — short, the same on every machine, and still true after the
    whole directory is moved or renamed. Somebody who keeps twelve gigabytes of
    weights somewhere of their own writes an absolute path, or one starting at
    ~, and it is taken exactly as written.
    """

    def test_a_bare_path_is_inside_the_checkout(self):
        from shell import config as C
        from shell.paths import ROOT
        self.assertEqual(C.somewhere("models/llm"), str(ROOT / "models" / "llm"))
        self.assertEqual(C.somewhere(".venv/bin"), str(ROOT / ".venv" / "bin"))

    def test_an_absolute_one_is_left_alone(self):
        from shell import config as C
        self.assertEqual(C.somewhere("/Volumes/big/llm"), "/Volumes/big/llm")

    def test_and_a_tilde_is_your_home(self):
        from shell import config as C
        self.assertEqual(C.somewhere("~/Models/llm"),
                         str(Path.home() / "Models" / "llm"))

    def test_nothing_written_stays_nothing(self):
        """An empty draft_model is a setting, not a path — it must not become
        the checkout."""
        from shell import config as C
        self.assertEqual(C.somewhere(""), "")

    def test_the_settings_come_out_resolved(self):
        """What the app is handed has real paths in it, whatever the file says
        — nothing downstream should have to know this rule exists."""
        from shell import config as C
        from shell.paths import ROOT
        cfg = C.afoot({"llm": {"model": "models/llm", "venv": "/opt/env/bin"},
                       "stt": {"model": "~/elsewhere/parakeet"},
                       "tts": {"model": ""}})
        self.assertEqual(cfg["llm"]["model"], str(ROOT / "models" / "llm"))
        self.assertEqual(cfg["llm"]["venv"], "/opt/env/bin")
        self.assertEqual(cfg["stt"]["model"], str(Path.home() / "elsewhere" / "parakeet"))
        self.assertEqual(cfg["tts"]["model"], "")


class TurningTheGameSSwitchesOff(unittest.TestCase):
    """memory, relation and scene each have an `enabled` flag, and a flag that
    changes what the machine does without changing what the page says is worse
    than no flag at all: it is discovered a week later by somebody wondering
    why nothing is being remembered.
    """

    def setUp(self):
        from tests import clean
        clean()

    def tearDown(self):
        from lucid_talk import config as C
        C.PATH.unlink(missing_ok=True)

    def off(self, **what):
        """A game with some of it switched off, as a fresh session sees it."""
        import json
        from lucid_talk import config as C
        C.PATH.parent.mkdir(parents=True, exist_ok=True)
        C.PATH.write_text(json.dumps({k: {"enabled": False} for k in what}))
        return C.load()

    def test_memory_off_says_so_on_its_own_sheet(self):
        import asyncio
        from lucid_talk import server as SV
        cfg = self.off(memory=True)

        class Ws:
            def __init__(self): self.sent = []
            async def send_json(self, m): self.sent.append(m)

        class Fake:
            def __init__(self, cfg): self.cfg, self.persona = cfg, {"slug": "lover"}

        ws = Ws()
        asyncio.run(SV.COMMANDS["memory_get"](Fake(cfg), {"slug": "lover"}, ws))
        self.assertTrue(ws.sent[0]["off"],
                        "the sheet is told nothing is being kept")

        from lucid_talk import config as C
        C.PATH.unlink()                        # switched back on
        ws = Ws()
        asyncio.run(SV.COMMANDS["memory_get"](Fake(C.load()), {"slug": "lover"}, ws))
        self.assertFalse(ws.sent[0]["off"], "and not told so when it is on")

    def test_and_the_page_draws_that_state(self):
        """The one place it can be said is the sheet itself."""
        page = (Path(__file__).resolve().parents[2]
                / "lucid_talk" / "static" / "sheets.js").read_text()
        self.assertIn("memory is off", page)
        self.assertIn("readonly", page,
                      "an editable box that saves nowhere is a trap")

    def test_relation_off_shows_no_standing(self):
        """A standing nothing is moving any more is a number pretending to be
        one — including one left on disk from before it was turned off."""
        from lucid_talk import relation as R
        from lucid_talk import server as SV
        R.save("lover", {"warmth": 60, "trust": 40, "mood": 20, "when": 0})

        SV.session = None                      # the box, read before anything starts
        try:
            self.off(relation=True)
            rows = {p["slug"]: p for p in SV.ledger()["pills"]}
            self.assertEqual(rows["lover"]["standing"], "")
            from lucid_talk import config as C
            C.PATH.unlink()                    # switched back on
            rows = {p["slug"]: p for p in SV.ledger()["pills"]}
            self.assertTrue(rows["lover"]["standing"], "on, it is shown again")
        finally:
            SV.session = None



class WhatAFreshInstallActuallyGets(unittest.TestCase):
    """setup.sh writes two keys into the machine's `llm` section and nothing
    else, which is the ordinary case rather than the odd one — so a section
    merged whole would take every documented default with it, and what a
    stranger's first evening ran on would be the fallbacks buried in the code.
    """

    def tearDown(self):
        from shell import config as MACHINE
        MACHINE.PATH.unlink(missing_ok=True)

    def test_a_partial_section_keeps_the_rest_of_it(self):
        import json
        from shell import config as MACHINE
        MACHINE.PATH.parent.mkdir(parents=True, exist_ok=True)
        MACHINE.PATH.write_text(json.dumps(
            {"llm": {"model": "models/llm", "venv": ".venv/bin"}}))

        cfg = MACHINE.load()
        self.assertEqual(cfg["llm"]["max_tokens"], MACHINE.DEFAULTS["llm"]["max_tokens"])
        self.assertEqual(cfg["llm"]["context_turns"], MACHINE.DEFAULTS["llm"]["context_turns"])
        self.assertEqual(cfg["llm"]["context_words"], MACHINE.DEFAULTS["llm"]["context_words"])
        self.assertEqual(cfg["llm"]["temperature"], MACHINE.DEFAULTS["llm"]["temperature"])
        self.assertTrue(cfg["llm"]["model"].endswith("models/llm"))

    def test_and_the_game_is_handed_the_whole_thing(self):
        import json
        from lucid_talk import config as GAME
        from shell import config as MACHINE
        MACHINE.PATH.parent.mkdir(parents=True, exist_ok=True)
        MACHINE.PATH.write_text(json.dumps({"llm": {"model": "models/llm"}}))
        cfg = GAME.load()
        self.assertEqual(cfg["llm"]["max_tokens"], MACHINE.DEFAULTS["llm"]["max_tokens"])
        self.assertIn("hangover_ms", cfg["vad"])


class NothingIsKilledThatWasNotStarted(unittest.TestCase):
    """Unloading the models must not reach for other processes. The port the
    language model uses is the commonest one in development there is, and a
    game that clears it on the way out takes somebody's other work with it."""

    def test_no_process_is_ended_by_port_number(self):
        models = (Path(__file__).resolve().parents[2]
                  / "lucid_talk" / "models.py").read_text()
        stop = models[models.index("    def stop(self):"):]
        stop = stop[:stop.index("\n    def ")]
        self.assertNotIn("os.kill(pid", stop,
                         "stop() ends a process it did not start")
        self.assertIn("port_pids", stop, "and no longer even looks?")

    def test_and_the_stale_port_sweep_is_gone(self):
        session = (Path(__file__).resolve().parents[2]
                   / "lucid_talk" / "session.py").read_text()
        self.assertNotIn("STALE_PORTS", session)
        self.assertNotIn("7861", session)


class AssetsCannotClimbOut(unittest.TestCase):
    """Both halves of a bundle asset's path come off a URL."""

    def test_a_slug_that_climbs_is_refused(self):
        from lucid_talk import personas as P
        self.assertIsNone(P.asset("../../shell", "server.py"))
        self.assertIsNone(P.asset("..", "config.py"))

    def test_a_name_that_climbs_is_refused(self):
        from lucid_talk import personas as P
        self.assertIsNone(P.asset("lover", "../../server.py"))

    def test_and_an_ordinary_one_is_not(self):
        from lucid_talk import personas as P
        self.assertIsNotNone(P.asset("lover", "room.js"))


class OnlyOurOwnPagesGetTheConversation(unittest.TestCase):
    """Browsers apply the same-origin rule to fetch and not to websockets, so
    any page in any tab could otherwise dial the socket and be handed the
    transcript in the handshake."""

    class Ws:
        def __init__(self, **headers):
            self.headers = {k.lower(): v for k, v in headers.items()}

    def test_a_page_from_somewhere_else_is_refused(self):
        from shell import server as S
        self.assertFalse(S.from_this_page(
            self.Ws(origin="https://evil.example", host="127.0.0.1:6969")))

    def test_our_own_page_is_not(self):
        from shell import server as S
        self.assertTrue(S.from_this_page(
            self.Ws(origin="http://127.0.0.1:6969", host="127.0.0.1:6969")))
        self.assertTrue(S.from_this_page(
            self.Ws(origin="https://mac.local:6969", host="mac.local:6969")))

    def test_and_a_program_with_no_origin_is_let_through(self):
        """curl, a test, the phone bridge. This closes what a browser opens; it
        is not authentication and does not pretend to be."""
        from shell import server as S
        self.assertTrue(S.from_this_page(self.Ws(host="127.0.0.1:6969")))
