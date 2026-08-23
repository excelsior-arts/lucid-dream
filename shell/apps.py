"""What is installed, and where it lives.

One entry per app. Adding a second one is adding a line here and a package
beside this one — the shell has nothing else to learn about it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class App:
    slug: str          # the route: /lucid-talk
    name: str          # what the tile says
    blurb: str         # one line under it
    factory: str       # "package.module:function" returning a FastAPI app


INSTALLED = [
    App(slug="lucid-talk",
        name="Lucid Talk",
        blurb="A box of pills. Take one and dream out loud.",
        factory="lucid_talk.server:create_app"),
]


def load(app: App) -> Callable:
    """Import an app's factory only when it is actually being mounted."""
    module_name, _, attr = app.factory.partition(":")
    import importlib
    return getattr(importlib.import_module(module_name), attr)
