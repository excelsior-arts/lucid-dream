"""Coming back to a conversation, or starting one.

Taking a pill you were already under carries on where you left off. That is
right for a reload, a dropped socket, a phone locking itself in a pocket — the
thread should survive all three, because losing it to any of them is a bug
wearing a design's clothes.

It is wrong for anything longer. Starting fresh is a console command, so the
way back in is the wide door and the way to a new conversation is the narrow
one; the shorter the window, the less often somebody is handed an afternoon
they had finished with. Five minutes is the length of an accident.

The clock runs from the last thing said, not from when the conversation began
— a long evening is one sitting however long it ran.
"""
import os
import time
import unittest

from tests import clean
from lucid_talk import config as C
from lucid_talk import paths, store as S


class TheWindowIsShort(unittest.TestCase):
    def setUp(self):
        clean()
        from lucid_talk.session import Session
        self.s = Session(has_listeners=lambda: False)
        self.addCleanup(self.s.mic.close)

    def quiet_for(self, minutes):
        """A conversation of this pill's, last spoken in that long ago."""
        store = S.Store()
        sid = store.start(self.s.persona["slug"], self.s.persona["pill"])
        store.append("user", "hello")
        f = paths.SESSIONS / f"{sid}.jsonl"
        when = time.time() - minutes * 60
        os.utime(f, (when, when))
        return sid

    def test_a_minute_ago_is_the_same_sitting(self):
        sid = self.quiet_for(1)
        self.assertEqual(self.s._recent_session(), sid)

    def test_and_four_minutes_still_is(self):
        sid = self.quiet_for(4)
        self.assertEqual(self.s._recent_session(), sid)

    def test_but_ten_minutes_is_a_new_one(self):
        self.quiet_for(10)
        self.assertIsNone(self.s._recent_session())

    def test_and_so_is_an_afternoon(self):
        self.quiet_for(150)
        self.assertIsNone(self.s._recent_session())

    def test_the_setting_is_what_decides_it(self):
        self.quiet_for(30)
        self.assertIsNone(self.s._recent_session())
        self.s.cfg["resume_within_minutes"] = 60
        self.assertIsNotNone(self.s._recent_session())

    def test_zero_always_starts_fresh(self):
        self.quiet_for(0)
        self.s.cfg["resume_within_minutes"] = 0
        self.assertIsNone(self.s._recent_session())

    def test_the_shipped_default_is_the_short_one(self):
        """The number in config.py is what anybody who has not edited theirs
        gets, and it is the whole of this behavior for them."""
        self.assertEqual(C.DEFAULTS["resume_within_minutes"], 5)
