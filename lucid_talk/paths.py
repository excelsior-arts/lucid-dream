"""Where Lucid Talk keeps its things.

Two halves, and the split is the point.

What the app *is* lives in the package, in git, the same on every machine:

    lucid_talk/
      personas/       one directory per character: its prompt, its voice,
                      the room it puts you in, and anything else it needs
      prompts/        what it sends the model
      static/         the page

What the app has *become* lives under whoever is playing, in the checkout's
userdata/ directory, and none of it is in git:

    userdata/<who>/lucid-talk/
      config.json     what this app is tuned to
      sessions/       every conversation, one file each
      memory/         what each persona knows about you, and where you stand
      rooms/          what each conversation did to the room it happened in
      tmp/            scratch: llm.log, recordings, anything mid-experiment

The app owns everything under that directory and nothing outside it, which is
what makes it an app rather than the whole program. Anything private we invent
next — and rooms/ was the last one — gets a directory there and no line in
.gitignore. See shell/paths.py for why that matters.

One directory per player, and the game is handed one of them: two players are
two of these trees, and neither this file nor anything under it knows which it
is looking at. Which port to serve on and which certificate to use belong to
the shell that runs us, not here.
"""
from __future__ import annotations

from pathlib import Path

from shell.paths import home

APP = Path(__file__).resolve().parent
ROOT = APP.parent                      # the checkout, for the odd thing shared

STATIC = APP / "static"

# ---- the characters; one copy of each, versioned ----
PERSONAS = APP / "personas"
PROMPTS = APP / "prompts"

# ---- yours; none of it in git ----
DATA = home("lucid-talk")
CONFIG = DATA / "config.json"
SESSIONS = DATA / "sessions"
MEMORY = DATA / "memory"
ROOMS = DATA / "rooms"                 # one file per conversation
TMP = DATA / "tmp"
LLM_LOG = TMP / "llm.log"

