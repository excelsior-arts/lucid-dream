#!/bin/sh
# setup.sh — everything between a fresh clone and a game you can start.
#
#   ./setup.sh                 the environment, the models, the config
#   ./setup.sh --check         say what is missing and change nothing
#   ./setup.sh --models DIR    keep the models somewhere else (default ./models)
#
# Safe to run twice, and expected to be: it skips what is already there, so an
# interrupted download is resumed by running it again rather than started over.
# Nothing here reaches outside this checkout and the models directory, and the
# only thing it writes into your own data is the four paths in step 4.
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
        -h|--help)   sed -n '2,9p' "$0" | cut -c3-; exit 0 ;;
        *)           echo "unknown option: $1 (--check, --models DIR)"; exit 1 ;;
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
want "memory" "$RAM GB"
if [ "$RAM" -lt 32 ]; then
    say "  ^ 32 GB is the floor. Measured on the app's own meter, the default"
    say "    set holds about 23 GB mid-reply, and macOS wants the rest of it."
    say "    It will run, and it will swap."
fi

FREE="$(df -g . | tail -1 | awk '{print $4}')"
want "free disk" "$FREE GB"
[ "$FREE" -ge 30 ] || die "About 30 GB is needed for the models and the virtual
environment. There is $FREE GB free on this volume."

# The interpreter, chosen the way run.sh chooses one, except that here it may
# not exist yet. uv is not required and is much the fastest way to get 3.12.
PY=""
if command -v uv >/dev/null 2>&1; then
    PY="uv"
    want "python" "uv $(uv --version 2>/dev/null | awk '{print $2}')"
else
    for cand in python3.12 python3; do
        if command -v "$cand" >/dev/null 2>&1 \
           && "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)'; then
            PY="$cand"
            want "python" "$("$cand" -V 2>&1)"
            break
        fi
    done
fi
if [ -z "$PY" ]; then
    want "python" "3.12 not found"
    MISSING=1
    say ""
    say "  Python 3.12 is the one this is built against. The quickest way:"
    say ""
    say "      curl -LsSf https://astral.sh/uv/install.sh | sh"
    say ""
    say "  which installs uv, and uv fetches the interpreter itself. Or use"
    say "  Homebrew (brew install python@3.12), or python.org. Then run this"
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
        uv venv --python 3.12 .venv
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
# Three, and they are the download. None of them is gated and none of them
# needs an account: they are Apache-2.0 and CC-BY-4.0, and they come down
# anonymously. If you point llm.model at something that *is* gated -- several
# of the uncensored community models are -- Hugging Face will refuse with a 401
# until you have accepted its terms on the model's page and logged in with
# `huggingface-cli login`. That is between you and whoever published it.
case "$MODELS" in
    /*) WHERE="$MODELS" ;;
    ~*) WHERE="$HOME${MODELS#\~}" ;;
    *)  WHERE="$PWD/$MODELS" ;;
esac
step "3. Models — about 21 GB into $MODELS"

# repo : directory : GB : the part of the repo to take, if not all of it.
#
# That fourth field is not decoration. The language model is published as one
# repository holding every quantization of itself -- 2, 4, 6 and 8-bit, and a
# full copy at the root -- so asking for the whole thing fetches about 95 GB to
# use 16 of it. We want the 4-bit and nothing else.
#
# The same model is also published by the mlx-community org, which would be a
# safer place for a default to point at than one person's account:
#
#   mlx-community/Qwen3.8-27B-Uncensored-OptiQ-4bit:llm:19.8:
#
# It is here as a fallback and not as the default, because it was tried: the
# mixed-precision quantization reads 26.5 GB on the app's own meter, carries
# 3.3 GB more weights than the one above, and writes closely enough that
# nobody could tell them apart. Worth swapping to only if that repo goes.
MODEL_LIST="orcarouter/Qwen3.8-27B-Uncensored-MLX:llm:16.1:4-bit
mlx-community/parakeet-tdt-0.6b-v2:parakeet-tdt-0.6b-v2:2.5:
mlx-community/chatterbox-turbo-fp16:Chatterbox-Turbo-fp16:2.8:"

for entry in $MODEL_LIST; do
    repo="${entry%%:*}"; rest="${entry#*:}"
    dir="${rest%%:*}"; rest="${rest#*:}"
    size="${rest%%:*}"; sub="${rest#*:}"
    [ "$sub" = "$size" ] && sub=""
    # The config in step 4 has to name the same place the weights landed.
    [ "$dir" = "llm" ] && LLM_SUB="$sub"
    if [ -d "$WHERE/$dir" ] && [ -n "$(find "$WHERE/$dir" -name '*.safetensors' -print -quit 2>/dev/null)" ]; then
        want "$dir" "already here"
    elif [ -n "$CHECK" ]; then
        want "$dir" "would download ~$size GB"
    else
        want "$dir" "downloading ~$size GB"
        .venv/bin/python - "$repo" "$WHERE/$dir" "$sub" <<'PY' || die "That download did not finish.

If it stopped on a 401 or 403, the model is gated: open its page on Hugging
Face, accept the terms, run .venv/bin/huggingface-cli login, and run this
again. Anything else — run this again; it resumes."
import sys
from huggingface_hub import snapshot_download

sub = sys.argv[3] if len(sys.argv) > 3 else ""
snapshot_download(sys.argv[1], local_dir=sys.argv[2],
                  allow_patterns=[f"{sub}/*"] if sub else None)
PY
    fi
done

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
# The pack mirrors this checkout path for path, so laying it over is the whole
# of the operation: whatever is in it goes where it already says it goes, and
# nothing here needs to know the shape of a game's directories. A file whose
# destination does not exist belongs to something this checkout has not got --
# another game, or a part of one -- and is named rather than dropped quietly.
VOICES="excelsior-arts/lucid-voices"
if [ -n "$CHECK" ]; then
    want "voices" "would fetch the reference clips"
else
    want "voices" "the reference clips"
    .venv/bin/python - "$VOICES" "$WHERE/voices" "$PWD" <<'PY' || die "The voices did not download.

Run this again -- it resumes. Without them the models are all here and the
first thing a pill tries to say fails, because the voice is cloned from a clip
that is not there."
import shutil
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

repo, into, root = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
got = Path(snapshot_download(repo, repo_type="dataset", local_dir=str(into)))

# The pack's own paperwork, and the metadata the downloader leaves beside it.
OWN = {"README.md", ".gitattributes", ".gitignore"}

placed, elsewhere = 0, []
for src in sorted(got.rglob("*")):
    if not src.is_file():
        continue
    rel = src.relative_to(got)
    if rel.parts[0] == ".cache" or (len(rel.parts) == 1 and rel.name in OWN):
        continue
    dst = root / rel
    if dst.parent.is_dir():
        shutil.copyfile(src, dst)
        placed += 1
    else:
        elsewhere.append(rel)
for rel in elsewhere:
    print(f"  {'':22} not for this checkout: {rel}")
if not placed:
    raise SystemExit("nothing in the pack belongs to this checkout")
PY
fi

say ""
say "  After this it needs no network at all, ever."

# ---- 4. the config ---------------------------------------------------------
# Four paths into the machine's config, and nothing else touched: it is your
# file, and it may well have tuning in it that this knows nothing about. The
# machine's, because one model, one recognizer and one voice serve every game
# on the shelf -- nobody has the memory for two, and nobody wants to set them
# up twice.
#
# A path already written and still pointing at something real is left exactly
# as it is. Somebody who keeps their models elsewhere, or runs the app from a
# venv of their own, has answered this question already and does not need it
# answered again by a script they ran to fix something else.
step "4. Where the models are"

if [ -n "$CHECK" ]; then
    want "config" "would write the four model paths"
else
    .venv/bin/python - "$MODELS" "$LLM_SUB" <<'PY'
import json
import pathlib
import sys

from shell import config as C
from shell import paths as P

models = sys.argv[1].rstrip("/")          # as given: the app reads it the same way
llm_sub = (sys.argv[2] if len(sys.argv) > 2 else "").strip("/")
llm_dir = f"{models}/llm/{llm_sub}" if llm_sub else f"{models}/llm"
p = P.CONFIG
p.parent.mkdir(parents=True, exist_ok=True)
cfg = json.loads(p.read_text()) if p.exists() else {}


def fill(section, key, value):
    """Write it if nothing is there, or if what is there has gone."""
    was = cfg.setdefault(section, {}).get(key) or ""
    if was and pathlib.Path(C.somewhere(was)).exists():
        print(f"  {section + '.' + key:22} kept: {was}")
        return
    cfg[section][key] = value
    print(f"  {section + '.' + key:22} {value}")


fill("llm", "model", llm_dir)
fill("llm", "venv", ".venv/bin")
fill("stt", "model", f"{models}/parakeet-tdt-0.6b-v2")
fill("tts", "model", f"{models}/Chatterbox-Turbo-fp16")
p.write_text(json.dumps(cfg, indent=2) + "\n")
PY
fi

# ---- 5. and does it hold together ------------------------------------------
step "5. Checking"

if [ -n "$CHECK" ]; then
    say "  (not run: --check changes nothing)"
    say ""
    say "Run ./setup.sh to do all of the above."
    exit 0
fi

if ./check.sh >/dev/null 2>&1; then
    want "tests" "pass"
else
    want "tests" "something failed — ./check.sh says what"
fi

say ""
say "Done. Start it with:"
say ""
say "    ./run.sh"
say ""
say "It prints a box with an address in it. Open the one marked 'this Mac'."
