"""What this game is tuned to, in one JSON file you can edit while it runs.

The player's `lucid-talk/config.json` is read whenever a session starts, so
changing a value and saying something is enough — no restart, no code edits.

Its absence means something: nothing here has been changed. Reading the file
therefore never creates it — the defaults below are simply used — and it
appears the first time something is set.

---- what is not in here --------------------------------------------------

The models and the microphone are the machine's, not this game's: one language
model, one recognizer, one voice and one set of thresholds, however many games
the shell ends up carrying. Nobody has the memory for two of them, and nobody
wants to set them up twice. They live in `userdata/config.json` (see
`shell/config.py`) and arrive here already merged, so everything downstream
reads `cfg["llm"]` and `cfg["vad"]` exactly as it always did.

What stays is what belongs to *this* game: what it remembers, where you stand
with it, how long a dose runs.
"""
from __future__ import annotations

import json

from shell import config as MACHINE

from . import paths
from .paths import CONFIG as PATH

DEFAULTS = {
    "memory": {
        "enabled": True,
        # The whole memory block, and it is a hard budget rather than a target:
        # every bullet is re-prefilled on every turn, so a fact earns its place
        # by displacing a weaker one.
        "max_bullets": 8,
        "fold_after": 4,        # messages that must fall out before folding runs
    },
    # Where you stand with it: warmth, trust and mood, kept per persona and
    # moved one exchange at a time. This is the point of the thing — a
    # conversation you can damage and have to repair — so it is on.
    "relation": {
        "enabled": True,
        # Judging costs one short LLM call per exchange, run while it is
        # still speaking. Turn it off to freeze the state where it is: the
        # feelings still color its replies, nothing moves them any more.
        "score": True,
    },
    # Where the two of you are, written down every few turns and carried
    # forward. Its replies run long enough that the opening of a scene falls
    # out of the live window within four turns, which is how a conversation
    # that began in a shop ends up in a bedroom nobody walked to.
    "scene": {
        "enabled": True,
        # Words spoken since the last note, not turns. A turn is anything from
        # "mm-hm" to four hundred words, so counting them measures nothing;
        # what matters is how much has been said, because that is what pushes
        # the beginning out of the live window. Half of context_words, so the
        # room is written down before it can fall out of view.
        "every_words": 300,
    },
    # Several gigabytes stay resident between turns so the next reply is
    # quick. Left alone all afternoon that is a poor trade, so a quiet machine
    # puts itself away and comes back when you next say something. Minutes;
    # 0 never stops.
    "idle_stop_minutes": 30,
    # Taking a pill you were already under picks the conversation back up
    # rather than starting a new one: a reload, a dropped socket, a phone
    # locking itself. Past this, it was a different dream. Minutes, counted
    # from the last thing said; 0 always starts fresh.
    #
    # Short on purpose: five minutes is the length of an accident. You left
    # the room and came straight back, or the page reloaded under you.
    # Anything longer is a decision, and a decision should start something.
    # Keep it short while starting a new conversation is a console command
    # rather than a control on the deck.
    "resume_within_minutes": 5,
    # Opening a room is the first honest signal that somebody means to play,
    # and it arrives seconds before they speak. Both halves of that head start
    # are taken here: the models begin loading on the way in, and once they are
    # up the prompt in front of them is sent through once with nothing to say,
    # so its prefill is in the server's cache before the first real turn needs
    # it (LLMServer.stream_reply explains why that is worth ~1.8s).
    #
    # The cost is that opening a room to look at it loads several gigabytes.
    # On a machine at the memory floor, or for somebody who browses the box
    # more than they use it, false. It changes nothing else: every other way
    # in still starts the stack.
    "warm_on_open": True,
    "ui": {
        # How long "keep going" runs when you tick it. Asked for on the first
        # visit, because it is the one number a person actually has an opinion
        # about before they have used anything.
        "continuous_minutes": 15,
    },
}

def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out

def exists() -> bool:
    """Whether anything here has ever been changed. The file is the record."""
    return PATH.exists()

def whole(cfg: dict) -> dict:
    """This game's settings with the machine's stack folded in.

    Everything downstream reads `cfg["llm"]`, `cfg["vad"]` and
    `cfg["ui"]["mic_follows_window"]` exactly as it did when they lived here.
    """
    stack = MACHINE.stack()
    cfg["ui"] = {**DEFAULTS["ui"], **(cfg.get("ui") or {})}
    cfg["ui"]["mic_follows_window"] = stack.pop("mic_follows_window")
    cfg.update(stack)
    # The voice a persona falls back to is ours, not the machine's: it is a
    # clip inside one of this game's bundles.
    cfg.setdefault("tts", {}).setdefault(
        "voice_ref", str(paths.PERSONAS / "lover" / "voice.ref.wav"))
    return cfg


def load() -> dict:
    """The settings, whether or not the file is there.

    Deliberately does not write one: the file appearing is how the game knows
    somebody has set something here, so only a change creates it.
    """
    if not PATH.exists():
        return whole(json.loads(json.dumps(DEFAULTS)))
    try:
        raw = json.loads(PATH.read_text())
        # A file from before the split carries the machine's settings; they go
        # up a level, and what is left is rewritten without them.
        if MACHINE.adopt(raw):
            PATH.write_text(json.dumps(raw, indent=2) + "\n")
        cfg = _merge(DEFAULTS, raw)
        if cfg != raw:  # new keys added by an upgrade — keep the file complete
            PATH.write_text(json.dumps(cfg, indent=2) + "\n")
        return whole(cfg)
    except Exception as e:
        print(f"[config] {PATH.name} is not valid JSON ({e}); using defaults")
        return whole(json.loads(json.dumps(DEFAULTS)))

def save(cfg: dict):
    """This game's own, and never the machine's — see whole()."""
    mine = {k: v for k, v in cfg.items() if k not in MACHINE.OURS}
    if isinstance(mine.get("ui"), dict):
        mine["ui"] = {k: v for k, v in mine["ui"].items()
                      if k != "mic_follows_window"}
    PATH.write_text(json.dumps(mine, indent=2) + "\n")
