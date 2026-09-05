"""Which Lucid Dream this is.

One file at the root of the checkout, holding one line, because a version has
to be readable by things that are not Python: a release script, a CI job,
somebody looking at a bug report, `cat VERSION`.

It is shown in two places and both of them are for the same moment — somebody
saying "it does this" and somebody else needing to know which build they mean.
The terminal box prints it as the machine comes up, and the console carries it
in the top right of its bar, where it is out of the way until it is wanted.

Semantic, and the first release is 1.0.0. What moves it:

  * the last number, for anything a player would call a fix
  * the middle one, for anything they would call new
  * the first, for a game that is not this game, or a save file that no longer
    opens — the layout under userdata/ is a promise, and breaking it costs a
    major
"""
from __future__ import annotations

from .paths import ROOT

FILE = ROOT / "VERSION"


def _read() -> str:
    """The version, or a name for not having one.

    A checkout with no VERSION file is somebody's working copy rather than a
    release, and saying "dev" is more honest than guessing a number.
    """
    try:
        line = FILE.read_text().strip().splitlines()[0].strip()
    except Exception:
        return "dev"
    return line or "dev"


NOW = _read()
