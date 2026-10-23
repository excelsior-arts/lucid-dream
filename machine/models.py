"""The three models themselves: the language server, the ear, and the voice.

One owner and one thread. `LLMServer` supervises a child process we can
actually kill; `Voice` holds Parakeet and Chatterbox and runs every MLX call on
a thread of its own, because MLX is not re-entrant and two pages talking at
once must queue rather than collide.

Nothing here knows what a game is. It is handed a model path, samples, a clip
to speak from and a list of messages, and hands back text, words and audio --
the same shape a hosted provider would answer with, which is the point of the
line being here. What to say, and in whose voice, is decided a long way above
this. See machine/machine.py, which is the surface these answer on.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import queue
import re
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import requests

from . import log as LOG
from . import paths
from . import shelf

VENV_BIN = paths.ROOT / ".venv" / "bin"    # replaced by config's llm.venv on start
# Where setup.sh puts them. Only fallbacks -- apply_config replaces both from
# the config on start -- but a fallback should describe the ordinary install
# rather than one machine's home directory.
#
# The LLM has no fallback on purpose. Its path is the one config decides
# outright, quantisation and all, and every caller passes it: a constant here
# saying "4-bit" read as though the code chose that, which setup.sh does.
MODELS = paths.ROOT / "models"
# The manifest's, until apply_config hands over the config's -- which is the
# same place unless somebody keeps a model of their own. See machine/shelf.py.
STT_PATH = shelf.where(MODELS, "stt")
TTS_PATH = CB_PATH = shelf.where(MODELS, "tts")
# Where the language model answers. A port rather than a constant because a
# second copy of this app on one Mac is otherwise hostile to the first: it
# finds the model already there, adopts it, and kills it on the way out --
# LLMServer.stop takes whatever holds this port, which is right for one
# instance putting its own strays down and wrong for two instances sharing a
# machine. Set `llm.port` and they never meet.
# One below the app's own 6969, and deliberately none of the obvious ones.
#
# A server on this port is adopted rather than replaced — see LLMServer.stop —
# and adoption is decided by the port alone, not by which model is loaded on
# it. On 8080, the busiest port in development, that means the game talks to
# whatever language model somebody else left running, and mlx_lm swaps a
# fifteen-gigabyte model in and out on alternating requests while both of you
# wonder why everything got slow.
#
# Not 6666 either, which is inside the IRC range browsers refuse to open at
# all (6665-6669, with 6697 for its TLS) — irrelevant today, when only this
# process talks to the model, and not irrelevant at all on the day a page
# talks to it directly. And not 6970 and up, which is where RTP streaming
# lives. 6968 is unregistered, out of both ranges, and next door to the app.
LLM_HOST, LLM_PORT = "127.0.0.1", 6968


def llm_url() -> str:
    return f"http://{LLM_HOST}:{LLM_PORT}"

# What the voice says to itself before anybody is listening. Short, and never
# heard: the length only has to be enough to take the whole path once. See
# Voice.warm.
WARM_TEXT = "Yes. I am here."
LLM_OPTS = {"max_tokens": 220, "temperature": 0.8, "top_p": 0.95, "max_kv_size": 8192}


def apply_config(cfg: dict):
    """Let config.json drive generation without touching code."""
    global STT_PATH, TTS_PATH, CB_PATH, VENV_BIN
    global TTS_EXAG, TTS_CFG, TTS_PAUSE, PARAGRAPH_PAUSE, LLM_OPTS, LLM_PORT
    llm = cfg.get("llm", {})
    t = cfg.get("tts", {})
    stt = cfg.get("stt", {})
    if llm.get("venv"):
        VENV_BIN = Path(llm["venv"])
    if stt.get("model"):
        STT_PATH = Path(stt["model"])
    if t.get("model"):
        TTS_PATH = CB_PATH = Path(t["model"])
    TTS_EXAG = float(t.get("exaggeration", TTS_EXAG))
    TTS_CFG = float(t.get("cfg_weight", TTS_CFG))
    TTS_PAUSE = float(t.get("pause", TTS_PAUSE))
    PARAGRAPH_PAUSE = float(t.get("paragraph_pause", PARAGRAPH_PAUSE))
    if llm.get("port"):
        LLM_PORT = int(llm["port"])
    LLM_OPTS = dict(llm)


# Delivery intensity, 0-1, and the guidance weight. Lower cfg trades a little
# fidelity for noticeably more pitch movement.
TTS_EXAG, TTS_CFG = 0.6, 0.2
# Silence added after each sentence. Slows the felt pace by adding space
# rather than altering the speech, so it costs nothing in quality.
TTS_PAUSE = 0.0
# A beat after a paragraph. The model puts breaks where a thought ends;
# without a gap they are lost, since each chunk is trimmed and queued
# straight after the last.
PARAGRAPH_PAUSE = 0.45
# Fade at each chunk edge. Long enough to hide the room tone cutting in
# and out, short enough not to eat the first consonant.
FADE_MS = 25.0


def footprint_mb(pid: int) -> float:
    """Physical footprint, the number Activity Monitor shows.

    ps reports RSS, which misses MLX's unified/GPU allocations -- measured 10.4
    GB against a real 15 GB for the LLM. Costs ~60ms, so callers cache it.
    Returns 0.0 if the tool is unavailable, and the caller falls back to RSS.
    """
    try:
        out = subprocess.run(["footprint", "-p", str(pid)],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return 0.0
    for line in out.splitlines():
        if "phys_footprint:" in line and "peak" not in line:
            part = line.split("phys_footprint:")[1].strip()
            try:
                value, unit = part.split()[0], part.split()[1].upper()
            except IndexError:
                continue
            try:
                n = float(value.replace(",", ""))
            except ValueError:
                continue
            return n * 1024 if unit.startswith("G") else (n if unit.startswith("M") else n / 1024)
    return 0.0


def process_mb(pid: int) -> float:
    """What a process really costs: footprint when we can get it, else RSS."""
    return footprint_mb(pid) or rss_mb(pid)


def rss_mb(pid: int) -> float:
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)],
                             capture_output=True, text=True, timeout=2).stdout.strip()
        return int(out) / 1024 if out else 0.0
    except Exception:
        return 0.0


def port_pids(port: int) -> list[int]:
    try:
        out = subprocess.run(["lsof", "-iTCP:%d" % port, "-sTCP:LISTEN", "-t"],
                             capture_output=True, text=True, timeout=3).stdout.split()
        return [int(p) for p in out]
    except Exception:
        return []


def trim_silence(a: np.ndarray, sr: int, lead_ms=60, tail_ms=120) -> np.ndarray:
    """Drop dead air at the edges of a generated chunk.

    The duration budget is a target, not a fit: OmniVoice pads what it doesn't
    need, and a tag makes the budget bigger, so a [sigh] reply would open with
    most of a second of silence before anything happened.
    """
    if a.size == 0:
        return a
    frame = max(1, int(0.010 * sr))
    n = a.size // frame
    if n < 2:
        return a
    rms = np.sqrt((a[:n * frame].reshape(n, frame) ** 2).mean(axis=1))
    loud = np.flatnonzero(rms > max(1e-4, 0.02 * float(rms.max())))
    if loud.size == 0:
        return a
    start = max(0, loud[0] * frame - int(lead_ms / 1000 * sr))
    end = min(a.size, (loud[-1] + 1) * frame + int(tail_ms / 1000 * sr))
    out = a[start:end].copy()

    # Ramp both edges. A cloned voice carries the reference's room tone, so a
    # hard cut goes tone -> digital silence -> tone between sentences, and that
    # switching is what sounds artificial. A short fade lets it decay instead.
    n = min(int(FADE_MS / 1000 * sr), out.size // 2)
    if n > 1:
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32) ** 0.5
        out[:n] *= ramp
        out[-n:] *= ramp[::-1]
    return out


def sentence_exaggeration(text: str, base: float) -> float:
    """Push delivery per sentence instead of once per reply.

    Every sentence is generated separately, so each can be delivered
    differently -- that variation is the difference between a reply that moves
    and one flat voice reading three lines.

    Punctuation is the obvious signal, but the model will not reliably vary it:
    prompted for it twice, replies came back as three plain periods every time,
    with zero spread. Length it does vary on its own, and short clauses measured
    as genuinely more intense than long ones, so that carries the variation.
    """
    ex = base
    words = len(text.split())
    if words <= 4:
        ex += 0.10          # "Stop." "Look at me." land hard
    elif words >= 13:
        ex -= 0.07          # a long line settles
    if "!" in text:
        ex += 0.15
    if "..." in text or "\u2026" in text:
        ex -= 0.10
    if text.rstrip().endswith("?"):
        ex += 0.05
    return max(0.0, min(1.0, ex))


def is_turbo() -> bool:
    """Whether the loaded voice model is Chatterbox Turbo.

    Turbo has no CFG and no exaggeration -- it warns on every call if you pass
    them, and delivery there comes from the words alone. It is the default, so
    anything a caller says about delivery has to ask this first.
    """
    return "turbo" in str(CB_PATH).lower()


# A bracketed tag as a model writes one: "[laugh]", "[clear throat]",
# "[Sigh]". Letters, spaces and hyphens, on one line. The page strips the same
# shape from everything it shows -- see speech.ts in @lucid/machine.
TAG = re.compile(r"\[([A-Za-z][A-Za-z -]*)\]")


# Which tags a voice says well, by ear: the map both ends read, beside the
# page's code that reads it too (voice-tags.ts in @lucid/machine). Keyed by
# the model's name -- its directory's, less a precision suffix.
TAG_MAP = paths.ROOT / "app" / "packages" / "machine" / "src" / "voice-tags.json"


def tag_entry(name: str, where=None):
    """The map's entry for a voice, following `as`; None for one with none."""
    try:
        voices = json.loads(Path(where or TAG_MAP).read_text()).get("voices") or {}
    except (OSError, ValueError):
        return None
    entry = voices.get(name)
    for _ in range(4):
        if not isinstance(entry, dict) or not entry.get("as"):
            break
        entry = voices.get(entry["as"])
    return entry if isinstance(entry, dict) else None


def tag_name(path) -> str:
    """A model's name in the map: its directory's, lower-cased, less the
    precision it was converted at ("chatterbox-turbo-fp16" is
    "chatterbox-turbo")."""
    return re.sub(r"-(fp16|fp32|bf16|f16|f32|q?\d+bit|q\d)$", "", Path(path).name.lower())


def voice_tags(path=None, where=None) -> frozenset[str]:
    """The delivery tags the voice model at `path` keeps, "[laugh]" and all.

    Turbo's tokenizer carries them as single added tokens, and a tag it has
    a token for is performed rather than read: [sigh] is a breath before the
    line, [laugh] a laugh. A tag it has no token for is read out as words. So
    what it could keep is whatever the model's own added_tokens.json says,
    never a list written down here; what it does keep is those of them the
    map (TAG_MAP) says it says well. A model with no entry keeps every one
    its tokenizer knows and the log says so, so a new voice tries the whole
    range and is pruned by ear. Nothing at all for a model that is not
    Turbo, or a directory without the file.
    """
    path = Path(path or CB_PATH)
    if "turbo" not in str(path).lower():
        return frozenset()
    known = _tags_in(str(path))
    entry = tag_entry(tag_name(path), where)
    if entry is None:
        if known and str(path) not in _UNMAPPED:
            _UNMAPPED.add(str(path))
            LOG.say(f"voice tags: {tag_name(path)} has no entry in voice-tags.json -- it keeps "
                    f"all {len(known)} its tokenizer knows, to be pruned by ear", source="machine")
        return known
    return known & frozenset((entry.get("say") or {}).keys())


_UNMAPPED: set[str] = set()


_TAGS: dict[str, frozenset[str]] = {}


def _tags_in(where: str) -> frozenset[str]:
    if where not in _TAGS:
        found: set[str] = set()
        for name in ("added_tokens.json", "tokenizer_config.json"):
            try:
                data = json.loads((Path(where) / name).read_text())
            except (OSError, ValueError):
                continue
            if name == "tokenizer_config.json":
                data = {v.get("content", ""): k for k, v in
                        (data.get("added_tokens_decoder") or {}).items()
                        if isinstance(v, dict)}
            found |= {t for t in data if isinstance(t, str) and TAG.fullmatch(t)}
            if found:
                break
        _TAGS[where] = frozenset(found)
    return _TAGS[where]


def voice_text(text: str, tags=frozenset()) -> str:
    """What the synthesiser is handed for a line of the reply.

    A tag in `tags` stays, lower-cased to the token's own spelling, and is
    performed. Every other bracketed tag goes: one the tokenizer has no token
    for is read aloud as words -- "[surprise-oh] you did it" came back as
    "Surprise. Oh, you did it", and a leading one can derail the sentence.
    *mmm* is a sound the model wrapped in emphasis; the marks would otherwise
    be at the mercy of the tokenizer, so they go too.

    A line that is only tags is nothing to say. Alone, with no words for the
    voice to carry them, Turbo made noise of them rather than sounds: a
    "[sigh]" a faint breath with nothing of the speaker in it, or a word
    nobody wrote ("Yeah.") -- see hasWords in speech.ts (@lucid/machine),
    which keeps a tag with the sentence it opens instead.
    """
    def keep(m):
        name = "[" + " ".join(m.group(1).lower().split()) + "]"
        return name if name in tags else " "
    clean = TAG.sub(keep, text).replace("*", " ")
    if not re.search(r"[A-Za-z0-9]", TAG.sub(" ", clean)):
        return ""
    return re.sub(r"\s{2,}", " ", clean).strip()


def draft_args() -> list[str]:
    """Speculative decoding: a small model guesses, the big one verifies.

    Decode is the bottleneck for a spoken reply -- measured 13.5 tok/s for a
    198-token answer, so ~15s of a 19s turn. A draft model can cut that when
    its guesses are accepted, at the cost of holding it in memory too.

    Off unless llm.draft_model is set, since a mismatched tokenizer produces
    garbage rather than a clean error.
    """
    path = LLM_OPTS.get("draft_model")
    if not path or not Path(path).exists():
        return []
    args = ["--draft-model", str(path)]
    kind = LLM_OPTS.get("draft_kind")
    if kind:
        args += ["--draft-kind", str(kind)]
    return args


def last_words(path, lines: int = 12) -> list[str]:
    """The tail of a child's log, for when the child is why nothing works.

    The language model runs as its own process and writes its complaints to a
    file of its own. Telling somebody a path is telling them to go and look;
    this brings the last few lines to where they already are, which is the
    console they opened when it would not start.
    """
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            back = min(f.tell(), 8192)
            f.seek(-back, 2)
            tail = f.read().decode("utf-8", "replace").splitlines()
        return [t.strip() for t in tail[-lines:] if t.strip()]
    except Exception:
        return []


def _fronted(messages: list[dict], system: str | None) -> list[dict]:
    """The messages with a system message on the front, if there is one.

    Nothing is ever supplied here. The whole prompt is somebody else's -- the
    page assembles the whole of it out of what only it knows -- and a system
    message this end invented
    would sit in front of all of it, uninvited and cached. Said means what was
    said; unsaid means nothing at all.
    """
    return ([{"role": "system", "content": system}] if system else []) + list(messages)


# A model that stops answering, noticed: the rule the page keeps as well
# (app/packages/machine/src/stall.ts, which has the reasons). Before the first
# word the prompt is being read, which at 8192 tokens or on a model just woken
# can take tens of seconds; once words are flowing, a working model writes
# several a second, and fifteen seconds with none is a stall. Starting the
# model is not counted: the chat route waits on start_llm before it asks.
FIRST_WORD_S = 90.0
NEXT_WORD_S = 15.0


class Stalled(Exception):
    """The model server took a request and stopped answering it: alive, its
    port open, and no word for longer than a working one ever takes. Frozen,
    not refusing -- so it is restarted rather than asked again (Stack.revive).
    """


def _unblock(r) -> None:
    """Make a read blocked on this response come back now.

    `read1` blocks until the server sends something, and a server that is
    frozen sends nothing: the stop flag in `_lines` was read only between
    reads, so a page that gave up left the reply holding `_words` -- and the
    next line queued behind it -- for as long as the read timeout. Shutting
    the socket down from another thread wakes the read with an end of
    stream; closing it alone does not on every platform.
    """
    if r is None:
        return
    for get in (lambda: r.raw._fp.fp.raw._sock,
                lambda: r.raw.connection.sock):
        try:
            sock = get()
        except Exception:
            continue
        if sock is not None:
            with contextlib.suppress(Exception):
                sock.shutdown(socket.SHUT_RDWR)
            break
    with contextlib.suppress(Exception):
        r.close()


def _lines(r, stop_flag: threading.Event):
    """The lines of a streamed response, each the moment it has arrived.

    Not `iter_lines`. mlx_lm streams its frames with no length and no chunked
    encoding, and on a body like that requests reads in blocks of 512 bytes:
    the read blocks until 512 bytes have come, and a frame is about 350. So
    the first word waited for the second, and every word after arrived in
    lumps of a word and a half -- a token's worth of delay (~75 ms at this
    model's pace) on the first word, and a stutter in the stream the page
    never saw as words but the voice saw as later sentence ends. `read1`
    hands over whatever has arrived, which is the whole difference.
    """
    buf = b""
    while not stop_flag.is_set():
        data = r.raw.read1(65536)
        if not data:
            break
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            yield line.decode("utf-8", "replace").rstrip("\r")
    if buf and not stop_flag.is_set():
        yield buf.decode("utf-8", "replace").rstrip("\r")


class LLMServer:
    """Supervises the model server as a child process we can actually kill.

    `mlx_lm.server` by default, which is what llm.server names; `mlx_vlm` is
    the alternative, for a model mlx-lm will not load."""

    def __init__(self, model_path: Path | str, log_path: Path | None = None,
                 server: str = ""):
        self.model_path = Path(model_path)
        # Said outright by whoever builds this, rather than read out of the
        # globals as they happen to stand. One of these describes one launch
        # line, and the caller knows which line it wants: taken from the
        # module, a supervisor built before the config was read -- which is
        # what the memory meter does, long before any start -- launched
        # mlx_lm for a machine whose config says mlx_vlm.
        self.server = str(server or LLM_OPTS.get("server") or "mlx_lm")
        self.proc: subprocess.Popen | None = None
        self._mem_mb = 0.0
        self._mem_at = 0.0
        self.log_path = log_path or paths.LLM_LOG

    def adopt_or_none(self) -> int | None:
        pids = port_pids(LLM_PORT)
        return pids[0] if pids else None

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def ready(self) -> bool:
        try:
            return requests.get(f"{llm_url()}/v1/models", timeout=2).status_code == 200
        except Exception:
            return False

    def args(self) -> list[str]:
        """The launch line, which is not the same for the two servers.

        mlx_lm keeps the prompts it has already processed and re-uses the
        longest matching prefix. That is worth about two seconds a turn here:
        what a caller puts in front of a conversation comes to some 800 words
        that do not change between turns, and mlx_vlm re-reads every one of
        them every time. Measured on one machine, same model,
        same prompt, time to first token: 3.4s against 1.6s.

        mlx_lm does not take --max-kv-size; it is bounded by the size of its
        prompt cache instead. It has taken --kv-bits since 0.32, and is not
        given it: its own help says a quantised cache turns batching off, and
        two pages on one server are two requests at once. mlx_vlm is what a
        vision model would need, which is why both are here.
        """
        common = ["--host", LLM_HOST, "--port", str(LLM_PORT),
                  "--model", str(self.model_path), "--max-tokens", "2048"]
        if self.server == "mlx_lm":
            gb = float(LLM_OPTS.get("prompt_cache_gb", 4))
            # How many prompts the server keeps, as well as how many bytes.
            # Its default is ten. A turn of a room puts two new ones in (the
            # context, and the whole prompt with the reply on it) and each of
            # the small calls after it -- the scene, the judgement, the fold
            # -- two more: eight a turn, which is the ten with nothing to
            # spare, and the entry the next turn resumes from is the oldest
            # of them. One room keeps it by a hair; a second page on the same
            # server, or a page reloaded, throws it out. Measured on a shared
            # server: a turn that should have read ~240 tokens read 2004 and
            # took 5s to the first word. The bytes bound it; the count is set
            # out of the way of them.
            return ([str(VENV_BIN / "mlx_lm.server")] + common
                    + ["--prompt-cache-bytes", str(int(gb * 1e9)),
                       "--prompt-cache-size", str(int(LLM_OPTS.get("prompt_cache_size", 40)))]
                    + draft_args())
        return ([str(VENV_BIN / "mlx_vlm.server")] + common
                + ["--kv-bits", "4",
                   "--max-kv-size", str(LLM_OPTS.get("max_kv_size", 8192))]
                + draft_args())

    def start(self):
        if self.running() or self.ready():
            return
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        # Closed at this end the moment the child has it, rather than left to
        # be swept up whenever the frame is: the child holds its own copy and
        # writes the log, and nothing here reads it -- last_words opens it
        # again when somebody asks why the model would not start.
        with open(self.log_path, "ab", buffering=0) as log:
            self.proc = subprocess.Popen(
                self.args(),
                stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,  # own group, so we can kill the tree
                env={**os.environ,
                     "PATH": f"{VENV_BIN}:{os.environ.get('PATH', '')}"},
            )

    def wait_ready(self, timeout=600) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.ready():
                return True
            if self.proc is not None and self.proc.poll() is not None:
                return False
            time.sleep(1.0)
        return False

    def stop(self):
        if self.proc is not None and self.proc.poll() is None:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
                # And let it act on it: a server that stalled may be a
                # stopped process, and a stopped process holds a SIGTERM
                # until it is continued -- ten seconds of waiting below, and
                # then the kill, for a restart somebody is waiting on.
                os.killpg(os.getpgid(self.proc.pid), signal.SIGCONT)
            except Exception:
                self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except Exception:
                try:
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                except Exception:
                    self.proc.kill()
        self.proc = None
        # And nothing else. A model already on this port is adopted rather
        # than replaced, and adopting a thing is not being handed the right to
        # end it: somebody may be running a model there on purpose, and
        # unloading a game must not take their work with it.
        left = port_pids(LLM_PORT)
        if left:
            LOG.say(f"the model on :{LLM_PORT} was already running when this "
                    f"started, so it is left running", source="llm")

    def memory_mb(self) -> float:
        """Resident size of the LLM, cached.

        This shells out to lsof and ps -- measured at ~45ms for the lsof alone
        -- and the UI asks for it five times a second on the event loop, which
        was stalling websocket traffic including streamed audio.
        """
        now = time.monotonic()
        if now - getattr(self, "_mem_at", 0.0) < 3.0:
            return self._mem_mb
        pids = port_pids(LLM_PORT)
        if self.proc is not None and self.proc.poll() is None:
            pids.append(self.proc.pid)
        self._mem_mb = sum(process_mb(p) for p in set(pids))
        self._mem_at = now
        return self._mem_mb

    def warm(self, messages, system: str | None = None) -> bool:
        """Push a prompt through with nothing to say, to leave it in the cache.

        Same body as a real turn and one token of output, so the server pays
        the prefill — the expensive half — while somebody is still looking at
        the page. The next turn arrives with the same front and re-uses it; see
        stream_reply, which explains why the layout of a prompt is what decides
        the cost of the turn after it.

        Quiet by design. Nothing here reaches the page or anything it keeps:
        a warm that fails costs the turn after it a second and a half, which is
        exactly what was happening before it existed.
        """
        body = {
            "model": str(self.model_path),
            "messages": _fronted(messages, system),
            "max_tokens": 1,
            "temperature": 0.0,
            "stream": False,
        }
        if self.server == "mlx_lm":
            body["chat_template_kwargs"] = {"enable_thinking": False}
        try:
            r = requests.post(f"{llm_url()}/v1/chat/completions", json=body,
                              timeout=(5, 120))
            return r.status_code == 200
        except Exception:
            return False

    def stream_reply(self, messages, on_delta, stop_flag: threading.Event,
                     system: str | None = None, temperature: float | None = None,
                     max_tokens: int | None = None, top_p: float | None = None):
        """Stream tokens from the OpenAI-compatible endpoint. Returns full text.

        The whole conversation goes over on every call and this client keeps
        nothing between them. The *server* does, though, and that is the thing
        to hold in mind when changing what goes in here: mlx_lm keeps the
        prompts it has processed and re-uses the longest matching prefix (see
        args, where the cache is sized, and the measurement there — 3.4s to
        first token against 1.6s).

        So a call is not priced by its length but by how much of its front the
        server has seen before. Which makes the layout of what is passed here
        load-bearing:

          * `system` is the stable part. Nothing that moves during a
            conversation may be put in it, however natural a home it looks.
          * `messages` wants to be append-only for as long as it can be.
          * anything that does move belongs pressed onto the last message,
            where it changes nothing in front of itself.

        One thing breaks it as it stands, and it is written up where it lives:
        the caller's own window slides its start forward one exchange per
        exchange, so past the window length every turn misses. See `window` in
        app/packages/talk/src/conversation/prompt.ts, which is the end that
        could fix it.
        """
        body = {
            "model": str(self.model_path),
            "messages": _fronted(messages, system),
            "max_tokens": int(max_tokens if max_tokens is not None
                              else LLM_OPTS.get("max_tokens", 220)),
            "temperature": float(temperature if temperature is not None
                                 else LLM_OPTS.get("temperature", 0.8)),
            "top_p": float(top_p if top_p is not None else LLM_OPTS.get("top_p", 0.95)),
            "stream": True,
        }
        if self.server == "mlx_lm":
            # This model thinks by default under mlx_lm, and the thinking
            # arrives as `reasoning` deltas rather than `content` -- so the
            # page shows nothing and the speaker says nothing, which looks
            # exactly like a hang. There is nothing to say out loud in a
            # chain of thought.
            body["chat_template_kwargs"] = {"enable_thinking": False}
        text = ""
        # The watch (FIRST_WORD_S, NEXT_WORD_S): a thread beside the read,
        # because the read is what blocks. It ends the read two ways, both by
        # shutting the response's socket (_unblock): the page gave up (the
        # stop flag), which frees `_words` at once rather than when the
        # server next says something; or no word in time, which is a stall,
        # raised as Stalled once the read has come back.
        clock = {"at": time.monotonic(), "words": False, "r": None}
        ended = threading.Event()
        stalled = threading.Event()

        def watch():
            while not ended.wait(0.2):
                limit = NEXT_WORD_S if clock["words"] else FIRST_WORD_S
                late = time.monotonic() - clock["at"] > limit
                if not (stop_flag.is_set() or late):
                    continue
                if late and not stop_flag.is_set():
                    stalled.set()
                if clock["r"] is not None:
                    _unblock(clock["r"])
                    return

        threading.Thread(target=watch, daemon=True, name="llm-watch").start()
        try:
            # The read timeout is the first word's, a little over: the headers
            # wait on it, and nothing can be shut down before there is a
            # response to shut. After them the watch always comes first.
            with requests.post(f"{llm_url()}/v1/chat/completions", json=body,
                               stream=True, timeout=(10, FIRST_WORD_S + 5)) as r:
                clock["r"] = r
                r.raise_for_status()
                for line in _lines(r, stop_flag):
                    if stalled.is_set():
                        break
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        delta = json.loads(payload)["choices"][0].get("delta", {}).get("content")
                    except Exception:
                        continue
                    if delta:
                        clock["at"], clock["words"] = time.monotonic(), True
                        text += delta
                        on_delta(delta)
        except requests.exceptions.ReadTimeout as e:
            if stop_flag.is_set():
                return text.strip()
            raise Stalled(f"no word in {FIRST_WORD_S:.0f} s") from e
        except Exception:
            # What a shut socket raises, from wherever it was mid-read, is
            # either of the two ends above and nothing to report.
            if stalled.is_set():
                raise Stalled(self._stalled_said(clock["words"])) from None
            if stop_flag.is_set():
                return text.strip()
            raise
        finally:
            ended.set()
        if stalled.is_set():
            raise Stalled(self._stalled_said(clock["words"]))
        return text.strip()

    @staticmethod
    def _stalled_said(words: bool) -> str:
        return (f"no new word in {NEXT_WORD_S:.0f} s" if words
                else f"no word in {FIRST_WORD_S:.0f} s")


class Voice:
    """Parakeet + OmniVoice.

    Every MLX call runs on one long-lived thread. MLX binds its default stream
    per thread, so loading on one thread and generating on another raises
    "no Stream(gpu, 0) in current thread" — and mixing threads has segfaulted
    this Qwen 3.5 hybrid stack before.
    """

    def __init__(self):
        self.stt = None
        self.tts = None
        self.sample_rate = 24000
        self.exaggeration = None   # a caller may set it; else the config's
        self.cfg_weight = None
        self.pause = None
        self.ref_path = None
        self.tags = frozenset()  # the delivery tags the loaded voice performs
        # The speaker conditioning per clip, derived once and kept: see
        # _conditioned. Keyed by the clip's path, size and mtime, so a clip
        # replaced on the shelf is derived again and a renamed one is not.
        self._conds: dict[tuple, object] = {}
        self.stats = {}       # last chunk: generation cost vs audio produced
        self._jobs: "queue.Queue" = queue.Queue()
        self._thread = threading.Thread(target=self._run, daemon=True, name="voice")
        self._thread.start()

    # ---------- the one MLX thread ----------

    def _run(self):
        import mlx.core as mx
        mx.set_default_device(mx.gpu)
        mx.set_default_stream(mx.default_stream(mx.gpu))
        while True:
            job, out = self._jobs.get()
            if job is None:
                return
            try:
                job(out)
            except Exception as e:  # surfaced on the caller's thread
                out.put(("error", e))
            out.put(("done", None))

    def _call(self, fn, timeout=900):
        out: "queue.Queue" = queue.Queue()
        self._jobs.put((lambda o: o.put(("ok", fn())), out))
        value = None
        while True:
            kind, payload = out.get(timeout=timeout)
            if kind == "ok":
                value = payload
            elif kind == "error":
                raise payload
            else:
                return value

    # ---------- loading ----------

    def _do_load_stt(self):
        if self.stt is None:
            from mlx_audio.stt.utils import load_model
            self.stt = load_model(str(STT_PATH))
        return True

    def _do_load_tts(self):
        if self.tts is None:
            from mlx_audio.tts.utils import load_model
            self.tts = load_model(str(CB_PATH))
            self.tags = voice_tags(CB_PATH)
        return True

    def load_stt(self):
        return self._call(self._do_load_stt)

    def load_tts(self):
        return self._call(self._do_load_tts)

    def set_reference(self, ref_path):
        """Point the clone at a speaker's clip. See machine/voices.py.

        Just a path. This used to copy the clip over a fixed file, which
        OmniVoice needed because it generated a speaker into that file when one
        was missing; chatterbox only ever reads a path.
        """
        self.ref_path = Path(ref_path)
        return True

    # ---------- inference ----------

    def transcribe(self, audio_16k: np.ndarray) -> str:
        def work():
            import mlx.core as mx
            self._do_load_stt()
            result = self.stt.generate(mx.array(audio_16k.astype(np.float32)))
            text = getattr(result, "text", None)
            return (text if text is not None else str(result)).strip()
        return self._call(work, timeout=300)

    def warm(self) -> bool:
        """Say something nobody hears, so the first real sentence is quicker.

        Nothing about this caches *what* will be said — that cannot be known,
        and it is not what costs. What costs is fixed and paid once: MLX
        compiling its kernels on first use, the working buffers being
        allocated, and the speaker conditioning being derived from the
        reference clip, which set_reference only wrote down the path of.

        Measured, same sentence, one after the other: 1.36s then 0.82s. Against
        a *different, longer* sentence in between at 1.63s for twice the audio
        — so the second call was already fast and it is the first call that is
        slow, whatever it is asked to say.

        Per voice, so it belongs after set_reference and again after every
        change of clip. The samples are thrown away: this is the model waking
        up, not anybody speaking.
        """
        try:
            for _ in self.speak(WARM_TEXT):
                pass
            return True
        except Exception:
            return False

    def speak(self, text: str, ref_path=None):
        """Yield (samples, sample_rate) chunks as they are generated.

        The clip comes with the call. There is one of these models and any
        number of rooms speaking through it, each in a voice of its own; a
        clip set on the model between calls is a clip the next room can
        change before this call reaches the thread -- which it did, and one
        pill spoke in the other's voice. set_reference remains for warming.
        """
        out: "queue.Queue" = queue.Queue()

        def job(o):
            self._do_load_tts()
            # The tags this voice performs stay; every other one goes. See
            # voice_text, and voice_tags for where the list comes from.
            ends_paragraph = text.endswith("\n")
            clean = voice_text(text, self.tags)
            if not clean:
                return
            turbo = is_turbo()
            base = self.exaggeration if self.exaggeration is not None else TTS_EXAG
            t0 = time.monotonic()
            ref = Path(ref_path) if ref_path else self.ref_path
            if not ref:
                # Nobody said which voice. There is no machine's own to fall
                # back to -- see machine/voices.py -- and this is said plainly
                # rather than handed to the synthesiser as the string "None",
                # which comes back as a missing-file traceback three frames
                # down.
                raise RuntimeError("no reference clip to speak from — name a "
                                   "voice; the shelf is models/voices/")
            kw = dict(text=clean, verbose=False)
            if not turbo:
                kw["exaggeration"] = sentence_exaggeration(clean, base)
                kw["cfg_weight"] = (self.cfg_weight if self.cfg_weight is not None
                                    else TTS_CFG)
            # The clip's conditioning, derived once per clip rather than once
            # per sentence -- see _conditioned, which says what that cost.
            conds = self._conditioned(ref, kw.get("exaggeration"))
            if conds is None:
                kw["ref_audio"] = str(ref)
            elif turbo:
                self.tts._conds = conds
            else:
                kw["conds"] = conds
            # The model prints a line per sentence ('S3 Token -> Mel'), which
            # buries the app's own log. Only this call is muted; loading and
            # any real error still print.
            with contextlib.redirect_stdout(io.StringIO()):
              for res in self.tts.generate(**kw):
                  samples = np.array(res.audio, dtype=np.float32).reshape(-1)
                  # chatterbox leaves ~0.5s of silence after each chunk, which is
                  # dead air between sentences.
                  samples = trim_silence(samples, res.sample_rate)
                  pause = self.pause if self.pause is not None else TTS_PAUSE
                  if ends_paragraph:
                      pause = max(pause, PARAGRAPH_PAUSE)
                  pause = max(0.0, min(3.0, float(pause)))
                  if pause:
                      samples = np.concatenate(
                          [samples, np.zeros(int(pause * res.sample_rate), np.float32)])
                  self.sample_rate = res.sample_rate
                  gen = time.monotonic() - t0
                  audio_s = samples.size / res.sample_rate if samples.size else 0.0
                  self.stats = {
                      "gen_s": round(gen, 2),
                      "audio_s": round(audio_s, 2),
                      # < 1 means it produced sound faster than it plays
                      "rtf": round(gen / audio_s, 2) if audio_s > 0.05 else None,
                      "words": len(clean.split()),
                      "mem_gb": round(self.memory_mb() / 1024, 2),
                  }
                  o.put(("chunk", (samples, res.sample_rate)))
                  t0 = time.monotonic()

        self._jobs.put((job, out))
        while True:
            kind, payload = out.get(timeout=300)
            if kind == "chunk":
                yield payload
            elif kind == "error":
                raise payload
            else:
                return

    def _conditioned(self, ref: Path, exaggeration=None):
        """The speaker conditioning for a clip, derived the first time and
        kept for every sentence after.

        Handed `ref_audio` on every call, Chatterbox derives the whole of the
        conditioning again each time: the clip read off disk, loudness
        normalised, resampled twice, run through the speech tokenizer and the
        voice encoder, and the decoder's reference embedded -- for a sentence
        of a reply, every sentence of every reply, in a voice that has not
        changed since the room opened. That was most of the fixed cost per
        call the splitter's note measures (~0.4s before a word is said).
        Derived once here, it is the same arrays every time: nothing in the
        derivation samples, so what the voice is conditioned on is byte for
        byte what it was conditioned on before.

        Turbo keeps its conditioning on the model and reads it when no clip is
        passed; the full model takes it as an argument, and moves its own
        exaggeration onto it per call -- so the base is derived with the
        exaggeration of the first sentence and the model adjusts it after,
        exactly as it did when it derived a fresh one. A model with no
        prepare_conditionals answers None, and the clip goes with the call as
        it always did.

        On the one MLX thread, like everything that touches the model.
        """
        prepare = getattr(self.tts, "prepare_conditionals", None)
        if prepare is None:
            return None
        try:
            st = ref.stat()
        except OSError:
            return None
        key = (str(ref), st.st_size, st.st_mtime_ns)
        got = self._conds.get(key)
        if got is None:
            if len(self._conds) >= 8:
                self._conds.clear()      # a shelf's worth; the next derives again
            if is_turbo():
                prepare(str(ref), exaggeration=0.0, norm_loudness=True)
                got = self.tts._conds
            else:
                got = prepare(str(ref), self.tts.sample_rate,
                              exaggeration if exaggeration is not None else TTS_EXAG)
            self._conds[key] = got
        return got

    # ---------- teardown ----------

    def unload(self):
        """Both of them, and every byte they were holding."""
        self._drop("stt", "tts")

    def unload_stt(self):
        """The ear alone; the voice stays where it is.

        The two are wanted for different reasons and stop being wanted at
        different moments -- a microphone that goes off is not a speaker that
        goes quiet -- and putting the pair away to reclaim one of them is the
        other one loading again at the next sentence, which is the fifteen
        seconds this is trying to save.
        """
        self._drop("stt")

    def unload_tts(self):
        """And the voice alone."""
        self._drop("tts")

    def _drop(self, *which: str):
        """Let go of the named models on the one MLX thread, and free the cache.

        On that thread because everything else here is: MLX binds its default
        stream per thread, and dropping a model from under a generation running
        on another one is the segfault this class exists to avoid.
        """
        def work():
            import mlx.core as mx
            for name in which:
                setattr(self, name, None)
            if "tts" in which:
                self._conds.clear()      # derived from a model that is gone
            mx.clear_cache()
            return True
        try:
            self._call(work, timeout=60)
        except Exception:
            for name in which:
                setattr(self, name, None)

    def memory_mb(self) -> float:
        import mlx.core as mx
        return (mx.get_active_memory() + mx.get_cache_memory()) / (1024 * 1024)
