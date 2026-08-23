"""Score a candidate reference clip before you commit to it.

    python voicecheck.py mycllip.wav

Cloning copies delivery, not just timbre, so a flat reference produces a flat
companion no matter how the engine is tuned. That is not a guess: cloning s7
measured 2.2 st of pitch movement while Chatterbox's own voice measured 5.3 st
on the identical line and settings. This tells you which side of that your clip
falls on, before you spend an evening blaming the wrong knob.
"""
from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

TARGET_SR = 24000       # S3GEN_SR: what the decoder resamples to anyway
GOOD_SD = 3.5           # semitones of pitch movement; s7 sat at 2.2 and was flat
OK_SD = 2.8

# Chatterbox slices the reference by hard prefix, so only the front matters:
#   ENC_COND_LEN = 6s  -> the encoder that drives PROSODY
#   DEC_COND_LEN = 10s -> the decoder that carries TIMBRE
# Audio past 10s is discarded. Audio past 6s shapes the voice but not the
# delivery, which is why a lively passage at 0:12 changes nothing.
PROSODY_S = 6.0
TIMBRE_S = 10.0


def load(path: Path):
    with wave.open(str(path)) as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = np.frombuffer(w.readframes(n), np.int16).astype(np.float32) / 32768
    if ch > 1:
        raw = raw.reshape(-1, ch).mean(axis=1)
    return raw, sr, ch


def contour(a: np.ndarray, sr: int):
    """Median F0 and how far the pitch actually moves, in semitones."""
    fr, hop = int(0.04 * sr), int(0.01 * sr)
    f0 = []
    for i in range(0, len(a) - fr, hop):
        x = a[i:i + fr]
        if np.sqrt((x ** 2).mean()) < 0.01:
            continue
        x = x - x.mean()
        c = np.correlate(x, x, "full")[fr - 1:]
        if c[0] <= 0:
            continue
        c = c / c[0]
        lo, hi = int(sr / 400), int(sr / 70)
        seg = c[lo:hi]
        if not len(seg):
            continue
        k = int(np.argmax(seg))
        if seg[k] < 0.35:          # unvoiced or noise
            continue
        f0.append(sr / (lo + k))
    f0 = np.array(f0)
    if len(f0) < 15:
        return None
    semi = 12 * np.log2(f0 / np.median(f0))
    semi = semi[np.abs(semi) < 12]      # drop octave errors
    voiced = len(f0) * 0.01
    return np.median(f0), semi.std(), np.percentile(semi, 95) - np.percentile(semi, 5), voiced


def speaker_spread(a: np.ndarray, sr: int, seg_s: float = 1.0) -> float:
    """How much the voice's own pitch center wanders, in semitones.

    One person speaking has a fairly steady center and moves around it. Two
    people have two centers, and the gap between them shows up here. It matters
    because a multi-speaker clip scores *well* on pitch movement -- the movement
    is between speakers, not within one -- and cloning it blends the voices.
    """
    n = int(seg_s * sr)
    if a.size < n * 3:
        return 0.0
    centers = []
    for i in range(0, a.size - n, n):
        m = contour(a[i:i + n], sr)
        if m and m[3] > seg_s * 0.35:      # enough voiced audio to trust
            centers.append(m[0])
    if len(centers) < 3:
        return 0.0
    centers = np.array(centers)
    return float(np.std(12 * np.log2(centers / np.median(centers))))


def noise_floor_db(a: np.ndarray, sr: int) -> float:
    """How loud the clip is in the gaps between words, relative to the speech.

    Clean speech drops to near silence between phrases. A music bed, room tone
    or hiss holds the floor up, and that bed gets cloned along with the voice.
    It also fools the pitch tracker: sustained notes are periodic, so a scored
    "pitch contour" can be measuring the soundtrack rather than the speaker.
    """
    fr = max(1, int(0.03 * sr))
    n = len(a) // fr
    if n < 10:
        return -99.0
    rms = np.sqrt((a[:n * fr].reshape(n, fr) ** 2).mean(axis=1))
    if rms.size < 10:
        return -99.0
    speech = np.percentile(rms[rms > 0], 90) if (rms > 0).any() else 0.0
    if speech <= 0:
        return -99.0
    # Per-second, then take the median: one percentile over the whole window
    # lets a bed hide behind whichever half happens to be clean.
    per_s = max(1, int(1.0 / 0.03))
    blocks = [rms[i:i + per_s] for i in range(0, len(rms), per_s)]
    floors = [np.percentile(b, 10) for b in blocks if len(b) >= per_s // 2]
    if not floors:
        return -99.0
    return 20 * np.log10(max(float(np.median(floors)), 1e-9) / speech)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = Path(sys.argv[1]).expanduser()
    if not path.exists():
        print(f"no such file: {path}")
        return 1

    a, sr, ch = load(path)
    dur = len(a) / sr
    print(f"{path.name}")
    print(f"  {dur:.1f}s, {sr} Hz, {'mono' if ch == 1 else f'{ch} channels'}")

    notes = []
    if dur < PROSODY_S:
        notes.append(f"only {dur:.1f}s — the encoder wants {PROSODY_S:.0f}s of delivery")
    if ch != 1:
        notes.append("not mono — convert it")
    if sr != TARGET_SR:
        notes.append(f"{sr} Hz — resample to {TARGET_SR}")
    peak = float(np.abs(a).max())
    if peak > 0.99:
        notes.append("clipped — find a cleaner source")
    elif peak < 0.15:
        notes.append(f"quiet (peak {peak:.2f}) — normalize it")

    if dur > TIMBRE_S + 0.5:
        notes.append(f"{dur - TIMBRE_S:.0f}s past {TIMBRE_S:.0f}s is ignored entirely — trim it")

    m = contour(a, sr)
    if m is None:
        print("  not enough voiced speech to judge — is this music, or mostly silence?")
        return 1
    f0, sd, rng, voiced = m

    # The number that decides delivery: only the first 6s reaches the encoder.
    head = contour(a[:int(PROSODY_S * sr)], sr)
    if head is None:
        print(f"  the first {PROSODY_S:.0f}s has almost no speech in it — that window is")
        print("  all the delivery the engine ever sees. Start the clip on the talking.")
        return 1
    h_f0, h_sd, h_rng, h_voiced = head
    f0 = h_f0
    if f0 >= 180:
        band = "clearly female"
    elif f0 >= 150:
        band = "low female, or a high male voice — listen before trusting this"
    else:
        band = "male range"
    print(f"  median pitch  {h_f0:6.1f} Hz   ({band})")
    print(f"  pitch movement{h_sd:6.2f} st   <- first {PROSODY_S:.0f}s, THIS decides delivery")
    print(f"                {sd:6.2f} st      whole clip, for comparison")
    print(f"  pitch range   {h_rng:6.2f} st")
    print(f"  voiced speech {h_voiced:6.1f}s of the first {PROSODY_S:.0f}s")

    spread = speaker_spread(a[:int(TIMBRE_S * sr)], sr)
    print(f"  voice steadiness{spread:5.2f} st   (one speaker stays under ~2)")
    if spread > 3.5:
        notes.append(f"MORE THAN ONE VOICE almost certainly ({spread:.1f} st between "
                     "one-second pitch centers). The movement score above is measuring "
                     "the difference between speakers. Trim to a single speaker.")
    elif spread > 2.0:
        notes.append(f"pitch center wanders ({spread:.1f} st) — either a very "
                     "expressive speaker or a second voice; listen before trusting it")

    floor = noise_floor_db(a[:int(PROSODY_S * sr)], sr)
    print(f"  gap loudness  {floor:6.1f} dB   (clean speech is below -35)")
    if floor > -20:
        notes.append("LOUD BACKGROUND — music or noise under the speech. It gets "
                     "cloned into the voice, and the pitch number above is partly "
                     "measuring it. Find a passage with clean dialogue.")
    elif floor > -35:
        notes.append(f"audible background ({floor:.0f} dB between words) — usable, "
                     "but a cleaner passage clones better")
    if h_voiced < 3.0:
        notes.append(f"only {h_voiced:.1f}s of actual speech in the window — "
                     "cut the silence from the front")

    sd = h_sd          # judge on the window that counts
    print()
    if sd >= GOOD_SD:
        print(f"  VERDICT: expressive ({sd:.2f} st). Good reference material.")
    elif sd >= OK_SD:
        print(f"  VERDICT: middling ({sd:.2f} st). Better than s7, still not lively.")
    else:
        print(f"  VERDICT: flat ({sd:.2f} st). Everything cloned from this will sound")
        print("           monotone, and no engine setting will fix it. Find a clip")
        print("           where the speaker is actually animated.")
    for n in notes:
        print(f"  - {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
