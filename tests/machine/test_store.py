"""The store, under whatever a name turns out to be.

Ported from the checks that sat beside the named bags — the sessions, the
memory, the standing and the rooms — and asked of the two shapes that replaced
them. The questions are the same ones, because the failures are: a torn last
line, a hand-edited file, a half-written save, and a path that arrived from an
address bar and is turned straight into a path on disk.

What is *not* here is anything about what any of it means. Which turns are
folded into a memory, what a standing comes out as in English, when a room is
written down: all of it is the page's, and is tested there. Nothing below uses
a word this machine would recognise — `lucid-talk` appears because a test needs
some game's name, and any other word would do as well.
"""
import json
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import clean
from machine import paths as P
from machine import store as S

GAME = "lucid-talk"
LOG = f"/store/{GAME}/logs/sessions/2026-03-03T03-03-03_lover.jsonl"


class Store(unittest.TestCase):
    def setUp(self):
        clean()
        app = FastAPI()
        S.routes(app)
        self.client = TestClient(app)

    def on_disk(self, path):
        """Where a path in either shape actually lands. `data` and `logs` are
        two ways of reading a file, not two directories -- see store.root."""
        return P.MINE / GAME / path

    def put(self, path, body):
        return self.client.put(f"/store/{GAME}/data/{path}", content=body)

    def line(self, path, row, version):
        return self.client.post(f"/store/{GAME}/logs/{path}",
                                json={"line": row, "version": version})


# ---- what a path may be ----------------------------------------------------


class WhatCountsAsAName(unittest.TestCase):
    def test_the_names_a_game_actually_writes(self):
        for good in ("config.json", "lover.md", "lover.relation.json",
                     "2026-08-18T20-14-03_lover.jsonl", "a-b_c~d:e"):
            self.assertTrue(S.named_well(good), good)

    def test_and_nothing_else(self):
        for bad in ("", None, "..", ".", ".hidden", "a/b", "a b", "a\\b",
                    "a\0b", "a*", "x" * 200):
            self.assertFalse(S.named_well(bad), repr(bad))


class NothingEscapesTheGamesDirectory(Store):
    def test_a_path_that_climbs_reaches_nothing(self):
        for bad in ("../../../etc/passwd", "..", "../config.json",
                    "a/../../b", ".ssh/id_rsa"):
            self.assertIsNone(S.under(GAME, bad), bad)

    def test_and_so_does_a_game_that_is_not_a_name(self):
        for bad in ("../player1", "..", "", "a/b"):
            self.assertIsNone(S.under(bad, "config.json"), repr(bad))

    def test_a_real_one_lands_under_this_player(self):
        """And where it always did. The two shapes are two ways of reading a
        file rather than two directories: a layout somebody may have years of
        evenings in is not the machine's to rearrange."""
        p = S.under(GAME, "memory/lover.md")
        self.assertEqual(p, (P.MINE / GAME / "memory" / "lover.md").resolve())

    def test_two_games_cannot_reach_each_other(self):
        mine = S.under(GAME, "config.json")
        yours = S.under("lucid-trip", "config.json")
        self.assertNotEqual(mine, yours)
        self.assertEqual(mine.parents[1], yours.parents[1])

    def test_the_two_shapes_are_two_verbs_and_one_directory(self):
        """A value at `data/x` and a log at `logs/x` are the same file, and
        that is the point: the layout under a player is what it always was, and
        the shapes are how a path is read. A game keeps its own paths apart the
        way it keeps any two of them apart."""
        self.assertEqual(S.under(GAME, "sessions/a.jsonl"),
                         (P.MINE / GAME / "sessions" / "a.jsonl").resolve())
        self.line("sessions/a.jsonl", {"kind": "meta"}, 0)
        self.assertTrue(self.on_disk("sessions/a.jsonl").is_file())
        self.assertEqual(
            self.client.get(f"/store/{GAME}/data/sessions/a.jsonl").text,
            '{"kind": "meta"}\n')

    def test_a_climbing_path_is_refused_rather_than_answered(self):
        got = self.client.get(f"/store/{GAME}/data/../../config.json")
        self.assertIn(got.status_code, (400, 404))
        self.assertFalse((P.USERDATA / "config.json").exists())


# ---- values ----------------------------------------------------------------


class Values(Store):
    def test_nothing_written_yet_is_no_bytes_rather_than_a_404(self):
        """Asking after a value nobody has made is the ordinary case, not a
        mistake: a fresh player has none of them, and a 404 apiece is a browser
        console full of red for somebody who has done nothing wrong."""
        got = self.client.get(f"/store/{GAME}/data/memory/lover.md")
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.content, b"")

    def test_but_a_path_of_the_wrong_shape_is_still_refused(self):
        got = self.client.get(f"/store/{GAME}/data/.ssh/id_rsa")
        self.assertEqual(got.status_code, 400)

    def test_text_survives_the_round_trip(self):
        self.put("memory/lover.md", "- he sleeps late\n")
        got = self.client.get(f"/store/{GAME}/data/memory/lover.md")
        self.assertEqual(got.text, "- he sleeps late\n")
        self.assertTrue(got.headers["content-type"].startswith("text/markdown"))

    def test_and_so_does_json(self):
        self.put("memory/lover.relation.json",
                 json.dumps({"warmth": -12.5, "log": [{"why": "cold"}]}))
        got = self.client.get(f"/store/{GAME}/data/memory/lover.relation.json")
        self.assertEqual(got.json()["warmth"], -12.5)
        self.assertEqual(got.json()["log"][0]["why"], "cold")

    def test_what_is_stored_is_the_bytes_and_not_a_shape(self):
        """The machine has no opinion about what is in a value: a game that
        wants a key merged does the merging where it knows what a key means."""
        self.put("rooms/x.json", '{"lamp": 3, "she')
        self.assertEqual(self.client.get(f"/store/{GAME}/data/rooms/x.json").text,
                         '{"lamp": 3, "she')

    def test_a_later_write_replaces_the_whole_of_it(self):
        self.put("rooms/x.json", '{"lamp": 3}')
        self.put("rooms/x.json", '{"lamp": 1}')
        self.assertEqual(json.loads(self.on_disk("rooms/x.json").read_text()),
                         {"lamp": 1})

    def test_nothing_is_ever_left_half_written(self):
        """Named rather than globbed: the temporary is hidden, and `*.new`
        does not match a name that starts with a dot."""
        self.put("memory/lover.md", "- one")
        self.assertEqual([x.name for x in self.on_disk("memory").iterdir()],
                         ["lover.md"])

    def test_the_first_write_makes_the_directory(self):
        self.assertFalse(self.on_disk("memory").exists())
        self.put("memory/lover.md", "- one")
        self.assertTrue(self.on_disk("memory/lover.md").is_file())

    def test_and_a_read_makes_nothing_at_all(self):
        """A page asking after a game nobody has installed must not leave a
        directory tree behind it."""
        self.client.get("/store/lucid-trip/data/config.json")
        self.assertFalse((P.MINE / "lucid-trip").exists())

    def test_deleting_one(self):
        self.put("memory/lover.relation.json", "{}")
        got = self.client.delete(f"/store/{GAME}/data/memory/lover.relation.json")
        self.assertEqual(got.json(), {"removed": True})
        self.assertFalse(self.on_disk("memory/lover.relation.json").exists())

    def test_deleting_what_was_never_there_is_not_an_error(self):
        got = self.client.delete(f"/store/{GAME}/data/memory/lover.relation.json")
        self.assertEqual(got.json(), {"removed": False})


class WhatIsInADirectory(Store):
    def test_names_sizes_and_when_each_was_written(self):
        self.put("memory/lover.md", "- one\n")
        self.put("memory/thinker.md", "- two\n- three\n")
        items = self.client.get(f"/store/{GAME}/data/memory/").json()["items"]
        self.assertEqual([x["name"] for x in items], ["lover.md", "thinker.md"])
        self.assertEqual(items[0]["size"], 6)
        self.assertTrue(items[0]["at"] > 0)

    def test_a_directory_nobody_has_written_to_is_empty_rather_than_missing(self):
        got = self.client.get(f"/store/{GAME}/data/memory/")
        self.assertEqual(got.json(), {"items": []})

    def test_and_a_value_is_not_a_directory(self):
        self.put("memory/lover.md", "- one\n")
        self.assertEqual(
            self.client.get(f"/store/{GAME}/data/memory/lover.md/").json()["items"],
            [])


# ---- logs ------------------------------------------------------------------


class Appending(Store):
    def test_a_log_exists_only_from_its_first_append(self):
        """A name handed out and never written in leaves nothing on disk, which
        is what keeps a listing clear of evenings nobody had."""
        got = self.client.get(LOG)
        self.assertEqual(got.json(), {"lines": [], "version": 0})
        self.assertFalse(self.on_disk("sessions").exists())

    def test_what_was_written_comes_back_exactly(self):
        rows = [{"kind": "meta", "persona": "lover"},
                {"kind": "turn", "role": "user", "content": "there you are"}]
        for n, row in enumerate(rows):
            self.assertEqual(self.line(LOG[len(f"/store/{GAME}/logs/"):], row, n)
                             .status_code, 201)
        self.assertEqual(self.client.get(LOG).json(),
                         {"lines": rows, "version": 2})

    def test_the_version_is_where_the_next_line_lands(self):
        path = LOG[len(f"/store/{GAME}/logs/"):]
        self.assertEqual(self.line(path, {"a": 1}, 0).json(), {"version": 1})
        self.assertEqual(self.line(path, {"a": 2}, 1).json(), {"version": 2})

    def test_an_append_from_behind_is_told_the_count_and_writes_nothing(self):
        """Two tabs in one conversation, and the second one finds out rather
        than overwriting."""
        path = LOG[len(f"/store/{GAME}/logs/"):]
        self.line(path, {"a": 1}, 0)
        got = self.line(path, {"a": 2}, 0)
        self.assertEqual(got.status_code, 409)
        self.assertEqual(got.json(), {"version": 1})
        self.assertEqual(self.client.get(LOG).json()["version"], 1)

    def test_and_an_append_with_no_version_at_all(self):
        path = LOG[len(f"/store/{GAME}/logs/"):]
        got = self.client.post(f"/store/{GAME}/logs/{path}", json={"line": {"a": 1}})
        self.assertEqual(got.status_code, 409)

    def test_a_line_has_to_be_a_bag_of_keys(self):
        path = LOG[len(f"/store/{GAME}/logs/"):]
        for bad in ("a string", 7, [1, 2], None):
            got = self.client.post(f"/store/{GAME}/logs/{path}",
                                   json={"line": bad, "version": 0})
            self.assertEqual(got.status_code, 400, repr(bad))

    def test_and_a_version_has_to_be_a_number(self):
        """A caller with a bug is a 400. This used to be an int() raising
        through the route as a 500, which reads as the machine being broken
        rather than the request being wrong."""
        path = LOG[len(f"/store/{GAME}/logs/"):]
        for bad in ("abc", [1], {"a": 1}):
            got = self.client.post(f"/store/{GAME}/logs/{path}",
                                   json={"line": {"a": 1}, "version": bad})
            self.assertEqual(got.status_code, 400, repr(bad))

    def test_and_the_body_itself_has_to_be_one(self):
        """A list, a number, a string, or nothing that parses at all."""
        path = LOG[len(f"/store/{GAME}/logs/"):]
        for bad in ([1, 2], 7, "a string", None):
            got = self.client.post(f"/store/{GAME}/logs/{path}", json=bad)
            self.assertEqual(got.status_code, 400, repr(bad))
        got = self.client.post(f"/store/{GAME}/logs/{path}", content=b"{not json",
                               headers={"content-type": "application/json"})
        self.assertEqual(got.status_code, 400)

    def test_and_so_does_a_delete_body(self):
        for bad in ([1, 2], "a string"):
            got = self.client.request("DELETE", LOG, json=bad)
            self.assertEqual(got.status_code, 400, repr(bad))


class Damage(Store):
    def wounded(self) -> str:
        path = LOG[len(f"/store/{GAME}/logs/"):]
        self.line(path, {"kind": "meta"}, 0)
        self.line(path, {"kind": "turn", "content": "one"}, 1)
        with self.on_disk("sessions/2026-03-03T03-03-03_lover.jsonl").open("a") as f:
            f.write('{"kind": "turn", "cont')
        return path

    def test_a_torn_last_line_reads_as_nothing_and_costs_no_more(self):
        self.wounded()
        got = self.client.get(LOG).json()
        self.assertEqual(got["lines"][1]["content"], "one")
        self.assertIsNone(got["lines"][2])

    def test_but_it_still_counts_toward_where_the_next_one_lands(self):
        """An index in what comes back is an index in the file, which is what
        a delete takes."""
        self.wounded()
        got = self.client.get(LOG).json()
        self.assertEqual(got["version"], 3)
        self.assertEqual(len(got["lines"]), 3)

    def test_and_the_next_append_is_not_glued_onto_the_wreck(self):
        path = self.wounded()
        self.assertEqual(self.line(path, {"kind": "turn", "content": "two"}, 3)
                         .status_code, 201)
        got = self.client.get(LOG).json()
        self.assertEqual(got["lines"][3]["content"], "two")
        self.assertEqual(got["version"], 4)

    def test_a_file_of_pure_rubbish_is_read_as_nothing_rather_than_thrown(self):
        self.on_disk("sessions").mkdir(parents=True, exist_ok=True)
        self.on_disk("sessions/2026-03-03T03-03-03_lover.jsonl").write_text(
            "not json at all\nnor this\n")
        self.assertEqual(self.client.get(LOG).json(),
                         {"lines": [None, None], "version": 2})


class TakingALineBackOut(Store):
    def three(self) -> str:
        path = LOG[len(f"/store/{GAME}/logs/"):]
        for n, text in enumerate(("again", "in between", "again")):
            self.line(path, {"kind": "turn", "content": text}, n)
        return path

    def gone(self, index, version):
        return self.client.request("DELETE", LOG,
                                   json={"index": index, "version": version})

    def said(self):
        return [x["content"] for x in self.client.get(LOG).json()["lines"]]

    def test_by_position(self):
        self.three()
        got = self.gone(2, 3)
        self.assertEqual(got.json(), {"removed": True, "version": 2})
        self.assertEqual(self.said(), ["again", "in between"])

    def test_and_the_rest_of_the_file_is_untouched(self):
        self.three()
        self.gone(0, 3)
        self.assertEqual(self.said(), ["in between", "again"])

    def test_a_position_that_is_not_there_changes_nothing(self):
        self.three()
        for bad in (3, -1, 99):
            got = self.gone(bad, 3)
            self.assertEqual(got.json(), {"removed": False, "version": 3}, bad)

    def test_from_a_log_that_is_not_there_either(self):
        got = self.gone(0, 0)
        self.assertEqual(got.json(), {"removed": False, "version": 0})

    def test_an_index_has_to_be_a_number(self):
        self.three()
        got = self.client.request("DELETE", LOG,
                                  json={"index": "the last one", "version": 3})
        self.assertEqual(got.status_code, 400)

    def test_it_is_written_beside_and_renamed(self):
        self.three()
        self.gone(1, 3)
        self.assertEqual([x.name for x in self.on_disk("sessions").iterdir()],
                         [LOG.rsplit("/", 1)[-1]])


class ADeleteIsAlsoAMoveOnAVersion(Store):
    """A position is a fact about a file of a known length.

    The reader's is one request old: it read the lines, found the turn it
    meant, and by the time the delete arrives another tab may have appended --
    which moves every position after it. So the delete used to take the
    neighbour of the line somebody asked for, out of a file that looks
    perfectly ordinary afterwards. The check is the append's, under the append's
    lock, because a check and a write that are two moves are not a check.
    """

    def setUp(self):
        super().setUp()
        self.path = LOG[len(f"/store/{GAME}/logs/"):]
        for n, text in enumerate(("one", "two", "three")):
            self.line(self.path, {"kind": "turn", "content": text}, n)

    def gone(self, index, version):
        return self.client.request("DELETE", LOG,
                                   json={"index": index, "version": version})

    def said(self):
        return [x["content"] for x in self.client.get(LOG).json()["lines"]]

    def test_a_version_the_file_has_moved_past_takes_nothing(self):
        was = self.client.get(LOG).json()["version"]
        self.line(self.path, {"kind": "turn", "content": "four"}, was)
        got = self.gone(1, was)
        self.assertEqual(got.status_code, 409)
        self.assertEqual(got.json(), {"version": 4})
        self.assertEqual(self.said(), ["one", "two", "three", "four"])

    def test_and_the_version_it_is_actually_at_takes_the_line_meant(self):
        self.line(self.path, {"kind": "turn", "content": "four"}, 3)
        got = self.gone(1, 4)
        self.assertEqual(got.json(), {"removed": True, "version": 3})
        self.assertEqual(self.said(), ["one", "three", "four"])

    def test_two_pages_deleting_from_the_same_read_and_only_one_lands(self):
        first, second = self.gone(0, 3), self.gone(0, 3)
        self.assertEqual(first.json(), {"removed": True, "version": 2})
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json(), {"version": 2})
        self.assertEqual(self.said(), ["two", "three"])

    def test_a_delete_that_says_no_version_is_refused(self):
        got = self.client.request("DELETE", LOG, json={"index": 0})
        self.assertEqual(got.status_code, 400)
        self.assertEqual(self.said(), ["one", "two", "three"])

    def test_and_so_is_one_that_is_not_a_number(self):
        for bad in ("three", [3], {}):
            got = self.client.request("DELETE", LOG,
                                      json={"index": 0, "version": bad})
            self.assertEqual(got.status_code, 400, repr(bad))
        self.assertEqual(self.said(), ["one", "two", "three"])

    def test_a_log_that_is_not_there_is_at_nothing_and_says_so(self):
        other = f"/store/{GAME}/logs/sessions/nobody.jsonl"
        got = self.client.request("DELETE", other, json={"index": 0, "version": 2})
        self.assertEqual(got.status_code, 409)
        self.assertEqual(got.json(), {"version": 0})


class ALineIsALine(Store):
    """One line of JSON, ended by a newline, and by nothing else.

    `str.splitlines` also breaks on U+2028 and U+2029, and these files are
    written with `ensure_ascii=False` -- so a line separator inside somebody's
    own words went to disk raw and came back as two unreadable lines. One turn
    became two nulls and every index after it was off by one, which is what a
    delete from the transcript then took.
    """

    SPLITTY = "one\u2028two\u2029three\x0cfour"

    def test_a_separator_inside_the_words_is_still_one_line(self):
        path = LOG[len(f"/store/{GAME}/logs/"):]
        self.line(path, {"role": "user", "text": self.SPLITTY}, 0)
        got = self.client.get(LOG).json()
        self.assertEqual(got["version"], 1)
        self.assertEqual(got["lines"], [{"role": "user", "text": self.SPLITTY}])

    def test_and_a_delete_still_counts_the_way_the_reader_does(self):
        path = LOG[len(f"/store/{GAME}/logs/"):]
        self.line(path, {"text": self.SPLITTY}, 0)
        self.line(path, {"text": "after"}, 1)
        got = self.client.request("DELETE", LOG, json={"index": 0, "version": 2})
        self.assertEqual(got.json(), {"removed": True, "version": 1})
        self.assertEqual(self.client.get(LOG).json()["lines"], [{"text": "after"}])


class WhatALogIsAtWithoutReadingIt(Store):
    """The count and the first line, against the reader that parses the lot.

    Both are on paths that used to parse whole files. Every append asks what
    version the log is at, which made appending an evening's lines cost the
    square of what was said; a listing asks every conversation for its count
    and its first line, and read all of both to answer. What these say has to
    be what read_log would have said, damage and all -- the version is a
    position in the file, and that position is what a delete takes.
    """

    SHAPES = {
        "nothing at all": "",
        "one line": '{"kind": "meta"}\n',
        "two": '{"kind": "meta"}\n{"kind": "turn"}\n',
        "a torn last line": '{"kind": "meta"}\n{"kind": "tu',
        "a blank line in the middle": '{"a": 1}\n\n{"b": 2}\n',
        "nothing but blank lines": "\n  \n\n",
        "a first line nobody can read": 'not json at all\n{"a": 1}\n',
        "a separator inside somebody's words": '{"a": "one\u2028two"}\n{"b": 2}\n',
        # Not something written through here -- json escapes them -- but
        # something a hand-edited file has, and the reader counts them as
        # line endings because it reads the file as text.
        "the endings an editor left": '{"a": 1}\r\n{"b": 2}\r{"c": 3}\r',
        # Longer than one bite of the file, so the counting has to carry a
        # line across the seam rather than count it twice or not at all.
        "a line longer than a read": '{"a": "%s"}\n{"b": 2}\n' % ("x" * 200000),
    }

    def wrote(self, text: str) -> Path:
        p = self.on_disk("sessions/2026-03-03T03-03-03_lover.jsonl")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode())
        return p

    def test_the_count_is_the_one_the_reader_would_have_said(self):
        for what, text in self.SHAPES.items():
            with self.subTest(what):
                p = self.wrote(text)
                self.assertEqual(S.counted(p), S.read_log(p)["version"])

    def test_and_so_is_the_first_line(self):
        for what, text in self.SHAPES.items():
            with self.subTest(what):
                p = self.wrote(text)
                lines = S.read_log(p)["lines"]
                self.assertEqual(S.head_of(p), lines[0] if lines else None)

    def test_a_log_that_is_not_there_is_at_nothing(self):
        p = self.on_disk("sessions/never-written.jsonl")
        self.assertEqual(S.counted(p), 0)
        self.assertIsNone(S.head_of(p))

    def test_the_next_line_still_lands_where_it_is_told(self):
        """Which is the append's whole use for the count."""
        path = LOG[len(f"/store/{GAME}/logs/"):]
        self.wrote('{"kind": "meta"}\n{"kind": "tu')
        self.assertEqual(self.line(path, {"kind": "turn"}, 2).status_code, 201)
        self.assertEqual(self.line(path, {"kind": "turn"}, 2).status_code, 409)


class TheListing(Store):
    def evening(self, name, said, persona="lover"):
        path = f"sessions/{name}.jsonl"
        self.line(path, {"kind": "meta", "persona": persona}, 0)
        self.line(path, {"kind": "turn", "content": said}, 1)
        return name

    def test_newest_first(self):
        """The one thing anybody asks a listing is what happened last."""
        import os
        import time
        one = self.evening("2026-03-03T03-03-03_lover", "first")
        two = self.evening("2026-03-03T04-04-04_thinker", "second", "thinker")
        now = time.time()
        os.utime(self.on_disk(f"sessions/{one}.jsonl"), (now - 100, now - 100))
        items = self.client.get(f"/store/{GAME}/logs/sessions/").json()["items"]
        self.assertEqual([x["id"] for x in items],
                         [f"{two}.jsonl", f"{one}.jsonl"])

    def test_each_carries_its_count_its_moment_and_its_first_line(self):
        """The head is where a game writes what the whole of it is about, so
        reading it here saves the page a request per log to find out."""
        self.evening("2026-03-03T03-03-03_lover", "first")
        got = self.client.get(f"/store/{GAME}/logs/sessions/").json()["items"][0]
        self.assertEqual(got["lines"], 2)
        self.assertEqual(got["head"], {"kind": "meta", "persona": "lover"})
        self.assertTrue(got["at"] > 0)

    def test_a_directory_with_nothing_in_it(self):
        self.assertEqual(self.client.get(f"/store/{GAME}/logs/sessions/").json(),
                         {"items": []})


class NoOneRequestFillsTheDisk(Store):
    """There is no authentication on any of this and with --phone it is
    reachable by anyone on the wifi, which is documented rather than
    accidental. A trust model that says anyone here may write does not have to
    mean anyone here may write until the volume is full."""

    def test_a_value_bigger_than_we_will_take_is_refused(self):
        got = self.put("memory/lover.md", b"x" * (S.MOST + 1))
        self.assertEqual(got.status_code, 413)
        self.assertFalse(self.on_disk("memory/lover.md").exists())

    def test_and_so_is_a_line(self):
        path = LOG[len(f"/store/{GAME}/logs/"):]
        got = self.line(path, {"text": "x" * (S.MOST_LINE + 1)}, 0)
        self.assertEqual(got.status_code, 413)
        self.assertEqual(self.client.get(LOG).json()["version"], 0)

    def test_what_a_game_actually_writes_still_goes_through(self):
        self.assertEqual(self.put("memory/lover.md", "- he sleeps late\n").status_code,
                         200)


class ACrashLeavesNothingAPageCanSee(Store):
    """A write is a file beside and a rename, so a kill between the two leaves
    a temporary behind. It is hidden, and a listing skips what is hidden --
    otherwise a page is offered a name it never wrote as one of its own."""

    def test_the_leftover_is_not_in_the_listing(self):
        from unittest import mock
        home = S.root(GAME) / "memory"
        home.mkdir(parents=True, exist_ok=True)
        with mock.patch.object(Path, "replace", side_effect=OSError("killed")):
            with self.assertRaises(OSError):
                S.beside(home / "lover.md", b"- half of it")
        self.assertTrue(list(home.iterdir()), "nothing was written at all")
        self.assertEqual(S.listing(home), [])


class WhereAGameKeepsThings(unittest.TestCase):
    def test_the_console_says_the_players_directory(self):
        self.assertIn(str(P.MINE), S._where(""))

    def test_and_one_games_when_it_is_asked_after(self):
        self.assertIn(str(P.MINE / GAME), S._where(GAME))

    def test_a_name_that_is_not_one_is_refused_rather_than_resolved(self):
        self.assertIn("not a name", S._where("../../etc"))


if __name__ == "__main__":
    unittest.main()
