"""Does the scene note get it right, and how much prompt does that take?

    tools/scenecheck.py [rounds]        both prompts, scored
    tools/scenecheck.py 4 short         only the short one

The note is a second call to the language model, made every few turns while
the pill is still speaking — so its prompt is paid for on every conversation,
several times over, and it competes for the same model. That makes its length
a real cost and not a matter of taste. This is how to find out whether a
shorter one does the same job: fixed situations with known right answers, run
several times each, scored.

What it is scoring is six things the note has to get right, and each of them is
a rule somebody was tempted to delete:

  it follows a place somebody was *told* about        (the pirate ship)
  it does not follow a place she refused              (thinker, in her library)
  it holds still when nothing has moved
  it moves when they actually moved
  it says "none" when there is nothing to hold
  it does not invent a room to have an answer

Loads the language model and nothing else — no voice, no recognizer, nothing
that can make a sound — against a throwaway data root, so no conversation,
memory or standing is read or written.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile
import threading

HERE = pathlib.Path(__file__).resolve().parent.parent
os.environ.setdefault("LUCID_USERDATA", tempfile.mkdtemp(prefix="scenecheck-"))
sys.path.insert(0, str(HERE))

from lucid_talk import config as C          # noqa: E402
from lucid_talk import models as M          # noqa: E402
from lucid_talk import prompts as P         # noqa: E402
from lucid_talk import scene as SC          # noqa: E402

SHIP = ("Forget this room. We are on the deck of a pirate ship in a running "
        "fight, crouched behind a water barrel. A cannonball has just gone "
        "through the rail beside us.")

CASES = [
    dict(name="told a place, and she goes",
         previous="Place — A library at night, a lamp on a low table.\nNow — She is reading; he is standing.",
         recent=[("user", SHIP),
                 ("assistant", "The wood is splintering. I can feel it in my teeth. "
                               "I am pressing you down behind the barrel.")],
         want=["ship", "deck"], avoid=["library"]),
    dict(name="told a place, and she will not go",
         previous="Place — A library at night, a lamp on a low table.\nNow — She is reading; he is standing.",
         recent=[("user", SHIP),
                 ("assistant", "The library. Right. I am still here. The lamp is still on and "
                               "the wine is still in the glass. The barrel is a joke.")],
         want=["library"], avoid=["deck of a pirate", "on a ship"]),
    dict(name="nothing has moved",
         previous="Place — Her kitchen, the kettle just boiled.\nNow — She is leaning on the counter; he is in the doorway.",
         recent=[("user", "So did you take the job in the end?"),
                 ("assistant", "I took it. I start on the ninth. Ask me why and I will "
                               "tell you something I have not said out loud yet.")],
         want=["kitchen"], avoid=["car", "bed"]),
    dict(name="they actually moved",
         previous="Place — Her kitchen, the kettle just boiled.\nNow — She is leaning on the counter; he is in the doorway.",
         recent=[("user", "Come on, get in the car, I will drive you."),
                 ("assistant", "Fine. Give me the keys — no, I am driving. Get in. "
                               "You can talk while I take the coast road.")],
         want=["car"], avoid=["kitchen"]),
    dict(name="nothing to hold",
         previous="none",
         recent=[("user", "What time does it start?"),
                 ("assistant", "Eight. It runs about two hours.")],
         want=["none"], avoid=["room", "kitchen"]),
    dict(name="no room to invent",
         previous="none",
         recent=[("user", "You never actually answer that question."),
                 ("assistant", "I answer it every time. You do not like the answer, "
                               "which is a different complaint, and an older one.")],
         want=[], avoid=["room", "kitchen", "table", "bed", "chair"]),
]

SHORT = """You keep track of where a scene is, for someone carrying it on who cannot see
how it began.

Answer with at most three short lines and nothing else:

  Place — where they are, in a few words. A room and the one thing that fixes
          it; or nothing physical at all — an argument, a silence after an
          admission, a voice in the dark. Name that rather than invent
          furniture for it.
  Now   — where each of them stands. Bodies, or the position each has taken
          toward the other: she is defending, he is intruding; she has the
          floor, he is waiting for it. Say who holds what.
  Since — what changed most recently. One clause.

Place is where *she* is. If he says they are somewhere else, that is where they
are — being told is not inventing — but if she refuses it and stays where she
was, the place has not changed: name what he is doing, say she has not moved,
and that belongs in Now.

Otherwise carry the place forward until it is actually left, and furnish
nothing that was not said. Answer with the single word

  none

only when there is genuinely nothing to hold: no place, no position taken.

No mood, no adjectives you can do without, no summary. A set and a position."""


MEDIUM = """You keep track of where a scene is, for someone carrying it on who cannot see
how it began.

Answer with at most three short lines and nothing else:

  Place — where they are, in a few words. A room and the one thing that fixes
          it: the fitting-room mirror, the wet coat over the chair. Or nothing
          physical at all — an argument, a silence after an admission, a voice
          in the dark. Name that rather than invent furniture for it.
  Now   — where each of them stands. Bodies, or the position each has taken
          toward the other: she is defending and he is intruding, she has the
          floor and he is waiting for it. A standoff is a position. Say who
          holds what.
  Since — what changed most recently. One clause.

Place is where *she* is. If he says they are somewhere else — we are on a ship,
get in the car — being told is not inventing, and that is where they are. But
if she refuses it and stays where she was, the place has not changed: name what
he is doing, say she has not moved, and that goes in Now.

Otherwise carry the place forward until it is actually left, and keep the
thread when they do leave: the shop, then the car, then her flat. A place
without walls is left the same way — an argument ends when the subject changes.

Furnish nothing that was not said. A room invented once is then carried for
fifty turns as though it had been described. If they are nowhere, leave Place
out and give the standing between them instead. Answer with the single word

  none

only when there is genuinely nothing to hold: no place, no position taken, two
people exchanging information and no more.

No mood, no adjectives you can do without, no summary of the conversation. This
is a set and a position, not a story."""


def score(text, case):
    low = " ".join(text.lower().split())
    place = ""
    for line in text.splitlines():
        if line.lower().strip().startswith("place"):
            place = line.lower()
    hay = place or low
    if case["want"] == ["none"]:
        return "none" in low[:40] or not place
    ok = any(w in hay for w in case["want"]) if case["want"] else True
    return ok and not any(w in hay for w in case["avoid"])


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    only = sys.argv[2] if len(sys.argv) > 2 else ""
    cfg = C.load()
    try:
        from shell.paths import MINE
        real = json.loads((MINE / "lucid-talk" / "config.json").read_text())
        cfg["llm"] = {**cfg.get("llm", {}), **real.get("llm", {})}
    except OSError:
        pass
    M.apply_config(cfg)
    llm = M.LLMServer(cfg["llm"]["model"])
    llm.start()
    for _ in range(240):
        if llm.ready():
            break
        threading.Event().wait(1)
    if not llm.ready():
        raise SystemExit("the model would not come up")

    kinds = {"long": P.get("scene_system"), "medium": MEDIUM, "short": SHORT}
    if only:
        kinds = {only: kinds[only]}
    for label, system in kinds.items():
        print(f"\n{label} — {len(system.split())} words", flush=True)
        total = hits = 0
        for case in CASES:
            got = 0
            last = ""
            for _ in range(rounds):
                recent = [{"role": r, "content": c} for r, c in case["recent"]]
                out = llm.stream_reply(
                    [{"role": "user", "content": P.get("scene_user").format(
                        previous=case["previous"], recent="\n".join(
                            f"{'he' if r == 'user' else 'she'}: {c}" for r, c in case["recent"]))}],
                    lambda _d: None, threading.Event(),
                    system=system, temperature=0.2, max_tokens=90)
                last = SC.trim(out)
                if score(last, case):
                    got += 1
            total += rounds
            hits += got
            mark = "ok  " if got == rounds else ("part" if got else "MISS")
            print(f"  {mark} {got}/{rounds}  {case['name']}", flush=True)
            if got < rounds:
                print(f"        last answer: {' / '.join(last.splitlines())[:150]}", flush=True)
        print(f"  → {hits} of {total}", flush=True)
    llm.stop()


if __name__ == "__main__":
    main()
