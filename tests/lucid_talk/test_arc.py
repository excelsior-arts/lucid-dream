"""A dose with a shape, rather than a quarter of an hour of middle.

The directions are deliberately abstract, because they go to every pill on the
shelf — the one who wants you, the one who is unimpressed by you, and the ones
not written yet, which will not all be kind. So they say what a turn is for and
never what anybody does with their hands.

Keep going used to be one instruction repeated until the clock ran out:
continue, move things forward a little, so many minutes left. Which is a
metronome. The pill wandered pleasantly and then stopped because the time was
up — no build, no turn, and nothing that felt like an ending. Somebody who asks
for fifteen minutes is asking for fifteen minutes of *something*, and wants the
thing they were in to finish.

So the run is told where it is rather than how long is left: settle, open out,
push, land. A number of minutes means little to a model; which part of an
evening it is in means a great deal.

What is tested here is the shape, not the words — those are the game's writing
and are meant to be rewritten. The shape is: it starts quiet, it does not ask
for an ending before the end, it does ask for one at the end, and it does not
hand the same sentence to two turns running.
"""
import unittest

from lucid_talk.session import Session


class Arc:
    """Just the part of a Session that decides what to say to itself."""

    ARC = Session.ARC
    continuous_nudge = Session.continuous_nudge


CLOSING = ("bring it to rest", "land it", "last thing", "finish what this",
           "end where it wants", "nearly gone")


def asks_to_close(text):
    low = text.lower()
    return any(phrase in low for phrase in CLOSING)


class ItStartsQuietAndEndsFinished(unittest.TestCase):
    def setUp(self):
        self.arc = Arc()

    def test_the_opening_does_not_ask_for_an_ending(self):
        for turn in range(4):
            self.assertFalse(asks_to_close(self.arc.continuous_nudge(0.02, turn)),
                             "it asked the pill to finish in the first minute")

    def test_nor_does_the_middle(self):
        for spent in (0.25, 0.4, 0.5, 0.6, 0.75):
            for turn in range(4):
                self.assertFalse(asks_to_close(self.arc.continuous_nudge(spent, turn)),
                                 f"asked for an ending at {spent:.0%}")

    def test_the_end_asks_for_an_ending(self):
        for spent in (0.86, 0.95, 1.0):
            for turn in range(4):
                self.assertTrue(asks_to_close(self.arc.continuous_nudge(spent, turn)),
                                f"the dose ran out with no ending asked for at {spent:.0%}")

    def test_past_the_end_is_still_the_end(self):
        """Clocks drift and a turn can start a moment late. Falling off the last
        band and back to the opening would reopen an evening that was closing."""
        self.assertTrue(asks_to_close(self.arc.continuous_nudge(1.4, 0)))


class AShortDoseStillFinishes(unittest.TestCase):
    """Turns are coarse — ten or twenty seconds of talk each — so a five minute
    dose is a handful of them, and the arithmetic alone can put the last one at
    80% of the way through, still being told to push. Then the clock runs out
    and nothing ever asked it to land."""

    def setUp(self):
        self.arc = Arc()

    def test_the_turn_with_no_time_after_it_closes(self):
        for spent in (0.35, 0.6, 0.8):
            self.assertTrue(asks_to_close(self.arc.continuous_nudge(spent, 0, last=True)),
                            f"the last turn of the dose was still pushing at {spent:.0%}")

    def test_and_it_is_only_the_last_one(self):
        self.assertFalse(asks_to_close(self.arc.continuous_nudge(0.6, 0, last=False)),
                         "every turn was told to wrap up")

    def test_a_dose_of_four_turns_gets_all_four_parts(self):
        """0%, 25%, 50%, 75% — and the fourth is the last there is room for."""
        said = [self.arc.continuous_nudge(f, i, last=(i == 3))
                for i, f in enumerate((0.0, 0.25, 0.5, 0.75))]
        self.assertEqual(len(set(said)), 4, "two turns of four were the same")
        self.assertTrue(asks_to_close(said[-1]), "it stopped rather than finished")
        for early in said[:-1]:
            self.assertFalse(asks_to_close(early), "it wound up before the end")


class ItDoesNotRepeatItself(unittest.TestCase):
    def setUp(self):
        self.arc = Arc()

    def test_two_turns_running_are_not_the_same_words(self):
        """The surest way to be told the same thing twice is to ask the same
        way twice, and an echo chamber is what this was reported as."""
        for spent in (0.1, 0.4, 0.7, 0.95):
            a = self.arc.continuous_nudge(spent, 0)
            b = self.arc.continuous_nudge(spent, 1)
            self.assertNotEqual(a, b, f"the same sentence twice at {spent:.0%}")

    def test_every_part_of_the_arc_has_more_than_one_way_to_say_it(self):
        for edge, lines in self.arc.ARC:
            self.assertGreater(len(lines), 1, f"one phrasing only, up to {edge}")
            self.assertEqual(len(set(lines)), len(lines), f"duplicates up to {edge}")


class WhatEveryTurnStillSays(unittest.TestCase):
    def test_the_pill_is_told_nobody_spoke(self):
        """Load-bearing, and older than the arc: without it the model answers as
        though somebody had said something, and the reply comes back addressed
        to a question nobody asked."""
        arc = Arc()
        for spent in (0.0, 0.3, 0.6, 0.9, 1.0):
            for turn in range(2):
                self.assertIn("not said anything",
                              arc.continuous_nudge(spent, turn),
                              f"at {spent:.0%}")


if __name__ == "__main__":
    unittest.main()
