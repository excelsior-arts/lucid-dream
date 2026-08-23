"""Where everything of yours lives.

    userdata/
      config.json           the certificate to serve on, and whether the wifi
                            address is offered at all -- the machine's, and
                            the same whoever is playing
      certs/                the TLS keys that let a phone reach this
      players/              one directory per player; the count is the roster
        player1/
          log/                what the console said
          lucid-talk/         one directory per app, named by its route
            config.json         what that app is tuned to
            sessions/           every conversation, one file each
            memory/             what each persona knows about you
            rooms/              what each conversation did to its room
            tmp/                scratch; nothing reads it
        staci/
          ...

Named the way a game names it, because that is what this is: the program is
the program, and everything anybody has done with it is one directory you can
copy, delete, or carry to another machine. One line in .gitignore, and a
guarantee that goes with it — nothing under userdata/ is ever committed,
whatever gets invented next.

That last clause is the working rule. **Anything private invented from here on
goes under a player's directory and nowhere else** — beside the code is not an
option, however convenient, because then the guarantee goes back to being a
list somebody has to remember to extend. If a new kind of thing needs a home,
give it a directory under an app's `home()` and add nothing to .gitignore.

---- the machine, and the people on it --------------------------------------

Two levels, and the split is the point. The certificate and whether the phone
is offered are the computer's: one answer, however many people play. Everything
below `players/` is one player's — their conversations, what each persona
knows about them, where they stand with it — and touches nobody else's.

A player is a directory name and that is the whole of the mechanism.
`LUCID_USER` picks which, `run.sh --user pete` sets it, and a name nobody has
used yet is made on the spot with the machine's app settings — the model, the
voices — and none of its memories. There is no picker in the page yet and no
password anywhere: a player here is a save file, not an account.

The port is in neither place. It belongs to the run: 6969 unless `run.sh
--port` says otherwise, and everything handed out — the wifi addresses, the
phone's QR code — is built from the one actually bound, so the same people are
the same people on whatever port the machine is serving.

None of this is in git, but it is also the only copy of every conversation
anybody has had with this thing, so treat it the way you would treat a diary.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # the checkout

# The one root. LUCID_USERDATA moves it elsewhere — for a second instance that
# must not touch yours, or a test. Anything that reaches outside it has to
# honour it too, or it is not an isolation switch: a dev instance writing to a
# scratch root while still reading fixed addresses inside the checkout would be
# quietly working on somebody's real conversations.
ELSEWHERE = bool(os.environ.get("LUCID_USERDATA"))
USERDATA = Path(os.environ["LUCID_USERDATA"]) if ELSEWHERE else (ROOT / "userdata")

CERTS = USERDATA / "certs"                             # the machine's
CONFIG = USERDATA / "config.json"                      # the machine's
PLAYERS = USERDATA / "players"                         # and everybody else's

# The name a machine starts under, for somebody who never typed one.
# Deliberately the dumbest thing a game ever called you: it is a slot, not a
# character.
FIRST = "player1"

# The port, in one place and not in any config: it belongs to the run.
PORT = 6969

# Directory names, so: no separators, nothing hidden, nothing that means "up".
SHAPE = re.compile(r"[a-z0-9][a-z0-9._-]{0,31}$")


def named(raw: str | None) -> str:
    """The name as a directory can hold it, or a refusal to start."""
    who = (raw or FIRST).strip().lower()
    if not SHAPE.fullmatch(who):
        raise SystemExit(f"'{raw}' is not a name: letters, digits, - . _ , "
                         f"32 at most, and it has to start with a letter or "
                         f"a digit.")
    return who


def players(root: Path | None = None) -> list[str]:
    """Everybody this machine knows, which is everybody with a directory.

    No exceptions to write down and none to forget: the roster is a directory
    of its own, so the certificate and the machine's config are not in it and
    cannot be mistaken for somebody.

    `root` is the roster to read, and it is a parameter for the same reason
    the switch above exists: a check that makes people has to be able to make
    them somewhere that is not somebody's real one.
    """
    root = root or PLAYERS
    if not root.is_dir():
        return []
    return sorted(d.name for d in root.iterdir()
                  if d.is_dir() and not d.name.startswith("."))


def fold(src: Path, dst: Path):
    """Move one thing home, into whatever is already standing there.

    Directories merge; a file that would land on another is kept beside it
    instead. Nothing here is ever overwritten — a log an old instance wrote
    after this one had started its own is still that player's, and which of
    the two matters is not a question this can answer.
    """
    if not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
    elif src.is_dir() and dst.is_dir():
        for child in sorted(src.iterdir()):
            fold(child, dst / child.name)
        try:
            src.rmdir()
        except OSError:
            pass
    else:
        beside, n = dst.with_name(dst.name + ".strayed"), 1
        while beside.exists():
            n += 1
            beside = dst.with_name(f"{dst.name}.strayed{n}")
        src.rename(beside)


def strays(root: Path) -> list[Path]:
    """One player's things lying where the machine's are.

    From before there were players: an app's directory, the log, the scratch.
    Not the certificate and not config.json — those belong at this level and
    stay. The list is not only historical, either: an instance started before
    a checkout was updated keeps writing to the addresses it bound at import,
    and lays them down again beside the roster.
    """
    from .apps import INSTALLED
    theirs = {a.slug for a in INSTALLED} | {"log", "tmp"}
    if not root.is_dir():
        return []
    return [c for c in sorted(root.iterdir()) if c.is_dir() and c.name in theirs]


def settle(root: Path | None = None) -> bool:
    """Fold a userdata/ from before there were players into the first one.

    Everything one player had lying at the root moves under `players/player1`,
    where a player's things are now. The machine's — config.json, certs/ —
    were always the machine's and do not move, which is also why a certificate
    written down as a path keeps working. Runs at import, from wherever the
    program is entered.
    """
    root = root or USERDATA
    loose = strays(root)
    if not loose:
        return False
    for child in loose:
        fold(child, root / PLAYERS.name / FIRST / child.name)
    return True


def like_the_others(who: str, root: Path | None = None) -> Path | None:
    """Whose game settings a new player starts from: the first one, or anyone."""
    root = root or PLAYERS
    for name in [FIRST] + players(root):
        if name != who and any((root / name).glob("*/config.json")):
            return root / name
    return None


def welcome(who: str, root: Path | None = None) -> Path:
    """Make a player's directory if this is the first anybody has heard of them.

    They start with what is true of the machine and nothing that is true of
    anybody: one config.json per app — the model, the voices — copied from
    whoever is already here. Sessions, memory and standing are not copied, and
    there is nothing else to hand over. Not the certificate, which is the
    machine's and one level up; not the port, which is the run's.
    """
    root = root or PLAYERS
    who = named(who)
    mine = root / who
    if mine.is_dir():
        return mine
    mine.mkdir(parents=True, exist_ok=True)
    was = like_the_others(who, root)
    for app in sorted(d for d in (was.iterdir() if was else []) if d.is_dir()):
        if (app / "config.json").exists():
            (mine / app.name).mkdir(parents=True, exist_ok=True)
            (mine / app.name / "config.json").write_text(
                (app / "config.json").read_text())
    return mine


WHO = named(os.environ.get("LUCID_USER"))
MINE = PLAYERS / WHO                                   # this player, always

if not ELSEWHERE:
    settle()


def home(app: str) -> Path:
    """One app's private directory, named by its route. Made on demand."""
    d = MINE / app
    d.mkdir(parents=True, exist_ok=True)
    return d
