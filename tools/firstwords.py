"""What does a pill reach for when there is nothing behind it?

    tools/firstwords.py [rounds]

No memory, no standing, no scene, no room — just each persona's own prompt and
somebody saying hello, a dozen times over. Whatever furniture turns up is
furniture the character brought with it, and that is the list worth building a
room out of: a room made of what a persona already talks about is a room it can
talk about, and one made of what looked good in a drawing is a room it walks
around.

It is how the wine got onto Thinker's table. Asked cold, twelve times, Thinker
mentioned wine six times and a glass five — the strongest signal in anything
either of these two has ever said — while the door and the mirror, which its
real conversations name constantly, never came up at all. Those are how it
*leaves* a conversation, not how it opens one. Neither number is visible from
reading the prompts.

Safe to run whenever a persona is written or rewritten:

  * the data root is a throwaway one, so no conversation, memory or standing is
    read or written — the only real setting it takes is which model, and on
    what port;
  * it loads the language model and nothing else. No voice, no recognizer,
    nothing that can make a sound in a room with other people in it;
  * it reuses the model the app already has up, if it is up.
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
# Before anything of the app is imported: see tests/__init__.py for why this
# has to happen first, and why it is not optional.
os.environ.setdefault("LUCID_USERDATA", tempfile.mkdtemp(prefix="firstwords-"))
sys.path.insert(0, str(HERE))

from lucid_talk import config as C            # noqa: E402
from lucid_talk import models as M            # noqa: E402
from lucid_talk import personas as P          # noqa: E402

OPENERS = ["Hi.", "Hey.", "Are you there?", "So?"]

# Anything a hand could be put on. Things rather than places: a room is built
# out of things, and "somewhere" cannot be touched.
STUFF = """door doorway handle window curtain blind shutter mirror glass table desk
chair armchair couch sofa cushion pillow bed sheet duvet blanket rug carpet floor
wall ceiling shelf bookcase book page lamp light candle fire fireplace hearth wine
bottle cup mug coffee tea cigarette ashtray phone clock watch key coat jacket shoe
boot ring bath water sink stove kettle knife plate bowl record radio piano guitar
photograph picture frame drawer box letter pen paper notebook stair step balcony
gate tree flower plant vase""".split()

DULL = set("""the a an and or but if of to in on at is are was were be been it its
i you he she they we me him her them my your his their this that these those there
here what when where how why not no yes just so very much more most only own same
then than too can will would could should do does did have has had am being about
into over under after before between out up down off again once because while
during without within along across behind beyond thing things way ways time times
moment word words voice sound kind sort bit lot""".split())


def ask(llm, who: dict, cfg: dict, rounds: int) -> list[str]:
    said = []
    for opener in OPENERS:
        for _ in range(rounds):
            said.append(llm.stream_reply(
                [{"role": "user", "content": opener}],
                lambda _d: None, threading.Event(),
                system=P.system_prompt(who),
                temperature=float(who.get("temperature")
                                  or cfg["llm"].get("temperature", .85)),
                top_p=float(who.get("top_p") or cfg["llm"].get("top_p", .95)),
                max_tokens=180))
            print(f"  {who['slug']} {len(said)}/{len(OPENERS) * rounds}", flush=True)
    return said


def counted(said: list[str]) -> tuple[collections.Counter, collections.Counter]:
    text = " ".join(said).lower()
    things = collections.Counter()
    for w in STUFF:
        n = len(re.findall(r"\b" + w + r"s?\b", text))
        if n:
            things[w] = n
    # And whatever else it kept naming, in case the list above is short of
    # imagination — nouns it put an article in front of. Crude, and it is the
    # part that turns up the radio and the doorframe.
    loose = collections.Counter(
        w for w in re.findall(r"\b(?:the|a|an|my|your|his|her)\s+([a-z]{3,})", text)
        if w not in DULL and w not in STUFF)
    return things, loose


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    cfg = C.load()
    # The data root is scratch; the machine settings are the real ones, and
    # they live in a file under the root we have just thrown away.
    try:
        from shell.paths import MINE
        real = json.loads((MINE / "lucid-talk" / "config.json").read_text())
        cfg["llm"] = {**cfg.get("llm", {}), **real.get("llm", {})}
    except OSError:
        pass                                   # never set up; defaults will do
    M.apply_config(cfg)

    llm = M.LLMServer(cfg["llm"]["model"])
    llm.start()
    for _ in range(240):
        if llm.ready():
            break
        threading.Event().wait(1)
    if not llm.ready():
        raise SystemExit("the model would not come up")

    out = {}
    try:
        for home in P.homes():
            who = P.get(home.name)
            if who:
                out[home.name] = ask(llm, who, cfg, rounds)
    finally:
        llm.stop()

    for who, said in out.items():
        things, loose = counted(said)
        print(f"\n{who} — {len(said)} openings, {len(' '.join(said).split())} words")
        print("  things: " + (", ".join(f"{w}×{n}" for w, n in things.most_common(14))
                              or "nothing it could put a hand on"))
        print("  also:   " + ", ".join(f"{w}×{n}" for w, n in loose.most_common(12)))


if __name__ == "__main__":
    main()
