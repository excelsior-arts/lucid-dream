"""Storage with no words.

Two shapes, and between them everything any game here has ever kept:

    GET|PUT|DELETE /store/{game}/data/{path}    a value by path, bytes both ways
    GET            /store/{game}/data/{dir}/    names, sizes, mtimes
    GET            /store/{game}/logs/{dir}/    {id, lines, at, head} per log
    GET            /store/{game}/logs/{path}    {lines, version}
    POST           /store/{game}/logs/{path}    {line, version} -> 201, or 409
    DELETE         /store/{game}/logs/{path}    {index, version} -> 200, or 409

A value is a file: read it, replace it, delete it. A log is a file of one JSON
object per line that is only ever appended to, and the number of lines in it is
the version an appender says it expects to follow.

That is the whole vocabulary, and it is the point of the file. Every name a
game has for what it keeps is a word on the other side of this line and a path
on this one, so the machine that holds one game's things is the same machine
for a game with nothing in common with it. Lucid Talk's own mapping is in
app/packages/talk/src/conversation/files.ts, which is where its words live.

---- where it lands ---------------------------------------------------------

`{game}` is a directory under the player's, and nothing more to this:

    userdata/players/<player>/<game>/<path>

`data` and `logs` are two ways of reading a file, not two directories. The same
game's `data/config.json` and `logs/sessions/x.jsonl` land beside each other at
`<game>/config.json` and `<game>/sessions/x.jsonl`, which is where a player's
things have always been -- a layout somebody may have years of evenings in, and
not the machine's to rearrange because it grew a second verb. A game keeps its
own two sets of paths apart, the way it keeps any two of its paths apart.

The player is the run's -- `--user`, read once at import -- and is never in an
address, so nothing a page can say reaches another player's things. Two games
write under two directories and cannot collide.

---- two tabs, one log ------------------------------------------------------

There is no lock on anything but the two ways of changing a log, and they need
one because the check and the write have to be one move: two pages reading 8
and both writing would both be right and the second would still land. A delete
is the same move with the same version in it -- it says which position, and a
position only means anything in a file of a known length. Everything else is a
whole-file replace, written beside and renamed, so a crash midway leaves what
was there rather than half of what replaced it.

---- the log rule -----------------------------------------------------------

Nothing that passes through here is said in the console. These carry the words
of conversations, which is exactly what machine/log.py promises never to write
down. Names, counts and versions, yes; a body, never.
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.requests import ClientDisconnect

from . import log as LOG
from . import paths as P

# What a name may be, at every level: a game's slug, and each segment of a
# path under it. Conservative on purpose -- this arrives from an address bar,
# from a link, and on this program over the wifi from a phone with nothing in
# front of it, and it is turned straight into a path. Letters, digits and
# `_ - . ~ :`, and never a leading dot, which is what rules out `.` and `..`
# without a second check and keeps anything hidden from being written at all.
SEGMENT = re.compile(r"[A-Za-z0-9_~:][A-Za-z0-9._~:-]*")

# How deep a path may go, and how long a name may be. Neither is a design: they
# are the two numbers that stop a page, or something wearing a page's clothes,
# from making a directory tree nobody can delete.
DEEP, LONG = 8, 120

# And how much one request may carry, for the same reason. There is no
# authentication on any of this and with --phone it is reachable by anyone on
# the wifi, which is documented rather than accidental -- but a trust model
# that says "anyone here may write" does not have to mean "anyone here may
# fill the disk". Both are far above anything a game has ever written: a value
# is a whole file replaced at once, a line is a moment in one.
MOST = 4 * 1024 * 1024
MOST_LINE = 1024 * 1024

# What content a value comes back as. A short list rather than mimetypes,
# because these are the only things a game stores: text it wrote and JSON it
# made. Anything else is bytes, which is what a browser does least with and is
# the right answer for a thing nobody has declared.
KINDS = {".json": "application/json", ".md": "text/markdown; charset=utf-8",
         ".txt": "text/plain; charset=utf-8",
         ".jsonl": "application/x-ndjson"}


async def raw(req: Request, most: int = MOST) -> bytes | None:
    """A request's body, or nothing at all if it is more than we will take.

    Read in pieces and counted as it arrives, rather than taken whole and
    measured after: a body is only refused for being too big if it was never
    held in the first place. A caller that says how long it is up front is
    taken at its word and refused before a byte of it is read.
    """
    said = req.headers.get("content-length") or ""
    if said.isdigit() and int(said) > most:
        return None
    out = bytearray()
    try:
        async for piece in req.stream():
            out += piece
            if len(out) > most:
                return None
    except ClientDisconnect:
        raise HungUp() from None
    return bytes(out)


class HungUp(Exception):
    """The caller went before its body had all arrived.

    Not the machine's fault and not news: a page cuts off a call it no
    longer needs -- an answer it has moved past, a page that was closed --
    and sometimes the cut lands while the body is still on its way in.
    Starlette raises on the read, and unhandled that was a full traceback in
    the server's log under "Exception in ASGI application" every few
    minutes of play. Answered with a short reply nobody is there to read,
    which is what the situation is.
    """


def hung_up():
    return JSONResponse({"error": "the caller hung up before its body had arrived"},
                        status_code=400)


def too_much(most: int):
    return JSONResponse({"error": f"that is more than {most} bytes"},
                        status_code=413)


async def asked(req: Request, most: int = MOST_LINE):
    """The request's body as a bag of keys, or the refusal to send instead.

    A body that is not JSON at all, or is a list, a number or a string, is a
    caller with a bug -- and every one of those used to come back as a 500
    with a traceback behind it, either out of the JSON parser or out of the
    first `.get` on something that has none. None of it is the machine being
    broken, so none of it should say so. One that is simply enormous is the
    same kind of thing and is told so with the size, not with a traceback.

    Used by the machine's own routes as well as by these, which is why it is
    out here: a body is a body, and a caller with a bug is one whatever it
    was asking for.
    """
    try:
        body = await raw(req, most)
    except HungUp:
        return hung_up()
    if body is None:
        return too_much(most)
    try:
        got = json.loads(body) if body.strip() else None
    except Exception:
        got = None
    if not isinstance(got, dict):
        return JSONResponse({"error": "a body is a bag of keys"}, status_code=400)
    return got


def named_well(name: str) -> bool:
    return bool(SEGMENT.fullmatch(str(name or ""))) and len(str(name)) <= LONG


def root(game: str) -> Path:
    """One game's directory, under the player whose run this is.

    Not through paths.home(), which makes the directory: a read of an address
    nobody has ever written to must not lay down a tree for a game that is not
    installed. It is made on the first write, by beside() and by the append.
    """
    return P.MINE / game


def under(game: str, path: str) -> Path | None:
    """Where a path lands on disk, or nothing if it is not a path of ours.

    An empty path is the directory itself, which is what a listing asks for.
    Every segment is checked rather than the whole string, and the result is
    resolved and checked again against the root it should be under -- the first
    is what a name is allowed to be, the second is the guarantee, and neither
    is worth having on its own.
    """
    if not named_well(game):
        return None
    parts = [x for x in str(path or "").split("/") if x]
    if len(parts) > DEEP or not all(named_well(x) for x in parts):
        return None
    home = root(game).resolve()
    here = home.joinpath(*parts).resolve()
    try:
        here.relative_to(home)
    except ValueError:
        return None
    return here


def beside(p: Path, body: bytes):
    """Write it beside and move it into place.

    Everything a game keeps is the only copy of itself -- months of evenings
    in some of these files, and one that will not parse reads as nothing at all
    -- so no write here is ever seen half done. A crash between the two leaves
    the previous file exactly where it was and a stray temporary beside it.

    Hidden, which is what the leading dot is for: a listing skips those the way
    it skips everything else hidden, so what a crash leaves behind is not
    offered back to a page as one of its own files.
    """
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.new")
    tmp.write_bytes(body)
    tmp.replace(p)


def listing(home: Path) -> list[dict]:
    """What is in a directory: names, sizes, and when each was last written."""
    if not home.is_dir():
        return []
    out = []
    for p in sorted(home.iterdir()):
        if not p.is_file() or p.name.startswith("."):
            continue
        got = p.stat()
        out.append({"name": p.name, "size": got.st_size, "at": got.st_mtime})
    return out


def lines_of(text: str) -> list[str]:
    """The lines of a JSONL file, which are the ones separated by newlines.

    `str.splitlines` also breaks on U+2028, U+2029, form feed and a few
    others, and this file is written with `ensure_ascii=False` — so a line
    separator inside somebody's own text goes to disk raw and is then read
    back as two lines. Both halves fail to parse, one line in the log becomes
    two nulls, and every index after it is off by one for the delete that
    follows. A log line is one line of JSON ended by a newline, and by
    nothing else.
    """
    return text.split("\n")


def read_log(p: Path) -> dict:
    """A log as its reader wants it: the lines, and where the next one lands.

    Every non-empty line counts toward the version, readable or not -- the
    version is a position in the file, and a torn last line still holds one. A
    line that will not parse comes back as null rather than being dropped, for
    the same reason: an index in this list is an index in the file, and that is
    what a delete takes.

    Half a line at the end is what a kill -9 leaves behind, and it costs that
    line and nothing else.
    """
    lines: list = []
    if not p.is_file():
        return {"lines": lines, "version": 0}
    for raw in lines_of(p.read_text(encoding="utf-8", errors="replace")):
        if not raw.strip():
            continue
        try:
            lines.append(json.loads(raw))
        except ValueError:
            lines.append(None)
    return {"lines": lines, "version": len(lines)}


def counted(p: Path) -> int:
    """What version a log is at, without reading a word of it as JSON.

    The version is a position in the file and nothing else -- every non-empty
    line holds one, readable or not -- so it can be counted rather than parsed.
    Every append asks for it, and parsing the whole of a conversation to find
    out where the next line goes is what made an evening of appending cost the
    square of what was said.

    A line for a line with read_log, which is the whole requirement: the same
    text decoding, the same universal newlines, and the same rule that a run
    of whitespace is not a line. A torn last line -- what a kill -9 leaves --
    is a line here as it is there, because it holds a position. Read a line at
    a time so that a long evening is not held in memory to be counted.
    """
    if not p.is_file():
        return 0
    with p.open("r", encoding="utf-8", errors="replace") as f:
        return sum(1 for line in f if line.strip())


def head_of(p: Path) -> dict | None:
    """A log's first line, which is where a game writes what the whole of it
    is about.

    The first line rather than all of them: a listing of an evening's
    conversations used to read and parse every line of every one of them to
    show a name and a count. Unreadable comes back as nothing, the way it does
    in read_log, where it is a null holding its place.
    """
    if not p.is_file():
        return None
    with p.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                return json.loads(line)
            except ValueError:
                return None
    return None


def torn(p: Path) -> bool:
    """Whether the last line of a file was never finished."""
    try:
        with p.open("rb") as f:
            if not f.seek(0, 2):
                return False
            f.seek(-1, 2)
            return f.read(1) != b"\n"
    except OSError:
        return False


# One writer at a time across every append, everywhere. The version check and
# the write have to be one move or the version is a suggestion.
_appending = threading.Lock()


def routes(app):
    """Hang the store on an app. Called by the server, once."""

    def one(game: str, path: str) -> Path | None:
        """The file a path names. A trailing slash is a directory, and a
        directory is not something to write, delete or read as a value."""
        return None if not path or path.endswith("/") else under(game, path)

    def not_a_path(what: str):
        return JSONResponse({"error": f"{what!r} is not a path"}, status_code=400)

    # ---- values by path -----------------------------------------------------

    @app.get("/store/{game}/data/{path:path}")
    def value(game: str, path: str):
        """One value, as the bytes it was written as -- or, for a path ending
        in a slash, what is in that directory.

        Nothing written yet is no bytes rather than a 404, and that is a
        decision. Asking after a value nobody has made is the ordinary case,
        not a mistake: a player who has never spoken to a character has no
        file for what it remembers, and every fresh start would otherwise open
        with a browser console full of red for somebody who has done nothing
        wrong. A page tells absent from empty the way anything else does --
        the listing beside this -- and a path of the wrong *shape* is still
        refused, which is the failure worth shouting about.

        The listing is the same rule: a directory nobody has written into is
        empty, not missing.
        """
        if path.endswith("/") or not path:
            home = under(game, path)
            if home is None:
                return not_a_path(path)
            return {"items": listing(home)}
        p = one(game, path)
        if p is None:
            return not_a_path(path)
        return Response(p.read_bytes() if p.is_file() else b"",
                        media_type=KINDS.get(p.suffix, "application/octet-stream"))

    @app.put("/store/{game}/data/{path:path}")
    async def value_put(game: str, path: str, req: Request):
        """Replace one, whole. The body is the file: this end has no opinion
        about what is in it, so a game that wants a key merged does the merging
        where it knows what a key means."""
        p = one(game, path)
        if p is None:
            return not_a_path(path)
        try:
            body = await raw(req)
        except HungUp:
            return hung_up()
        if body is None:
            return too_much(MOST)
        beside(p, body)
        return {"bytes": len(body)}

    @app.delete("/store/{game}/data/{path:path}")
    def value_gone(game: str, path: str):
        p = one(game, path)
        if p is None:
            return not_a_path(path)
        try:
            p.unlink()
            return {"removed": True}
        except FileNotFoundError:
            return {"removed": False}          # nothing to forget

    # ---- append-only logs ---------------------------------------------------

    @app.get("/store/{game}/logs/{path:path}")
    def log(game: str, path: str):
        """One log's lines, or what logs are in a directory.

        The listing carries each log's first line, because that is where a game
        writes what the whole of it is about -- and reading it here saves the
        page a request per log to find out. Newest first: the one thing anybody
        asks a listing is what happened last.
        """
        if path.endswith("/") or not path:
            home = under(game, path)
            if home is None:
                return not_a_path(path)
            out = []
            for each in sorted(
                    (x for x in home.iterdir() if x.is_file()
                     and not x.name.startswith(".")) if home.is_dir() else [],
                    key=lambda x: x.stat().st_mtime, reverse=True):
                out.append({"id": each.name, "lines": counted(each),
                            "at": each.stat().st_mtime, "head": head_of(each)})
            return {"items": out}
        p = one(game, path)
        if p is None:
            return not_a_path(path)
        return read_log(p)

    @app.post("/store/{game}/logs/{path:path}", status_code=201)
    async def log_append(game: str, path: str, req: Request):
        """Add one line, if the log is still where the caller left it.

        `version` is the number of lines the append expects to follow. Equal,
        and it is written; anything else and the caller is told the count and
        nothing is written -- which is two tabs in one conversation, and the
        second one finding out rather than overwriting.

        The file appears here and nowhere else: a log exists from its first
        append, so a name handed out and never written in leaves nothing on
        disk to read, list or clean up.
        """
        p = one(game, path)
        if p is None:
            return not_a_path(path)
        body = await asked(req)
        if not isinstance(body, dict):
            return body
        line = body.get("line")
        if not isinstance(line, dict):
            return JSONResponse({"error": "a line is a bag of keys"},
                                status_code=400)
        # A version is a count of lines. None is a caller who did not say
        # which, and is told the count; anything that is not a number is a
        # caller with a bug, and used to be an int() raising straight through
        # the route as a 500 -- which says the machine is broken.
        want = body.get("version")
        if want is not None:
            try:
                want = int(want)
            except (TypeError, ValueError):
                return JSONResponse({"error": "a version is a number of lines"},
                                    status_code=400)
        with _appending:
            current = counted(p)
            if want is None or want != current:
                return JSONResponse({"version": current}, status_code=409)
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a", encoding="utf-8") as f:
                # A file whose last line has no newline on it is one a kill -9
                # caught mid-write. The torn line stays torn -- it is read as
                # nothing and costs that line -- but appending straight onto it
                # would glue this line to the wreck and lose that one too.
                if torn(p):
                    f.write("\n")
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
            return {"version": current + 1}

    @app.delete("/store/{game}/logs/{path:path}")
    async def log_remove(game: str, path: str, req: Request):
        """Take one line out, by position, if the log is still where the
        caller left it.

        The one thing here that is not append-only, so it writes a new file and
        moves it into place rather than truncating the one being read. By
        position rather than by content because position is what the reader
        already has: it read the lines, it knows which one it means, and asking
        the machine to match a body would be asking it to look at one.

        Which is why `version` is not optional. A position is a fact about a
        file of a known length, and the reader's knowledge of it is one request
        old: another tab appending in between moves every position after it, so
        a delete arriving with an index and nothing else takes the neighbour of
        the line somebody meant, out of a file that looks untouched afterwards.
        The version is compared under the lock the append is under -- the read
        and the write are one move, or the check is a suggestion -- and a
        mismatch is the 409 an append gets, carrying the count the file is
        actually at.
        """
        p = one(game, path)
        if p is None:
            return not_a_path(path)
        body = await asked(req)
        if not isinstance(body, dict):
            return body
        try:
            index = int(body.get("index"))
        except (TypeError, ValueError):
            return JSONResponse({"error": "an index is a number"},
                                status_code=400)
        try:
            want = int(body["version"])
        except (KeyError, TypeError, ValueError):
            return JSONResponse({"error": "a version is a number of lines"},
                                status_code=400)
        with _appending:
            lines = ([x for x in lines_of(p.read_text(encoding="utf-8",
                                                      errors="replace"))
                      if x.strip()] if p.is_file() else [])
            if want != len(lines):
                return JSONResponse({"version": len(lines)}, status_code=409)
            if not 0 <= index < len(lines):
                return {"removed": False, "version": len(lines)}
            del lines[index]
            beside(p, ("\n".join(lines) + ("\n" if lines else "")).encode())
            return {"removed": True, "version": len(lines)}


@LOG.command("files_where", "where a game keeps what you have done with it",
             args="[slug]")
def _where(rest: str) -> str:
    """The player's directory, for somebody about to back one up or delete one.

    Named for the thing rather than for any game: the machine does not know
    what is installed -- a game is a slug in an address and a directory under
    the player -- so this answers about the one that was asked after, and about
    the player's own directory when nothing was.
    """
    want = (rest or "").strip().lower()
    if not want:
        return f"{P.WHO} {P.MINE}"
    if not named_well(want):
        return f"{want!r} is not a name"
    return f"{want} {P.MINE / want}"
