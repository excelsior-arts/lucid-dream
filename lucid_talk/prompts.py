"""Editable prompts, in files instead of source.

Every prompt the app sends lives in prompts/ as plain markdown you can open and
change. Files are read on each use, so an edit takes effect on the next reply —
no restart, and nothing to keep in sync, because there is one copy of each text
and it is the one the app reads.
"""
from __future__ import annotations

from . import paths

DIR = paths.PROMPTS

# The names the app asks for, in the order they are listed in the UI.
NAMES = ["system", "memory_intro", "fold_system", "fold_user",
         "relation_intro", "relation_system", "relation_user",
         "scene_intro", "scene_system", "scene_user"]


def get(name: str) -> str:
    """A prompt by name. Empty if the file is gone — git has the original."""
    try:
        return (DIR / f"{name}.md").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def listing() -> list[dict]:
    return [{"name": n, "path": str(DIR / f"{n}.md"),
             "exists": (DIR / f"{n}.md").exists()} for n in NAMES]
