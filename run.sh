#!/bin/sh
# Lucid Dream — the shell, and the apps it opens. http://127.0.0.1:6969
#
#   ./run.sh                     you, on your own wifi address
#   ./run.sh --user pete         somebody else: their own conversations,
#                                nothing of yours
#   ./run.sh --port 6970         serve on that port instead
#   ./run.sh --no-phone          loopback only
#
# A player is a directory under userdata/players/ and nothing else — no
# account, no password. A name nobody has used yet is made on the spot, starting from this
# machine's settings and none of anybody's memories. Without --user you are
# "player1", which is what a fresh machine calls whoever never typed a name.
# See shell/paths.py.
#
# The port belongs to the run and is written down nowhere: 6969 unless --port
# says otherwise, and everything handed out — the wifi addresses, the phone's
# QR code — is built from the one actually bound. One of these at a time is
# the ordinary way to run it; each instance loads its own language model and
# its own voice, so two at once is a question about memory.
#
# The phone is where this actually gets used, so the wifi address is on by
# default: tools/lan_bridge.py runs alongside the app, because the firewall
# only lets /usr/bin/python3 accept incoming connections (see MANUAL).
# Ctrl-C stops both. There is no password on either — anyone on the network
# who finds the port can read the conversations, so --no-phone, or
# "phone": false in config.json, is there for when you are not on yours.
set -e
# Everything is already on disk, but the TTS loader still contacts Hugging
# Face on every start to revalidate its cached tokenizer. Nothing about this
# app should need the network at runtime, so it is told there is none.
#
# That relies on setup.sh having fetched the tokenizer as well as the three
# models, which it does. Unset HF_HUB_OFFLINE when pointing any of them at
# something not downloaded yet, or the first thing reaching for it fails with
# the network switched off rather than with a missing file.
export HF_HUB_OFFLINE=1
export HF_HUB_DISABLE_PROGRESS_BARS=1
export HF_HUB_DISABLE_TELEMETRY=1
export TOKENIZERS_PARALLELISM=false
# chatterbox-turbo draws a token progress bar per sentence regardless of
# verbose=False, which buries the app's own log
export TQDM_DISABLE=1
# Wherever this checkout happens to be; nothing here assumes a path.
cd "$(cd "$(dirname "$0")" && pwd)"

PHONE=1
while [ $# -gt 0 ]; do
    case "$1" in
        --user|-u)  export LUCID_USER="$2"; shift 2 ;;
        --user=*)   export LUCID_USER="${1#*=}"; shift ;;
        --port|-p)  export LUCID_PORT="$2"; shift 2 ;;
        --port=*)   export LUCID_PORT="${1#*=}"; shift ;;
        --no-phone) PHONE=""; PHONESAID=1; shift ;;
        --phone)    PHONE=1; PHONESAID=1; shift ;;
        -h|--help)  sed -n '2,17p' "$0" | cut -c3-; exit 0 ;;
        *)          echo "unknown option: $1 (--user, --port, --no-phone)"; exit 1 ;;
    esac
done

# One read of the machine's config for the three things this script needs,
# through shell/paths.py rather than a fixed path -- and a name nobody has used
# yet is made here, before anything looks for their directory.
SETTINGS="$(python3 - <<'EOF'
import json
import os

from shell import paths as P

mine = P.welcome(P.WHO)


def read(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


cfg = read(P.CONFIG)
print('WHO="%s"' % P.WHO)
print('PORT="%s"' % (os.environ.get("LUCID_PORT") or P.PORT))
print('PHONEOFF="%s"' % ("1" if cfg.get("phone") is False else ""))
# The interpreter belongs to the machine as well: one stack, and one
# environment that serves it, whichever game is opened. (No apostrophes in
# here: this heredoc sits inside a command substitution, where a lone quote
# breaks the parse of the whole script.)
print('VENV="%s"' % ((cfg.get("llm") or {}).get("venv") or ""))
EOF
)" || exit 1                            # a name a directory cannot hold, say
eval "$SETTINGS"
PORT="${PORT:-6969}"

# The interpreter, in one place: llm.venv from the app's config, a .venv in the
# checkout, or whatever python3 is on PATH. The app launches the language
# model from llm.venv as a child process, so the same environment should run
# the app itself -- two paths to keep in step was one too many.
PY=""
for cand in "$VENV/python" "./.venv/bin/python" "$(command -v python3)"; do
    if [ -x "$cand" ]; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
    echo "no Python found. Set llm.venv in config.json to the directory"
    echo "holding mlx_vlm.server (see AGENTS.md), or make a .venv here."
    exit 1
fi
export PATH="$(cd "$(dirname "$PY")" && pwd):$PATH"

# Nothing said on the command line: whatever the machine's config says.
if [ -z "$PHONESAID" ] && [ -n "$PHONEOFF" ]; then
    PHONE=""
fi

# Some ports a browser will not open whatever is listening on them: they are
# the ones other protocols took first, and the refusal ("unsafe port", "this
# address is restricted") never mentions the port. The server is fine, curl
# gets a page, and the browser looks broken -- so say it here instead.
case " 2049 3659 4045 4190 5060 5061 6000 6566 6665 6666 6667 6668 6669 6697 10080 " in
    *" $PORT "*)
        echo "warning: browsers refuse port $PORT -- it belongs to another"
        echo "protocol, and they block it whatever is serving there. The page"
        echo "will not open. Try:  ./run.sh --port $((PORT + 4))"
        echo "" ;;
esac

# An instance already holding the port is the usual reason a start "succeeds"
# and then nothing works. Say so instead of failing three lines later.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $PORT is already in use — another Lucid Talk is running."
    echo "stop it first:  lsof -ti:$PORT | xargs kill"
    echo "or serve this one somewhere else:  ./run.sh --port $((PORT + 1))"
    exit 1
fi

# The page shows a "play on your phone" control only when a phone could
# actually reach us. The flag lives out here, so it has to be handed in.
[ -n "$PHONE" ] || export LUCID_PHONE=0

"$PY" -u -m shell &
APP=$!
trap 'kill $APP $BRIDGE 2>/dev/null' EXIT INT TERM

if [ -n "$PHONE" ]; then
    # Start the bridge only once the app is actually serving, or its banner
    # advertises a URL that forwards to nothing.
    i=0
    while [ $i -lt 60 ]; do
        if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
        if ! kill -0 $APP 2>/dev/null; then echo "app exited before it started serving."; exit 1; fi
        i=$((i + 1))
        sleep 0.5
    done
    if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "app never bound $PORT — not starting the bridge."
        exit 1
    fi
    # -u for the same reason as the app: buffered stdout swallows the banner
    /usr/bin/python3 -u tools/lan_bridge.py "$PORT" &
    BRIDGE=$!
fi

wait $APP
