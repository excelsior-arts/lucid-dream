"""Where you stand with a pill: the arithmetic nobody would notice going wrong.

This is the one part of the program with no visible output. A conversation
that reads a little colder than it should reads like the model having a day,
not like a constant that moved — so a regression here can live for weeks. The
numbers below are the ones the feel of the game is made of.
"""
import time
import unittest

from tests import clean
from lucid_talk import relation as R


class Arithmetic(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_blank_slate_is_the_middle(self):
        s = R.blank()
        for axis in R.AXES:
            self.assertEqual(s[axis], 0.0)
        self.assertEqual(s["turns"], 0)

    def test_one_ordinary_turn_barely_moves_anything(self):
        """Most turns are a 0 or a 1, and they have to be nearly free.

        This is what makes the state stable enough to be worth keeping: if a
        pleasant exchange were worth five points, a quiet evening would end in
        devotion.
        """
        s = R.apply("t", {"warmth": 1})
        self.assertAlmostEqual(s["warmth"], 1.0)
        self.assertEqual(s["turns"], 1)

    def test_a_rupture_costs_nine_times_an_ordinary_turn(self):
        """The steps are deliberately not a straight line. A 3 is contempt, a
        threat to leave, being lied to — and with linear steps ten insults
        were needed to turn a pill cold, which is not how anyone works."""
        one = R.apply("a", {"warmth": 1})["warmth"]
        clean()
        three = R.apply("b", {"warmth": 3})["warmth"]
        self.assertAlmostEqual(three, one * 9)

    def test_trust_is_spent_faster_than_it_is_earned(self):
        """The asymmetry is most of what makes this feel true."""
        up = R.apply("a", {"trust": 3})["trust"]
        clean()
        down = R.apply("b", {"trust": -3})["trust"]
        self.assertGreater(abs(down), abs(up) * 3)

    def test_nothing_can_be_pushed_past_the_ends(self):
        for _ in range(60):
            s = R.apply("t", {"warmth": 3, "trust": 3, "mood": 3})
        for axis in R.AXES:
            self.assertLessEqual(s[axis], R.LIMIT)
        for _ in range(120):
            s = R.apply("t", {"warmth": -3, "trust": -3, "mood": -3})
        for axis in R.AXES:
            self.assertGreaterEqual(s[axis], -R.LIMIT)

    def test_a_model_shouting_a_hundred_still_moves_one_exchange_worth(self):
        """The judge is a language model and will occasionally return 40."""
        s = R.apply("t", {"warmth": 100})
        self.assertAlmostEqual(s["warmth"], R.STEP_WEIGHT[3] * R.GAIN["warmth"])

    def test_the_log_of_how_you_got_here_does_not_grow_forever(self):
        for _ in range(40):
            s = R.apply("t", {"mood": 1}, why="something")
        self.assertLessEqual(len(s["log"]), 20)

    def test_a_turn_that_moved_nothing_is_still_a_turn(self):
        s = R.apply("t", {})
        self.assertEqual(s["turns"], 1)
        self.assertEqual(s["log"], [])


class Decay(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_bad_mood_is_gone_by_tomorrow_and_mistrust_is_not(self):
        now = time.time()
        state = {**R.blank(), "warmth": 80, "trust": -80, "mood": -80,
                 "updated": now - 24 * 3600}
        after = R.decayed(state, now)
        self.assertLess(abs(after["mood"]), 10)          # six-hour half-life
        self.assertGreater(abs(after["trust"]), 75)      # ninety days
        self.assertGreater(after["warmth"], 60)          # thirty days

    def test_almost_nothing_is_rounded_to_nothing(self):
        now = time.time()
        state = {**R.blank(), "mood": 0.4, "updated": now - 3600}
        self.assertEqual(R.decayed(state, now)["mood"], 0.0)

    def test_a_clock_that_went_backwards_does_not_undo_a_feeling(self):
        """Daylight saving, an NTP correction, a file copied from another
        machine. Negative elapsed time must not multiply a feeling upwards."""
        now = time.time()
        state = {**R.blank(), "warmth": 50, "updated": now + 10 * 3600}
        self.assertAlmostEqual(R.decayed(state, now)["warmth"], 50)


class OnDisk(unittest.TestCase):
    def setUp(self):
        clean()

    def test_it_survives_the_round_trip(self):
        R.apply("lover", {"warmth": 2, "trust": 1})
        again = R.load("lover")
        self.assertGreater(again["warmth"], 0)
        self.assertEqual(again["turns"], 1)

    def test_a_hand_edited_file_is_still_a_file(self):
        R.apply("lover", {"warmth": 1})
        R.path("lover").write_text('{"warmth": 5000, "trust": "x", "junk": 1}')
        s = R.load("lover")
        self.assertEqual(s["warmth"], R.LIMIT)
        self.assertEqual(s["trust"], 0.0)          # unreadable becomes nothing
        self.assertNotIn("junk", s)

    def test_a_file_that_is_not_json_at_all_starts_from_nothing(self):
        R.path("lover").parent.mkdir(parents=True, exist_ok=True)
        R.path("lover").write_text("half a fi")
        self.assertEqual(R.load("lover")["warmth"], 0.0)

    def test_forgetting_takes_the_history_with_it(self):
        """A fresh start, not a suspiciously blank history: the turn count and
        the record of how you got here go too."""
        R.apply("lover", {"warmth": 3}, why="kind")
        R.reset("lover")
        self.assertFalse(R.path("lover").exists())
        self.assertEqual(R.load("lover")["turns"], 0)

    def test_forgetting_what_was_never_there_is_not_an_error(self):
        self.assertEqual(R.reset("nobody")["turns"], 0)


class Prose(unittest.TestCase):
    """The numbers never reach the model; these sentences do."""

    def test_every_value_a_pill_can_hold_has_something_to_say(self):
        for axis in ("warmth", "trust"):
            for v in range(-100, 101, 5):
                self.assertTrue(R._band(axis, float(v)),
                                f"{axis} at {v} describes itself as nothing")

    def test_the_middle_of_a_mood_says_nothing_at_all(self):
        self.assertEqual(R._band("mood", 0.0), "")

    def test_a_word_for_the_top_of_the_page(self):
        cold = R.standing({**R.blank(), "warmth": -70})
        warm = R.standing({**R.blank(), "warmth": 70})
        self.assertEqual(cold[0], "frozen")
        self.assertEqual(warm[0], "devoted")

    def test_liking_you_and_still_telling_you_nothing(self):
        word, temper = R.standing({**R.blank(), "warmth": 30, "trust": -40})
        self.assertEqual(temper, "wary")

    def test_a_temper_beats_a_standing(self):
        _, temper = R.standing({**R.blank(), "warmth": 30, "mood": -70})
        self.assertEqual(temper, "furious")

    def test_conduct_is_checkable_where_a_mood_is_not(self):
        self.assertEqual(R.conduct(R.blank()), "")
        done = R.conduct({**R.blank(), "warmth": -80})
        self.assertIn("nothing", done.lower())
        # Trust alone is enough: a pill can like you and still be closed.
        self.assertTrue(R.conduct({**R.blank(), "trust": -70}))

    def test_a_long_absence_is_mentioned_and_a_short_one_is_not(self):
        now = time.time()
        away = R.describe({**R.blank(), "turns": 20, "updated": now - 20 * 86400})
        near = R.describe({**R.blank(), "turns": 20, "updated": now - 3600})
        self.assertIn("days since", away)
        self.assertNotIn("days since", near)


class WhatTheJudgeSaid(unittest.TestCase):
    """The scoring model is told to answer in JSON and does not always."""

    def test_json_wrapped_in_talk(self):
        deltas, why = R.read_deltas(
            'Sure! Here you go:\n```json\n{"warmth": 1, "trust": -2, '
            '"mood": 0, "why": "he apologized"}\n```\nHope that helps.')
        self.assertEqual(deltas["warmth"], 1)
        self.assertEqual(deltas["trust"], -2)
        self.assertEqual(why, "he apologized")

    def test_nonsense_moves_nothing(self):
        for raw in ("", "I would rather not.", "{not json}", "{}", "[1,2]"):
            deltas, _ = R.read_deltas(raw)
            self.assertFalse(any((deltas or {}).values()), raw)

    def test_a_wild_number_is_brought_back_to_one_exchange(self):
        deltas, _ = R.read_deltas('{"warmth": -99, "trust": 50}')
        self.assertEqual(deltas["warmth"], -R.MAX_STEP)
        self.assertEqual(deltas["trust"], R.MAX_STEP)

    def test_a_reason_cannot_be_a_paragraph(self):
        deltas, why = R.read_deltas('{"warmth": 1, "why": "%s"}' % ("x" * 500))
        self.assertLessEqual(len(why), 120)
