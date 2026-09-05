"""The documents, against the program they describe.

Prose rots differently from code: nothing fails, nobody notices, and the first
person to find out is a stranger following an instruction that has not been
true for months. Only the mechanical part of that is checkable — a path in
three places that has to be one path, a console line quoted in a table that
has to be a line something actually prints — and this is that part.

It is deliberately not a spell-check of the manual. What is here is what has
already gone wrong: the by-hand install wrote a model path that did not exist,
and the troubleshooting table quoted five console lines none of which were in
the program.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class TheInstallWritesAPathThatExists(unittest.TestCase):
    """AGENTS §3 is the by-hand version of setup.sh, and following it used to
    leave a config pointing one directory above the weights: a model server
    that starts, fails, and says nothing anybody can act on. The rule now is
    that every model is a checkout at models/<org>/<repo>, named in the
    manifest and nowhere else -- so what the by-hand install downloads has to
    land where the manifest says, and no document may write a model path into
    the config that a newer manifest would leave stale."""

    def test_the_by_hand_install_lands_every_checkout_where_the_manifest_looks(self):
        from machine import shelf as S
        agents = (ROOT / "AGENTS.md").read_text()
        for label, e in S.entries():
            with self.subTest(label):
                m = re.search(r"d\('" + re.escape(e["repo"]) + r"',\s*local_dir='([^']+)'", agents)
                self.assertTrue(m, f"AGENTS.md does not download {e['repo']}")
                self.assertEqual(m.group(1), f"models/{e['repo']}")

    def test_the_shipped_default_is_the_same_place(self):
        from machine import config as C
        from machine import shelf as S
        got = C.load()
        self.assertEqual(got["llm"]["model"], str(S.where(C.somewhere("models"), "llm", C.DEFAULTS["llm"]["size"])))
        self.assertEqual(got["stt"]["model"], str(S.where(C.somewhere("models"), "stt")))
        self.assertEqual(got["tts"]["model"], str(S.where(C.somewhere("models"), "tts")))

    def test_no_document_writes_a_model_path_into_the_config(self):
        for doc in ("AGENTS.md", "MANUAL.md"):
            text = (ROOT / doc).read_text()
            with self.subTest(doc=doc):
                stray = re.findall(r'"model":\s*"(models/[^"]+)"', text)
                self.assertEqual(stray, [], f"{doc} writes a model path into the config: {stray}")

    def test_the_manifest_is_whole(self):
        from machine import shelf as S
        for label, e in S.entries():
            with self.subTest(label):
                self.assertRegex(e["repo"], r"^[\w.-]+/[\w.-]+$")
                self.assertRegex(e["rev"], r"^[0-9a-f]{40}$")
                self.assertGreater(e["gb"], 0)


class TheTroubleshootingTableQuotesRealLines(unittest.TestCase):
    """Every string AGENTS puts in backticks as something the console says
    has to be something the program says. The table used to name `LLM failed`,
    `STT failed`, `TTS failed` and `ready — just talk`, none of which were
    anywhere in the source."""

    SAID = {
        "the language model did not start": ["machine/machine.py"],
        "the recognizer would not load": ["machine/machine.py"],
        "the voice would not load": ["machine/machine.py"],
        "starting the language model on": ["machine/machine.py"],
        "microphone: no echo cancellation": ["app/packages/audio/src/capture.ts"],
        "microphone: echo canceled": ["app/packages/audio/src/capture.ts"],
    }

    def test_each_one_is_in_the_source_it_would_come_from(self):
        agents = (ROOT / "AGENTS.md").read_text()
        for line, wheres in self.SAID.items():
            with self.subTest(line=line):
                self.assertIn(line, agents, f"AGENTS.md no longer quotes {line!r}")
                found = any(line in (ROOT / w).read_text() for w in wheres)
                self.assertTrue(found, f"nothing in {wheres} says {line!r}")

    def test_and_the_ones_that_were_wrong_are_gone(self):
        agents = (ROOT / "AGENTS.md").read_text()
        for gone in ("`LLM failed`", "`STT failed`", "ready — just talk",
                     "loading Parakeet"):
            self.assertNotIn(gone, agents,
                             f"{gone} is quoted and nothing prints it")


class TheServerIsNamedCorrectly(unittest.TestCase):
    """`mlx_lm.server` is what the machine launches; `mlx_vlm` is the
    alternative for a model mlx-lm will not load. Both documents and the
    launcher used to call the alternative the requirement."""

    def test_nothing_asks_for_the_alternative_by_name_as_a_requirement(self):
        for where in ("run.sh", "AGENTS.md"):
            text = (ROOT / where).read_text()
            with self.subTest(where=where):
                for line in text.splitlines():
                    if "mlx_vlm.server" in line:
                        self.assertIn("alternative", line.lower(),
                                      f"{where} names mlx_vlm.server as the one "
                                      f"it needs: {line.strip()!r}")


if __name__ == "__main__":
    unittest.main()
