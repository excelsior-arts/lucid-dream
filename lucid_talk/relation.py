"""Where you stand with her: a small state that outlives the conversation.

Memory records what is true about you. This records what you are to her, which
is a different thing and moves differently -- facts accumulate, a relationship
swings. Three axes, kept per persona in memory/<persona>.relation.json:

    warmth   contempt ... fondness      moves slowly, both ways
    trust    guarded ... open           falls fast, rises slowly
    mood     today's temper             decays in hours

Two more come free and need no judgement at all: how many turns you have spent
together, and how long you have been away.

The numbers never reach the model. They are quantised into named bands and
rendered as a sentence, because a model does something sensible with "she is
guarded with him" and nothing sensible with "trust: -40". Bands also give the
stance hysteresis: a value wobbling between -38 and -42 does not change a word
of the prompt, so she does not flip register turn to turn.

That hysteresis is worth keeping for a second reason nobody had in mind when
it was written. These axes move on every scored turn, and the banded prose is
what goes into the system prompt -- which is the front of the prefix the LLM
server caches between turns (see models.LLMServer.args). Bands mean a prompt
that changes a few times an evening instead of every turn. Anything added here
that rendered a number directly would read the same to a person and cost a
cache miss, and about two seconds, per exchange. See session._window.
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

from . import paths, prompts
from shell import log as LOG

AXES = ("warmth", "trust", "mood")
LIMIT = 100.0

# How long it takes for half of a feeling to fade, with no contact at all.
# Anger cools over days; a bad mood is gone by tomorrow; trust, once lost,
# is the slowest thing here.
#
# Counted in evenings rather than in calendar months, which is the correction:
# this is taken nightly, and a season-long trust is one that never moves. At
# ninety days a week away healed five percent of a bad night and a single
# sitting healed nothing at all, so the standing stopped being something you
# mend and became something you reset. These are the same three-to-one shape,
# at the tempo of a life that does not come back to things for a quarter.
HALF_LIFE_HOURS = {"warmth": 24 * 7, "trust": 24 * 21, "mood": 6}

# The most one exchange may move an axis.
MAX_STEP = 3.0

# What each step is worth, and it is deliberately not a straight line. Most
# turns are a 0 or a 1 and should barely register -- that is what makes the
# state stable enough to trust. A 3 is a rupture: contempt, a threat to leave,
# being lied to. Linear steps made those cost 2.4 points out of 100, so ten
# insults were needed to turn her cold, which is not how anyone works.
STEP_WEIGHT = {0: 0.0, 1: 1.0, 2: 3.0, 3: 9.0}

# Trust is asymmetric, which is most of what makes it feel true: it is spent
# faster than it is earned.
GAIN = {"warmth": 1.0, "trust": 0.6, "mood": 1.4}
LOSS = {"warmth": 1.2, "trust": 2.0, "mood": 1.4}

# The top band used to start at 100, which no axis ever reaches and none of
# them has to: 60 and up fell through _band to the fallback below, which
# returns this same line. The behavior was right and the table said otherwise,
# and a table that only reads correctly if you also read the function is a trap
# for whoever tunes these next.
BANDS = {
    "warmth": [
        (-100, -60, "She cannot stand him. Every exchange costs her something."),
        (-60, -25, "She is cold with him, and does not pretend otherwise."),
        (-25, -8, "She is distant. Present, but nothing is being offered."),
        (-8, 8, "She is neither drawn to him nor put off. It could go either way."),
        (8, 25, "She likes him, mildly, and it shows in small ways."),
        (25, 60, "She is fond of him. She wants him there."),
        (60, 101, "She is deeply attached to him, and does not hide it."),
    ],
    "trust": [
        (-100, -60, "She does not believe what he tells her."),
        (-60, -25, "She is guarded. She keeps things back."),
        (-25, -8, "She is careful with him — not suspicious, not open."),
        (-8, 8, "She has no particular reason to trust or doubt him."),
        (8, 25, "She takes him at his word."),
        (25, 60, "She is open with him, including about things she would not tell most people."),
        (60, 101, "She trusts him completely."),
    ],
    "mood": [
        (-100, -60, "Right now she is angry."),
        (-60, -25, "Right now she is irritated with him."),
        (-25, -8, "Something in the last few minutes has put her slightly off."),
        (-8, 8, ""),
        (8, 25, "She is in a good mood."),
        (25, 60, "She is in high spirits."),
        (60, 101, "She is delighted, and it is spilling into everything she says."),
    ],
}


# What she DOES, as opposed to how she feels.
#
# The bands above are adjectives, and a model renders an adjective as tone and
# then goes on doing what the persona told it to do -- which here is to be
# curious and give a full paragraph. Conduct is checkable where a mood is not:
# no questions, nothing offered, a handful of words.
#
# There was a token ceiling here too, and it was the wrong instrument: a cap
# cannot shorten a reply, it can only cut one off, and what it cut had to be
# either spoken as a fragment or hidden from you. The instructions do the work
# on their own -- measured, they produce "Good." and "Get out." unaided.
CONDUCT = [
    (-75, None, None,
     "You are done with him. A handful of words, or nothing at all. Ask him "
     "nothing, explain nothing, help him with nothing. Contempt is allowed, "
     "and so is refusing him outright, in whatever words are yours. Do not "
     "soften it at the end and do not leave him a way back in."),
    (-40, -60, None,
     "Give him nothing he has not asked for. One or two short sentences. No "
     "questions back, no examples, no helping him think it through. Cold is "
     "the point; do not warm it up at the end."),
    (-15, -30, None,
     "Keep it short and flat. Nothing offered, nothing drawn out, no question "
     "back to him."),
]


def conduct(state: dict) -> str:
    """How she behaves right now. Empty when nothing needs saying."""
    for warmth_at, trust_at, _unused, text in CONDUCT:
        if state["warmth"] <= warmth_at or (trust_at is not None
                                            and state["trust"] <= trust_at):
            return text
    return ""


def path(slug: str) -> Path:
    return paths.MEMORY / f"{slug}.relation.json"


def blank() -> dict:
    return {**{a: 0.0 for a in AXES}, "turns": 0, "updated": time.time(), "log": []}


def load(slug: str) -> dict:
    try:
        state = json.loads(path(slug).read_text())
    except (OSError, ValueError):
        return blank()
    out = blank()
    for k, v in state.items():
        if k in out:
            out[k] = v
    for a in AXES:                      # a hand-edited file is still a file
        try:
            out[a] = max(-LIMIT, min(LIMIT, float(out[a] or 0)))
        except (TypeError, ValueError):
            # A word where a number should be. This used to raise, and it
            # raised from inside the prompt block — so one bad character in a
            # file nobody was supposed to open ended every reply that persona
            # tried to make. An axis that cannot be read is an axis at rest.
            out[a] = 0.0
    return out


def save(slug: str, state: dict):
    """Beside and renamed, like everything else that cannot be rebuilt.

    A torn write here is worse than a lost file: load() treats an unreadable
    one as blank(), so the next exchange would write that blank back over
    months of standing without anything having gone visibly wrong.
    """
    paths.MEMORY.mkdir(parents=True, exist_ok=True)
    p = path(slug)
    tmp = p.with_suffix(".json.new")
    tmp.write_text(json.dumps(state, indent=2) + "\n")
    tmp.replace(p)


def reset(slug: str) -> dict:
    """Forget where you stand, and start again from nothing.

    The file goes rather than being zeroed, so the turn count and the log of
    how you got here go with it — a fresh start, not a suspiciously blank
    history. A new one appears on the next scored exchange.
    """
    try:
        path(slug).unlink()
    except FileNotFoundError:
        pass                             # nothing to forget
    except OSError as e:
        # The reset appeared to work and did not, which is worse than an error.
        LOG.say(f"could not clear {slug}'s standing — {type(e).__name__}: {e}",
                source="talk", level="error")
    return blank()


def decayed(state: dict, now: float | None = None) -> dict:
    """Let time do to a feeling what time does. Never called on its own —
    every read and every write goes through it, so the state on disk is only
    ever a snapshot of a moment that has since passed."""
    now = time.time() if now is None else now
    hours = max(0.0, (now - float(state.get("updated") or now)) / 3600.0)
    if hours < 0.01:
        return dict(state)
    out = dict(state)
    for a in AXES:
        out[a] = float(out[a]) * math.pow(0.5, hours / HALF_LIFE_HOURS[a])
        if abs(out[a]) < 0.5:
            out[a] = 0.0
    out["updated"] = now
    return out


def apply(slug: str, deltas: dict, why: str = "") -> dict:
    """Move the axes by one exchange's worth, and write it down."""
    state = decayed(load(slug))
    moved = []
    for a in AXES:
        d = float(deltas.get(a) or 0.0)
        d = max(-MAX_STEP, min(MAX_STEP, d))
        if not d:
            continue
        weight = STEP_WEIGHT.get(round(abs(d)), abs(d))
        d = math.copysign(weight, d) * (GAIN[a] if d > 0 else LOSS[a])
        state[a] = max(-LIMIT, min(LIMIT, state[a] + d))
        moved.append(f"{a}{d:+.1f}")
    state["turns"] = int(state.get("turns") or 0) + 1
    state["updated"] = time.time()
    if moved:
        # Enough history to see how you got here, not enough to grow forever.
        state["log"] = (state.get("log") or [])[-19:] + [{
            "at": time.strftime("%Y-%m-%d %H:%M"),
            "moved": " ".join(moved),
            "why": why[:120],
        }]
    save(slug, state)
    return state


# One word for the header, so you can see where you stand without reading a
# paragraph — and without a number, which would turn a relationship into a
# score you try to farm. Temperature, because that is what warmth is.
STANDING = [
    (-60, "frozen"), (-25, "cold"), (-8, "cool"), (8, "even"),
    (25, "warm"), (60, "close"), (101, "devoted"),
]


def standing(state: dict) -> tuple[str, str]:
    """A word and a temper, for the top of the page."""
    word = next(w for edge, w in STANDING if state["warmth"] < edge)
    temper = ""
    if state["mood"] <= -60:
        temper = "furious"
    elif state["mood"] <= -25:
        temper = "annoyed"
    elif state["mood"] >= 60:
        temper = "delighted"
    elif state["mood"] >= 25:
        temper = "bright"
    # Trust lagging well behind warmth is its own thing: she likes you and
    # still would not tell you anything.
    elif state["trust"] <= -25 and state["warmth"] > -25:
        temper = "wary"
    return word, temper


def _band(axis: str, value: float) -> str:
    for lo, hi, text in BANDS[axis]:
        if lo <= value < hi:
            return text
    return BANDS[axis][-1][2] if value > 0 else BANDS[axis][0][2]


def describe(state: dict) -> str:
    """The state as prose. Empty when there is nothing worth saying."""
    parts = [_band(a, state[a]) for a in AXES]

    turns = int(state.get("turns") or 0)
    if turns >= 400:
        parts.append("They have been talking for a long time now.")
    elif turns >= 80:
        parts.append("They know each other well by now.")
    elif turns <= 6:
        parts.append("They barely know each other yet.")

    away = (time.time() - float(state.get("updated") or time.time())) / 86400.0
    if away >= 14:
        parts.append(f"It has been about {int(away)} days since they last spoke.")
    elif away >= 3:
        parts.append(f"It has been {int(away)} days since they last spoke.")

    return " ".join(p for p in parts if p)


def as_prompt_block(slug: str) -> str:
    """What goes into the system prompt, or nothing at all."""
    text = describe(decayed(load(slug)))
    if not text:
        return ""
    return "\n\n" + prompts.get("relation_intro").rstrip() + "\n" + text


def read_deltas(raw: str) -> tuple[dict, str]:
    """Pull the judgement out of whatever the model wrapped it in."""
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return {}, ""
    try:
        data = json.loads(raw[start:end + 1])
    except ValueError:
        return {}, ""
    deltas = {}
    for a in AXES:
        try:
            deltas[a] = max(-MAX_STEP, min(MAX_STEP, float(data.get(a) or 0)))
        except (TypeError, ValueError):
            deltas[a] = 0.0
    return deltas, str(data.get("why") or "")[:120]


def score(llm, slug: str, exchange: list[dict]) -> dict | None:
    """Judge one exchange and move the axes. Returns the new state, or None.

    Runs on the worker thread while she is still speaking, so it costs nothing
    you can hear. It is shown the exchange and nothing else -- never the
    accumulated score -- so it cannot talk itself into a direction.
    """
    if not exchange:
        return None
    import threading

    him = " ".join(m["content"] for m in exchange if m["role"] == "user")
    her = " ".join(m["content"] for m in exchange if m["role"] != "user")
    raw = llm.stream_reply(
        [{"role": "user",
          "content": prompts.get("relation_user").format(him=him.strip(),
                                                         her=her.strip()[:400])}],
        lambda _d: None,
        threading.Event(),
        system=prompts.get("relation_system"),
        temperature=0.1,
        # One line of JSON. The cap matters because the LLM serves one request
        # at a time: every token this spends is a token the next reply waits
        # for, if you answer her before she has finished speaking.
        max_tokens=48,
    )
    deltas, why = read_deltas(raw)
    if not deltas or not any(deltas.values()):
        return None
    return apply(slug, deltas, why)
