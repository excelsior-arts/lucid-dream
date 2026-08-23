"""Mic capture with VAD and speaker playback. Python owns the audio devices."""

from __future__ import annotations

import queue
import threading
import time
from collections import deque

import numpy as np

from shell import log as LOG
from scipy.signal import resample_poly

STT_RATE = 16000
BLOCK_MS = 32
BLOCK = STT_RATE * BLOCK_MS // 1000

# VAD tuning. Levels are RMS of float32 samples in [-1, 1].
ONSET_BLOCKS = 3            # ~96 ms above threshold before we call it speech
HANGOVER_MS = 700           # trailing silence that ends a turn
MIN_TURN_MS = 500           # shorter than this is a cough, not a sentence
MAX_TURN_MS = 30000
PREROLL_BLOCKS = 8          # keep ~256 ms before onset so we don't clip the first word
FLOOR_MIN = 0.004           # absolute floor so a silent room can't arm the VAD
FLOOR_MULT = 3.0            # speech must beat the running noise floor by this much
# And then it may go quiet again without having stopped.
#
# One threshold cannot do both jobs. Starting to speak is a loud event —
# floor x 3 keeps a fan, a fridge and a room from arming the mic. Continuing to
# speak is not: an unstressed syllable, the tail of a question, the breath in
# the middle of a sentence all fall under that bar while somebody is plainly
# still talking. With one gate for both, "so who you are?" armed the mic, fell
# below the bar on the second syllable, and was measured at 384ms of a
# second-long sentence — then dropped as too short to be one.
#
# So: arm high, sustain low, which is what every voice detector does. As a
# multiple of the same floor, and comfortably above it, because this one has
# only to tell a voice from the room rather than from a doorway.
SUSTAIN_MULT = 1.4
BARGE_MULT = 6.0            # louder still to interrupt playback
BARGE_GRACE_MS = 600        # ignore the mic right after playback starts
# How much of the pill's own voice the browser's echo canceller must have
# heard before talking over it is believed.
#
# Canceling an echo means subtracting a signal the canceller has to learn
# first, and it can only learn while there is something to cancel -- so it is
# at its worst on the first reply after the mic opens and good from the second
# on. Which is exactly backwards for us: barge-in is armed from the first
# word, so the pill hears itself, decides it was interrupted, and stops in the
# middle of its opening line. Every browser does this; they differ only in how
# long they take to converge.
#
# Measured in playback actually heard rather than wall-clock, because a
# canceller learns nothing from silence. The cost is the first second and a
# half of the first reply, which cannot be interrupted by voice -- Skip and
# typing both still stop it. 0 trusts the canceller from the first block.
BARGE_LEARN_MS = 1500
# Loudness alone cannot tell a voice from a door: both clear the gate, and one
# of them stops it mid-sentence. Speech is periodic — it has a pitch — and a
# bang, a cough, a keyboard or a chair does not. 0 disables the test.
BARGE_VOICED = 0.30


def apply_config(cfg: dict):
    global FLOOR_MULT, SUSTAIN_MULT, HANGOVER_MS, MIN_TURN_MS, MAX_TURN_MS, BARGE_MULT
    global BARGE_GRACE_MS, BARGE_VOICED, BARGE_LEARN_MS
    v = cfg.get("vad", {})
    FLOOR_MULT = float(v.get("floor_mult", FLOOR_MULT))
    SUSTAIN_MULT = float(v.get("sustain_mult", SUSTAIN_MULT))
    HANGOVER_MS = int(v.get("hangover_ms", HANGOVER_MS))
    MIN_TURN_MS = int(v.get("min_turn_ms", MIN_TURN_MS))
    MAX_TURN_MS = int(v.get("max_turn_ms", MAX_TURN_MS))
    BARGE_MULT = float(v.get("barge_mult", BARGE_MULT))
    BARGE_GRACE_MS = int(v.get("barge_grace_ms", BARGE_GRACE_MS))
    BARGE_VOICED = float(v.get("barge_voiced", BARGE_VOICED))
    BARGE_LEARN_MS = int(v.get("barge_learn_ms", BARGE_LEARN_MS))


def voicedness(block: np.ndarray, rate: int = STT_RATE) -> float:
    """How periodic this block is, 0 to 1.

    A vowel repeats itself at the speaker's pitch, so it correlates strongly
    with itself one period later. A cough, a keystroke or a chair scrape has no
    period at all and scores near zero.
    """
    n = block.size
    lo, hi = rate // 400, rate // 70          # 70-400 Hz, a human range
    if n <= hi:
        return 0.0
    a = block - block.mean()
    ac = np.correlate(a, a, "full")[n - 1:]
    if ac[0] <= 0:
        return 0.0
    return float((ac[lo:hi] / ac[0]).max())


def speechlike(block: np.ndarray, rate: int = STT_RATE) -> bool:
    """Whether this block could be a voice, on two counts.

    Periodicity alone lets a resonant thump through -- a door closing is a
    decaying low tone, and a tone is periodic. Speech carries its vowels in
    formants well above the pitch, so requiring real energy above 300 Hz
    separates a voice from a thud without touching a voice.

    Only ever called on a block that already passed the loudness gate, so it
    costs nothing while the room is quiet.
    """
    if voicedness(block, rate) < BARGE_VOICED:
        return False
    spec = np.abs(np.fft.rfft(block * np.hanning(block.size))) ** 2
    freq = np.fft.rfftfreq(block.size, 1.0 / rate)
    total = spec.sum()
    return bool(total > 0 and spec[freq >= 300].sum() / total >= 0.10)


class Mic:
    """Continuous 16 kHz capture, fed by the page.

    Blocks arrive through feed() over the websocket. Nothing here opens a
    device, and nothing here may: the page is the only thing on this machine
    that records or plays, and this process must never hold a microphone.

    Two reasons, and both of them bite the moment it does. A microphone has one
    holder, so a device taken here is a device the browser is refused — and the
    page has nowhere else to go. And the pill's voice comes out of that same
    page, so a microphone opened here is one listening to a speaker with
    nothing canceling the echo between them, which is a pill answering itself.

    What is left in this file is the listening rather than the device: where a
    voice starts and stops, how loud the room is, and when somebody has talked
    over the pill.
    """

    def __init__(self):
        self.utterances: queue.Queue = queue.Queue()
        self.level = 0.0
        self.floor = FLOOR_MIN
        self.mode = "hands_free"     # or "push_to_talk"
        self.barge_in = True
        self.enabled = True
        self.ptt_down = False
        self.speaker = None          # the sink, for gating the mic while it talks
        self.on_event = None         # (name, payload)
        self._blocks: queue.Queue = queue.Queue()
        self._thread = None
        self._stop = threading.Event()
        self._native_rate = STT_RATE

    def _emit(self, name, **payload):
        if self.on_event:
            self.on_event(name, payload)

    def feed(self, samples: np.ndarray, rate: int):
        """A page handing us captured audio.

        The VAD, barge-in and utterance assembly all read from one queue, so a
        page only has to put blocks into it and nothing downstream knows where
        they came from.
        """
        if self._stop.is_set():
            return
        block = np.asarray(samples, dtype=np.float32).reshape(-1)
        if rate != STT_RATE and block.size:
            n = int(block.size * STT_RATE / rate)
            block = np.interp(np.linspace(0, block.size - 1, n),
                              np.arange(block.size), block).astype(np.float32)
        self._blocks.put(block)

    def start(self):
        """Begin listening. Nothing is opened: blocks arrive through feed()."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._native_rate = STT_RATE
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _to_stt_rate(self, block: np.ndarray) -> np.ndarray:
        if self._native_rate == STT_RATE:
            return block
        g = np.gcd(self._native_rate, STT_RATE)
        return resample_poly(block, STT_RATE // g, self._native_rate // g).astype(np.float32)

    def _run(self):
        preroll = deque(maxlen=PREROLL_BLOCKS)
        barged = False           # this turn began by stopping the pill
        learned_ms = 0.0         # playback heard since this mic opened
        said_learning = False
        collected: list[np.ndarray] = []
        speaking = False
        onset = 0
        voiced_hits = 0
        silence_ms = 0.0
        ptt_was_down = False

        while not self._stop.is_set():
            try:
                raw = self._blocks.get(timeout=0.2)
            except queue.Empty:
                continue
            block = self._to_stt_rate(raw)
            rms = float(np.sqrt(np.mean(block * block))) if block.size else 0.0
            self.level = rms

            out_active = self.speaker is not None and self.speaker.playing

            # Track the room's noise floor only while nothing else is going on.
            if not speaking and not out_active and rms < max(self.floor * 2, FLOOR_MIN * 2):
                self.floor = 0.98 * self.floor + 0.02 * rms
            self.floor = max(self.floor, FLOOR_MIN * 0.5)

            if not self.enabled:
                collected, speaking, onset, silence_ms = [], False, 0, 0.0
                continue

            gate = max(self.floor * FLOOR_MULT, FLOOR_MIN)
            sustain = max(self.floor * SUSTAIN_MULT, FLOOR_MIN * 0.7)

            if self.mode == "push_to_talk":
                if self.ptt_down and not ptt_was_down:
                    collected, preroll = [], deque(maxlen=PREROLL_BLOCKS)
                    if self.speaker:
                        self.speaker.stop()
                    self._emit("listening", active=True)
                if self.ptt_down:
                    collected.append(block)
                elif ptt_was_down:
                    self._finish(collected)
                    collected = []
                    self._emit("listening", active=False)
                ptt_was_down = self.ptt_down
                continue

            # Hands-free.
            if out_active:
                loud = rms > max(self.floor * BARGE_MULT, FLOOR_MIN * 2)
                past_grace = self.speaker.since_start_ms > BARGE_GRACE_MS
                learning = learned_ms < BARGE_LEARN_MS
                if learning and self.barge_in and loud and past_grace \
                        and not said_learning:
                    # Only if somebody actually talked over it, and only once:
                    # otherwise the one time this matters looks like the mic
                    # being broken.
                    said_learning = True
                    self._emit("log", text="not interrupting yet — the "
                               "browser is still learning to cancel the "
                               "pill's own voice. Skip stops it")
                if self.barge_in and loud and past_grace and not learning:
                    onset += 1
                    # Somewhere in the run there has to be a voice. Consonants
                    # are unvoiced, so one block out of the three is enough --
                    # what this rejects is a run with no pitch in it at all.
                    if BARGE_VOICED and speechlike(block):
                        voiced_hits += 1
                    if onset >= ONSET_BLOCKS and (voiced_hits or not BARGE_VOICED):
                        self.speaker.stop()
                        self._emit("barge_in")
                        collected = list(preroll)
                        speaking, onset, silence_ms = True, 0, 0.0
                        voiced_hits = 0
                        # Remembered, because this decision is made in about a
                        # tenth of a second and is sometimes wrong. A chair
                        # moving is loud and has pitch in it. Whoever hears the
                        # end of this turn needs to know that stopping the pill
                        # is riding on it.
                        barged = True
                        self._emit("listening", active=True)
                else:
                    onset = 0
                    voiced_hits = 0
                learned_ms += block.size * 1000.0 / STT_RATE
                preroll.append(block)
                continue

            if not speaking:
                preroll.append(block)
                if rms > gate:
                    onset += 1
                    if onset >= ONSET_BLOCKS:
                        collected = list(preroll)
                        speaking, onset, silence_ms = True, 0, 0.0
                        self._emit("listening", active=True)
                else:
                    onset = 0
                continue

            collected.append(block)
            # The lower bar: still talking, rather than starting to. See
            # SUSTAIN_MULT — this is the difference between hearing a sentence
            # and hearing its first syllable.
            silence_ms = 0.0 if rms > sustain else silence_ms + BLOCK_MS
            length_ms = len(collected) * BLOCK_MS
            if silence_ms >= HANGOVER_MS or length_ms >= MAX_TURN_MS:
                speaking = False
                self._emit("listening", active=False)
                if length_ms - silence_ms >= MIN_TURN_MS:
                    self._finish(collected)
                else:
                    # Too brief to be a sentence. It used to end here in
                    # silence, which looks from the page like the turn was
                    # heard and then quietly lost.
                    #
                    # And if the pill was stopped to make room for it, that was
                    # a mistake somebody can hear: a room noise took the reply
                    # away and put nothing in its place. Said so here, where
                    # both halves are known, so it can be put back.
                    self._emit("dropped", ms=int(length_ms - silence_ms),
                               barged=barged)
                collected = []
                preroll.clear()
                barged = False

    def _finish(self, blocks: list[np.ndarray]):
        if not blocks:
            return
        audio = np.concatenate(blocks).astype(np.float32)
        if audio.size < STT_RATE * MIN_TURN_MS // 1000:
            return
        self.utterances.put(audio)

    def close(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
