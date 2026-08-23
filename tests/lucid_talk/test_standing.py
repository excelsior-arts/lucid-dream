"""The two numbers a room is lit by.

How the pill is holding you is a relationship, kept per persona and scored
after every turn you were in — and it is also, now, the color of the room you
are standing in. Which means a file nobody was ever supposed to open is on the
path between a conversation and how it looks, so the ways it can be wrong are
worth writing down: missing, half-written, hand-edited, turned off in config.

None of them should do anything more dramatic than leave the room the color
it was painted. A room that goes black because a JSON file has a word in it
where a number should be is a worse failure than no color at all.
"""
import json
import time
import unittest

from tests import clean
from lucid_talk import paths, relation as R
from lucid_talk.server import standing_now


class Stub:
    """Just enough of a session to be asked where you stand."""

    def __init__(self, on=True, slug="thinker"):
        self.cfg = {"relation": {"enabled": on, "score": True}}
        self.persona = {"slug": slug, "pill": "Gold"}


def write(slug, **axes):
    paths.MEMORY.mkdir(parents=True, exist_ok=True)
    R.path(slug).write_text(json.dumps(axes))


class WhatTheRoomIsToldAboutYou(unittest.TestCase):
    def setUp(self):
        clean()

    def test_a_pill_with_no_opinion_of_you_yet(self):
        """Nothing on file, which is every first evening."""
        self.assertEqual(standing_now(Stub()), {"warmth": 0.0, "temper": 0.0})

    def test_where_you_actually_stand(self):
        write("thinker", warmth=-78.0, trust=-40.0, mood=-22.0, turns=120,
              updated=time.time())
        got = standing_now(Stub())
        self.assertAlmostEqual(got["warmth"], -78.0, delta=.5)
        self.assertAlmostEqual(got["temper"], -22.0, delta=1.5)

    def test_the_mood_has_decayed_by_the_time_it_is_read(self):
        """A temper is hours old, not a fact. The room should open in what is
        left of it rather than in what it was last night."""
        write("thinker", warmth=0.0, trust=0.0, mood=90.0,
              updated=time.time() - 24 * 3600)
        self.assertLess(abs(standing_now(Stub())["temper"]), 30,
                        "yesterday's mood lit the room as though it were now")

    def test_turned_off_in_config_means_no_colour(self):
        write("thinker", warmth=90.0, trust=0.0, mood=0.0)
        self.assertEqual(standing_now(Stub(on=False)),
                         {"warmth": 0.0, "temper": 0.0})

    def test_a_file_somebody_edited_by_hand(self):
        """A word where a number should be. relation.load already survives
        this; what matters here is that the room does too."""
        R.path("thinker").parent.mkdir(parents=True, exist_ok=True)
        R.path("thinker").write_text('{"warmth": "very", "trust": 0, "mood": 0}')
        self.assertEqual(standing_now(Stub()), {"warmth": 0.0, "temper": 0.0})

    def test_a_torn_file(self):
        R.path("thinker").parent.mkdir(parents=True, exist_ok=True)
        R.path("thinker").write_text('{"warmth": -40, "tru')
        self.assertEqual(standing_now(Stub()), {"warmth": 0.0, "temper": 0.0})

    def test_it_is_the_pill_you_are_with(self):
        """Two pills, two standings. Opening Lover must not light the room
        with what Thinker thinks of you."""
        write("thinker", warmth=-80.0, trust=0.0, mood=0.0)
        write("lover", warmth=70.0, trust=0.0, mood=0.0)
        self.assertLess(standing_now(Stub(slug="thinker"))["warmth"], -50)
        self.assertGreater(standing_now(Stub(slug="lover"))["warmth"], 50)

    def test_nothing_it_returns_can_light_a_room_wrongly(self):
        """The room clamps too, but a number out of range should never leave
        here: a hand-written 5000 would pin every room to the top of the
        curve for good."""
        write("thinker", warmth=5000.0, trust=0.0, mood=-9000.0)
        got = standing_now(Stub())
        self.assertLessEqual(got["warmth"], 100.0)
        self.assertGreaterEqual(got["temper"], -100.0)
