"""Where everything of yours lives.

    userdata/
      config.json           the certificate to serve on, and whether the wifi
                            address is offered at all -- the machine's, and
                            the same whoever is playing
      certs/                the TLS keys that let a phone reach this
      players/              one directory per player; the count is the roster
        player1/
          log/                what the console said
          lucid-talk/         one directory per game, named by its slug, and
                              laid out however that game names its paths --
                              see machine/store.py, which reads them and knows
                              what none of them hold
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
give it a directory under a game's `home()` and add nothing to .gitignore.

---- the machine, and the people on it --------------------------------------

Two levels, and the split is the point. The certificate and whether the phone
is offered are the computer's: one answer, however many people play. Everything
below `players/` is one player's — everything they have done with everything
installed — and touches nobody else's.

A player is a directory name and that is the whole of the mechanism.
`LUCID_USER` picks which, `run.sh --user pete` sets it, and a name nobody has
used yet is made on the spot, empty: what is the machine's is the machine's,
and nothing of anybody else's is theirs. There is no picker in the page yet and
no password anywhere: a player here is a save file, not an account.

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


# What belongs at the root of userdata/ rather than to anybody: the roster
# itself, and the keys that let a phone reach this. config.json is a file and
# is never in this question.
THE_MACHINE_S = {"players", "certs"}


def strays(root: Path) -> list[Path]:
    """One player's things lying where the machine's are.

    From before there were players: a game's directory, the log, the scratch.
    Not the certificate and not config.json — those belong at this level and
    stay. The list is not only historical, either: an instance started before
    a checkout was updated keeps writing to the addresses it bound at import,
    and lays them down again beside the roster.

    Named by what belongs here rather than by what does not: a game is a slug
    in an address and a directory under a player, and there is no list of them
    anywhere. So a stray is anything at this level that is not one of the two
    things that do belong, which is also the answer that stays right when
    somebody invents a third kind of directory under a player.
    """
    if not root.is_dir():
        return []
    return [c for c in sorted(root.iterdir())
            if c.is_dir() and c.name not in THE_MACHINE_S]


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


def welcome(who: str, root: Path | None = None) -> Path:
    """Make a player's directory if this is the first anybody has heard of them.

    An empty one, and that is the whole of it. It used to copy one config.json
    per game across from whoever was already here, because those files carried
    the machine's own settings — the model, the voices — and a new player
    should not have to find them again. They do not any more: what is the
    machine's is one level up in `userdata/config.json`, and what is left in a
    game's own file is only what that player has changed about that game.
    Handing somebody else's answer to a stranger is worse than handing them the
    game's, which is what an absent file already means.

    Not the certificate, which is the machine's and one level up; not the port,
    which is the run's.
    """
    root = root or PLAYERS
    who = named(who)
    mine = root / who
    mine.mkdir(parents=True, exist_ok=True)
    return mine


WHO = named(os.environ.get("LUCID_USER"))
MINE = PLAYERS / WHO                                   # this player, always

# Scratch, and the one thing in it anybody ever reads: what the language model
# said on its way to not starting. The machine's rather than a game's, because
# the model is -- one of it, however many games are on the shelf.
TMP = MINE / "tmp"
LLM_LOG = TMP / "llm.log"

if not ELSEWHERE:
    settle()


def home(game: str) -> Path:
    """One game's private directory, named by its slug. Made on demand."""
    d = MINE / game
    d.mkdir(parents=True, exist_ok=True)
    return d
