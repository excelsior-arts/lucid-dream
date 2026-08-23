"""What a conversation did to the room it happened in.

One small JSON file per session, in this player's lucid-talk/rooms/. Not
inside the session file: that is append-only JSONL on purpose, so a kill -9 costs at most
the turn in flight, and this is mutable — rewritten every time you touch
something in the room.

    {"v": 1, "lamp": 3, "shelves": {"-3.2,2.4": 2}, "plant": {"from": 12}}

---- what the rooms are becoming ------------------------------------------

The rooms are a game. Not a game bolted onto the chat — the room *is* the
game, and the conversation is what plays it. The intention, in order of how
much it constrains everything else:

  * Most things in a room can be touched. Click a shelf and books fall off it
    and drop onto the spiral; click it again and they are pushed further down,
    turn by turn, until they are gone. Click a lamp and it steps through five
    or six brightnesses. Click the urn by Lover's window and a crystal plant
    starts growing out of it, and goes on growing as you talk.

  * Nothing in a room is on a clock. Things change when a hand touches them
    and when somebody says something, and never otherwise. A plant grows a
    generation per reply, not per minute. This is what makes a room
    reproducible, and it is not negotiable — the moment anything drifts on
    wall-clock time, the rule below stops being true.

  * The room is a pure function of the conversation, the clicks, and the
    persona's current temperature. Same three, same room. Which means a room
    is rebuilt rather than restored, and loading is the ordinary constructor
    with the animation durations set to zero.

  * Two seeds, with different lifetimes. What *happened* is hashed from the
    persona and the session id and is fixed forever: which books fell, where
    they landed, which step the lamp is on. How it *looks now* mixes the
    persona's current temperature with the live conversation: leaf angles,
    proportions, color, how fast a thing grows. So reopening an old
    conversation at a different temperature keeps its history and grows it in
    a different hand, and no two playthroughs land in the same room.

That is why this file holds so little. The app already keeps every transcript
and already replays it into the page on load, so the conversation — most of
what a room is made of — needs no saving here. All that is left is what a hand
did. Where the plant has got to is not stored; where it *started* is, and the
rest is arithmetic over the messages since.

Animations never own state. They travel to it. A book falling is a transient;
the fact that it fell is `shelves["-3.2,2.4"] = 1`.

---- if you are adding an object to a room ---------------------------------

Rooms will go on being redesigned. Objects will be added, moved, renamed and
taken out, and a save written three redesigns ago still has to open without
anybody thinking about it. So, in order:

  1. Give it a hand-chosen name, never a loop index. `lamp`, not `thing3`.
     An id derived from position in a list moves when the list does, and a
     stored click then lands on the wrong object — which is worse than losing
     it, because it looks like it worked. For swarms where a name per item is
     absurd, derive the id from something in the world that survives a
     redesign, like position on the wall rounded to 10cm, and accept that
     moving the whole fitting resets them.

  2. Read defensively and totally. Every stored value has to land somewhere
     valid in the room *as it is now* or be dropped — clamped, not trusted. A
     lamp that had six steps and now has four reads a stored 5 as 3. An object
     that no longer exists is quietly ignored; nothing throws, nothing warns,
     the room simply opens without it.

  3. Never prune what you do not recognize. Take an object out for a redesign,
     put it back four commits later, and its state is still here waiting. The
     bag is merged on write, so a room that does not mention a key leaves it
     alone. A few hundred bytes buys the freedom to move things around.

The server holds none of that logic — it stores what the room hands it and
hands it back. All three rules belong to whoever knows what the object is
*now*, which is the room's own code. `v` is here for the day a real migration
is unavoidable; nothing reads it yet.
"""
from __future__ import annotations

import json
import re

from .paths import ROOMS as DIR

V = 1
SAFE = re.compile(r"[^A-Za-z0-9._-]")


def _path(session_id: str):
    """One file per session, named after it. Nothing else is allowed to be a
    filename: a session id comes from a timestamp and a persona slug, but it
    arrives here over a websocket and is therefore somebody's input."""
    stem = SAFE.sub("", session_id or "")[:120]
    # And a name has to be a name. Dots survive the filter above — they belong
    # in a timestamp — so "..", which is not a session and never was, came
    # through it as the perfectly legal filename "...json". Nothing escapes
    # the directory either way; this is about not writing a file for a thing
    # that was never a conversation.
    if not any(c.isalnum() for c in stem):
        return None
    return DIR / f"{stem}.json"


def load(session_id: str) -> dict:
    p = _path(session_id)
    if not p or not p.exists():
        return {"v": V}
    try:
        got = json.loads(p.read_text())
        return got if isinstance(got, dict) else {"v": V}
    except Exception:
        # A half-written or hand-edited file loses the room, not the app.
        return {"v": V}


def save(session_id: str, state: dict) -> bool:
    """Write the whole bag, keeping anything already in it that this room did
    not mention -- rule 3 above. Written beside and renamed, so a crash midway
    leaves the previous save intact rather than a truncated one."""
    p = _path(session_id)
    if not p or not isinstance(state, dict):
        return False
    DIR.mkdir(parents=True, exist_ok=True)
    merged = {**load(session_id), **state, "v": V}
    tmp = p.with_suffix(".json.new")
    tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n")
    tmp.replace(p)
    return True


def forget(session_id: str) -> bool:
    """Put a room back to nothing. The conversation is untouched -- this is
    the room's own reset, for when a design change has made a save absurd."""
    p = _path(session_id)
    if p and p.exists():
        p.unlink()
        return True
    return False
