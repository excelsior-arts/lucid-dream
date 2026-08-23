"""Personas: one directory each, re-read from disk every time.

  personas/lover/
    persona.md      the character, and what it is tuned to
    voice.ref.wav   the clip it speaks from
    room.css        the room it puts you in
    assets/         anything that room needs

Everything about *you* lives outside the bundle -- memory/, sessions/, and
where you stand -- keyed by the same slug. A bundle is the game's content and
is never written to at runtime; that is what makes a persona something you
could one day hand to somebody without handing over your conversations too.

  personas/lover/persona.md

      ---
      name: Lover
      color: "141, 92, 214"
      temperature: 0.9
      ---
      You are Lover. You are ...

The body is the system prompt. Edit it and start a new session to hear it --
nothing is compiled in. `draft: true` keeps a character out of the picker
without deleting it: the directory stays, and old conversations with it still
open. `voice:` borrows another persona's clip; otherwise a persona speaks with
the one in its own directory.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from . import paths, prompts

DIR = paths.PERSONAS

# What a bundle may contain, by name. Anything else in the directory is the
# persona's own business -- images, sounds, whatever its room wants.
PROMPT = "persona.md"
VOICE = "voice.ref.wav"
ROOM = "room.css"
ROOM_SCRIPT = "room.js"
ASSETS = "assets"

# Frontmatter keys a persona may set. Everything here is measured to do
# something; nothing is passed through for decoration.
TUNABLES = (
    "temperature",      # LLM sampling
    "top_p",
    "exaggeration",     # 0-1 delivery intensity     — full Chatterbox only;
    "cfg_weight",       # lower = more pitch movement  — Turbo ignores both
    "pause",            # seconds of silence after each sentence
)


def _parse(home: Path) -> dict:
    """Read one bundle. `home` is the directory; persona.md is its text."""
    raw = (home / PROMPT).read_text()
    meta, body = {}, raw
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", raw, re.S)
    if m:
        try:
            meta = yaml.safe_load(m.group(1)) or {}
        except Exception:
            meta = {}
        body = m.group(2)
    slug = home.name
    return {
        "slug": slug,
        # Written, but not shown: kept out of the picker until it is ready.
        "draft": bool(meta.get("draft")),
        # Two names, and the split is the point. `name` is the character's own,
        # used where a character is being addressed -- the prompt, and nothing
        # else. `pill` is what a player is handed: a colored pill in a box.
        # Everything anybody sees says the pill, which keeps the interface
        # free of who the character happens to be this month, and leaves the
        # prompt free to be as specific as it likes.
        "name": str(meta.get("name") or slug.replace("-", " ").title()),
        "pill": str(meta.get("pill") or slug.replace("-", " ").title()),
        "voice": meta.get("voice"),
        # One line for the chooser, said about the pill rather than by it.
        "blurb": str(meta.get("blurb") or ""),
# Where this one is, in words, for the model rather than for the
        # screen. It seeds the scene of a new conversation and is then let go
        # of: the moment the two of you talk yourselves into a dressing room
        # or a station platform, scene.py writes over it and the room stops
        # being the place. So it is a first line, never a fact — which is why
        # nothing reads it again once a session has begun.
        #
        # It says the same thing personas/<slug>/room.js draws, and that
        # duplication is deliberate: one is what a player sees, the other is
        # what the model reads, and they are allowed to drift apart.
        "place": str(meta.get("place") or "").strip(),
        # What color the pill is, as "r, g, b". The box is lit by these.
        "color": str(meta.get("color") or "150, 140, 130"),
        # And the figure repeated across the back of its card. A word, matched
        # against what choose.html knows how to draw; anything it does not
        # know leaves the card plain, which is a card and not a fault.
        "figure": str(meta.get("figure") or "").strip().lower(),
        **{k: meta.get(k) for k in TUNABLES},
        "prompt": body.strip(),
        "home": str(home),
        "file": str(home / PROMPT),
        # Whether it dresses its own room, and whether that room has a script.
        "room": (home / ROOM).exists(),
        "script": (home / ROOM_SCRIPT).exists(),
    }


def homes() -> list[Path]:
    """Every bundle on disk: a directory with a persona.md in it."""
    if not DIR.exists():
        return []
    return sorted(d for d in DIR.iterdir() if (d / PROMPT).exists())


def listing() -> list[dict]:
    """The characters on offer. Drafts are written but not shown."""
    return sorted((d for d in map(_parse, homes()) if not d["draft"]),
                  key=lambda d: d["name"].lower())


def get(slug: str) -> dict | None:
    """One bundle by name. The name arrives over a websocket — a page saying
    which pill it came for — so it is somebody's input, and gets the same
    treatment as the one in asset() below rather than being trusted because
    the directory beside it is ours."""
    home = (DIR / slug).resolve()
    try:
        home.relative_to(DIR.resolve())
    except ValueError:
        return None
    if home == DIR.resolve():
        return None
    return _parse(home) if (home / PROMPT).exists() else None


def system_prompt(persona: dict) -> str:
    # System first, persona last. The model weights what it read most recently,
    # so anything generic sitting after a persona quietly overrides it -- which
    # is why system.md carries no style or length guidance, only the facts
    # about being spoken aloud that the model cannot work out for itself.
    return prompts.get("system").rstrip() + "\n\n" + persona["prompt"].strip()


def voice_ref(persona: dict) -> Path | None:
    """The reference clip this persona is cloned from.

    A voice belongs to a persona, so it lives in the persona's own directory
    and nothing has to say so. `voice:` is for the exception -- two characters
    that should sound alike -- and borrows from the other one's bundle.
    """
    borrowed = persona.get("voice")
    home = DIR / borrowed if borrowed else Path(persona["home"])
    p = home / VOICE
    return p if p.exists() else None


def asset(slug: str, name: str) -> Path | None:
    """A file from a bundle, for the page: its room, or something the room needs.

    Refuses anything that climbs out of the directory. The bundles are ours,
    but a path from a URL is not, and one line here is cheaper than trusting
    that forever.

    Both halves come off the URL, so both are checked: a slug that climbs
    (`../../shell`) moves the directory this is measuring against, and every
    name under it then looks perfectly contained.
    """
    root = DIR.resolve()
    try:
        home = (DIR / slug).resolve()
        home.relative_to(root)
        want = (home / name).resolve()
        want.relative_to(home)
    except (ValueError, OSError):
        return None
    return want if want.is_file() else None
