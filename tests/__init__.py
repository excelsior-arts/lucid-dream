"""The checks that do not need the models, the microphone, or a server.

Everything in here runs against a throwaway userdata/ directory and finishes
in a second or two, so it can be run before every commit rather than when
something has already gone wrong.

---- how this is laid out ---------------------------------------------------

One directory per thing being tested, named after it, the way userdata/ is:

    tests/
      machine/          the machine: the console, the models' surface,
                      where things live, and the storage it lends a game

There is one directory because there is one program left in Python. What a
game *is* — the conversation, the prompts it assembles, the arithmetic behind
how a character holds you — runs in the browser and is checked there, under
app/. The machine is supposed to be able to carry a game it knows nothing
about; what is checked in here is that it can, against the one game this
checkout ships.

---- why this package sets an environment variable on import -----------------

`machine/paths.py` reads LUCID_USERDATA once, at import, and everything that
keeps things on disk is handed a directory built from it. So the switch has to
be thrown before the first `import machine.anything` — after that it is far too
late.

This package is imported before any test in it, whichever way the tests are
started, which makes this the one place that is always early enough. It is
also not optional: a test suite that writes conversations, memory and standing
into the real userdata/ is not a test suite, it is a lossy edit of somebody's
diary. That has happened here once already, which is why machine/paths.py
carries the guard it does and why this file refuses to go on if the switch has
not taken.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# A fresh root per run, and never one chosen outside this file.
#
# It used to take an inherited LUCID_USERDATA, which reads as flexibility and
# is a loaded gun: clean() empties this directory between tests, so a shell
# that had exported the variable for any other reason -- a second instance, a
# scratch copy, somebody's real conversations kept outside the checkout --
# handed the tests that directory to delete. The guard below would not have
# stopped it either; it only knows about the userdata/ in this repository.
#
# Nothing needs to choose it. What runs here writes conversations, memory and
# standing, and every one of those is somebody's if it is not thrown away.
os.environ["LUCID_USERDATA"] = tempfile.mkdtemp(prefix="lucid-tests-")

from machine import paths as _paths                              # noqa: E402

SCRATCH = Path(os.environ["LUCID_USERDATA"]).resolve()
REAL = (Path(__file__).resolve().parents[1] / "userdata").resolve()

if not _paths.ELSEWHERE or _paths.USERDATA.resolve() != SCRATCH or SCRATCH == REAL:
    raise SystemExit(
        "the tests are not isolated — they would write to your real "
        f"conversations at {REAL}. Nothing was run."
    )


def clean():
    """Empty the scratch root between tests that care about what is on disk.

    The directories themselves are left, because the modules under test are
    entitled to assume their own directory exists once something has made it.
    """
    import shutil
    for child in SCRATCH.iterdir():
        shutil.rmtree(child) if child.is_dir() else child.unlink()
