"""How a reply is cut up before it is spoken.

Nothing about this touches a model — it is text in and text out — and it
decides most of what the voice sounds like: where it breathes, how long you
wait for the first word, whether a pause is a pause or a hard cut between two
clips. It is also the part that has already gone wrong in a way nobody could
see from the code: while a reply is streaming, the last paragraph is still
being written, and treating it as finished came out as one word at a time.
"""
import unittest

from lucid_talk import models as M


def spoken(text, **kw):
    return M.split_for_speech(text, **kw)


class Sentences(unittest.TestCase):
    def test_the_first_sentence_goes_alone_so_speech_starts_sooner(self):
        out = spoken("Yes. I thought so too. It was always going to be.")
        self.assertEqual(out[0], "Yes.")

    def test_short_sentences_after_it_are_carried_together(self):
        """The per-call overhead costs more than the extra words do."""
        out = spoken("Yes. Come here. Sit down. Stay a while.")
        self.assertEqual(len(out), 2)
        self.assertIn("Come here.", out[1])
        self.assertIn("Stay a while.", out[1])

    def test_an_ellipsis_is_a_pause_and_not_a_boundary(self):
        """"Stay... just like that." is one sentence, and splitting it makes a
        hard cut between two clips where a breath belongs."""
        out = spoken("Stay... just like that.")
        self.assertEqual(out, ["Stay... just like that."])

    def test_a_real_ellipsis_character_too(self):
        self.assertEqual(len(spoken("Stay… just like that.")), 1)

    def test_a_question_and_a_shout_are_still_ends(self):
        out = spoken("Are you there? I said are you there!")
        self.assertEqual(out[0], "Are you there?")


class Paragraphs(unittest.TestCase):
    def test_a_paragraph_is_never_merged_into_the_next(self):
        """The model put the break there, and letting one call span it
        flattens the arc it was building."""
        out = spoken("One.\n\nTwo.\n")
        self.assertEqual(len(out), 2)

    def test_a_finished_paragraph_keeps_the_break_the_model_wrote(self):
        """trim_silence strips the natural tail off every chunk, so without
        this the next paragraph starts instantly and the break is inaudible."""
        out = spoken("One.\n\nTwo.\n")
        self.assertTrue(out[0].endswith("\n"))

    def test_a_paragraph_still_being_written_is_not_treated_as_finished(self):
        """This is the "one word at a time" bug. Every new token arriving mid
        sentence used to look like a completed paragraph and be sent to the
        voice on its own."""
        for so_far in ("She", "She looked", "She looked up", "She looked up at"):
            out = spoken(so_far)
            self.assertEqual(len(out), 1, so_far)
            self.assertFalse(out[0].endswith("\n"), so_far)

    def test_a_single_newline_is_a_break_as_well(self):
        self.assertEqual(len(spoken("One.\nTwo.\n")), 2)

    def test_nothing_at_all_comes_back_as_nothing(self):
        for empty in ("", "   ", "\n\n"):
            self.assertEqual(spoken(empty), [])


class Tags(unittest.TestCase):
    """[sigh] and friends are delivery, not words."""

    def test_a_tag_with_no_words_of_its_own_rides_with_the_line_before_it(self):
        """On its own it would be dropped before synthesis and the delivery
        would go with it."""
        out = spoken("I know. [sigh]")
        self.assertEqual(len(out), 1)
        self.assertIn("[sigh]", out[0])

    def test_a_line_that_is_only_a_tag_at_the_very_start(self):
        out = spoken("[laughs] Fine.")
        self.assertTrue(any("[laughs]" in c for c in out))


class TheOpening(unittest.TestCase):
    """first_short is the trade between waiting and a stream of small calls,
    and it is only made once, at the top of a reply."""

    LONG = ("I have been thinking about what you said last night, and about "
            "the way you said it, which is the part that stayed with me.")

    def test_a_long_opening_is_cut_at_a_clause_so_the_voice_starts_sooner(self):
        plain = spoken(self.LONG)
        short = spoken(self.LONG, first_short=True)
        self.assertEqual(len(plain), 1)
        self.assertEqual(len(short), 2)
        self.assertLess(len(short[0].split()), len(plain[0].split()))

    def test_the_words_are_all_still_there_and_in_order(self):
        self.assertEqual(" ".join(spoken(self.LONG, first_short=True)).split(),
                         self.LONG.split())

    def test_an_opening_that_is_already_short_is_left_alone(self):
        self.assertEqual(spoken("Yes. And no.", first_short=True)[0], "Yes.")

    def test_only_the_opening_is_treated_this_way(self):
        text = "Yes.\n\n" + self.LONG
        out = spoken(text, first_short=True)
        self.assertEqual(out[-1].strip(), self.LONG)


class AnInterruptedReplyKeepsItsShape(unittest.TestCase):
    """Stopped mid-reply, a transcript holds what was heard — and holds it the
    way it was written.

    Rebuilding it out of the chunks it was spoken in loses the model's blank
    lines, because the splitter took them out and left one newline behind. A
    reply that arrived with air in it then reads back from History as a block
    with stray spaces down the left, which is not what anybody saw.
    """

    WRITTEN = ("She put the glass down.\n\n"
               "*a long pause*\n\n"
               "You were saying something. Go on.")

    def spoke(self, upto):
        """The chunks the voice got through before it was stopped."""
        return M.split_for_speech(self.WRITTEN)[:upto]

    def test_the_paragraphs_the_model_wrote_are_still_there(self):
        said = M.spoken_prefix(self.WRITTEN, self.spoke(2))
        self.assertIn("\n\n", said, "the blank line was flattened")

    def test_and_nothing_is_stored_that_was_never_heard(self):
        said = M.spoken_prefix(self.WRITTEN, self.spoke(1))
        self.assertNotIn("You were saying", said,
                         "a line the voice never reached is in the transcript")

    def test_what_was_heard_is_all_there(self):
        said = M.spoken_prefix(self.WRITTEN, self.spoke(2))
        self.assertIn("She put the glass down.", said)
        self.assertIn("*a long pause*", said)

    def test_a_whole_reply_comes_back_whole(self):
        every = M.split_for_speech(self.WRITTEN)
        self.assertEqual(M.spoken_prefix(self.WRITTEN, every).strip(),
                         self.WRITTEN.strip())

    def test_nothing_spoken_is_nothing_stored(self):
        self.assertEqual(M.spoken_prefix(self.WRITTEN, []), "")

    def test_no_stray_space_down_the_left(self):
        """The signature of the old rejoin: a newline with a space after it."""
        said = M.spoken_prefix(self.WRITTEN, self.spoke(2))
        self.assertNotIn("\n ", said)


class WhatIsNotWorthAnswering(unittest.TestCase):
    """What comes back from the recognizer when it heard the room."""

    def test_the_usual_noises_are_junk(self):
        for noise in ("", "   ", "you", "You.", "thank you", "Thank you!"):
            self.assertTrue(M.is_junk(noise), noise)

    def test_something_somebody_said_is_not(self):
        for real in ("are you there", "I have been thinking", "no"):
            self.assertFalse(M.is_junk(real), real)

    def test_punctuation_and_case_do_not_make_a_new_sentence(self):
        self.assertEqual(M.normalize("  Thank  YOU!! "), "thank you")
