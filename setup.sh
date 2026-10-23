#!/bin/sh
# setup.sh — everything between a fresh clone and a game you can start.
#
#   ./setup.sh                 the environment, the models, the config
#   ./setup.sh --check         say what is missing and change nothing
#   ./setup.sh --models DIR    keep the models somewhere else (default ./models)
#   ./setup.sh --sizes md,lg   which sizes of the language model to fetch (default all three)
#   ./setup.sh --prune         and remove models a newer release no longer uses
#
# Safe to run twice, and expected to be: it skips what is already there, so an
# interrupted download is resumed by running it again rather than started over.
# Nothing here reaches outside this checkout and the models directory, and the
# only thing it writes into your own data is the five paths in step 4.
#
# It asks nothing and installs no system packages. What it needs — a Python and
# an internet connection for one afternoon — is checked first and reported all
# at once, because being told the third thing is missing after twenty minutes
# of download is the worst way to learn it.
set -e
cd "$(cd "$(dirname "$0")" && pwd)"

# Beside the code by default, because that is what makes this one directory
# you can move, copy or delete: the game, its models and your saves in the same
# place, and a config that says "models/llm" rather than somebody's home. An
# absolute path (or ~) sends them elsewhere -- a disk of their own, or the pile
# you already had before you met this -- and the config keeps it as given.
MODELS="models"
CHECK=""
while [ $# -gt 0 ]; do
    case "$1" in
        --check|-n)  CHECK=1; shift ;;
        --models)    MODELS="$2"; shift 2 ;;
        --models=*)  MODELS="${1#*=}"; shift ;;
        --sizes)     LLM_SIZES="$2"; shift 2 ;;
        --sizes=*)   LLM_SIZES="${1#*=}"; shift ;;
        --prune)     PRUNE=1; shift ;;
        -h|--help)   sed -n '2,11p' "$0" | cut -c3-; exit 0 ;;
        *)           echo "unknown option: $1 (--check, --models DIR, --sizes LIST, --prune)"; exit 1 ;;
    esac
done

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n%s\n' "$*" >&2; exit 1; }
MISSING=0
want() { printf '  %-22s %s\n' "$1" "$2"; }

# ---- 1. the machine --------------------------------------------------------
# Hard requirements, all reported before anything is done about any of them.
step "1. This machine"

ARCH="$(uname -m)"
want "processor" "$ARCH"
[ "$ARCH" = "arm64" ] || die "This needs an Apple Silicon Mac. The models run on
MLX, which is Apple's own framework — there is no Intel, Windows or Linux build
of this, and no amount of configuration will produce one."

OSV="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
want "macOS" "$OSV"
case "$OSV" in
    1[0-3].*) die "This needs macOS 14 or later. You have $OSV." ;;
esac

RAM="$(( $(sysctl -n hw.memsize) / 1073741824 ))"
# Which size of the language model this Mac gets by default. Measured on the
# app's own meter, the large one holds about 23 GB mid-reply with the voice
# and the ear beside it, the middle one about 12, the small one about 8; macOS
# wants the rest. All three are fetched -- see LLM_SIZES -- and this is only
# which one is written into the config, which the console can change.
# The same rule is machine/shelf.py's pick(), which the first-open card in a
# room suggests a size by; change both.
if [ "$RAM" -ge 32 ]; then PICK=lg
elif [ "$RAM" -ge 16 ]; then PICK=md
else PICK=sm
fi
want "memory" "$RAM GB — the $PICK model by default"
if [ "$RAM" -lt 32 ]; then
    say "  ^ 32 GB is what the large model wants. This Mac starts on the $PICK;"
    say "    the large one is on the shelf, and the console switches (ai_model_size)."
fi

FREE="$(df -g . | tail -1 | awk '{print $4}')"
want "free disk" "$FREE GB"
[ "$FREE" -ge 40 ] || die "About 40 GB is needed for the models and the virtual
environment. There is $FREE GB free on this volume."

# The interpreter, chosen the way run.sh chooses one, except that here it may
# not exist yet. uv is not required and is much the fastest way to get 3.14.
PY=""
if command -v uv >/dev/null 2>&1; then
    PY="uv"
    want "python" "uv $(uv --version 2>/dev/null | awk '{print $2}')"
else
    for cand in python3.14 python3.13 python3.12 python3; do
        if command -v "$cand" >/dev/null 2>&1 \
           && "$cand" -c 'import sys; raise SystemExit(0 if (3, 12) <= sys.version_info[:2] <= (3, 14) else 1)'; then
            PY="$cand"
            want "python" "$("$cand" -V 2>&1)"
            break
        fi
    done
fi
if [ -z "$PY" ]; then
    want "python" "3.12-3.14 not found"
    MISSING=1
    say ""
    say "  Python 3.14 is the one this is built against. The quickest way:"
    say ""
    say "      curl -LsSf https://astral.sh/uv/install.sh | sh"
    say ""
    say "  which installs uv, and uv fetches the interpreter itself. Or use"
    say "  python.org's -- not Homebrew's 3.14, which takes half a minute to"
    say "  name 127.0.0.1 and so to start the language model. Then run this"
    say "  again."
fi

[ "$MISSING" = 0 ] || die "Nothing was changed."

# ---- 2. the environment ----------------------------------------------------
step "2. Python environment"

if [ -x ".venv/bin/python" ]; then
    want ".venv" "already here"
elif [ -n "$CHECK" ]; then
    want ".venv" "would be made"
else
    want ".venv" "making it"
    if [ "$PY" = "uv" ]; then
        uv venv --python 3.14 --managed-python .venv
    else
        "$PY" -m venv .venv
    fi
fi

# mlx is the one worth asking about: it is the floor of everything else here,
# and its absence is what "installed" and "not installed" really means.
if [ -x ".venv/bin/python" ] && .venv/bin/python -c "import mlx.core" 2>/dev/null; then
    want "packages" "already installed"
elif [ -n "$CHECK" ]; then
    want "packages" "would be installed from requirements.txt"
else
    want "packages" "installing — a few minutes"
    if [ "$PY" = "uv" ]; then
        uv pip install --python .venv/bin/python -r requirements.txt
    else
        .venv/bin/python -m pip install --upgrade pip >/dev/null
        .venv/bin/python -m pip install -r requirements.txt
    fi
fi

# ---- 3. the models ---------------------------------------------------------
# Five checkouts, and they are the download. None of them is gated and none
# of them needs an account: they are Apache-2.0 and CC-BY-4.0, and they come
# down anonymously. If you point llm.model at something that *is* gated,
# Hugging Face will refuse with a 401 until you have accepted its terms on the
# model's page and logged in with `huggingface-cli login`. That is between you
# and whoever published it.
case "$MODELS" in
    /*) WHERE="$MODELS" ;;
    ~*) WHERE="$HOME${MODELS#\~}" ;;
    *)  WHERE="$PWD/$MODELS" ;;
esac
step "3. Models — about 31 GB into $MODELS"

# What is fetched is machine/models.json: every model the machine runs, by
# the repository it is checked out from, pinned to a commit. Each lands at
# $MODELS/<org>/<repo> exactly as published and is never changed -- see
# machine/shelf.py, which does the asking and the fetching, and which the
# machine reads the same file through. So a newer release of the game that
# brings a newer model edits that one file: this step then finds a checkout
# missing or at another commit and fetches it, and says what is on the shelf
# that nothing names any more, which --prune removes.
#
# The language model comes in three sizes and all three are fetched, so a Mac
# can be switched between them from the console; which one starts is decided
# above, by memory. `lg` is the one the game was written against. The other
# two were measured against it on real sessions (2026-09): the middle one
# writes nearly as well and answers in under a second; the small one loses
# the character and is for proving the machine runs on a small Mac.
LLM_SIZES="${LLM_SIZES:-sm,md,lg}"
if [ ! -x ".venv/bin/python" ]; then
    # --check on a machine where step 2 has not run yet: nothing here can
    # read the manifest, and the most that can be said is what is on disk.
    want "models" "cannot be checked before step 2 has made .venv"
elif [ -n "$CHECK" ]; then
    .venv/bin/python -m machine.shelf --check --models "$WHERE" --sizes "$LLM_SIZES"
else
    .venv/bin/python -m machine.shelf --fetch --models "$WHERE" --sizes "$LLM_SIZES" \
        ${PRUNE:+--prune} || die "A download did not finish.

If it stopped on a 401 or 403, the model is gated: open its page on Hugging
Face, accept the terms, run .venv/bin/huggingface-cli login, and run this
again. Anything else — run this again; it resumes."
fi

# The voice model asks the hub for its own tokenizer the first time it speaks,
# and run.sh runs with HF_HUB_OFFLINE=1 -- so unless it is in the cache before
# then, the first thing a pill tries to say fails with the network switched
# off. Fetched here, into the shared Hugging Face cache rather than models/,
# because that is where the loader looks for it.
if [ -n "$CHECK" ]; then
    want "S3TokenizerV2" "would fetch ~470 MB into the Hugging Face cache"
else
    want "S3TokenizerV2" "the voice tokenizer, ~470 MB"
    .venv/bin/python - <<'PY' || die "The voice tokenizer did not download.

Run this again -- it resumes. Until it is in the cache the first spoken reply
fails, because run.sh runs with the network switched off."
from huggingface_hub import snapshot_download

snapshot_download("mlx-community/S3TokenizerV2")
PY
fi

# The voices, which are not in git and are not meant to be. A reference clip is
# six seconds of somebody's actual speech and the one thing here that cannot be
# taken back once it is published -- so they live in a dataset of their own,
# where they can be replaced or withdrawn without the code repository being
# involved, and a clip offered in a pull request has nowhere to land.
#
# They land on the shelf: models/voices/<name>.wav, beside the weights, because
# that is what a clip is -- a model asset, fetched with the models and named by
# one word. Nothing about it belongs to any game: `GET /machine/voices` lists
# the names, a persona says which of them it speaks in, and two games may name
# the same one. See machine/voices.py.
#
# The pack lands on the shelf exactly as it is published, at a revision
# named here rather than whatever is latest: a clip inside a folder is a
# voice named by that folder (`lucid_talk/personas/lover/voice.ref.wav`
# answers to `lucid_talk/personas/lover`), so nothing is renamed and nothing
# is copied. The downloader keeps its own bookkeeping in a dot-folder the
# resolver does not look in. Pinned, so that a pack changed later reaches
# nobody who did not ask for it. See machine/voices.py.
VOICES="excelsior-arts/lucid-voices"
VOICES_REV="def88d4ccd5fec4b18bb72b0304b781152a62aba"
if [ -n "$CHECK" ]; then
    # The shelf itself, by name, because that is the question somebody running
    # --check about a silent pill actually has: a persona names a voice, and
    # this is the list the name has to be in.
    SHELF="$(cd "$WHERE/voices" 2>/dev/null && find . -not -path '*/.*' \
        \( -name voice.ref.wav -o -name '*.wav' \) 2>/dev/null | sed \
        -e 's#^\./##' -e 's#/voice\.ref\.wav$##' -e 's#\.wav$##' | sort | tr '\n' ' ')"
    if [ -n "$SHELF" ]; then
        want "voices" "on the shelf: $SHELF"
    else
        want "voices" "would fetch the reference clips"
    fi
else
    want "voices" "the reference clips"
    .venv/bin/python - "$VOICES" "$VOICES_REV" "$WHERE/voices" <<'PY' || die "The voices did not download.

Run this again -- it resumes. Without them the models are all here and the
first thing a character tries to say fails, because the voice is cloned from a
clip that is not there."
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

repo, rev, shelf = sys.argv[1], sys.argv[2], Path(sys.argv[3])
shelf.mkdir(parents=True, exist_ok=True)
got = Path(snapshot_download(repo, repo_type="dataset", revision=rev, local_dir=str(shelf)))

placed = []
for src in sorted(got.rglob("*.wav")):
    rel = src.relative_to(got)
    if any(part.startswith(".") for part in rel.parts):
        continue          # the downloader's own bookkeeping, not a voice
    name = "/".join(rel.parts[:-1]) if src.name == "voice.ref.wav" else str(rel)[:-4]
    placed.append(name)
if not placed:
    raise SystemExit("nothing in the pack is a voice")
print(f"  {'':22} on the shelf: {', '.join(sorted(set(placed)))}")
PY
fi

say ""
say "  After this it needs no network at all, ever."

# ---- 4. the config ---------------------------------------------------------
# Three settings into the machine's config, and nothing else touched: it is
# your file, and it may well have tuning in it that this knows nothing about.
# Which size of the language model to start on, where the shelf is if it is
# not the default, and which environment serves the model. No model path:
# which repository plays which part is machine/models.json, and a path
# written here would be a path a newer release leaves stale.
#
# A setting already written is left exactly as it is. Somebody who chose a
# size, or keeps their models elsewhere, has answered this question already
# and does not need it answered again by a script they ran to fix something
# else.
step "4. The config"

if [ -n "$CHECK" ]; then
    want "config" "would write the size ($PICK), the shelf, the environment"
else
    .venv/bin/python - "$MODELS" "$PICK" <<'PY'
import json
import pathlib
import sys

from machine import config as C
from machine import paths as P

models = sys.argv[1].rstrip("/")          # as given: the app reads it the same way
pick = sys.argv[2] if len(sys.argv) > 2 else "lg"
p = P.CONFIG
p.parent.mkdir(parents=True, exist_ok=True)
cfg = json.loads(p.read_text()) if p.exists() else {}


def fill(section, key, value, on_disk=False):
    """Write it if nothing is there, or if what is there has gone."""
    was = cfg.setdefault(section, {}).get(key) or ""
    if was and (not on_disk or pathlib.Path(C.somewhere(was)).exists()):
        print(f"  {section + '.' + key:22} kept: {was}")
        return
    cfg[section][key] = value
    print(f"  {section + '.' + key:22} {value}")


fill("llm", "size", pick)
fill("llm", "venv", ".venv/bin", on_disk=True)
# The shelf, only when it is not where the machine looks anyway: a default
# written down is a default that stops following the code.
if models != "models" or (cfg.get("models") or {}).get("dir"):
    fill("models", "dir", models, on_disk=True)
# Paths an older setup wrote for the models are the manifest's job now, and
# left in place they would point at directories that have moved.
shelf = C.somewhere(models)
for section in ("llm", "stt", "tts"):
    was = str((cfg.get(section) or {}).get("model") or "")
    if section in cfg and "model" in cfg[section] and (
            not was or was.startswith(("models/", shelf))):
        del cfg[section]["model"]
        print(f"  {section + '.model':22} dropped: the manifest names it now")
was = str((cfg.get("voices") or {}).get("path") or "")
if "voices" in cfg and "path" in cfg["voices"] and (
        not was or was in ("models/voices", f"{models}/voices", f"{shelf}/voices")):
    del cfg["voices"]["path"]
    print(f"  {'voices.path':22} dropped: beside the models, as before")
p.write_text(json.dumps(cfg, indent=2) + "\n")
PY
fi

# ---- 5. the page -----------------------------------------------------------
# Everything the browser runs is built from app/ into app/dist, and the server
# serves whatever it finds there. Node is needed for that and for nothing else
# -- no model, no conversation and no file of yours goes near it -- so a
# machine without one still runs, and says at every address what is missing and
# how to get it. Said plainly here rather than skipped in silence, because "the
# page is not there" is otherwise a mystery with nothing to explain it.
step "5. The page"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    want "app" "no node — nothing to serve a browser"
    say "  ^ Install Node 24 or later and run this again to build the page."
elif [ -n "$CHECK" ]; then
    want "app" "would build app/ — npm ci && npm run build"
else
    want "app" "building — a minute"
    (cd app && npm ci && npm run build) >/dev/null \
        || die "The page did not build.

Run it by hand to see why:  cd app && npm ci && npm run build
Everything else here is done; until it builds, every address answers with a
page saying so."
fi

# ---- 6. and does it hold together ------------------------------------------
step "6. Checking"

if [ -n "$CHECK" ]; then
    say "  (not run: --check changes nothing)"
    say ""
    say "Run ./setup.sh to do all of the above."
    exit 0
fi

if ./check.sh >/dev/null 2>&1; then
    want "tests" "pass"
else
    want "tests" "something failed"
    die "Everything above is installed, and the program's own checks do not
pass on it. Run ./check.sh to see which of them. Nothing below this was said,
because a setup that reports success over a failing suite is one nobody can
believe the next time it reports it."
fi

say ""
say "Done. Start it with:"
say ""
say "    ./run.sh"
say ""
say "It prints a box with an address in it. Open the one marked 'this Mac'."
