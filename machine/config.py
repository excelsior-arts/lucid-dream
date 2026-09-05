"""Where to serve, and on what. The machine's settings, not an app's.

userdata/config.json, beside players/ rather than inside anybody's directory.
Every app has its own config under the player whose it is; this is the one
they all share, because a certificate and the models belong to the computer
rather than to any one app or any one person on it. See machine/paths.py.

The port is not in it and never is. It belongs to the run: 6969 unless
LUCID_PORT (run.sh --port) says otherwise, and everything handed out — the
wifi addresses, the phone's QR code — is built from the one actually bound.
Nothing on disk should have to be edited to serve the same people on another
port. See machine/paths.py.
"""
from __future__ import annotations

import json
import os

from pathlib import Path

from .paths import CONFIG as PATH, PORT, ROOT

DEFAULTS = {
    # Leave this alone on a managed Mac: the firewall only lets certain
    # binaries accept incoming connections, so "0.0.0.0" binds fine and still
    # times out from the wifi. Use "phone" below instead.
    "host": "127.0.0.1",
    # true = run.sh also starts tools/lan_bridge.py, so your phone can reach
    # this on the wifi. There is no password, on any of it.
    "phone": True,
    # HTTPS, and it is for the phone. Empty is the ordinary case: a browser
    # counts localhost as a secure origin whatever the scheme, so the
    # microphone works at this Mac over plain http with nothing installed.
    # A phone reaches this machine by its name on the wifi, which is not a
    # secure origin, and there getUserMedia does not exist at all -- so a
    # phone that is to be talked into needs these, and needs the certificate
    # trusted on the phone itself. Generate with mkcert; see AGENTS.md.
    # A relative path is read from the checkout, so
    # "userdata/certs/lucid.pem" -- which is where AGENTS and the MANUAL say
    # to put them -- keeps working when the directory is renamed or moved.
    "tls_cert": "",
    "tls_key": "",

    # ---- the stack every game on this shelf shares -------------------------
    #
    # One language model, one recognizer, one voice, one set of thresholds for
    # the microphone. Not because a game could not want its own, but because
    # nobody has the memory for two of them at once and nobody wants to set
    # them up twice: what is here is the machine's answer, and every caller is
    # handed it. What any one speaker sounds like is not here -- that is named
    # in the request that wants it, and the clip is on the shelf.
    # Where the models are: a directory of checkouts, one per repository,
    # laid out `<org>/<repo>` exactly as published. Which repository plays
    # which part is machine/models.json -- see machine/shelf.py -- so nothing
    # here has to name a model, and a newer release bringing a newer one
    # changes nothing in this file. Beside the code unless somebody keeps
    # the whole shelf elsewhere: a shared directory, an external disk.
    "models": {
        "dir": "models",
    },
    "llm": {
        # Which size of the language model is in use: `sm`, `md` or `lg`,
        # the three the manifest ships. setup.sh writes the one this Mac's
        # memory is good for; the console's ai_model_size switches. The
        # path itself is worked out from the manifest and the shelf above.
        "size": "lg",
        # Or a model of your own, by path: any MLX chat model works, it is
        # spoken to over an OpenAI-compatible endpoint. Empty is the size
        # above. Set, it is what runs, and the size is whatever it matches.
        "model": "",
        # And sizes of your own, name to path, beside the shipped three: a
        # build you are trying that the manifest does not know.
        "sizes": {},
        # A fuse, not a target. A token ceiling cannot shorten a reply, it can
        # only cut one off mid-word — so length is asked for in the prompt
        # itself ("answer in three sentences") and this is set high enough
        # that it only ever catches a model that has run away with itself.
        "max_tokens": 1400,
        "temperature": 0.8,
        "top_p": 0.95,
        "max_kv_size": 8192,
        # Live context is deliberately short: time-to-first-token climbs steeply
        # past ~4 exchanges (1.6s at 4, 3.3s at 6, 4.6s at 12 on this machine).
        # Long-term continuity is the caller's to carry, and is cheaper
        # carried as a few lines it writes than as a bigger window.
        #
        # These two are the caller's numbers, kept here as the shape of a
        # sensible default rather than as a setting: how much of a
        # conversation goes up with a turn is decided by whoever is holding
        # the conversation, and nothing in this package reads them. Lucid
        # Talk's own are in its config.json -- see MANUAL, "Tuning", and
        # app/packages/talk/src/conversation/config.ts.
        "context_turns": 6,         # user+assistant pairs kept in context
        # Messages vary from a few words to nearly two hundred, so a count
        # alone lets the prompt swing ~5x and time-to-first-token with it.
        # This caps the conversation part; 0 disables the cap.
        "context_words": 600,
        # Where the model server listens. Next to the app's own 6969 rather
        # than on 8080: a server found on this port is used as-is, whatever
        # model it happens to hold, so it wants a port nothing else is likely
        # to be on. Change it if something here already is.
        "port": 6968,
        # Where the model server lives — `mlx_lm.server` by default, or
        # `mlx_vlm.server` where `llm.server` names the alternative. The
        # language model runs as a child process from here, and run.sh starts
        # the app itself with it. The default is a .venv in the checkout,
        # which is what AGENTS.md builds; point it anywhere if your
        # environment is elsewhere.
        "venv": ".venv/bin",
        # Which program serves the model. mlx_lm re-uses the part of the
        # prompt it has processed before, which is about two seconds a turn
        # here; mlx_vlm re-reads all of it every time, and is what a vision
        # model would need. Both read the same model files.
        "server": "mlx_lm",
        # How much RAM mlx_lm may keep of prompts it has already seen.
        "prompt_cache_gb": 4,
        # Speculative decoding. A small model of the SAME family drafts
        # tokens the big one verifies; decode is what makes a reply slow.
        # Empty disables it. Costs its own memory while loaded.
        "draft_model": "",
    },
    "stt": {
        # Empty is the manifest's recognizer on the shelf above; a path is
        # one of your own.
        "model": "",
    },
    "tts": {
        # Empty is the manifest's voice model, Chatterbox Turbo: about 20%
        # quicker per reply than the full one, and most people prefer the
        # voice. It ignores exaggeration and cfg_weight, so point this at a
        # checkout of Chatterbox-fp16 if you want those to do anything.
        "model": "",
        # 0-1. How hard delivery is pushed. The floor for this machine; a
        # caller may send its own, and each sentence is nudged from it by
        # punctuation.
        "exaggeration": 0.6,
        # Lower trades a little fidelity for noticeably more pitch movement;
        # 0.2 beat 0.5 on contour spread at every exaggeration tested.
        "cfg_weight": 0.2,
        # Silence after each sentence, seconds. The artifact-free way to
        # slow the pace: it adds space instead of altering the speech.
        "pause": 0.0,
        # A beat after each paragraph. The model writes breaks where a
        # thought ends; without this the next one starts instantly.
        "paragraph_pause": 0.45,
    },
    # The shelf of reference clips: models/voices/<name>.wav, and a persona
    # names one of them. A model asset like the weights above and written down
    # like one -- so a machine keeping its models on a disk of their own keeps
    # the clips there too, and setup.sh --models DIR writes this alongside the
    # other paths. See machine/voices.py.
    "voices": {
        "path": "models/voices",
    },
    "vad": {
        "floor_mult": 3.0,          # how much louder than the room speech starts
        # Starting to talk is loud; carrying on is not. One threshold for both
        # measured a second-long question at 384ms and threw it away as a
        # cough. Arm at floor_mult, stay armed down to this. See
        # app/packages/audio/src/vad.ts, which is what listens by them.
        "sustain_mult": 1.4,        # …and how much louder it stays
        "hangover_ms": 700,         # silence that ends your turn
        "min_turn_ms": 500,
        "max_turn_ms": 30000,
        "barge_mult": 6.0,          # how much louder you must be to interrupt
        "barge_grace_ms": 600,
        # Playback the browser's echo canceller must have heard before
        # talking over a reply is believed — it cancels badly until it has
        # learned the voice, and the first reply after the mic opens is the
        # one it has not learned yet. See audio/vad.ts. 0 trusts it
        # immediately.
        "barge_learn_ms": 1500,
        # How periodic a block must be to count as a voice rather than a door
        # closing. Loudness alone cannot tell them apart, and one of them cuts
        # a reply off mid-sentence. 0 disables the test.
        "barge_voiced": 0.30,
        # How much louder than what the microphone hears of the reply --
        # the pill's own voice after the canceller -- a voice over it must
        # be. On headphones that residue is the quiet room and an ordinary
        # voice interrupts; on speakers with a poor canceller the bar stays
        # high. See audio/vad.ts.
        "barge_over": 2.5,
    },

    # Whether talking over a reply stops it. "auto" leaves it to what the
    # page's microphone actually granted, which is the only thing that knows;
    # "on" and "off" are somebody saying so at the console, for a browser that
    # reports cancellation and does not do any. See /mic_barge.
    "mic_barge": "auto",

    # What the microphone does when you leave the page.
    #   "focus"  close it whenever the window is not in front. Safest, and
    #            what you want if the mic sits next to other people.
    #   "hidden" close it only when the page is really hidden — another
    #            tab, another app on a phone, a locked screen. Keeps you
    #            talking to it while you work in another window.
    #   "never"  leave it alone; only the Mic button decides.
    # Read at Start, like the rest of this file.
    #
    # "hidden" by default, and "focus" is the one to think about rather
    # than the one to reach for. Losing focus is not leaving: opening the
    # microphone's own menu in the menu bar unfocuses the window for as
    # long as it takes to read it, and under "focus" the mic closes while
    # you are looking at it — so the indicator vanishes as you click it and
    # the system's microphone controls cannot be reached at all. Which is
    # the one moment somebody is certain to want them.
    "mic_follows_window": "hidden",
}


# Everything that names something on disk rather than a setting: where the
# four models are, and which environment serves the language model. The draft
# model belongs on it like any other: read against the working directory
# instead, a relative path is only found by a start made from the checkout,
# and speculative decoding turns itself off anywhere else with nothing said.
ON_DISK = (("models", "dir"), ("llm", "model"), ("llm", "venv"), ("llm", "draft_model"),
           ("stt", "model"), ("tts", "model"), ("voices", "path"))

def somewhere(value: str) -> str:
    """A path as this reads them: from the checkout unless it says otherwise.

    The models come down into `models/` beside the code, so what is written in
    the config is `models` — short, the same on every machine, and true
    after the whole thing is moved or renamed. An absolute path is taken as
    given and a leading ~ is your home, for models kept somewhere of their own:
    a directory shared between checkouts, or an external disk, or the pile you
    already had before you met this.
    """
    if not value:
        return value
    if value.startswith("~"):
        return str(Path(value).expanduser())
    return value if value.startswith("/") else str(ROOT / value)

def afoot(cfg: dict) -> dict:
    """The same settings with every path in them pointing at something real."""
    for section, key in ON_DISK:
        if isinstance(cfg.get(section), dict) and cfg[section].get(key):
            cfg[section][key] = somewhere(cfg[section][key])
    return cfg


def shelved(cfg: dict) -> dict:
    """Every model path that was left empty, filled in from the manifest.

    The config says which size is in use and where the shelf is; the manifest
    says which repository each part is. Only what is empty is filled: a path
    somebody wrote is a model of their own, and stays. Done after `afoot`, so
    the shelf is already a real place.
    """
    from . import shelf
    base = (cfg.get("models") or {}).get("dir") or somewhere("models")
    llm = cfg.setdefault("llm", {})
    if not llm.get("model"):
        size = llm.get("size") or "lg"
        llm["model"] = (str(shelf.where(base, "llm", size)) if size in shelf.sizes()
                        else somewhere(str((llm.get("sizes") or {}).get(size) or "")))
    for role in shelf.ROLES:
        section = cfg.setdefault(role, {})
        if not section.get("model"):
            section["model"] = str(shelf.where(base, role))
    voices = cfg.setdefault("voices", {})
    if not voices.get("path"):
        voices["path"] = str(Path(base) / "voices")
    return cfg


# What is the machine's: the models, and the numbers the microphone listens by.
OURS = ("llm", "stt", "tts", "vad")


def stack() -> dict:
    """The models and the microphone, ready for whichever game asked."""
    cfg = load()
    out = {k: cfg[k] for k in OURS if k in cfg}
    out["mic_follows_window"] = cfg.get("mic_follows_window", "hidden")
    out["mic_barge"] = cfg.get("mic_barge", "auto")
    return out


def secure(cfg: dict | None = None) -> bool:
    """Whether this machine has a certificate to serve on.

    Both halves, and both of them present on disk: a path written down and a
    file that has gone is how an instance drops back to http without anybody
    being told, and everything that guesses the scheme has to guess the same
    way the server does.
    """
    cfg = load() if cfg is None else cfg
    cert, key = cfg.get("tls_cert", ""), cfg.get("tls_key", "")
    return bool(cert and key and Path(cert).exists() and Path(key).exists())


def scheme(cfg: dict | None = None) -> str:
    return "https" if secure(cfg) else "http"


def deeply(base: dict, over: dict) -> dict:
    """Merge a section at a time, not a file at a time.

    A file that says {"llm": {"model": "..."}} is answering one question, not
    replacing the block. Merged shallowly that one key takes `max_tokens`,
    `temperature` and both context limits with it, and what runs instead are
    the fallbacks scattered through the code — a reply clipped at 220 tokens,
    with nothing in the config to explain it. setup.sh writes exactly such a
    partial section, so this is the ordinary case rather than the odd one.
    """
    out = dict(base)
    for key, value in (over or {}).items():
        out[key] = (deeply(base[key], value)
                    if isinstance(value, dict) and isinstance(base.get(key), dict)
                    else value)
    return out


def load() -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))
    if PATH.exists():
        try:
            cfg = deeply(cfg, json.loads(PATH.read_text()))
        except Exception as e:
            print(f"[config] {PATH.name} is not valid JSON ({e}); using defaults")
    # The certificate reads like a model path and is written down like one:
    # relative to the checkout, ~ for a home, absolute taken as given.
    for key in ("tls_cert", "tls_key"):
        cfg[key] = somewhere(cfg[key])
    # The run's, not the file's -- a port written down in one is ignored, and
    # dropped the next time this is saved.
    afoot(cfg)
    shelved(cfg)
    cfg["port"] = PORT
    if os.environ.get("LUCID_PORT"):
        try:
            cfg["port"] = int(os.environ["LUCID_PORT"])
        except ValueError:
            print(f"[config] LUCID_PORT={os.environ['LUCID_PORT']!r} is not a "
                  f"number; staying on {cfg['port']}")
    return cfg


def written() -> dict:
    """The file as somebody wrote it: no defaults merged, no paths resolved."""
    if not PATH.exists():
        return {}
    try:
        got = json.loads(PATH.read_text())
    except Exception as e:
        print(f"[config] {PATH.name} is not valid JSON ({e}); leaving it alone")
        return {}
    return got if isinstance(got, dict) else {}


def note(**changes) -> dict:
    """Write down a setting or two, and touch nothing else in the file.

    A patch over what is on disk, because the alternative — saving back what
    load() handed out — writes two things nobody asked for. It merges today's
    DEFAULTS in, so the whole of them are frozen into somebody's file and a
    default improved later never reaches them again; and it resolves every
    path against this checkout, so `models/llm` becomes an absolute path that
    stops being true the day the directory is moved, which is the one property
    somewhere() exists to keep.

    The port is dropped on the way past, wherever it came from: it belongs to
    the run and a number written down here is ignored anyway.
    """
    cfg = written()
    cfg.update(changes)
    cfg.pop("port", None)
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(cfg, indent=2) + "\n")
    return cfg
