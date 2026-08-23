"""A sentence is not over because its second syllable was quiet.

Speech does not hold one level. It starts loud — that is what makes the onset
detectable at all — and then falls away: unstressed syllables, the breath in
the middle, the tail of a question that drops rather than lands. A microphone
watching one threshold sees a voice arrive and then, a tenth of a second later,
sees a silent room.

Which is what happened. "So who you are?" — about a second of speech — armed the
mic and was then measured at 384ms, of which 256ms was the pre-roll kept from
before it started. Four blocks of an entire sentence cleared the bar. It was
dropped as too short to be a sentence, and the person who said it watched the
dots and got nothing back, twice a minute, with no way to tell why.

So there are two bars now. Arming stays where it was, because the thing it
keeps out is a fridge. Staying armed is lower, because the thing it has to keep
in is the quiet half of somebody's voice.
"""
import time
import unittest

import numpy as np

from lucid_talk import audio as A


class Ear:
    """A real Mic, fed by hand: blocks in through feed(), nothing opened."""

    def __init__(self, floor=0.01):
        self.mic = A.Mic()
        self.mic.enabled = True
        self.mic.floor = floor
        self.floor = floor
        self.kept = []
        self.mic.utterances.put = self.kept.append   # what survived
        self.dropped = []
        self.mic._emit = lambda name, **kw: (
            self.dropped.append(kw.get("ms")) if name == "dropped" else None)

    def block(self, loudness):
        """One 32 ms block at this many times the room's noise floor."""
        n = A.BLOCK
        rms = self.floor * loudness
        return np.full(n, rms, dtype=np.float32)

    def say(self, shape):
        """Feed a sentence, described as a loudness per block, then let it end.

        Through the real front door — Mic.start and Mic.feed, the two calls a
        page makes — so what is under test is the loop as it actually runs.
        """
        self.mic.start()
        try:
            for loudness in shape:
                self.mic.feed(self.block(loudness), A.STT_RATE)
            for _ in range(int(A.HANGOVER_MS / A.BLOCK_MS) + 3):
                self.mic.feed(self.block(0.2), A.STT_RATE)   # the room, after
            deadline = time.monotonic() + 5
            while not self.mic._blocks.empty() and time.monotonic() < deadline:
                time.sleep(0.01)
            time.sleep(0.35)               # the last blocks through the loop
        finally:
            self.mic.close()


def a_sentence():
    """Loud onset, then the quiet middle every real sentence has."""
    return [5.0] * 4 + [1.8] * 12 + [2.4] * 6 + [1.6] * 10


class TheQuietHalfOfASentenceIsKept(unittest.TestCase):
    def test_a_sentence_that_drops_after_its_first_syllable_survives(self):
        ear = Ear()
        ear.say(a_sentence())
        self.assertTrue(ear.kept, f"the whole sentence was dropped: {ear.dropped}")

    def test_and_it_is_measured_as_a_whole_sentence(self):
        ear = Ear()
        ear.say(a_sentence())
        heard_ms = len(ear.kept[0]) / A.STT_RATE * 1000
        self.assertGreater(heard_ms, A.MIN_TURN_MS,
                           "it was kept, but measured shorter than a cough")

    def test_the_old_single_gate_is_what_lost_it(self):
        """With sustain raised to the onset bar, the bug comes back — which is
        the proof that this is the thing that fixed it, not a coincidence."""
        was = A.SUSTAIN_MULT
        A.SUSTAIN_MULT = A.FLOOR_MULT
        try:
            ear = Ear()
            ear.say(a_sentence())
            self.assertFalse(ear.kept, "one gate kept it — the test proves nothing")
            self.assertTrue(ear.dropped, "and nothing said it had been dropped")
        finally:
            A.SUSTAIN_MULT = was


class TheRoomStillDoesNotArmIt(unittest.TestCase):
    def test_the_lower_bar_is_only_for_staying_armed(self):
        """A fridge sits above the sustain bar all day. It must never start a
        turn — arming is what keeps the room out, and it did not move."""
        ear = Ear()
        ear.say([1.5] * 60)
        self.assertFalse(ear.kept, "room noise started a turn")

    def test_a_real_cough_is_still_too_short(self):
        """The gate that drops a thump is length, and it is untouched."""
        ear = Ear()
        ear.say([6.0] * 3)
        self.assertFalse(ear.kept, "a 96 ms bang was taken for a sentence")


if __name__ == "__main__":
    unittest.main()
