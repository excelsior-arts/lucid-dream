"""The console: what the machine is doing, and how to tell it to do something.

This is the tool somebody reaches for when the evening has already stopped
working, so the ways it can fail are all of the "and then there was nothing to
look at" kind: a log that stops, a console that goes quiet, a command that
raises instead of answering.
"""
import asyncio
import logging
import unittest

from tests import clean
from shell import log as L


class Saying(unittest.TestCase):
    def setUp(self):
        clean()
        L.ring.clear()
        L.watchers.clear()

    def test_a_line_carries_who_said_it_and_how_loudly(self):
        line = L.say("the voice would not load", source="talk", level="error")
        self.assertEqual(line["source"], "talk")
        self.assertEqual(line["level"], "error")
        self.assertIn("voice", line["text"])
        self.assertEqual(L.ring[-1], line)

    def test_a_level_nobody_defined_becomes_an_ordinary_one(self):
        self.assertEqual(L.say("x", level="catastrophe")["level"], "info")

    def test_lines_are_numbered_in_the_order_they_happened(self):
        a, b = L.say("first"), L.say("second")
        self.assertEqual(b["n"], a["n"] + 1)

    def test_a_line_cannot_be_a_paragraph_or_break_the_column(self):
        line = L.say("a\nb\nc" + "x" * 5000)
        self.assertNotIn("\n", line["text"])
        self.assertLessEqual(len(line["text"]), L.WIDE)

    def test_the_backlog_a_page_gets_does_not_grow_forever(self):
        for i in range(L.KEEP + 50):
            L.say(f"line {i}")
        self.assertEqual(len(L.ring), L.KEEP)
        self.assertIn(f"line {L.KEEP + 49}", L.ring[-1]["text"])

    def test_it_is_also_written_down_where_it_outlives_the_process(self):
        L.say("something worth keeping")
        self.assertIn("something worth keeping", L.FILE.read_text())

    def test_the_file_turns_over_rather_than_growing_all_night(self):
        L.say("the oldest thing")
        L.FILE.write_text("x" * (L.BYTES + 1))
        L.say("after the turn")
        self.assertIn("after the turn", L.FILE.read_text())
        self.assertTrue(L.WAS.exists())
        self.assertLess(L.FILE.stat().st_size, L.BYTES)

    def test_a_log_that_cannot_be_written_does_not_take_the_app_down(self):
        """The one place in this program allowed not to speak."""
        L.DIR.mkdir(parents=True, exist_ok=True)
        was = L.FILE
        try:
            L.FILE = L.DIR                      # a directory, not a file
            self.assertTrue(L.say("still returns"))
        finally:
            L.FILE = was


class TheSameThingOverAndOver(unittest.TestCase):
    """A voice model announcing its tokenizer once per sentence put four
    hundred identical lines into the last thousand and pushed everything worth
    reading out of the ring."""

    def setUp(self):
        clean()
        L.ring.clear()
        L._last, L._again = None, 0

    def test_a_run_is_one_line_and_a_count(self):
        for _ in range(12):
            L.say("the same thing", source="talk")
        L.say("something else", source="talk")
        said = [l["text"] for l in L.ring]
        self.assertEqual(said, ["the same thing",
                                "… and that again, 11 more times",
                                "something else"])

    def test_the_count_is_said_when_the_run_ends(self):
        """Which is the moment it is worth knowing. Said at the start it would
        be a guess, and said never it would be a lie of omission."""
        L.say("waiting")
        L.say("waiting")
        self.assertEqual(len(L.ring), 1, "it said the count before it knew it")
        L.say("done")
        self.assertIn("1 more time", L.ring[1]["text"])

    def test_twice_is_said_in_the_singular(self):
        L.say("x"); L.say("x"); L.say("y")
        self.assertIn("1 more time,", L.ring[1]["text"] + ",")

    def test_the_same_words_from_two_places_are_two_things(self):
        L.say("ready", source="talk")
        L.say("ready", source="shell")
        self.assertEqual(len(L.ring), 2)

    def test_it_goes_into_the_file_the_same_way(self):
        for _ in range(5):
            L.say("over and over")
        L.say("and then this")
        wrote = L.FILE.read_text()
        self.assertEqual(wrote.count("over and over"), 1)
        self.assertIn("4 more times", wrote)


class OtherProgramsDiaries(unittest.TestCase):
    """Turning away running commentary is not muting an error: anything these
    two have to say at warning or above still arrives."""

    def setUp(self):
        clean()
        L.ring.clear()
        L._last, L._again = None, 0

    def _heard(self, who, level, msg):
        L.Ear().emit(logging.LogRecord(who, level, "f", 1, msg, None, None))
        return [l["text"] for l in L.ring]

    def test_a_voice_model_naming_its_tokenizer_is_not_news(self):
        self.assertEqual(self._heard("mlx_audio", logging.INFO,
                                     "Extracted conditionals using MLX S3Tokenizer"), [])

    def test_but_a_voice_model_in_trouble_is(self):
        self.assertEqual(self._heard("mlx_audio", logging.ERROR, "it would not load"),
                         ["it would not load"])

    def test_a_page_that_closed_mid_write_is_not_news(self):
        self.assertEqual(self._heard("asyncio", logging.WARNING,
                                     "socket.send() raised exception."), [])

    def test_but_anything_else_asyncio_says_is(self):
        self.assertEqual(self._heard("asyncio", logging.WARNING, "something odd"),
                         ["something odd"])


class WatchingPages(unittest.TestCase):
    def setUp(self):
        clean()
        L.ring.clear()
        L.watchers.clear()

    def test_a_page_that_stopped_reading_keeps_its_console(self):
        """A phone asleep in a pocket. Dropping the watcher meant the page
        came back to a log that stopped when it looked away, saying nothing
        about why — so the middle is lost instead of the console."""
        loop = asyncio.new_event_loop()
        try:
            L.bind(loop)
            q = asyncio.Queue(maxsize=2)
            L.watchers.add(q)
            for i in range(6):
                L.say(f"line {i}")
                loop.run_until_complete(asyncio.sleep(0))
            self.assertIn(q, L.watchers)
            self.assertEqual(q.qsize(), 2)
            newest = q.get_nowait(), q.get_nowait()
            self.assertIn("line 5", newest[-1]["lines"][0]["text"])
        finally:
            L.watchers.clear()
            loop.close()

    def test_with_nobody_listening_it_still_says_it(self):
        L.bind(None)
        self.assertTrue(L.say("into the ring and the file"))


class Health(unittest.TestCase):
    def setUp(self):
        L.health.clear()

    def test_the_bar_only_changes_when_something_has(self):
        """Called five times a second, so the comparison is the point."""
        L.state("machine", parts=[1])
        first = L.health["machine"]
        L.state("machine", parts=[1])
        self.assertIs(L.health["machine"], first)
        L.state("machine", parts=[2])
        self.assertIsNot(L.health["machine"], first)


class Commands(unittest.TestCase):
    def setUp(self):
        self.was = dict(L.orders)

    def tearDown(self):
        L.orders.clear()
        L.orders.update(self.was)

    def _run(self, line):
        return asyncio.new_event_loop().run_until_complete(L.run(line))

    def test_a_command_runs_and_answers(self):
        L.command("greet", "say hello", app="lucid-talk")(lambda args: f"hi {args}")
        self.assertEqual(self._run("/greet there"), "hi there")
        self.assertEqual(self._run("greet there"), "hi there")   # slash optional

    def test_a_command_that_throws_answers_instead_of_dying(self):
        """This runs on the socket that is showing you the log. A command that
        raises here takes the console with it."""
        def boom(_):
            raise RuntimeError("no")
        L.command("boom", "break")(boom)
        self.assertIn("boom failed", self._run("/boom"))
        self.assertIn("RuntimeError", self._run("/boom"))

    def test_asking_for_something_that_is_not_there(self):
        self.assertIn("no such command", self._run("/nonsense"))
        self.assertEqual(self._run("   "), "")

    def test_the_list_is_the_one_that_makes_sense_from_where_you_stand(self):
        """An app's front door is not one of its rooms: "listen or type only"
        is an answer to a question nobody standing at the box is asking."""
        L.command("everywhere", "shell's own", app="shell")(lambda a: "")
        L.command("models", "the machine's", app="machine")(lambda a: "")
        L.command("anywhere_in_talk", "the app's", app="lucid-talk")(lambda a: "")
        L.command("in_a_room", "a room's", app="lucid-talk/room")(lambda a: "")
        L.command("someone_elses", "another app's", app="other-app")(lambda a: "")

        at_the_box = [o["name"] for o in L.listing("lucid-talk")]
        in_a_room = [o["name"] for o in L.listing("lucid-talk/room")]
        for offered in (at_the_box, in_a_room):
            self.assertIn("everywhere", offered)
            self.assertIn("models", offered)
            self.assertIn("anywhere_in_talk", offered)
            self.assertNotIn("someone_elses", offered)
        self.assertNotIn("in_a_room", at_the_box)
        self.assertIn("in_a_room", in_a_room)

    def test_the_shell_and_the_machine_come_first(self):
        names = [o["app"] for o in L.listing("lucid-talk/room")]
        self.assertEqual(names, sorted(names, key=lambda a: L.RANK.get(a, 2)))

    def test_a_command_can_still_be_typed_from_anywhere(self):
        """The filtering is of what is offered, not of what is possible."""
        L.command("in_a_room", "a room's", app="lucid-talk/room")(lambda a: "ran")
        self.assertEqual(self._run("/in_a_room"), "ran")


class TheCommandsAreNamedInFamilies(unittest.TestCase):
    """Subject first: `<the thing>_<what about it>`.

    A console is a list somebody reads down, and read down it should fall into
    families on its own — room_clear beside room_reach beside room_state,
    ai_models_start beside ai_models_stop. Verb-first names scatter those: a
    start and a stop that belong together end up at opposite ends.

    Which puts the verb last, and the verb is what somebody types. That is what
    the any-word matching in night.js is for, and the two go together: without
    it, subject-first names would be less findable rather than more.
    """

    VERBS = ("start", "stop", "clear", "restart", "new", "show", "list",
             "set", "where", "reach", "state")

    def names(self):
        import re
        from pathlib import Path
        root = Path(__file__).resolve().parents[2]
        found = set()
        for f in (root / "shell/log.py", root / "shell/server.py",
                  root / "lucid_talk/server.py", root / "lucid_talk/static/index.html"):
            found |= set(re.findall(r"""(?:L|LOG|Hatch)\.command\(["']([a-z_]+)["']""",
                                    f.read_text()))
            if f.name == "log.py":
                found |= set(re.findall(r"""^@command\(["']([a-z_]+)["']""",
                                        f.read_text(), re.M))
        return found

    def test_no_command_leads_with_its_verb(self):
        wrong = [n for n in self.names() if n.split("_")[0] in self.VERBS
                 and len(n.split("_")) > 1]
        self.assertFalse(wrong, f"these lead with the verb: {sorted(wrong)}")

    def test_and_the_console_finds_a_name_by_any_of_its_words(self):
        from pathlib import Path
        night = (Path(__file__).resolve().parents[2]
                 / "shell/static/night.js").read_text()
        i = night.index("function suggest()")
        block = night[i:i + 1400]
        self.assertIn("split('_')", block,
                      "only the first word is matched, so a verb finds nothing")
