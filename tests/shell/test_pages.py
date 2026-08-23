"""Every page this serves must at least parse, and mean what it says.

There is no build step here on purpose -- the pages are hand-written HTML with
their scripts inline, served straight off disk, which is what makes them
readable and editable and is most of why this program is pleasant to work on.
The price is that nothing between an edit and a browser will say the word
"SyntaxError", and one wrong character does not break a feature: it stops the
whole file executing. The page still loads, still paints, and every control on
it does nothing at all.

That is also the failure most likely to reach somebody else, because it is
invisible to a checker that reads the file as text. A test asserting that a
line of JavaScript is present passes perfectly well on a page that cannot run
-- which is exactly what happened, and why this is here.

There is a second failure with the same shape and no syntax error in it: a
name that is used and never declared. Reading one throws where it is read, and
what dies is whatever was running — a handler that draws the ledger takes the
whole sheet with it, and the page around it looks fine. `node --check` cannot
see it, because it is not a parse error. So the other half of this file walks
the scope of every script and asks the one question that catches it: is
everything assigned to somewhere declared?

Wants node for the parsing half, which anything with a browser tier has.
Skipped where there is none, because the alternative is a suite that cannot be
run at all on a machine that is otherwise fine. The scope half needs nothing.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")

# Inline scripts only: src= is a file of its own and is checked as one.
INLINE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)


def pages():
    for d in sorted(ROOT.glob("*/static")):
        yield from sorted(d.glob("*.html"))


def scripts():
    for f in sorted(ROOT.glob("*/static/*.js")):
        yield f.relative_to(ROOT), f.read_text()


def blocks():
    """Every piece of JavaScript this serves, named by where it came from."""
    for page in pages():
        for i, block in enumerate(INLINE.findall(page.read_text())):
            if block.strip():
                yield f"{page.relative_to(ROOT)} script {i}", block
    for name, source in scripts():
        yield str(name), source


# ---- reading a script well enough to see what it declares ------------------
#
# Not a parser, and it does not have to be: the question is only whether a name
# is declared anywhere in the script it is assigned in, which is answered by
# knowing where declarations are written and taking every name out of them. It
# errs towards declared -- a construct this does not understand adds names
# rather than losing them -- so it cannot invent a failure, only miss one.

WORD = re.compile(r"[A-Za-z_$][\w$]*")
ASSIGNED = re.compile(r"^[ \t]*([A-Za-z_$][\w$]*)\s*(?:=[^=>]|\+\+|--|\+=|-=|\*=|/=)", re.M)
# Anything nested one deep, so a signature broken across lines with defaults in
# it is read whole rather than cut at the first bracket.
PARENS = r"((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)"
GIVEN = {"window", "document", "location", "self", "onload", "onerror"}


def code_only(src: str) -> str:
    """The source with comments and string bodies blanked, newlines kept.

    Prose is full of sentences that look like assignments -- "square -- turned
    square it is a tile" -- and this program's comments are prose. Blanking
    rather than deleting keeps every line number the one in the file.
    """
    out, i, n, state = [], 0, len(src), None
    while i < n:
        ch, nxt = src[i], src[i + 1] if i + 1 < n else ""
        if state is None:
            if ch == "/" and nxt == "*":
                state, i = "block", i + 2
                out.append("  ")
            elif ch == "/" and nxt == "/":
                state, i = "line", i + 2
                out.append("  ")
            elif ch in "'\"`":
                state, i = ch, i + 1
                out.append(" ")
            else:
                out.append(ch)
                i += 1
        elif state == "block":
            if ch == "*" and nxt == "/":
                state, i = None, i + 2
                out.append("  ")
            else:
                out.append("\n" if ch == "\n" else " ")
                i += 1
        elif state == "line":
            if ch == "\n":
                state = None
            out.append("\n" if ch == "\n" else " ")
            i += 1
        else:                                    # inside a string or template
            if ch == "\\":
                out.append("  ")
                i += 2
                continue
            if ch == state:
                state = None
            out.append("\n" if ch == "\n" else " ")
            i += 1
    return "".join(out)


def bound(piece: str) -> set:
    """The names one comma-separated piece of a declaration binds."""
    piece = piece.split("=")[0]
    if "{" in piece or "[" in piece:             # destructuring: all of them
        return set(WORD.findall(piece))
    m = WORD.match(piece.strip())
    return {m.group(0)} if m else set()


def head(text: str) -> set:
    """`ws, retry = null, running = false` -> three names, not one."""
    out, depth, piece = set(), 0, ""
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out |= bound(piece)
            piece = ""
        else:
            piece += ch
    return out | bound(piece)


def declared(src: str) -> set:
    out = set()
    for m in re.finditer(r"\b(?:let|const|var)\b", src):
        i, depth = m.end(), 0
        while i < len(src):                      # to the end of the statement
            ch = src[i]
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif (ch in ";\n" and depth == 0
                  and not src[:i].rstrip().endswith((",", "=", "&&", "||", "+", "("))):
                break
            i += 1
        out |= head(src[m.end():i])
    for pat in (r"\bfunction\s*([\w$]*)\s*\(" + PARENS + r"\)",   # and its parameters
                r"\bclass\s+([\w$]+)",
                r"\bcatch\s*\(([^)]*)\)",
                r"\(" + PARENS + r"\)\s*=>",
                r"([A-Za-z_$][\w$]*)\s*=>",
                r"\b([\w$]+)\s*\(" + PARENS + r"\)\s*\{"):       # a method, or an object one
        for m in re.finditer(pat, src, re.S):
            for group in m.groups():
                out |= set(WORD.findall(group or ""))
    return out


def loose(source: str) -> list:
    """Every (line, name) assigned in this script and declared in none of it."""
    src = code_only(source)
    known = declared(src) | GIVEN
    return [(src[:m.start()].count("\n") + 1, m.group(1))
            for m in ASSIGNED.finditer(src) if m.group(1) not in known]


@unittest.skipUnless(NODE, "node is not installed")
class ItAllParses(unittest.TestCase):
    def check(self, name, source):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tmp:
            tmp.write(source)
            path = tmp.name
        try:
            done = subprocess.run([NODE, "--check", path],
                                  capture_output=True, text=True, timeout=30)
        finally:
            Path(path).unlink(missing_ok=True)
        if done.returncode:
            # The line number is the script's, not the page's, so say which
            # script -- a page can carry several.
            self.fail(f"{name} does not parse:\n{done.stderr.strip()}")

    def test_the_scripts_inside_every_page(self):
        found = 0
        for page in pages():
            for i, block in enumerate(INLINE.findall(page.read_text())):
                if not block.strip():
                    continue
                found += 1
                with self.subTest(page=page.name, block=i):
                    self.check(f"{page.relative_to(ROOT)} script {i}", block)
        self.assertTrue(found, "no inline scripts found — the pattern has rotted")

    def test_and_the_ones_beside_them(self):
        found = 0
        for name, source in scripts():
            found += 1
            with self.subTest(script=str(name)):
                self.check(str(name), source)
        self.assertTrue(found, "no .js files found — the layout has moved")


class NothingIsUsedThatWasNeverDeclared(unittest.TestCase):
    """The failure with no syntax error in it.

    Swapping an element for a variable and forgetting to declare it leaves a
    page that parses, loads and paints, and one handler that throws the moment
    a message arrives — taking with it everything that handler draws. Here it
    was the ledger on the lid of the open box: the rows, the strength, the
    tally, all gone, and the box beneath them perfectly fine.
    """

    def test_every_script_this_serves(self):
        found = 0
        for name, source in blocks():
            found += 1
            with self.subTest(script=name):
                bad = loose(source)
                self.assertFalse(
                    bad, f"{name}: assigned but declared nowhere — "
                         + ", ".join(f"{n!r} at line {ln}" for ln, n in bad))
        self.assertTrue(found, "no scripts found — the layout has moved")
