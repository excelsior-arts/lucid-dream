"""The built page, if this checkout has one.

Everything the browser runs is one bundle, built out of app/ by Vite into
app/dist. The machine serves it and nothing else: one document for every route,
because the routing happens in the page. What is here is only the two facts
the server needs — whether there is a build to serve, and what its index.html
should say once the version has been written onto it.

A checkout with no build is an ordinary state rather than a broken one: node
is not required to run this, and setup.sh skips the build where there is none.
So `built()` answering None is a page of its own — the one below, which says
what is missing and the two lines that fix it. It is the switch the tests
throw as well.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from . import paths as P
from . import version as V

WEB_DIST = P.ROOT / "app" / "dist"


def built() -> Path | None:
    """Where the built app is, or nothing at all.

    LUCID_WEB names another directory — a build kept outside the checkout, or
    the small one a test makes — and `0` or `off` says to answer as though
    there were none even though a build is sitting there. Asked every time
    rather than decided at import, so a test can set it after this module has
    been read.

    The question is answered by index.html and not by the directory: `npm run
    build` writes into a directory that is already there, and a dist left half
    empty by an interrupted build would otherwise be served as though it were
    a page.
    """
    said = (os.environ.get("LUCID_WEB") or "").strip()
    if said.lower() in ("0", "off", "no", "false"):
        return None
    where = Path(said).expanduser() if said else WEB_DIST
    return where if (where / "index.html").is_file() else None


# What a browser gets when there is nothing to give it: the smallest page that
# can be written without a build, since a build is precisely what is missing.
#
# It says the machine is fine, because that is the part somebody cannot see
# from here — the server answered, or this page would not be on the screen.
# Everything is inline and nothing is fetched: the icons and the stylesheet
# live at addresses that exist, but a page whose whole subject is a missing
# file should not depend on one.
UNBUILT = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Lucid Dream</title>
<style>
html{background:#05060b;color:#cfe0f2;
     font:15px/1.6 ui-sans-serif,-apple-system,system-ui,sans-serif}
body{margin:0;display:grid;place-items:center;min-height:100vh;padding:2rem}
main{max-width:34rem}
h1{color:#c9a227;font-size:15px;font-weight:600;letter-spacing:.34em;margin:0 0 1.6rem}
p{color:#a08f74;margin:0 0 1rem}
pre{background:#0b0d16;border:1px solid #241f14;border-radius:4px;
    padding:.9rem 1.1rem;margin:0 0 1.2rem;color:#cfe0f2;overflow-x:auto}
</style>
</head>
<body>
<main>
<h1>L U C I D &nbsp; D R E A M</h1>
<p>The server is up — this page came from it. What is missing is the page
itself: app/ has not been built in this checkout, and the browser has nothing
to run.</p>
<pre>./setup.sh</pre>
<p>which builds it along with everything else. Or, where the rest is already
in place:</p>
<pre>cd app
npm ci
npm run build</pre>
<p>Then reload.</p>
</main>
</body>
</html>
"""


def page() -> str:
    """The document every address gets, with the build written onto <html>.

    The only thing done to it, and a bundle needs no more: Vite puts a hash of
    the contents in every filename, so a changed file is a changed address by
    construction and there is no cache stamp to keep. What is left is the
    version the console reads out of document.documentElement.dataset.lucid,
    which is not in the file because it is not the browser's to know.
    """
    dist = built()
    html = (dist / "index.html").read_text() if dist else UNBUILT
    return re.sub(r"<html\b(?![^>]*\bdata-lucid\b)",
                  f'<html data-lucid="{V.NOW}"', html, count=1)
