"""The paperwork, checked the way everything else here is.

Not because a test can make a license sound, but because the parts that rot are
mechanical: a dependency added to requirements.txt and never listed, a license
file whose text somebody edited, a README that promises a document nobody
wrote. All three are the kind of thing discovered by a stranger rather than by
whoever caused it.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def named(text: str) -> set:
    """Package names out of requirements.txt, comments and pins removed."""
    out = set()
    for line in (ROOT / "requirements.txt").read_text().splitlines():
        line = line.split("#")[0].strip()
        if line:
            out.add(re.split(r"[><=~!\[\s]", line)[0].lower())
    return out


class TheLicenceIsThere(unittest.TestCase):
    def test_and_is_the_one_the_readme_claims(self):
        license = (ROOT / "LICENSE").read_text()
        self.assertIn("PolyForm Noncommercial License 1.0.0", license)
        self.assertIn("Eugene Tiutiunnyk", license)
        for section in ("Acceptance", "Copyright License", "Noncommercial Purposes",
                        "Patent License", "No Liability", "Definitions"):
            self.assertIn(f"## {section}", license,
                          f"the {section} section has gone from the license text")

    def test_and_the_readme_says_what_it_is_not(self):
        """Source-available is not open source, and saying otherwise is the one
        claim that earns an argument in public."""
        readme = (ROOT / "README.md").read_text()
        self.assertIn("[PolyForm Noncommercial 1.0.0](LICENSE)", readme)
        self.assertIn("Source-available", readme)
        low = readme.lower()
        self.assertEqual(low.count("open source"), low.count("not open source"),
                         "the README says open source somewhere it is not "
                         "denying it — OSI's definition forbids the "
                         "field-of-use restriction this license is built on")


class EverythingItStandsOnIsListed(unittest.TestCase):
    def test_every_dependency_appears_in_the_third_party_list(self):
        listed = (ROOT / "THIRD-PARTY.md").read_text().lower()
        missing = [name for name in named("") if name not in listed]
        self.assertFalse(missing, f"not listed in THIRD-PARTY.md: {missing}")

    def test_and_so_do_the_models_and_the_vendored_code(self):
        listed = (ROOT / "THIRD-PARTY.md").read_text()
        for thing in ("parakeet-tdt-0.6b-v2", "chatterbox-turbo-fp16",
                      "three.module.js", "S3TokenizerV2"):
            self.assertIn(thing, listed)

    def test_and_every_vendored_file_is_named(self):
        """The browser has no install step, so a library a page needs is
        committed — and a committed library is the one kind of somebody else's
        code this repository actually distributes. One per game, eventually."""
        listed = (ROOT / "THIRD-PARTY.md").read_text()
        # Notes written here about what was vendored are ours, not somebody
        # else's: a README beside the files is documentation, not a dependency.
        vendored = sorted(p for d in ROOT.glob("*/static/vendor")
                          for p in d.rglob("*") if p.is_file()
                          and p.suffix.lower() != ".md"
                          and not p.name.startswith("."))
        self.assertTrue(vendored, "no vendored files found — has the layout moved?")
        missing = [str(p.relative_to(ROOT)) for p in vendored
                   if str(p.relative_to(ROOT)) not in listed]
        self.assertFalse(missing, f"vendored and unlisted: {missing}")

    def test_and_the_documents_point_at_each_other(self):
        readme = (ROOT / "README.md").read_text()
        for doc in ("THIRD-PARTY.md", "CONTRIBUTING.md", "LICENSE"):
            self.assertTrue((ROOT / doc).exists(), f"{doc} is missing")
            self.assertIn(doc, readme, f"the README never mentions {doc}")


class ContributionsCanBeRelicensed(unittest.TestCase):
    """The clause the business depends on: without it, offering this as a
    service later needs the permission of everybody who ever sent a patch."""

    def test_the_grant_is_written_down(self):
        text = (ROOT / "CONTRIBUTING.md").read_text().lower()
        self.assertIn("signed-off-by", text)
        self.assertIn("developercertificate.org", text)
        self.assertIn("relicense", text)
        self.assertIn("perpetual", text)


if __name__ == "__main__":
    unittest.main()
