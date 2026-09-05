#!/bin/sh
# The checks.
#
#   ./check.sh              everything there is
#   ./check.sh store        one module of the fast suite, matched by name
#   ./check.sh rooms        only the browser ones
#
# Three tiers, and the splits are deliberate.
#
# The fast suite is Python: the machine, and the storage it lends whatever is
# installed. It needs nothing installed, touches no model and no device, runs
# against a throwaway userdata/ directory and finishes in a fifth of a second —
# so it can be run before every commit rather than when something has already
# gone wrong.
#
# In the middle sits the page's own, under app/: the types, the lint and the
# unit tests. That tier is most of the program now — the conversation runs in
# the browser — and the compiler is most of the tier: a page that would not
# have parsed, or a name used and declared nowhere, is a build that fails
# rather than a room with a dead panel in it. The unit tests are the parts that
# have an answer without a browser: the turn, the loop, the detector,
# normalisation, pacing. It needs node, and is skipped on a machine without
# one, which is a machine that has nothing built to serve either.
#
# The last one needs a real browser and a running server, because what it
# checks cannot be faked: whether the page comes up at all, whether a page
# knows which conversation it is in, and whether everything in a room can
# still actually be pressed. The last is a question about perspective, about
# what is in front of what, and about a page projected onto a plane with CSS —
# none of which has an answer outside a browser that has actually drawn it.
# They run when they can and say so when they cannot.
set -e
cd "$(cd "$(dirname "$0")" && pwd)"

# Every probe below imports the app to ask it one thing, and importing
# machine/paths.py settles the real userdata/ on the way past: anything beside
# players/ that looks like a game is folded into the first player. Which is a
# check rearranging somebody's conversations in order to find out which
# interpreter to run. Naming the root it would have used anyway turns that off
# -- LUCID_USERDATA means "this instance keeps its things elsewhere", and here
# elsewhere is exactly where they already are -- so the probes read the same
# config and settle nothing. The suite itself is not run through this: it
# chooses a throwaway root of its own, in tests/__init__.py, and would ignore
# an inherited one anyway.
ASK="env LUCID_USERDATA=${LUCID_USERDATA:-$PWD/userdata}"

# The same interpreter the app runs on, chosen the same way run.sh chooses it:
# the tests import the app, so they need what the app imports.
VENV="$($ASK python3 -c 'import json
from machine import paths as P
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

# ---- and the page's own tier, if it has been installed ----------------------
#
# Types, lint and the unit tests under app/. Node is not a requirement of this
# program -- a machine without one runs the server and is told how to build the
# page when it asks for it -- so this is offered rather than demanded:
# node_modules is the sign that somebody is working on the page here, and only
# then is there anything to check.
#
# Not run for a named module or for `rooms`: both of those are somebody asking
# for one thing, and a minute of npm is not it.
if [ -z "$1" ] && [ -d app/node_modules ]; then
    echo ""
    echo "app:"
    ( cd app && npm run typecheck && npm run lint && npm test ) || FAILED=1
fi

# ---- and the rooms, in a browser, against whatever is serving ---------------
#
# Minutes rather than seconds, and the only tier that needs somebody to have
# started something: the specs under app/tests/browser are pointed at the
# server that is already up, so what they look at is the page as it is being
# played rather than one built for the occasion. `./check.sh rooms` asks for
# this on its own, which is what to do when the doubt is about the browser
# rather than about the code.
if [ -z "$1" ] || [ "$1" = "rooms" ] || [ "$1" = "reach" ]; then
    PORT="${LUCID_PORT:-$($ASK python3 -c 'from machine import paths as P
print(P.PORT)' 2>/dev/null || echo 6969)}"
    # https only if this machine has a certificate — the usual case is http,
    # since one is only needed to let a phone hear you. Whichever the config
    # says is tried first and the other after it, because the instance that is
    # up need not be the one this config would start.
    FIRST="$($ASK "$PY" -c 'from machine import config as C; print(C.scheme())' \
             2>/dev/null || echo http)"
    [ "$FIRST" = https ] && SECOND=http || SECOND=https
    URL=""
    for scheme in "$FIRST" "$SECOND"; do
        if curl -sk -m 3 -o /dev/null "$scheme://127.0.0.1:$PORT/"; then
            URL="$scheme://127.0.0.1:$PORT"
            break
        fi
    done
    # The driver comes with the page -- @playwright/test is in app's own
    # package.json -- but the browser it drives does not: it is a download of
    # its own, kept outside the checkout, and a checkout that has npm ci'd is
    # still one press away from a run that fails with "Executable doesn't
    # exist". So playwright is asked where it keeps chromium, and whether it
    # is there.
    HAVE=""
    if [ -d app/node_modules/@playwright/test ]; then
        HAVE="$(cd app && node -e "const {chromium} = require('@playwright/test');
                  process.stdout.write(require('fs').existsSync(chromium.executablePath())
                                       ? 'yes' : '')" 2>/dev/null || true)"
    fi

    echo ""
    echo "rooms:"
    if ! command -v node >/dev/null 2>&1; then
        echo "  (not checked: no node)"
    elif [ ! -d app/node_modules ]; then
        echo "  (not checked: the page has not been installed here —"
        echo "   cd app && npm ci)"
    elif [ -z "$HAVE" ]; then
        echo "  (not checked: no browser for playwright to drive, and the rooms"
        echo "   are the half of this that cannot be checked without one.)"
        echo ""
        echo "   Once, on this machine:"
        echo ""
        echo "       cd app && npx playwright install chromium"
    elif [ -z "$URL" ]; then
        echo "  (not checked: nothing is serving 127.0.0.1:$PORT over http or"
        echo "   https — start it with ./run.sh)"
    else
        # Pointed at the running server rather than at a dev server of its own:
        # LUCID_WEB is what tells playwright.config not to start one. See it
        # for the other way round, which is the loop somebody works in.
        ( cd app && LUCID_WEB="$URL" npx playwright test ) || FAILED=1
    fi
fi

exit $FAILED
