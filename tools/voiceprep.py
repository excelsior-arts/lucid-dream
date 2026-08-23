"""Cut a spec-compliant reference clip from any source audio.

    python voiceprep.py source.mp3 nova
    python voiceprep.py source.wav nova --window 8

Chatterbox only reads the first 6s of a reference for delivery, so which six
seconds you pick decides how alive the companion sounds. Rather than guessing
at -ss and re-checking, this scans the whole source, scores every candidate
window by how much the pitch actually moves, and cuts the best one -- already
mono, 24 kHz, level-corrected, silence trimmed off the front.

Needs ffmpeg on PATH. Writes lucid_talk/personas/<name>/voice.ref.wav.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

from voicecheck import (PROSODY_S, TARGET_SR, contour, load, noise_floor_db,
                        speaker_spread)

# Lucid Talk's voices: each app keeps its own things inside itself.
PERSONAS = Path(__file__).resolve().parent.parent / "lucid_talk" / "personas"
STEP_S = 0.5          # how finely to slide the search window


def decode(src: Path) -> tuple[np.ndarray, int]:
    """Whatever the source is, get mono 24 kHz float out of it."""
    tmp = Path(tempfile.mkdtemp()) / "dec.wav"
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", str(TARGET_SR),
         "-sample_fmt", "s16", str(tmp)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode != 0 or not tmp.exists():
        sys.exit(f"ffmpeg could not read {src}:\n{r.stderr.decode()[-400:]}")
    a, sr, _ = load(tmp)
    return a, sr


def best_window(a: np.ndarray, sr: int, window_s: float):
    """The window with the most pitch movement and the least junk under it.

    Expressiveness alone is the wrong target: a music bed is periodic, so it
    inflates the pitch score while being the very thing you don't want cloned.
    Windows are ranked on movement, then penalised for a loud floor between
    words, so a clean animated passage beats a noisy one that measures higher.
    """
    n = int(window_s * sr)
    if len(a) <= n:
        m = contour(a, sr)
        return 0.0, (m[1] if m else 0.0), (m[3] if m else 0.0), noise_floor_db(a, sr)
    best = (0.0, -1.0, 0.0, -99.0)
    for start in range(0, len(a) - n, int(STEP_S * sr)):
        seg = a[start:start + n]
        if np.sqrt((seg ** 2).mean()) < 0.01:
            continue
        m = contour(seg, sr)
        if m is None:
            continue
        _, sd, _, voiced = m
        # A window that is mostly silence can post a high number on very little
        # speech; require it to be carrying real audio before trusting it.
        if voiced < window_s * 0.4:
            continue
        floor = noise_floor_db(seg, sr)
        # A window holding two speakers scores *high* on movement -- the
        # movement is between voices. Penalise it hard, or an untrimmed clip
        # gets its worst window chosen for it.
        spread = speaker_spread(seg, sr)
        score = sd - max(0.0, floor + 35.0) / 6.0 - max(0.0, spread - 2.0) * 2.0
        if score > best[1]:
            best = (start / sr, score, voiced, floor)
    return best


def cut(src: Path, at: float, window_s: float, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{at:.2f}", "-i", str(src), "-t", f"{window_s:.2f}",
         "-ac", "1", "-ar", str(TARGET_SR), "-sample_fmt", "s16",
         "-af", "silenceremove=start_periods=1:start_threshold=-45dB,"
                "loudnorm=I=-18:TP=-2:LRA=11",
         str(out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode != 0 or not out.exists():
        sys.exit(f"ffmpeg could not cut the clip:\n{r.stderr.decode()[-400:]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="any audio file ffmpeg can read")
    ap.add_argument("name", help="the persona's slug; becomes personas/<slug>/voice.ref.wav")
    ap.add_argument("--window", type=float, default=8.0,
                    help="clip length in seconds (default 8; only the first 6 drive delivery)")
    args = ap.parse_args()

    src = Path(args.source).expanduser()
    if not src.exists():
        sys.exit(f"no such file: {src}")

    print(f"reading {src.name} ...")
    a, sr = decode(src)
    print(f"  {len(a)/sr:.1f}s of audio, scanning for the most expressive "
          f"{PROSODY_S:.0f}s ...")

    at, score, voiced, floor = best_window(a, sr, PROSODY_S)
    if score <= 0:
        sys.exit("  found no window with enough voiced speech — is this music?")
    print(f"  best window starts at {at:.1f}s  "
          f"(score {score:.2f}, {voiced:.1f}s voiced, floor {floor:.0f} dB)")
    if floor > -20:
        print("  note: every window had loud background. Nothing here will clone")
        print("        cleanly -- separate the vocals first, or use another source.")

    home = PERSONAS / args.name
    home.mkdir(parents=True, exist_ok=True)
    out = home / "voice.ref.wav"
    cut(src, at, args.window, out)
    print(f"  wrote {out}\n")

    subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "voicecheck.py"), str(out)])
    print(f"\nTo use it:  voice: {args.name}   in a persona's frontmatter")


if __name__ == "__main__":
    main()
