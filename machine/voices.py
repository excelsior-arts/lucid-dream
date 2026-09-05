"""The shelf of voices, by name.

    <voices.path>/<name>/voice.ref.wav     a folder that is a voice
    <voices.path>/<name>.wav               or a file that is one

A voice is a model asset and nothing else: six seconds of somebody speaking,
fetched by setup.sh beside the weights, and read by the speaker to clone from.
It says nothing about any game -- a name is a path of plain words, and what
the folders along it mean is the caller's business. The pack setup fetches is
laid on the shelf exactly as it is published, so a clip that arrives inside
a folder is named by that folder: `a/b/c/voice.ref.wav` answers to `a/b/c`.
A clip somebody cut themselves is a file dropped in wherever they like, and
answers to its path without the suffix.

Two shelves. The shipped one is under the models. The other is the player's
own: a name that begins `@<store>/` is looked for under that store of theirs,
where whatever put it there -- an upload, a tool -- also keeps the settings
that name it. Theirs is asked first only in the sense that the name says so;
nothing is lent, nothing is defaulted, and a name that is nowhere is refused
with the name in it -- because the alternative, speaking in whichever voice
happened to be loaded, is a character that sounds like the last person who
used the machine.
"""
from __future__ import annotations

import re
from pathlib import Path

from . import config as C
from . import store as S

# Beside the weights, because that is what this is -- and it moves with them.
# `setup.sh --models DIR` puts every asset on a disk of its own, clips
# included, and a shelf nailed to the checkout meant that install downloaded
# all of it and then found no voice at all: every name refused, at the moment
# a character first tried to speak.
#
# Read per ask rather than held, so it is the path the config has now and not
# the one it had when this module was first imported.
DEFAULT = "models/voices"

# What one word of a name may be. A name arrives in a socket message and is
# turned straight into a path, so it is checked rather than trusted: letters,
# digits, - and _, and nothing that is a separator or means "up".
WORD = re.compile(r"[A-Za-z0-9_-]+$")
# And how many of them: deep enough for any pack's layout, shallow enough
# that a walk of the shelf ends.
DEEP = 6

# The two shapes a clip may take on the shelf. wav because that is what a
# reference clip is: unencoded, 24 kHz, mono -- see tools/VOICES.md. The
# fixed leaf name is the pack's, so that a pack lands on the shelf unchanged.
LEAF = "voice.ref.wav"
SUFFIX = ".wav"
# A name in the player's own store rather than on the shipped shelf.
MINE = "@"


def named_well(name: str) -> bool:
    """A path of words, or one word; optionally in a store of the player's."""
    text = str(name or "")
    if text.startswith(MINE):
        head, _, rest = text[len(MINE):].partition("/")
        return S.named_well(head) and _words(rest)
    return _words(text)


# And how long: a name is a path a filesystem has to take.
LONG = 200


def _words(path: str) -> bool:
    if len(path) > LONG:
        return False
    parts = path.split("/")
    return 0 < len(parts) <= DEEP and all(WORD.fullmatch(x) for x in parts)


def shelf() -> Path:
    """Where the clips are, by the same rule as the models: a relative path
    from the checkout, ~ for a home, an absolute one taken as given."""
    return Path((C.load().get("voices") or {}).get("path") or C.somewhere(DEFAULT))


def _roots(name: str) -> tuple[Path, str] | None:
    """The shelf a name is on, and the path it names there."""
    if name.startswith(MINE):
        head, _, rest = name[len(MINE):].partition("/")
        return S.root(head), rest
    return shelf(), name


def clip(name: str) -> Path | None:
    """The file a name speaks from, or nothing at all.

    Two answers in one: a name of the wrong shape and a name nobody has put a
    clip on the shelf for are both nothing here, and both come back to the
    caller as the same refusal. The resolve is belt and braces over the pattern
    above -- a path that leaves its shelf is not a voice however it got there.
    """
    if not named_well(name):
        return None
    where = _roots(name)
    if where is None:
        return None
    root, path = where
    home = root.resolve()
    shapes = ((root / path / LEAF,) if name.startswith(MINE)
              else (root / path / LEAF, root / f"{path}{SUFFIX}"))
    for candidate in shapes:
        p = candidate.resolve()
        try:
            p.relative_to(home)
        except ValueError:
            return None
        if p.is_file():
            return candidate
    return None


def _walk(root: Path, prefix: str = "", loose: bool = True) -> list[str]:
    """Every voice under a root, by the name that reaches it.

    The directory, not a list written down: setup.sh lays the pack on it and
    a clip somebody cut themselves is a file dropped in beside those. A
    folder holding the pack's leaf is a voice named by the folder; any other
    wav is one named by its path -- on the shipped shelf. In a store of the
    player's only the leaf counts (`loose` off): a store holds whatever the
    game keeps there, and a wav in its scratch is not a voice anybody meant.
    Dot-folders are the downloader's own bookkeeping and are not looked in.
    """
    found: list[str] = []
    if not root.is_dir():
        return found
    home = root.resolve()
    for p in sorted(home.rglob("*")):
        rel = p.relative_to(home)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if len(rel.parts) > DEEP + 1 or not p.is_file():
            continue
        if p.name == LEAF:
            name = "/".join(rel.parts[:-1])
        elif loose and p.suffix == SUFFIX:
            name = "/".join(rel.parts[:-1] + (p.stem,))
        else:
            continue
        if name and _words(name):
            found.append(prefix + name)
    return found


def names() -> list[str]:
    """Every voice on the shipped shelf, and every one in the player's stores.

    Theirs are named with the store in front, the way a request has to name
    them; the stores are whatever directories the player has, and what each
    is for is not this module's to know.
    """
    mine: list[str] = []
    if S.P.MINE.is_dir():
        for game in sorted(S.P.MINE.iterdir()):
            if game.is_dir() and S.named_well(game.name) and not game.name.startswith("."):
                mine += _walk(game, f"{MINE}{game.name}/", loose=False)
    return sorted(set(_walk(shelf()) + mine))
