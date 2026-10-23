"""The shelf of assets, by kind and by name.

    <assets.dir>/sounds/<name>.m4a      a recording: a footstep, wind
    <assets.dir>/figures/<name>.glb     a body: a rigged mesh and its clips

An asset is what a voice clip is: a file somebody made, that a game plays or
draws, and that this repository does not hold. They are heavy, and most of
them are somebody else's -- a recording from a sound library, a character from
Mixamo -- so they live in a directory of their own (lucid-assets, a repository
beside this one, or wherever `assets.dir` points) and the machine serves them
by name and knows nothing else about them. A name nobody has put a file on
the shelf for is silence, or the plain figure, rather than an error: a game
with no shelf is the same game with the assets off.

Kinds are few and fixed. The machine has no word for what a game does with
a sound, but it does have to know what a sound is -- one suffix, one media
type -- or it is a file server.

tools/soundprep.py cuts the sounds out of a sound library; tools/figureprep.mjs
makes a figure out of a Mixamo download. Each writes down where its pieces
came from.
"""
from __future__ import annotations

import re
from pathlib import Path

from . import config as C

DEFAULT = "models/assets"

# kind -> (suffix, media type)
KINDS: dict[str, tuple[str, str]] = {
    "sounds": (".m4a", "audio/mp4"),
    "figures": (".glb", "model/gltf-binary"),
}

# Plain words, joined by hyphens: `ember`, `hyper-dash`. Nothing that could
# leave the shelf, and nothing that needs quoting anywhere.
_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def named_well(name: str) -> bool:
    return bool(_NAME.match(name or ""))


def root() -> Path:
    """Where the assets are, by the same rule as the models: a relative path
    from the checkout, ~ for a home, an absolute one taken as given."""
    return Path((C.load().get("assets") or {}).get("dir") or C.somewhere(DEFAULT))


def shelf(kind: str) -> Path | None:
    """One kind's directory, or nothing for a kind there is not."""
    return root() / kind if kind in KINDS else None


def media_type(kind: str) -> str:
    return KINDS[kind][1]


def asset(kind: str, name: str) -> Path | None:
    """The file a name is, or nothing at all. The resolve is belt and braces
    over the pattern: a path that leaves its shelf is not an asset."""
    where = shelf(kind)
    if where is None or not named_well(name):
        return None
    path = where / (name + KINDS[kind][0])
    try:
        if not path.resolve().is_relative_to(where.resolve()):
            return None
    except (OSError, ValueError):
        return None
    return path if path.is_file() else None


def names(kind: str) -> list[str]:
    """Every asset of a kind, by name, sorted. Empty when there is no shelf,
    which is an ordinary state of a machine."""
    where = shelf(kind)
    if where is None or not where.is_dir():
        return []
    return sorted(p.stem for p in where.glob("*" + KINDS[kind][0]) if named_well(p.stem))
