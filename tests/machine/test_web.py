"""Serving the built page: one document, every address.

A single-page app moves the routing into the browser, and the whole of what
the server owes it is that every address a person can be standing on comes
back as the same document. Get that wrong and the app works perfectly until
somebody reloads — which is the one thing everybody does.

The other half is what must not change while that is true. The console socket,
/shared/where and the icons belong to the machine whatever is drawing the page,
and a checkout with no build has to say so plainly at every address: node is
not a requirement of this program and never becomes one.

The build here is a real directory with a real index.html in it, made in
tempfile and pointed at with LUCID_WEB, so none of this depends on app/dist
having been built on this machine.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from machine import server as S
from machine import version as V

INDEX = ('<!doctype html>\n<html lang="en">\n<head><title>Lucid Dream</title>'
         '<script type="module" src="/assets/x.js"></script></head>'
         '<body><div id="app"></div></body>\n</html>\n')


def a_build() -> Path:
    """Somewhere with the shape of `npm run build`, and nothing in it."""
    dist = Path(tempfile.mkdtemp(prefix="lucid-dist-"))
    (dist / "index.html").write_text(INDEX)
    (dist / "assets").mkdir()
    (dist / "assets" / "x.js").write_text("export const it = 1\n")
    return dist


class Served(unittest.TestCase):
    """With a build to serve."""

    @classmethod
    def setUpClass(cls):
        cls.dist = a_build()
        cls.was = os.environ.get("LUCID_WEB")
        os.environ["LUCID_WEB"] = str(cls.dist)
        cls.client = TestClient(S.create_app())

    @classmethod
    def tearDownClass(cls):
        if cls.was is None:
            os.environ.pop("LUCID_WEB", None)
        else:
            os.environ["LUCID_WEB"] = cls.was
        shutil.rmtree(cls.dist, ignore_errors=True)

    def test_the_front_door_is_the_page(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn('<div id="app">', r.text)
        self.assertIn("no-cache", r.headers["cache-control"])

    def test_and_it_says_which_build_it_is(self):
        """The console reads it off <html>; without it every report of a bug
        is against an unknown version."""
        self.assertIn(f'data-lucid="{V.NOW}"', self.client.get("/").text)
        self.assertIn('lang="en"', self.client.get("/").text)

    def test_an_app_of_its_own_gets_the_same_document(self):
        """Mounted apps are matched before the machine's catch-all, so this only
        holds because the app itself stands aside."""
        r = self.client.get("/lucid-talk")
        self.assertEqual(r.status_code, 200)
        self.assertIn('<div id="app">', r.text)

    def test_and_so_does_a_room(self):
        """The address somebody actually bookmarks."""
        r = self.client.get("/lucid-talk/lover")
        self.assertEqual(r.status_code, 200)
        self.assertIn('<div id="app">', r.text)

    def test_a_route_nobody_wrote_down_is_still_the_page(self):
        r = self.client.get("/whatever/comes/next")
        self.assertEqual(r.status_code, 200)
        self.assertIn('<div id="app">', r.text)

    def test_the_bundle_is_served_and_kept(self):
        """Hashed names, so a year is safe and anything less is a request
        every reload that can only ever answer 304."""
        r = self.client.get("/assets/x.js")
        self.assertEqual(r.status_code, 200)
        self.assertIn("immutable", r.headers["cache-control"])

    def test_a_file_that_is_not_there_is_not_a_page(self):
        """Answering a missing image with HTML is how it becomes "unexpected
        token '<'" in a console, three files away from the actual mistake."""
        self.assertEqual(self.client.get("/nothing.png").status_code, 404)

    def test_the_shell_still_answers_for_itself(self):
        r = self.client.get("/shared/where")
        self.assertEqual(r.status_code, 200)
        self.assertIn("phone", r.json())

    def test_and_the_icons_are_where_browsers_look(self):
        self.assertEqual(self.client.get("/favicon.ico").status_code, 200)
        self.assertEqual(self.client.get("/apple-touch-icon.png").status_code, 200)

    def test_the_console_socket_is_untouched(self):
        with self.client.websocket_connect("/shared/log/ws") as ws:
            self.assertEqual(ws.receive_json()["type"], "backlog")

    def test_a_page_from_somewhere_else_is_not_let_in(self):
        """from_this_page, from the built page: same origin, same host."""
        with self.client.websocket_connect(
                "/shared/log/ws", headers={"origin": "http://testserver",
                                           "host": "testserver"}) as ws:
            self.assertEqual(ws.receive_json()["type"], "backlog")
        with self.assertRaises(Exception):
            with self.client.websocket_connect(
                    "/shared/log/ws",
                    headers={"origin": "http://elsewhere.example",
                             "host": "testserver"}) as ws:
                ws.receive_json()


class NotBuilt(unittest.TestCase):
    """And a checkout that has never seen node, which is not a broken one.

    Node is not a requirement of this program: somebody can clone it, run
    setup.sh on a machine without npm, and have every model and every
    conversation work. What they cannot have is the page, and the one thing
    the server owes them then is to say so at the address they opened —
    rather than a stack trace, a blank screen, or the 404 that a missing file
    would otherwise be.
    """

    @classmethod
    def setUpClass(cls):
        cls.was = os.environ.get("LUCID_WEB")
        os.environ["LUCID_WEB"] = "0"
        cls.client = TestClient(S.create_app())

    @classmethod
    def tearDownClass(cls):
        if cls.was is None:
            os.environ.pop("LUCID_WEB", None)
        else:
            os.environ["LUCID_WEB"] = cls.was

    def test_the_front_door_says_what_is_missing_and_how_to_get_it(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("has not been built", r.text)
        self.assertIn("./setup.sh", r.text)
        self.assertIn("npm run build", r.text)

    def test_and_so_does_every_other_address(self):
        """A room is the address somebody has bookmarked, and the app answers
        for its own routes before the machine's catch-all is ever asked."""
        for where in ("/lucid-talk", "/lucid-talk/lover", "/whatever/comes/next"):
            with self.subTest(where=where):
                r = self.client.get(where)
                self.assertEqual(r.status_code, 200)
                self.assertIn("has not been built", r.text)

    def test_and_it_still_says_which_build_it_is(self):
        self.assertIn(f'data-lucid="{V.NOW}"', self.client.get("/").text)

    def test_but_a_missing_file_is_still_missing(self):
        """The page is what an unknown route gets; a name with a suffix on it
        is a file, and answering that with HTML is how it becomes "unexpected
        token '<'" in a console somewhere."""
        self.assertEqual(self.client.get("/nothing.png").status_code, 404)

    def test_and_nothing_is_fetched_that_would_not_be_there(self):
        """It is the page about a missing bundle: it cannot ask for one."""
        self.assertNotIn("/assets/", self.client.get("/").text)


class NothingChangesFromAnotherPage(unittest.TestCase):
    """The origin rule the sockets keep, on the routes that change something.

    A form post and a fetch with no preflight are both sent cross-site; the
    browser only refuses to hand the *answer* back, which for "unload the
    models" or "append a line to somebody's conversation" is no protection at
    all. Confirmed against the running server before this was written: a POST
    to /machine/models/stop with a foreign Origin answered 200.
    """

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(S.create_app())

    # One of each: the machine's, and the store's.
    WRITES = ("/machine/models/stop", "/store/lucid-talk/logs/x.jsonl")

    def test_a_post_from_somebody_elses_page_is_refused(self):
        for where in self.WRITES:
            with self.subTest(where=where):
                r = self.client.post(where, json={},
                                     headers={"origin": "http://evil.example"})
                self.assertEqual(r.status_code, 403)

    def test_and_the_same_page_goes_through(self):
        r = self.client.post("/machine/models/stop",
                             headers={"origin": "http://testserver"})
        self.assertNotEqual(r.status_code, 403)

    def test_and_so_does_something_that_is_not_a_page_at_all(self):
        """curl, a test, the phone bridge: no Origin is not a browser, and
        this is not authentication -- see from_this_page."""
        self.assertNotEqual(self.client.post("/machine/models/stop").status_code,
                            403)

    def test_reading_is_left_alone(self):
        """A GET is what the browser was going to refuse to hand over anyway,
        and every curl in the manual is one."""
        r = self.client.get("/shared/where", headers={"origin": "http://evil.example"})
        self.assertEqual(r.status_code, 200)

    def test_a_delete_is_a_change_too(self):
        r = self.client.delete("/store/lucid-talk/data/x.md",
                               headers={"origin": "http://evil.example"})
        self.assertEqual(r.status_code, 403)


class TheRootAnswersAHead(unittest.TestCase):
    """Link previews, uptime checks and half the command-line tools ask that
    way first. FastAPI -- unlike Starlette -- does not add HEAD to a GET
    route, so this used to be a 405 at the one address anybody pastes."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(S.create_app())

    def test_the_page_and_everything_under_it(self):
        for where in ("/", "/lucid-talk/lover"):
            with self.subTest(where=where):
                r = self.client.head(where)
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.text, "")            # a HEAD carries no body


if __name__ == "__main__":
    unittest.main()
