"""Conversations on disk, one JSONL file per session, appended as you talk.

  sessions/2026-08-18T20-14-03_companion.jsonl

First line is metadata; every line after it is a turn. Append-only, so a crash
or a kill -9 never costs you more than the turn in flight.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime
from pathlib import Path

from .paths import SESSIONS as DIR


# What a conversation may be called: the stamp it was begun at, a suffix if two
# began in the same second, and the pill it belongs to. Checked rather than
# trusted, because this name arrives from a page's address bar and is turned
# straight into a path — and the address bar is typed in by hand, arrives in
# links, and on this program comes over the wifi from a phone with nothing in
# front of it. Anything else is not a conversation of ours.
NAME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?_[a-z0-9_-]+$")


def named_well(session_id: str) -> bool:
    return bool(NAME.match(str(session_id or "")))


def exists(session_id: str) -> bool:
    """Is there a transcript of that name — one that has been spoken in."""
    return named_well(session_id) and (DIR / f"{session_id}.jsonl").exists()


def could_be(session_id: str, persona_slug: str) -> bool:
    """Could this pill open a conversation of that name?

    True for a name of ours belonging to this pill with nothing written under
    it yet: a room somebody opened, said nothing in, and came back to. False
    for a name of the wrong shape or another pill's, which is a page pointed
    at a conversation that does not exist. See Store.adopt.
    """
    return (named_well(session_id) and whose(session_id) == persona_slug
            and not (DIR / f"{session_id}.jsonl").exists())


def whose(session_id: str) -> str:
    """Which pill a conversation belongs to, read off its name."""
    return str(session_id).rsplit("_", 1)[-1] if named_well(session_id) else ""


class Store:
    def __init__(self):
        self.path: Path | None = None
        self.persona: str = ""
        self.scene: str = ""      # where the conversation had got to

    # ---------- writing ----------

    def start(self, persona_slug: str, persona_name: str) -> str:
        """Name a new session without creating it yet.

        The file appears when something is actually said. Writing it here meant
        every restart left a transcript containing nothing but its own header,
        which then cluttered History and buried the real conversations.
        """
        DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        self.path = DIR / f"{stamp}_{persona_slug}.jsonl"
        # A name is a second and a slug, and two conversations can begin
        # inside one second — take a pill, change your mind, take it again;
        # or open a room twice while the first is still settling. Both would
        # have been the same file, so the second appended its turns to the
        # first and History showed one conversation that contradicted itself.
        # A conversation is the one thing here with no second copy.
        n = 2
        while self.path.exists():
            self.path = DIR / f"{stamp}-{n}_{persona_slug}.jsonl"
            n += 1
        self.persona = persona_slug
        self._pending_meta = {"kind": "meta", "persona": persona_slug,
                              "persona_name": persona_name, "started": time.time()}
        return self.path.stem

    def resume(self, session_id: str) -> list[dict]:
        if not named_well(session_id):
            raise FileNotFoundError(session_id)
        p = DIR / f"{session_id}.jsonl"
        if not p.exists():
            # Clear nothing on failure: dropping the pending header here left
            # the old path armed, and later turns were appended to a previous
            # transcript with no meta line at all.
            raise FileNotFoundError(session_id)
        self.path = p
        self._pending_meta = None
        rows = _read(p)
        self.persona = rows["meta"].get("persona", "")
        self.scene = rows["scene"]
        return rows["messages"]

    def adopt(self, session_id: str, persona_slug: str, persona_name: str) -> bool:
        """Take a name that has no file behind it as this conversation.

        A conversation nobody has said anything in does not exist on disk --
        start() names one and leaves the writing until there is something to
        write, so History is not full of empty evenings. Which means a page
        whose address bar names such a conversation is asking for something
        that is, on disk, indistinguishable from nothing at all.

        Answering "no such session" and opening a different one leaves the
        address bar lying, and the page then turns away everything about the
        conversation it is actually in. Answering "very well, that is what this
        one is called" costs nothing: the name was only ever a name, the
        transcript is empty either way, and what the page asked for is true.

        Only for this pill, and only for a name of ours. A conversation carries
        its pill in its name, and letting Thinker adopt a name ending in
        _lover would put a conversation in History under a pill that was never
        in it.
        """
        if not named_well(session_id) or whose(session_id) != persona_slug:
            return False
        p = DIR / f"{session_id}.jsonl"
        if p.exists():
            return False                  # not ours to invent; resume it
        DIR.mkdir(parents=True, exist_ok=True)
        self.path = p
        self.persona = persona_slug
        self.scene = ""
        self._pending_meta = {"kind": "meta", "persona": persona_slug,
                              "persona_name": persona_name, "started": time.time()}
        return True

    def append_scene(self, text: str):
        """Write down where the scene has got to.

        A milestone rather than a turn: it is not something either of you
        said, it is where you both are. Kept in the transcript because it
        belongs to this conversation and to no other, and so that reopening
        one from History picks the room back up.
        """
        if self.path is None or not text.strip():
            return
        self._write({"kind": "scene", "text": text.strip(), "ts": time.time()})

    def append(self, role: str, content: str):
        if self.path is None:
            return
        meta = getattr(self, "_pending_meta", None)
        if meta is not None:
            self._pending_meta = None
            self._write(meta)
        self._write({"kind": "turn", "role": role, "content": content, "ts": time.time()})

    def remove(self, role: str, content: str) -> bool:
        """Take a turn back out of the transcript.

        Everything else here is append-only, which is what makes a crash cheap.
        This is the exception, so it writes a new file and moves it into place
        rather than truncating the one being read.
        """
        if self.path is None or not self.path.exists():
            return False
        lines = self.path.read_text().splitlines()
        want = content.strip()
        for i in range(len(lines) - 1, -1, -1):     # the most recent match
            try:
                row = json.loads(lines[i])
            except ValueError:
                continue
            if (row.get("kind") == "turn" and row.get("role") == role
                    and (row.get("content") or "").strip() == want):
                del lines[i]
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text("\n".join(lines) + ("\n" if lines else ""))
                tmp.replace(self.path)
                return True
        return False

    def _write(self, obj: dict):
        with self.path.open("a") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    # ---------- reading ----------

    @property
    def session_id(self) -> str:
        return self.path.stem if self.path else ""


def _read(p: Path) -> dict:
    meta, messages, scene = {}, [], ""
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if row.get("kind") == "meta":
            meta = row
        elif row.get("kind") == "turn":
            messages.append({"role": row["role"], "content": row["content"]})
        elif row.get("kind") == "scene":
            scene = row.get("text", "")          # the last one wins
    return {"meta": meta, "messages": messages, "scene": scene}


def listing(limit: int = 40, persona: str | None = None) -> list[dict]:
    """Recent conversations, newest first; one persona's when asked for.

    The filtering happens here rather than after, because the limit is a
    number of conversations to offer and not a number of files to look at:
    forty transcripts of somebody else would otherwise leave its list empty.
    """
    if not DIR.exists():
        return []
    out = []
    for p in sorted(DIR.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
        if len(out) >= limit:
            break
        # The slug is in the filename, so most of a filtered listing costs a
        # directory entry rather than a parse of the whole conversation.
        if persona and not p.stem.endswith(f"_{persona}"):
            continue
        rows = _read(p)
        msgs = rows["messages"]
        if not msgs:
            continue          # nothing was ever said; not worth offering
        if persona and rows["meta"].get("persona") != persona:
            continue
        first = next((m["content"] for m in msgs if m["role"] == "user"), "")
        out.append({
            "id": p.stem,
            "persona": rows["meta"].get("persona", ""),
            "persona_name": rows["meta"].get("persona_name", ""),
            "turns": len(msgs),
            "when": datetime.fromtimestamp(p.stat().st_mtime).strftime("%b %d %H:%M"),
            "preview": (first[:70] + "…") if len(first) > 70 else first,
        })
    return out


def latest(persona_slug: str | None = None) -> str | None:
    for s in listing(limit=40, persona=persona_slug):
        if s["turns"]:
            return s["id"]
    return None
