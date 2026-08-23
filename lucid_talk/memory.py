"""Rolling memory: what fell out of the context window, kept as a compact block.

One file per persona, `memory/<persona>.md`. It is rewritten (not appended) each
time, so it stays a fixed size no matter how long you talk — which is the whole
point: prefill cost stays flat while memory spans weeks.

It's plain markdown. Edit it by hand, or in the app, whenever it gets something
wrong about you.
"""
from __future__ import annotations

import re
from pathlib import Path

from . import personas as P
from . import prompts
from .paths import MEMORY as DIR
from shell import log as LOG


def path(slug: str) -> Path:
    return DIR / f"{slug}.md"


def load(slug: str) -> str:
    p = path(slug)
    return p.read_text().strip() if p.exists() else ""


def previous(slug: str) -> Path:
    """The memory as it was before the last fold."""
    return DIR / f"{slug}.prev.md"


def save(slug: str, text: str):
    """Written beside and renamed, keeping one copy of what it replaced.

    What a pill remembers about you is months of evenings and there is no
    other copy of it anywhere. It is also rewritten wholesale, from the output
    of a language model, every time enough turns fall out of the window — so a
    fold that comes back with two bullets replaces eight weeks with two
    bullets, and a torn write during it leaves half a file. The rename makes
    the second impossible and .prev makes the first survivable: `cp` it back.
    """
    DIR.mkdir(parents=True, exist_ok=True)
    body = text.strip() + "\n" if text.strip() else ""
    p = path(slug)
    if p.exists():
        try:
            previous(slug).write_text(p.read_text())
        except OSError as e:
            # Worth saying, not worth stopping for: the new memory is still
            # the better copy of the two.
            LOG.say(f"could not keep the previous memory for {slug} — "
                    f"{type(e).__name__}: {e}", source="talk", level="warn")
    tmp = p.with_suffix(".md.new")
    tmp.write_text(body)
    tmp.replace(p)


def clean(raw: str, max_bullets: int) -> str:
    """Keep only bullet lines, capped — models like to add preamble."""
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if not re.match(r"^[-*•]\s+", line):
            # A stray "Here is the memory:" line, or a bullet without its dash.
            if line.endswith(":") or len(lines) == 0 and len(line.split()) < 4:
                continue
            line = "- " + line
        line = re.sub(r"^[*•]\s+", "- ", line)
        lines.append(line)
        if len(lines) >= max_bullets:
            break
    return "\n".join(lines)


def fold(llm, slug: str, dropped: list[dict], max_bullets: int = 14) -> str:
    """Fold forgotten turns into the memory. Returns the new memory text."""
    if not dropped:
        return load(slug)
    existing = load(slug) or "(nothing yet)"
    # Named, not roled. Handed "user:" and "assistant:", the folder wrote its
    # memories about "the assistant" — and worse, read everything on a user:
    # line as something he said about himself. He does not only speak as
    # himself: he asks for a register and gives samples of it, writes lines for
    # the pill to say, sets a scene to play in. All of that arrives in the first
    # person on his turn, and has been folded into the memory as biography.
    #
    # A name on each turn is what makes the difference legible, and it costs
    # nothing: the pill's own name is what the memory would call her anyway.
    persona = P.get(slug) or {}
    hers = persona.get("name") or persona.get("pill") or "you"
    convo = "\n".join(f"{'him' if m['role'] == 'user' else hers}: {m['content']}"
                      for m in dropped)
    prompt = prompts.get("fold_user").format(
        existing=existing, dropped=convo, max_bullets=max_bullets)
    import threading
    text = llm.stream_reply(
        [{"role": "user", "content": prompt}],
        lambda _d: None,
        threading.Event(),
        system=prompts.get("fold_system"),
        temperature=0.3,
        max_tokens=400,
    )
    new = clean(text, max_bullets)
    if not new:
        # The model said nothing usable — preamble only, or an empty reply
        # because it was interrupted. Saying so is the point: the caller moves
        # its "already folded" mark on the strength of this, and a fold that
        # quietly did nothing used to take those turns with it.
        return ""
    save(slug, new)
    return new


def as_prompt_block(slug: str) -> str:
    mem = load(slug)
    if not mem:
        return ""
    # Phrasing matters: telling the model "do not recite this" made it deny
    # knowing things that were sitting right there in its own prompt.
    return "\n\n" + prompts.get("memory_intro") + "\n" + mem
