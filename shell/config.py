"""Where to serve, and on what. One person's settings, not an app's.

userdata/<who>/config.json, at the root of that person's directory. Every app
has its own config below it; this is the one they share, because a certificate
belongs to the whole of somebody's instance rather than to any one app in it.

The port is not in it and never is. It belongs to the run: 6969 unless
LUCID_PORT (run.sh --port) says otherwise, and everything handed out — the
wifi addresses, the phone's QR code — is built from the one actually bound.
Nothing on disk should have to be edited to serve the same people on another
port. See shell/paths.py.
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
    # A relative path is read from the checkout, so "certs/lucid.pem" keeps
    # working when the directory is renamed or moved.
    "tls_cert": "",
    "tls_key": "",

    # ---- the stack every game on this shelf shares -------------------------
    #
    # One language model, one recognizer, one voice, one set of thresholds for
    # the microphone. Not because a game could not want its own, but because
    # nobody has the memory for two of them at once and nobody wants to set
    # them up twice: what is here is the machine's answer, and a game is handed
    # it. What a *character* sounds like is still the character's own business,
    # in its persona file.
    "llm": {
        # Where AGENTS.md puts the language model. Any MLX chat model works —
        # it is spoken to over an OpenAI-compatible endpoint — so point this
        # at whichever one the machine has room for.
        "model": "models/llm",
        # A fuse, not a target. A token ceiling cannot shorten a reply, it can
        # only cut one off mid-word — so length is asked for in the persona's
        # own words ("answer in three sentences") and this is set high enough
        # that it only ever catches a model that has run away with itself.
        "max_tokens": 1400,
        "temperature": 0.8,
        "top_p": 0.95,
        "max_kv_size": 8192,
        # Live context is deliberately short: time-to-first-token climbs steeply
        # past ~4 exchanges (1.6s at 4, 3.3s at 6, 4.6s at 12 on this machine).
        # Long-term continuity comes from memory/, not from a bigger window.
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
        # Where mlx_vlm.server lives — the language model runs as a child
        # process from here, and run.sh starts the app itself with it. The
        # default is a .venv in the checkout, which is what AGENTS.md builds;
        # point it anywhere if your environment is elsewhere.
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
        "model": "models/parakeet-tdt-0.6b-v2",
    },
    "tts": {
        # Turbo by default: about 20% quicker per reply, and most people
        # prefer the voice. It ignores exaggeration and cfg_weight, so point
        # this at Chatterbox-fp16 if you want those to do anything.
        "model": "models/Chatterbox-Turbo-fp16",
        # 0-1. How hard delivery is pushed; a persona overrides it with its own
        # exaggeration:, and each sentence is nudged from this by punctuation.
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
    "vad": {
        "floor_mult": 3.0,          # how much louder than the room speech starts
        # Starting to talk is loud; carrying on is not. One threshold for both
        # measured a second-long question at 384ms and threw it away as a
        # cough. Arm at floor_mult, stay armed down to this. See audio.py.
        "sustain_mult": 1.4,        # …and how much louder it stays
        "hangover_ms": 700,         # silence that ends your turn
        "min_turn_ms": 500,
        "max_turn_ms": 30000,
        "barge_mult": 6.0,          # how much louder you must be to interrupt
        "barge_grace_ms": 600,
        # Playback the browser's echo canceller must have heard before
        # talking over the pill is believed — it cancels badly until it has
        # learned the voice, and the first reply after the mic opens is the
        # one it has not learned yet. See audio.py. 0 trusts it immediately.
        "barge_learn_ms": 1500,
    },

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


def at_root(value: str) -> str:
    """An absolute path as given; anything else from the checkout.

    Relative is read from the checkout, not from userdata/, so a path can
    point anywhere on this machine — "userdata/certs/lucid.pem" is where
    tools/ writes them and what AGENTS.md tells you to set.
    """
    return str(ROOT / value) if value and not value.startswith("/") else value


# Everything that names something on disk rather than a setting: where the
# three models are, and which environment serves the language model.
ON_DISK = (("llm", "model"), ("llm", "venv"), ("stt", "model"), ("tts", "model"))

def somewhere(value: str) -> str:
    """A path as this reads them: from the checkout unless it says otherwise.

    The models come down into `models/` beside the code, so what is written in
    the config is `models/llm` — short, the same on every machine, and true
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


# What is the machine's, wherever it is found written down.
OURS = ("llm", "stt", "tts", "vad")


def adopt(game: dict) -> bool:
    """Take the machine's settings out of a game's config file, once.

    Before the shelf had a second game on it, every one of these lived in the
    game's own config — which was fine while there was one, and is a way to
    describe two language models the moment there are two. Whatever is found in
    a game's file moves up here, and the machine's own answer wins if it has one
    already. True if anything moved, so the caller can rewrite the file it came
    from.
    """
    taken = {k: game.pop(k) for k in OURS if k in game}
    ui = game.get("ui")
    if isinstance(ui, dict) and "mic_follows_window" in ui:
        taken["mic_follows_window"] = ui.pop("mic_follows_window")
    if not taken:
        return False
    mine = {}
    if PATH.exists():
        try:
            mine = json.loads(PATH.read_text())
        except Exception:
            mine = {}
    for key, value in taken.items():
        mine.setdefault(key, value)
    save(mine)
    return True


def stack() -> dict:
    """The models and the microphone, ready for whichever game asked."""
    cfg = load()
    out = {k: cfg[k] for k in OURS if k in cfg}
    out["mic_follows_window"] = cfg.get("mic_follows_window", "hidden")
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
    for key in ("tls_cert", "tls_key"):
        cfg[key] = at_root(cfg[key])
    # The run's, not the file's -- a port written down in one is ignored, and
    # dropped the next time this is saved.
    afoot(cfg)
    cfg["port"] = PORT
    if os.environ.get("LUCID_PORT"):
        try:
            cfg["port"] = int(os.environ["LUCID_PORT"])
        except ValueError:
            print(f"[config] LUCID_PORT={os.environ['LUCID_PORT']!r} is not a "
                  f"number; staying on {cfg['port']}")
    return cfg


def save(cfg: dict):
    PATH.parent.mkdir(parents=True, exist_ok=True)
    kept = {k: v for k, v in cfg.items() if k != "port"}
    PATH.write_text(json.dumps(kept, indent=2) + "\n")
