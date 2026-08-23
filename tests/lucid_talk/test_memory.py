"""What a pill remembers about you.

Months of evenings, rewritten wholesale from the output of a language model
every time enough turns fall out of the window, with no other copy anywhere.
The failure that matters is not a crash — it is a fold that quietly writes
less than there was, or a mark that moves past turns nothing ever read.
"""
import unittest

from tests import clean
from lucid_talk import memory as MEM


class Stub:
    """A language model that says what it is told to say."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.asked = []

    def stream_reply(self, messages, on_delta, stop, **kw):
        self.asked.append(messages[0]["content"])
        return self.answers.pop(0) if self.answers else ""


DROPPED = [{"role": "user", "content": "I have a brother"},
           {"role": "assistant", "content": "Older or younger?"}]


class OnDisk(unittest.TestCase):
    def setUp(self):
        clean()

    def test_nothing_remembered_yet_is_not_an_error(self):
        self.assertEqual(MEM.load("lover"), "")
        self.assertEqual(MEM.as_prompt_block("lover"), "")

    def test_it_survives_the_round_trip(self):
        MEM.save("lover", "- he has a brother\n- he hates the cold")
        self.assertIn("brother", MEM.load("lover"))
        self.assertIn("brother", MEM.as_prompt_block("lover"))

    def test_the_copy_it_replaced_is_kept(self):
        """The one recoverable path there is. A fold that comes back with two
        bullets replaces eight weeks of evenings with two bullets, and this is
        what makes that survivable rather than final."""
        MEM.save("lover", "- eight weeks of things")
        MEM.save("lover", "- two bullets")
        self.assertIn("eight weeks", MEM.previous("lover").read_text())
        self.assertIn("two bullets", MEM.load("lover"))

    def test_nothing_is_ever_left_half_written(self):
        MEM.save("lover", "- one")
        self.assertFalse(list(MEM.path("lover").parent.glob("*.new")))

    def test_saving_nothing_empties_it_rather_than_writing_a_blank_line(self):
        MEM.save("lover", "   ")
        self.assertEqual(MEM.load("lover"), "")


class Folding(unittest.TestCase):
    def setUp(self):
        clean()

    def test_what_the_model_returns_is_what_is_kept(self):
        llm = Stub("- he has a brother\n- he hates the cold")
        out = MEM.fold(llm, "lover", DROPPED)
        self.assertIn("brother", out)
        self.assertIn("brother", MEM.load("lover"))

    def test_a_fold_that_says_nothing_usable_says_so(self):
        """The caller moves its "already folded" mark on the strength of this
        answer. A fold that returned the old memory looked like a success, and
        those turns went out of the window and out of the memory both."""
        MEM.save("lover", "- what was already there")
        for empty in ("", "   ", "Here is the updated memory:", "Sure!"):
            self.assertEqual(MEM.fold(Stub(empty), "lover", DROPPED), "")
        self.assertIn("already there", MEM.load("lover"))

    def test_nothing_dropped_means_nothing_asked_of_the_model(self):
        llm = Stub("- something new")
        MEM.fold(llm, "lover", [])
        self.assertEqual(llm.asked, [])

    def test_the_model_is_shown_what_it_already_knew(self):
        MEM.save("lover", "- he has a brother")
        llm = Stub("- he has a brother\n- and a sister")
        MEM.fold(llm, "lover", DROPPED)
        self.assertIn("he has a brother", llm.asked[0])
        self.assertIn("Older or younger?", llm.asked[0])


class Tidying(unittest.TestCase):
    """Models like to add preamble, and bullets are the whole format."""

    def test_preamble_is_dropped_and_lines_become_bullets(self):
        out = MEM.clean("Here is the memory:\n- one\ntwo\n* three\n• four", 10)
        self.assertEqual(out.splitlines(), ["- one", "- two", "- three", "- four"])

    def test_it_stops_at_the_cap(self):
        out = MEM.clean("\n".join(f"- line {i}" for i in range(40)), 5)
        self.assertEqual(len(out.splitlines()), 5)

    def test_pure_preamble_leaves_nothing(self):
        self.assertEqual(MEM.clean("Certainly!", 10), "")
        self.assertEqual(MEM.clean("", 10), "")
