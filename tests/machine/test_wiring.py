"""That the page and the machine still speak the same language.

Nothing here loads a model or opens a socket: it reads the source of both
sides and compares the addresses one calls against the routes the other lays
down. That is enough to catch the one failure this pair keeps having — a route
renamed or removed on one side, which raises nothing anywhere. The page asks,
the machine answers 404, and a control simply stops doing anything.

It used to be a list of websocket commands against the handlers registered for
them. There is no websocket left: the page runs the conversation and everything
it needs is an address, so the same check reads the addresses out of the two
places that hold them all —

    app/packages/talk/src/conversation/files.ts       one game's storage
    app/packages/machine/src/*.ts, audio/src/stt.ts   the models

— and asks whether anything answers there. Both ways: a route nobody calls is
either a feature that was taken out of the page and left answering here, or one
that was never wired up. The page is typed and the machine is not, so this is
the seam with no compiler across it.
"""
import re
import unittest
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app" / "packages"
FILES = APP / "talk" / "src" / "conversation" / "files.ts"

# What the machine's own routes are called from. One file per thing it does,
# and the recognizer's call lives with the microphone that feeds it.
MACHINE_SIDE = sorted((APP / "machine" / "src").glob("*.ts")) + \
    [APP / "audio" / "src" / "stt.ts"]


def _routes() -> set[tuple[str, str]]:
    """Every address this server answers, as (path, method).

    Built the way the machine builds it, so a route that is never hung on the
    app is a route that does not exist here either.
    """
    from machine import machine as MACHINE
    from machine import store as STORE
    app = FastAPI()
    MACHINE.routes(app)
    STORE.routes(app)
    out = set()
    for r in app.routes:
        # A websocket has no methods and is every bit as much a route: the
        # voice is one, and it is the one address a page holds open.
        for method in getattr(r, "methods", None) or ["WEBSOCKET"]:
            out.add((r.path, method))
    return out


def _shape(path: str) -> str:
    """A path with everything that varies taken out of it.

    `${encodeURIComponent(slug)}` on one side and `{who}` on the other are the
    same segment, and comparing the words in them would be comparing two
    people's names for one thing.
    """
    path = re.sub(r"\$\{[^{}]*\}", "*", path)
    path = re.sub(r"\{[^{}]*\}", "*", path)
    # A star that is not a whole segment is not part of the address: it is the
    # optional ?persona= glued onto the end of the listing's path, and the
    # address stops in front of it. Same for anything still holding a `${`.
    path = re.sub(r"(?<=[^/])\*.*$", "", path)
    return re.split(r"[$?]", path)[0].rstrip("/")


# ---- what the page asks for ------------------------------------------------

# One game's storage. Every path is built from the same `base()`, which is
# `/store/<game>`, so the game's own slug is a variable here for the same
# reason it is a variable in the route.
#
# Read as a whole file rather than a declaration at a time: the calls are no
# longer one line each -- a listing is fetched, a log is read and then a line
# of it deleted -- and what is wanted is every address, wherever it is written.
FETCH = re.compile(r"""(?:fetch|call)\(\s*`\$\{base\(\)\}([^`]*)`""")
METHOD = re.compile(r"""method:\s*['"](\w+)['"]""")

# The four helpers at the top of the file, which every value goes through and
# which take the path as an argument.
HELPERS = {"value": "GET", "write": "PUT", "erase": "DELETE"}


def _asked_of_a_game() -> set[tuple[str, str]]:
    """Every /store address files.ts reaches for, and how.

    A fetch's method is the one written beside it, and a GET is a fetch with
    nothing written at all.

    The path past `data/` or `logs/` is not compared, because there is nothing
    on the other side to compare it to: the store takes a whole path as one
    segment and has never heard of `memory` or `sessions`. What is checked is
    the namespace, which of the two shapes is being asked for, and the method
    -- and that is the whole of the seam. What a path *means* is one file's
    business at each end, and both of them are files.ts.
    """
    src = FILES.read_text()
    out = set()
    for found in FETCH.finditer(src):
        # The method belongs to this call, so it is looked for between the
        # backtick and the end of the call rather than anywhere after it.
        tail = src[found.end():src.find("}", found.end()) + 1]
        said = METHOD.search(tail)
        kind = found.group(1).strip("/").split("/")[0]
        out.add((f"/store/*/{kind}/*", said.group(1) if said else "GET"))
    return out


def _kinds() -> set[str]:
    """The two shapes, as the page names them. A third would be a page asking
    for a kind of storage the machine does not have."""
    return {p.split("/")[3] for p, _ in _asked_of_a_game()}
def _asked_of_the_machine() -> set[tuple[str, str]]:
    """Every /machine address the page reaches for, and how.

    The helpers in status.ts say the method in their own names; chat, stt and
    the voice socket are written out.
    """
    out = set()
    for f in MACHINE_SIDE:
        if ".test." in f.name:
            continue
        src = f.read_text()
        # A template with the kind in it is one address with a star in it.
        for path in re.findall(r"""\bjson<[^>]*>\(\s*[`'"](/machine[^`'"]*)[`'"]""", src):
            out.add((_shape(path), "GET"))
        for path in re.findall(r"""\bpost<[^>]*>\(\s*['"](/machine[^'"]*)['"]""", src):
            out.add((_shape(path), "POST"))
        # A clip is bytes rather than JSON, and named in the address.
        for path in re.findall(r"""\bbytes\(\s*`(/machine[^`]*)`""", src):
            out.add((_shape(path), "GET"))
        for path in re.findall(r"""machine\(\)\s*\+\s*['"](/machine[^'"?]*)""", src):
            out.add((_shape(path), "POST"))
        # And through the seam a stand-in can answer in place of the machine
        # (address.ts `call`), which is how chat is asked for now.
        for path in re.findall(r"""\bcall\(\s*['"](/machine[^'"?]*)""", src):
            out.add((_shape(path), "POST"))
        for path in re.findall(r"""TTS_PATH\s*=\s*['"](/machine[^'"]*)['"]""", src):
            out.add((_shape(path), "WEBSOCKET"))
    return out


class EveryAddressThePageCallsIsAnswered(unittest.TestCase):
    """The tripwire. Rename a route and this is what says so."""

    def setUp(self):
        self.routes = {(_shape(p), m) for p, m in _routes()}

    # Every address the page calls on the machine, written down rather than
    # counted. A count only notices a set that has shrunk to nothing; a call
    # written in a shape the parser above does not recognise still reads as
    # four or five, and the route it names goes unchecked from that day on.
    # Written down, it fails the moment one of them stops being seen -- and a
    # route genuinely added or dropped is one line here, deliberately.
    THE_MACHINE_S = {
        ("/machine", "GET"),                   # what is loaded, and the numbers
        ("/machine/chat", "POST"),             # a reply, streamed
        ("/machine/stt", "POST"),              # what was heard
        ("/machine/tts", "WEBSOCKET"),         # and what is said back
        ("/machine/voices", "GET"),            # the shelf of clips
        ("/machine/assets/*", "GET"),          # and a shelf of assets, by kind
        ("/machine/assets/*/*", "GET"),        # one of them, as bytes
        ("/machine/models/start", "POST"),
        # What this page is using: the ear, and the voice. Neither is loaded
        # until somebody says so -- see Stack.want.
        ("/machine/models/stt", "POST"),
        ("/machine/models/tts", "POST"),
        ("/machine/models/llm", "POST"),       # which size of it to run
        ("/machine/models/fetch", "POST"),     # and one fetched, from a room's first-open card
        ("/machine/models/stop", "POST"),
        ("/machine/models/warm", "POST"),
        ("/machine/ping", "POST"),             # somebody is still here
    }

    # And the two shapes of storage, by method. The path past the namespace is
    # one segment to the store and is not compared -- see _asked_of_a_game.
    THE_STORE_S = {
        ("/store/*/data/*", m) for m in ("GET", "PUT", "DELETE")
    } | {
        ("/store/*/logs/*", m) for m in ("GET", "POST", "DELETE")
    }

    def test_there_are_some_to_check(self):
        """A pattern that stops matching passes every test under it."""
        self.assertEqual(_kinds(), {"data", "logs"},
                         "files.ts asks for a kind of storage there is not")
        self.assertEqual(_asked_of_a_game(), self.THE_STORE_S,
                         "what the page asks of the store is not what is "
                         "written down here")
        self.assertEqual(_asked_of_the_machine(), self.THE_MACHINE_S,
                         "what the page asks of the machine is not what is "
                         "written down here")

    def test_a_games_storage(self):
        for path, method in sorted(_asked_of_a_game()):
            self.assertIn((path, method), self.routes,
                          f"conversation/files.ts calls {method} {path} and "
                          f"nothing answers there")

    def test_and_the_machine_itself(self):
        for path, method in sorted(_asked_of_the_machine()):
            self.assertIn((path, method), self.routes,
                          f"the page calls {method} {path} and nothing answers "
                          f"there")

    def test_and_nothing_is_served_that_nobody_asks_for(self):
        """The other direction, for every route a page is the only caller of.

        One that nobody calls is either a feature that was taken out of the
        page and left answering here, or one that was never wired up.
        """
        asked = _asked_of_a_game() | _asked_of_the_machine()
        mine = {(p, m) for p, m in self.routes
                if p.startswith("/store/") or p.startswith("/machine")}
        self.assertFalse(mine - asked,
                         f"{sorted(mine - asked)} is served and no page asks "
                         f"for it")


class TheGameIsAWordAndNothingElse(unittest.TestCase):
    def test_the_slug_the_page_asks_under_is_the_one_the_shell_mounts(self):
        """`GAME` in files.ts is the namespace in the address, the directory
        under a player's, and the route the shell mounts the game at. The
        machine has no opinion about any of them -- it has no list of games at
        all -- so what is checked is that the page agrees with itself."""
        said = re.search(r"""export const GAME = ['"]([^'"]+)['"]""",
                         FILES.read_text())
        self.assertIsNotNone(said, "files.ts no longer names the game")
        mounted = re.search(r"""slug: ['"]([^'"]+)['"]""",
                            (FILES.parents[1] / "manifest.ts").read_text())
        self.assertEqual(said.group(1), mounted.group(1))


def _code(path: Path) -> str:
    """One module with its prose taken off: no comments, no docstrings.

    What is checked below is what the machine *does*, and the two are not the
    same question. A file is allowed to say in English which words are not its
    business -- that is the line being drawn, and it is worth writing down --
    but a name in the code is the machine knowing something about a game.
    """
    import ast
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list) or not body:
            continue
        first = body[0]
        if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            body.pop(0)
    return ast.unparse(tree)


class TheMachineHasNoWordForAGame(unittest.TestCase):
    """The whole of this plan, as one check.

    A game is a slug in an address and a directory under a player, and nothing
    else reaches the Python. If any of these words turns up in what the machine
    does rather than in what it says about itself, something has leaked back
    across the line.

    `memory` is not on the list and cannot be: the machine measures its own, in
    gigabytes, and that is the one meter every console shows.
    """

    # Not `prompt`, which is the language model's own word: `prompt_cache_gb`
    # is a setting on the server and warming a prompt is what the machine is
    # asked to do. Not `memory` either -- see above.
    THEIRS = ("persona", "pill", "relation", "standing", "room", "session",
              "ledger", "dose")

    def test_there_are_some_modules_to_check(self):
        self.assertGreater(len(list((ROOT / "machine").glob("*.py"))), 8)

    def test_not_one_of_them_says_a_game_s_word(self):
        """Whole words, so `start_new_session` is what it is -- a flag on a
        subprocess -- and not a game leaking back in."""
        for path in sorted((ROOT / "machine").glob("*.py")):
            code = _code(path).lower()
            for word in self.THEIRS:
                found = re.search(rf"(?<![a-z0-9_]){word}e?s?(?![a-z0-9_])", code)
                self.assertIsNone(found, f"machine/{path.name} says {word!r}")


class WhereTheModelsAre(unittest.TestCase):
    """A model path is read from the checkout unless it says otherwise.

    The models come down into `models/` beside the code, so the config says
    `models/llm` — short, the same on every machine, and still true after the
    whole directory is moved or renamed. Somebody who keeps twelve gigabytes of
    weights somewhere of their own writes an absolute path, or one starting at
    ~, and it is taken exactly as written.
    """

    def test_a_bare_path_is_inside_the_checkout(self):
        from machine import config as C
        from machine.paths import ROOT as CHECKOUT
        self.assertEqual(C.somewhere("models/llm"), str(CHECKOUT / "models" / "llm"))
        self.assertEqual(C.somewhere(".venv/bin"), str(CHECKOUT / ".venv" / "bin"))

    def test_an_absolute_one_is_left_alone(self):
        from machine import config as C
        self.assertEqual(C.somewhere("/Volumes/big/llm"), "/Volumes/big/llm")

    def test_and_a_tilde_is_your_home(self):
        from machine import config as C
        self.assertEqual(C.somewhere("~/Models/llm"),
                         str(Path.home() / "Models" / "llm"))

    def test_nothing_written_stays_nothing(self):
        """An empty draft_model is a setting, not a path — it must not become
        the checkout."""
        from machine import config as C
        self.assertEqual(C.somewhere(""), "")

    def test_the_settings_come_out_resolved(self):
        """What the machine is handed has real paths in it, whatever the file
        says — nothing downstream should have to know this rule exists."""
        from machine import config as C
        from machine.paths import ROOT as CHECKOUT
        cfg = C.afoot({"llm": {"model": "models/llm", "venv": "/opt/env/bin",
                               "draft_model": "models/draft"},
                       "stt": {"model": "~/elsewhere/parakeet"},
                       "tts": {"model": ""}})
        self.assertEqual(cfg["llm"]["model"], str(CHECKOUT / "models" / "llm"))
        self.assertEqual(cfg["llm"]["venv"], "/opt/env/bin")
        self.assertEqual(cfg["stt"]["model"],
                         str(Path.home() / "elsewhere" / "parakeet"))
        self.assertEqual(cfg["tts"]["model"], "")

    def test_the_draft_model_is_one_of_them(self):
        """It is checked for on disk before the flag is passed, so a relative
        one read against the working directory is found only by a start made
        from the checkout — and anywhere else speculative decoding turns
        itself off with nothing said about it."""
        from machine import config as C
        from machine.paths import ROOT as CHECKOUT
        cfg = C.afoot({"llm": {"draft_model": "models/draft"}})
        self.assertEqual(cfg["llm"]["draft_model"],
                         str(CHECKOUT / "models" / "draft"))

    def test_and_so_is_the_certificate(self):
        """Written down the way a model path is, and read the same way: a
        certificate under a home directory is an ordinary place to keep one."""
        import json
        from machine import config as C
        from machine.paths import ROOT as CHECKOUT
        C.PATH.parent.mkdir(parents=True, exist_ok=True)
        C.PATH.write_text(json.dumps({"tls_cert": "userdata/certs/x.pem",
                                      "tls_key": "~/keys/x-key.pem"}))
        self.addCleanup(C.PATH.unlink)
        cfg = C.load()
        self.assertEqual(cfg["tls_cert"],
                         str(CHECKOUT / "userdata" / "certs" / "x.pem"))
        self.assertEqual(cfg["tls_key"],
                         str(Path.home() / "keys" / "x-key.pem"))


class WhatAFreshInstallActuallyGets(unittest.TestCase):
    """setup.sh writes two keys into the machine's `llm` section and nothing
    else, which is the ordinary case rather than the odd one — so a section
    merged whole would take every documented default with it, and what a
    stranger's first evening ran on would be the fallbacks buried in the code.
    """

    def tearDown(self):
        from machine import config as MACHINE
        MACHINE.PATH.unlink(missing_ok=True)

    def test_a_partial_section_keeps_the_rest_of_it(self):
        import json
        from machine import config as MACHINE
        MACHINE.PATH.parent.mkdir(parents=True, exist_ok=True)
        MACHINE.PATH.write_text(json.dumps(
            {"llm": {"model": "models/llm", "venv": ".venv/bin"}}))

        cfg = MACHINE.load()
        for key in ("max_tokens", "context_turns", "context_words", "temperature"):
            self.assertEqual(cfg["llm"][key], MACHINE.DEFAULTS["llm"][key])
        self.assertTrue(cfg["llm"]["model"].endswith("models/llm"))

    def test_and_the_page_is_handed_the_stack(self):
        """The microphone's numbers reach a page through `GET /machine` -- one
        recognizer, one voice and one set of thresholds, however many games are
        on this Mac. A game's own settings never came from here."""
        import json
        from machine import config as MACHINE
        from machine import machine as M
        MACHINE.PATH.parent.mkdir(parents=True, exist_ok=True)
        MACHINE.PATH.write_text(json.dumps({"llm": {"model": "models/llm"}}))
        facts = M.Stack(llm=object(), voice=object()).facts()
        self.assertIn("hangover_ms", facts["vad"])
        self.assertIn(facts["mic_barge"], ("auto", "on", "off"))


class WhatIsWrittenDownStaysAsItWasWritten(unittest.TestCase):
    """A console command that changes a setting changes that setting.

    The file is not a snapshot of what load() handed out. That has today's
    DEFAULTS merged into it and every path resolved against this checkout, so
    writing it back freezes both: a default improved later never reaches this
    machine again, and `models/llm` becomes an absolute path that stops being
    true the day the directory is moved.
    """

    def tearDown(self):
        from machine import config as C
        C.PATH.unlink(missing_ok=True)

    def test_a_path_is_still_the_path_somebody_wrote(self):
        import json
        from machine import config as C
        C.PATH.parent.mkdir(parents=True, exist_ok=True)
        C.PATH.write_text(json.dumps({"llm": {"model": "models/llm"},
                                      "tls_cert": "userdata/certs/x.pem"}))
        C.note(mic_barge="off")
        got = json.loads(C.PATH.read_text())
        self.assertEqual(got["llm"]["model"], "models/llm")
        self.assertEqual(got["tls_cert"], "userdata/certs/x.pem")
        self.assertEqual(got["mic_barge"], "off")

    def test_and_nothing_else_is_written_at_all(self):
        import json
        from machine import config as C
        C.note(mic_follows_window="never")
        self.assertEqual(json.loads(C.PATH.read_text()),
                         {"mic_follows_window": "never"})
        self.assertEqual(C.load()["llm"]["max_tokens"],
                         C.DEFAULTS["llm"]["max_tokens"],
                         "a default was frozen into the file")


class NothingIsKilledThatWasNotStarted(unittest.TestCase):
    """Unloading the models must not reach for other processes. The port the
    language model uses is the commonest one in development there is, and a
    program that clears it on the way out takes somebody's other work with
    it."""

    def test_no_process_is_ended_by_port_number(self):
        models = (ROOT / "machine" / "models.py").read_text()
        stop = models[models.index("    def stop(self):"):]
        stop = stop[:stop.index("\n    def ")]
        self.assertNotIn("os.kill(pid", stop,
                         "stop() ends a process it did not start")
        self.assertIn("port_pids", stop, "and no longer even looks?")


class TheServerDoesNotHandOutAMapOfItself(unittest.TestCase):
    """FastAPI serves /docs, /redoc and /openapi.json unless it is told not to.

    Nothing here reads them: the page is built against these routes and the
    manual describes them in English. What they are on this port is a map of
    every address and every body shape to whoever asks -- and with --phone
    that is anyone on the wifi, none of whom this asks to identify themselves.
    """

    def app(self):
        from fastapi.testclient import TestClient
        from machine import server as S
        return TestClient(S.create_app())

    def test_the_schema_is_not_served(self):
        self.assertEqual(self.app().get("/openapi.json").status_code, 404)

    def test_and_neither_are_the_two_pages_that_read_it(self):
        """They answer, because every address that is not a route is the page
        itself -- and what comes back is the page, not a description."""
        client = self.app()
        for path in ("/docs", "/redoc"):
            said = client.get(path).text.lower()
            self.assertNotIn("swagger", said, path)
            self.assertNotIn("openapi", said, path)


class OnlyOurOwnPagesGetTheVoice(unittest.TestCase):
    """Browsers apply the same-origin rule to fetch and not to websockets, so
    any page in any tab could otherwise dial the voice socket and be handed
    whatever this machine is saying."""

    class Ws:
        def __init__(self, **headers):
            self.headers = {k.lower(): v for k, v in headers.items()}

    def test_a_page_from_somewhere_else_is_refused(self):
        from machine import server as S
        self.assertFalse(S.from_this_page(
            self.Ws(origin="https://evil.example", host="127.0.0.1:6969")))

    def test_our_own_page_is_not(self):
        from machine import server as S
        self.assertTrue(S.from_this_page(
            self.Ws(origin="http://127.0.0.1:6969", host="127.0.0.1:6969")))
        self.assertTrue(S.from_this_page(
            self.Ws(origin="https://mac.local:6969", host="mac.local:6969")))

    def test_and_a_program_with_no_origin_is_let_through(self):
        """curl, a test, the phone bridge. This closes what a browser opens; it
        is not authentication and does not pretend to be."""
        from machine import server as S
        self.assertTrue(S.from_this_page(self.Ws(host="127.0.0.1:6969")))


if __name__ == "__main__":
    unittest.main()
