#!/bin/sh
# Make this Mac reachable from your phone, with a microphone.
#
# A browser will only open a microphone on a page it considers safe: the
# computer you are sitting at, or a real https:// address. A phone is neither
# until this has been run. It makes a certificate for this Mac, tells the Mac
# to trust it, and writes it into userdata/config.json -- and then tells you
# the one thing that has to happen on the phone itself, which nothing here can
# do for you. One certificate for the machine, so everybody playing on it is
# reached the same way.
#
# Safe to run twice. It replaces the certificate and leaves everything else.
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)"

say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }

# Asked what it does rather than told to do it. A script that makes
# certificates and asks for a password should never be one you can start by
# accident while trying to find out what it is.
case "${1:-}" in
    -h|--help|help)
        say "Sets this Mac up so your phone can talk to it."
        say ""
        say "Makes a certificate for this Mac, asks macOS to trust it (one"
        say "password prompt), and points the config at it. Then tells you the"
        say "three steps to do on the phone."
        say ""
        say "You do not need this to play at the Mac -- that works already."
        exit 0 ;;
    "") ;;
    *)  die "phone.sh takes no arguments. Try --help." ;;
esac

if ! command -v mkcert >/dev/null 2>&1; then
    die "This needs mkcert, which makes the certificate.

  brew install mkcert

Then run this again. (Homebrew: https://brew.sh)"
fi

NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
LAN="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -n "$NAME" ] || die "This Mac has no name -- set one in System Settings > General > Sharing."

say ""
say "Making a certificate for $NAME.local${LAN:+ and $LAN}"
say ""

# Trusting it is what needs the password: macOS keeps its list of trusted
# certificates where a program cannot write to it unasked.
say "macOS will ask for your password -- that is it wanting permission to"
say "trust this certificate. It is the only thing this needs."
say ""
mkcert -install

CERTS="$(python3 -c 'from shell import paths as P; print(P.CERTS.relative_to(P.ROOT))')"
mkdir -p "$CERTS"
mkcert -cert-file "$CERTS/lucid.pem" \
       -key-file  "$CERTS/lucid-key.pem" \
       "$NAME.local" ${LAN:+"$LAN"} localhost 127.0.0.1 ::1 >/dev/null 2>&1

# Written with python rather than sed: config.json is somebody's file and may
# have anything else in it.
python3 - <<'PY'
import json
from shell import paths as P

p = P.CONFIG
here = P.CERTS.relative_to(P.ROOT)
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg["tls_cert"] = str(here / "lucid.pem")
cfg["tls_key"] = str(here / "lucid-key.pem")
cfg.setdefault("phone", True)
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(cfg, indent=2) + "\n")
PY

ROOT="$(mkcert -CAROOT)/rootCA.pem"
say ""
say "Done on this Mac. Now the phone, which is three taps and a switch:"
say ""
say "  1.  Send yourself this file -- AirDrop is easiest:"
say ""
say "        $ROOT"
say ""
say "  2.  Open it on the phone. Settings shows 'Profile Downloaded' --"
say "      tap it, and install."
say ""
say "  3.  Settings > General > About > Certificate Trust Settings,"
say "      and turn the switch ON for mkcert."
say ""
say "      Step 3 is the one everyone misses. Installing it is not enough."
say ""
say "Then ./run.sh, and open the https:// address it prints for your phone."
say ""
