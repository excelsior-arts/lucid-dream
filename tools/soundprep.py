#!/usr/bin/env python3
"""Cut a sound pack for the machine's shelf out of a sound library.

    python3 tools/soundprep.py --library ~/Documents/Sounds --out ../lucid-assets/sounds
    python3 tools/soundprep.py --library ~/Documents/Sounds --out ../lucid-assets/sounds --only ember,wind

The pack is never in this repository: it is heavy and it is somebody else's
recording. What is in this repository is the table below -- which clip each
sound a game plays is cut from, how it is trimmed, and how loud -- so that
anybody with the same library makes the same pack, and anybody with a
different one edits one table. The pack goes on the asset shelf
(`<assets.dir>/sounds/`, see machine/assets.py), and the machine serves it by
name; a name with no clip on the shelf is silence.

Each clip becomes one mono AAC file, `<name>.m4a`, small enough that a whole
pack is a couple of megabytes: a page fetches a clip once and keeps it. The
loops are cut to a length with a fade at both ends so they join without a
click. Trimming and fades are sox's; the encode is afconvert's on a Mac and
ffmpeg's elsewhere.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

# name: (file under the library, seconds to keep or None for all, gain in dB,
#        loop). The gain is baked in, so a page plays every clip at one level
#        and the mix is decided here, by ear, once. These are a game's sounds;
#        the interface's own -- the latch, a key, the lid -- are made in the
#        shell out of an oscillator and stay that way.
CLIPS: dict[str, tuple[str, float | None, float, bool]] = {
    # the desert
    "wind": ("Ambience_2/Ambience Nature Field Windy 02.wav", 24, -6, True),
    "night": ("Ambience_2/Ambience Wind With Crickets 01.wav", 24, -8, True),
    "enter": ("Production Elements/Production Element Title Transition Swell 01.wav", 4.5, -14, False),
    "end": ("Production Elements/Production Element Title Transition Musical Tone Drone 01.wav", None, -10, False),
    "thin": ("Production Elements/Production Element Title Transition Sweep Drone 01.wav", 3.5, -12, False),
    # the body
    "step": ("Foley Footsteps/Foley Footstep Baseball Cleat Dirt Debris Single Step 01.wav", None, -9, False),
    "land": ("Foley Footsteps/Foley Footstep Cowboy Boots Dirt Debris Jump Single 01.wav", None, -6, False),
    "jump": ("Multimedia/Multimedia Internet CD-Rom Flash Whoosh Short 01.wav", None, -12, False),
    "dash": ("Multimedia/Multimedia Internet CD-Rom Flash Whoosh 01.wav", 1.2, -8, False),
    "hyper": ("Production Elements/Production Element Title Transition Metallic Hit To Whoosh 01.wav", 2.4, -8, False),
    # the things on the ground
    "ember": ("Multimedia/Multimedia Internet CD-Rom Flash Pop Up Short 01.wav", None, -8, False),
    "shard": ("Production Elements/Production Element Title Transition Bell Hit 04.wav", 1.5, -10, False),
    "mote": ("Multimedia/Multimedia Internet CD-Rom Flash Pop Up Electronic 01.wav", None, -8, False),
    # the meeting
    "break": ("Crashes/Crash Brick Tumble Down 01.wav", 3.2, -6, False),
    "clash": ("Impacts/Impact Body Fall On Dirt And Rock 01.wav", None, -4, False),
    # the voice
    "ask": ("Production Elements/Production Element Title Transition Bell Swell 01.wav", None, -12, False),
}

RATE = 44100
BITRATE = 64000


def cut(src: Path, out: Path, seconds: float | None, gain: float, loop: bool, work: Path) -> None:
    """One clip: trimmed and faded and levelled by sox into a mono wav, then
    encoded to AAC."""
    wav = work / (out.stem + ".wav")
    args = ["sox", str(src), "-r", str(RATE), "-c", "1", str(wav)]
    if seconds is not None:
        args += ["trim", "0", f"{seconds}"]
    if loop:
        # A slow fade at both ends, so the join is a breath and not a click.
        args += ["fade", "t", "1.5", "0", "1.5"]
    else:
        args += ["fade", "t", "0.005", "0", "0.03"]
    args += ["gain", f"{gain}"]
    subprocess.run(args, check=True)
    if shutil.which("afconvert"):
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", str(BITRATE), "-c", "1",
                        str(wav), str(out)], check=True)
    else:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "aac",
                        "-b:a", str(BITRATE), "-ac", "1", str(out)], check=True)
    wav.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--library", required=True, help="the sound library's directory")
    ap.add_argument("--out", required=True, help="where the pack goes: <assets.dir>/sounds")
    ap.add_argument("--only", default="", help="a few names, comma-separated")
    a = ap.parse_args()
    if not shutil.which("sox"):
        print("sox is needed to trim and level the clips (brew install sox)", file=sys.stderr)
        return 1
    library = Path(a.library).expanduser()
    out = Path(a.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    work = out / ".work"
    work.mkdir(exist_ok=True)
    wanted = [n for n in a.only.split(",") if n] or list(CLIPS)
    manifest: dict[str, dict[str, object]] = {}
    missing = []
    for name in wanted:
        src, seconds, gain, loop = CLIPS[name]
        path = library / src
        if not path.is_file():
            missing.append(f"{name}: {src}")
            continue
        target = out / f"{name}.m4a"
        cut(path, target, seconds, gain, loop, work)
        manifest[name] = {"from": src, "seconds": seconds, "gain_db": gain, "loop": loop,
                          "bytes": target.stat().st_size}
        print(f"{name:8s} {target.stat().st_size / 1024:6.1f} KB  <- {src}")
    work.rmdir()
    (out / "manifest.json").write_text(json.dumps({
        "library": str(library), "clips": manifest,
        "note": "Cut by tools/soundprep.py. The recordings are the library's and under its licence; this pack is not distributed with the code.",
    }, indent=2) + "\n")
    total = sum(int(m["bytes"]) for m in manifest.values())
    print(f"{len(manifest)} clips, {total / 1024:.0f} KB, in {out}")
    if missing:
        print("missing from the library:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
