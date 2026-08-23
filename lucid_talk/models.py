"""Model stack: Qwen subprocess, Parakeet STT, OmniVoice TTS. One owner, one thread."""

from __future__ import annotations

import contextlib
import io
import json
import os
import queue
import re
import signal
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import requests

from . import paths, prompts
from shell import log as LOG

HOME = Path.home()
VENV_BIN = paths.ROOT / ".venv" / "bin"    # replaced by config's llm.venv on start
LLM_4BIT = HOME / "Models" / "Qwen3.8-27B-Uncensored-MLX" / "4-bit"
LLM_6BIT = HOME / "Models" / "Qwen3.8-27B-Uncensored-MLX-6bit" / "6-bit"
STT_PATH = HOME / "Models" / "parakeet-tdt-0.6b-v2"
TTS_PATH = CB_PATH = HOME / "Models" / "Chatterbox-fp16"
# Fallback clip, used only when a persona has no clip of its own.
VOICE_REF = paths.PERSONAS / "lover" / "voice.ref.wav"

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

VOICE_REF_TEXT = "Hello. I will use this same voice for every reply."
# What the voice says to itself before anybody is listening. Short, and never
# heard: the length only has to be enough to take the whole path once. See
# Voice.warm.
WARM_TEXT = "Yes. I am here."
LLM_OPTS = {"max_tokens": 220, "temperature": 0.8, "top_p": 0.95, "max_kv_size": 8192}


def apply_config(cfg: dict):
    """Let config.json drive generation without touching code."""
    global STT_PATH, TTS_PATH, CB_PATH, VOICE_REF, VENV_BIN
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
    if t.get("voice_ref"):
        VOICE_REF = Path(t["voice_ref"])
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

# Parakeet is far better than Whisper here, but a near-silent clip still yields filler.
JUNK = {
    "thank you", "thanks", "thanks for watching", "thank you for watching",
    "thanks for listening", "thank you for listening", "you", "bye", "goodbye",
    "please subscribe", "subscribe", "the end",
}


def normalize(text: str) -> str:
    t = re.sub(r"[^\w\s]", " ", text.lower().strip())
    return re.sub(r"\s+", " ", t).strip()


def is_junk(text: str) -> bool:
    n = normalize(text)
    return not n or n in JUNK


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


# The first chunk decides how soon it starts talking; the rest decide how much
# total work there is. Chatterbox has a large fixed cost per call -- 8 words
# costs ~3.2s and 16 words ~4.0s -- so many small chunks are far more expensive
# than a few larger ones. Measured on one reply: three sentences cost 15.2s of
# generation for 7.3s of audio, the same text in two chunks cost 7.6s.
MERGE_WORDS = 14

# How long the very first thing said may be. Everything after it is already
# covered by audio playing, so only this one is worth hurrying: a reply that
# opens with a forty-word sentence takes ~3s to write and ~3s to synthesise
# before a sound comes out, and a comma seven words in is a place a person
# would pause anyway.
FIRST_CHUNK_WORDS = 12
CLAUSE_END = re.compile(r"[,;:—–]\s")


def _shorten_opening(chunk: str) -> list[str]:
    """Cut the first chunk at a clause boundary, if it is long enough to wait for."""
    if len(chunk.split()) <= FIRST_CHUNK_WORDS:
        return [chunk]
    cut = None
    for m in CLAUSE_END.finditer(chunk):
        if len(chunk[:m.end()].split()) > FIRST_CHUNK_WORDS:
            break
        cut = m.end()
    if not cut:
        return [chunk]
    head, tail = chunk[:cut].strip(), chunk[cut:].strip()
    return [head, tail] if head and tail else [chunk]


def spoken_prefix(full: str, chunks: list[str]) -> str:
    """As much of the model's own text as was actually said out loud.

    A reply that was interrupted is stored as what was heard, not as what was
    written — anything else puts words in a transcript that nobody in the room
    ever heard. The obvious way to get that is to rejoin the chunks that were
    spoken, and it is wrong: the splitter has already taken the model's blank
    lines out and left one newline in their place, so rejoining with spaces
    stores "one paragraph.\n another" where the model wrote two. Read back from
    History a day later, a reply that arrived with air in it is a block with
    stray spaces down the left. Measured on this machine: 92 of 279 stored
    replies carry that signature.

    So the words are counted rather than joined, and the count is used to cut
    the model's own text where the voice stopped. Whitespace, breaks and all
    come back exactly as they were written.
    """
    want = sum(len(c.split()) for c in chunks)
    if not want or not full.strip():
        return ""
    seen = 0
    for m in re.finditer(r"\S+", full):
        seen += 1
        if seen >= want:
            return full[:m.end()]
    return full


def split_for_speech(text: str, first_short: bool = False):
    """Split a reply into speakable chunks.

    A paragraph is a unit of thought, so it is never merged into the next one:
    the model put the break there, and letting one call span it flattens the
    arc it was building. Within a paragraph, sentences after the first are
    merged up to MERGE_WORDS, because the per-call overhead costs more than the
    extra words do -- the first sentence goes alone so speech starts sooner.
    """
    out = []
    # Keep track of whether each paragraph was actually terminated in the text.
    # While a reply is streaming the last one is still being written, and
    # marking it made the caller treat every new token as a finished paragraph
    # -- which came out as one word at a time.
    pieces = re.split(r"(\n\s*\n+|\n)", text)
    paras = []
    for i in range(0, len(pieces), 2):
        body = pieces[i]
        terminated = (i + 1) < len(pieces)
        if body.strip():
            paras.append((body.strip(), terminated))
    for para, terminated in paras:
        # "Stay... just like that." is one sentence: an ellipsis is a pause,
        # not a boundary, and splitting there makes it a hard cut between clips.
        #
        # Both spellings of it. The three-dot one was held together and the
        # single character was cut at, so the same line delivered two ways
        # depending on which key the model happened to reach for — and the
        # typed one is the one it reaches for most.
        parts = [t.strip()
                 for t in re.split(r"(?<=[.!?])(?<!\.\.\.)\s+", para)
                 if t.strip()]
        merged = []
        for part in parts:
            wordless = not re.search(r"[a-zA-Z0-9]", re.sub(r"\[[a-z-]+\]", "", part))
            if merged and wordless:
                # a tag with no words of its own would be dropped before synthesis
                merged[-1] = f"{merged[-1]} {part}".strip()
            elif (merged and (len(merged) > 1 or out)
                  and len(merged[-1].split()) < MERGE_WORDS):
                merged[-1] = f"{merged[-1]} {part}".strip()
            else:
                merged.append(part)
        if merged and terminated:
            # A trailing newline marks the end of a paragraph. trim_silence
            # strips the natural tail off every chunk, so without this the next
            # paragraph starts instantly and the break the model wrote is
            # inaudible.
            merged[-1] += "\n"
        out.extend(merged)
    # Only the opening of a reply. Doing this everywhere would trade the wait
    # for a stream of small calls, and Chatterbox charges a fixed cost each.
    if first_short and out:
        out = _shorten_opening(out[0]) + out[1:]
    return out


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
    anything reading a persona's delivery keys has to ask this first.
    """
    return "turbo" in str(CB_PATH).lower()


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


class LLMServer:
    """Supervises mlx_vlm.server as a child process we can actually kill."""

    def __init__(self, model_path: Path | str = LLM_4BIT, log_path: Path | None = None):
        self.model_path = Path(model_path)
        self.server = str(LLM_OPTS.get("server") or "mlx_lm")
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
        the system prompt, the persona, the memory and the relation come to
        some 800 words that do not change between turns, and mlx_vlm re-reads
        every one of them every time. Measured on one machine, same model,
        same prompt, time to first token: 3.4s against 1.6s.

        mlx_lm does not take --kv-bits or --max-kv-size; it is bounded by the
        size of its prompt cache instead. mlx_vlm is what a vision model would
        need, which is why both are here.
        """
        common = ["--host", LLM_HOST, "--port", str(LLM_PORT),
                  "--model", str(self.model_path), "--max-tokens", "2048"]
        if self.server == "mlx_lm":
            gb = float(LLM_OPTS.get("prompt_cache_gb", 4))
            return ([str(VENV_BIN / "mlx_lm.server")] + common
                    + ["--prompt-cache-bytes", str(int(gb * 1e9))] + draft_args())
        return ([str(VENV_BIN / "mlx_vlm.server")] + common
                + ["--kv-bits", "4",
                   "--max-kv-size", str(LLM_OPTS.get("max_kv_size", 8192))]
                + draft_args())

    def start(self):
        if self.running() or self.ready():
            return
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        log = open(self.log_path, "ab", buffering=0)
        self.proc = subprocess.Popen(
            self.args(),
            stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True,  # own process group, so we can kill the whole tree
            env={**os.environ, "PATH": f"{VENV_BIN}:{os.environ.get('PATH', '')}"},
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
        the room. The next turn arrives with the same front and re-uses it; see
        stream_reply, which explains why the layout of a prompt is what decides
        the cost of the turn after it.

        Quiet by design. Nothing here reaches the page, the transcript or the
        memory: a warm that fails costs the turn after it a second and a half,
        which is exactly what was happening before it existed.
        """
        body = {
            "model": str(self.model_path),
            "messages": [{"role": "system", "content": system or prompts.get("system")}] + messages,
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

          * `system` is the stable part -- persona, memories, the relation as
            banded prose. Nothing that moves during a conversation may be added
            to it, however natural a home it looks.
          * `messages` wants to be append-only for as long as it can be.
          * the scene and the conduct are pressed onto the last user turn on
            purpose (Session._scene_press), so they change nothing in front of
            themselves.

        One thing breaks it as it stands, and it is written up where it lives:
        Session._window slides its start forward one exchange per exchange, so
        past the window length every turn misses. That is the first thing to
        fix if time-to-first-token ever needs to come down.
        """
        body = {
            "model": str(self.model_path),
            "messages": [{"role": "system", "content": system or prompts.get("system")}] + messages,
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
        with requests.post(f"{llm_url()}/v1/chat/completions", json=body,
                           stream=True, timeout=(10, 300)) as r:
            r.raise_for_status()
            for line in r.iter_lines(decode_unicode=True):
                if stop_flag.is_set():
                    break
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    delta = json.loads(payload)["choices"][0].get("delta", {}).get("content")
                except Exception:
                    continue
                if delta:
                    text += delta
                    on_delta(delta)
        return text.strip()


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
        self.exaggeration = None   # persona overrides; fall back to config
        self.cfg_weight = None
        self.pause = None
        self.ref_path = None
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
        return True

    def load_stt(self):
        return self._call(self._do_load_stt)

    def load_tts(self):
        return self._call(self._do_load_tts)

    def set_reference(self, ref_path):
        """Point the clone at a speaker's clip (persona switch).

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

        Per voice, so it belongs after set_reference and again after a pill
        switch. The samples are thrown away: this is the model waking up, not
        anybody speaking.
        """
        try:
            for _ in self.speak(WARM_TEXT):
                pass
            return True
        except Exception:
            return False

    def speak(self, text: str):
        """Yield (samples, sample_rate) chunks as they are generated."""
        out: "queue.Queue" = queue.Queue()

        def job(o):
            self._do_load_tts()
            # Bracketed tags are read aloud as words -- "[surprise-oh] you did
            # it" comes back as "Surprise. Oh, you did it", and a leading one
            # can derail the whole sentence. Nothing in the prompt asks for
            # them any more; this is the guard for when a model emits one.
            ends_paragraph = text.endswith("\n")
            clean = re.sub(r"\[[a-z-]+\]", " ", text)
            # *mmm* is a sound the model wrapped in emphasis; the marks would
            # otherwise be at the mercy of the tokenizer.
            clean = clean.replace("*", " ")
            clean = re.sub(r"\s{2,}", " ", clean).strip()
            if not clean:
                return
            turbo = is_turbo()
            base = self.exaggeration if self.exaggeration is not None else TTS_EXAG
            t0 = time.monotonic()
            kw = dict(text=clean, ref_audio=str(self.ref_path or VOICE_REF),
                      verbose=False)
            if not turbo:
                kw["exaggeration"] = sentence_exaggeration(clean, base)
                kw["cfg_weight"] = (self.cfg_weight if self.cfg_weight is not None
                                    else TTS_CFG)
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

    # ---------- teardown ----------

    def unload(self):
        def work():
            import mlx.core as mx
            self.stt = None
            self.tts = None
            mx.clear_cache()
            return True
        try:
            self._call(work, timeout=60)
        except Exception:
            self.stt = self.tts = None

    def memory_mb(self) -> float:
        import mlx.core as mx
        return (mx.get_active_memory() + mx.get_cache_memory()) / (1024 * 1024)
