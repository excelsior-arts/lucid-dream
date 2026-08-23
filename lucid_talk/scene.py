"""Where the two of you are, kept while the conversation moves past it.

The live context is deliberately short — six exchanges, six hundred words — and
her replies run to four hundred words apiece, so in continuous mode she is
often writing with one message of history: her own last one. Everything before
it is gone, including where the scene started. It began in a shopping mall and
ended in a bedroom, and nothing in the prompt disagreed.

Memory cannot fix that. Memory is what is true about *you* — a name, a job, a
dog — and its instructions say plainly to keep facts and leave events. A scene
is all event: a place, a position, a thing just done. It belongs to the
conversation rather than to the person, so it lives in the transcript beside
the turns, and it dies with them.

Kept short on purpose. It is prefilled on every turn, and a paragraph of
stage directions competes with the reply she is trying to write.
"""
from __future__ import annotations

import threading

from . import prompts

MAX_WORDS = 70


def trim(text: str) -> str:
    """Three short lines, and nothing that pretends to be prose."""
    lines = [l.strip(" -•\t") for l in (text or "").splitlines()]
    lines = [l for l in lines if l and not l.lower().startswith(("here", "sure", "scene:"))]
    out, used = [], 0
    for line in lines[:4]:
        n = len(line.split())
        if used + n > MAX_WORDS:
            break
        out.append(line)
        used += n
    return "\n".join(out)


# What it says when the two of them are simply talking and are not anywhere.
NO_SCENE = ("none", "no scene", "nothing", "n/a", "-")


# What the previous place is worth, said in the heading rather than reasoned
# out by the model. A scene the conversation earned is a position somebody has
# taken and is defended as one; a seed is the room describing itself to an
# empty chair, and nobody has agreed to it yet. The session knows which it is
# holding -- see Session._scene_new -- so it says so, and the writer is left
# with one situation to read instead of a rule and its exception.
SETTLED = "Where the scene was:"
GUESS = "Where the room says it begins, which nobody has confirmed yet:"

# And how much to ask for. Before she has answered him there is no standing
# between them to describe and nothing has changed yet, so Now and Since are
# two lines invented to fill a form -- on one measured opening, Since came
# back as his own turn restated. Asking for the one line that can be true is
# also the cheapest thing this call ever does: three lines of it are most of
# the wait in front of a first reply.
ASK_ALL = "Where is the scene now? Three lines at most."
ASK_PLACE = ("Only the Place line, and nothing else -- they have not spoken to "
             "each other yet, so there is no Now and no Since to write.")


def update(llm, previous: str, recent: list[dict], settled: bool = True,
           opening: bool = False) -> str:
    """Re-read where they are, from what was just said.

    Given the scene as it was and the last few turns, not the whole
    conversation: the point is to carry a place forward, not to summarise.

    `settled` is false while the place is still the room's own guess at itself.
    It changes one line of the prompt rather than adding a rule to it: told
    that nothing is confirmed, the writer takes what he named and keeps the
    room when he named nothing, which is what the rule would have said.
    """
    if not recent:
        return previous
    convo = "\n".join(f"{'he' if m['role'] == 'user' else 'she'}: {m['content']}"
                      for m in recent)
    text = llm.stream_reply(
        [{"role": "user", "content": prompts.get("scene_user").format(
            heading=SETTLED if settled else GUESS,
            ask=ASK_PLACE if opening else ASK_ALL,
            previous=previous or "(nothing yet — this is the start)", recent=convo)}],
        lambda _d: None,
        threading.Event(),
        system=prompts.get("scene_system"),
        temperature=0.2,
        max_tokens=40 if opening else 120,
    )
    if text.strip().strip(".").lower() in NO_SCENE:
        return ""            # they are not anywhere; carry nothing
    return trim(text) or previous


def as_prompt_block(scene: str) -> str:
    """What rides along with the turn. Empty when there is no scene yet."""
    if not scene:
        return ""
    return f"\n\n[{prompts.get('scene_intro').strip()}\n{scene}]"
