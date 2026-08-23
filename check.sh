#!/bin/sh
# The checks.
#
#   ./check.sh              everything there is
#   ./check.sh relation     one module of the fast suite, matched by name
#   ./check.sh rooms        only the browser ones
#
# Two tiers, and the split is deliberate.
#
# The fast suite is Python, needs nothing installed, touches no model and no
# device, runs against a throwaway userdata/ directory and finishes in a fifth
# of a second — so it can be run before every commit rather than when
# something has already gone wrong.
#
# The other one needs a real browser and a running server, because what it
# checks cannot be faked: whether the page comes up at all, and whether
# everything in a room can still actually be pressed. The second is a question
# about perspective, about what is in front of what, and about a page projected
# onto a plane with CSS — none of which has an answer outside a browser that has
# actually drawn it. The first has no answer outside one either: the deck is
# drawn by the same script that would have failed, so a page that throws on the
# way up shows a room with a dead panel in it and says nothing anywhere a
# person would look. Both run when they can and say so when they cannot.
#
# The live scripts under tests/live/ talk to a running server *and* the models,
# and take minutes. They are run by hand.
set -e
cd "$(cd "$(dirname "$0")" && pwd)"

# The same interpreter the app runs on, chosen the same way run.sh chooses it:
# the tests import the app, so they need what the app imports.
VENV="$(python3 -c 'import json
from shell import paths as P
print((json.loads(P.CONFIG.read_text()).get("llm") or {}).get("venv") or "")' 2>/dev/null || true)"
PY=""
for cand in "$VENV/python" "./.venv/bin/python" "$(command -v python3)"; do
    if [ -x "$cand" ]; then PY="$cand"; break; fi
done

FAILED=0

if [ "$1" != "rooms" ] && [ "$1" != "reach" ]; then
    if [ -n "$1" ]; then
        "$PY" -m unittest discover -s tests -t . -p "test_*$1*.py" -v || FAILED=1
    else
        "$PY" -m unittest discover -s tests -t . -v || FAILED=1
    fi
fi

# ---- and the rooms, if there is a browser and something to look at ----------
#
# Minutes rather than seconds: three scripts, each launching a browser, drawing
# both rooms at six sizes. Worth it when a page has changed and waste every
# other time -- so the pages are fingerprinted, and a run that passes writes
# the fingerprint down. Unchanged since the last clean run, this is skipped.
# `./check.sh rooms` asks for it anyway, which is what to do when the doubt is
# about the browser rather than the page.
pages_now() {
    find */static lucid_talk/personas -type f \
         \( -name '*.html' -o -name '*.js' -o -name '*.css' \) 2>/dev/null \
        | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1
}
STAMP="userdata/rooms-checked"

if [ -z "$1" ] || [ "$1" = "rooms" ] || [ "$1" = "reach" ]; then
    NOW="$(pages_now)"
    WAS=""
    [ -f "$STAMP" ] && WAS="$(cat "$STAMP")"
    if [ -z "$1" ] && [ -n "$NOW" ] && [ "$NOW" = "$WAS" ]; then
        echo ""
        echo "rooms:"
        echo "  (not checked: no page has changed since the last clean run —"
        echo "   ./check.sh rooms to look anyway)"
        exit $FAILED
    fi
    PORT="${LUCID_PORT:-$(python3 -c 'from shell import paths as P; print(P.PORT)' \
                           2>/dev/null || echo 6969)}"
    # https only if this machine has a certificate — the usual case is http,
    # since one is only needed to let a phone hear you. Whichever the config
    # says is tried first and the other after it, because the instance that is
    # up need not be the one this config would start.
    FIRST="$("$PY" -c 'from shell import config as C; print(C.scheme())' \
             2>/dev/null || echo http)"
    [ "$FIRST" = https ] && SECOND=http || SECOND=https
    URL=""
    for scheme in "$FIRST" "$SECOND"; do
        if curl -sk -m 3 -o /dev/null "$scheme://127.0.0.1:$PORT/"; then
            URL="$scheme://127.0.0.1:$PORT"
            break
        fi
    done
    # Asked once, here, rather than three times by the three scripts, and
    # asked by the same code they resolve it with -- tools/browsers.mjs, which
    # takes a directory or a file and will find a global install on its own.
    PW=1
    if command -v node >/dev/null 2>&1; then
        node -e 'import("./tools/browsers.mjs")
                   .then(m => m.playwright())
                   .then(pw => process.exit(pw ? 0 : 1))
                   .catch(() => process.exit(1))' 2>/dev/null || PW=""
    fi

    echo ""
    echo "rooms:"
    if ! command -v node >/dev/null 2>&1; then
        echo "  (not checked: no node)"
    elif [ -z "$PW" ]; then
        echo "  (not checked: no playwright — it drives a real browser, and the"
        echo "   rooms are the half of this that cannot be checked without one.)"
        echo ""
        echo "   Once, for every checkout on this machine:"
        echo ""
        echo "       npm install -g playwright"
        echo "       npx playwright install chromium webkit firefox"
        echo ""
        echo "   Nothing to set afterwards — a global install is found on its"
        echo "   own. LUCID_PLAYWRIGHT points at one kept somewhere else, and"
        echo "   may name the directory or the file inside it."
        echo ""
        echo "   Or just here, if you would rather keep it in the checkout:"
        echo ""
        echo "       npm i playwright && npx playwright install chromium webkit firefox"
    elif [ -z "$URL" ]; then
        echo "  (not checked: nothing is serving 127.0.0.1:$PORT over http or"
        echo "   https — start it with ./run.sh)"
    else
        # Does it come up at all, and then: can everything in it be pressed.
        # In that order — the second question is not worth asking about a page
        # whose script died on the way up, and the answer it gives then is
        # "nothing reaches anything", which reads as a broken room.
        node tools/pages.mjs "$URL" || FAILED=1
        node tools/pills.mjs "$URL" || FAILED=1
        node tools/reach.mjs "$URL" || FAILED=1
        # Only a clean look counts: a failed run leaves no fingerprint, so the
        # next one asks again rather than trusting a page it never approved.
        if [ "$FAILED" = 0 ] && [ -n "$NOW" ]; then
            mkdir -p "$(dirname "$STAMP")"
            printf '%s\n' "$NOW" > "$STAMP"
        fi
    fi
fi

exit $FAILED
