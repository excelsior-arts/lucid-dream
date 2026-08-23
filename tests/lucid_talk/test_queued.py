"""What happens to a turn that had to wait its turn.

Only one reply can be spoken at a time, so every other way of starting one —
typing, a press on something in the room, Skip, the continuous loop, a message
that arrived while the models were still loading — queues behind a single lock
and wakes up when the floor is free. The question each of these asks is whether
it should still be wanted by then.

Twice it was not, and both times the answer was heard rather than read. Stop
waits on that same lock before unloading, so a reply queued behind the last one
woke up afterwards, cleared the stop flag, and spoke — which loads the voice
model that had just been freed, seconds after the console said the memory was
back. And Skip queues a turn per press, so five presses in one breath took five
turns: the first was cut off and the other four were spoken in full, one after
another, to somebody who had asked to move on.
"""
import threading
import time
import unittest

from lucid_talk.session import Session


class Stub:
    """Just the floor and who is standing on it."""

    reply_to = Session.reply_to
    _keep_unanswered = Session._keep_unanswered

    def __init__(self):
        self._replying = threading.Lock()
        self.stop_reply = threading.Event()
        self.running = True
        self._speech_gen = 0
        self.spoken = []
        self.history = []
        self.store = self

    def _reply(self, text, hidden):
        self.spoken.append(text)

    def append(self, role, text):
        pass                       # the transcript, as far as this is concerned

    def _hands_soon(self):
        pass

    def emit(self, kind, **payload):
        pass

    # The one thing Stop and Skip have in common.
    def silence(self):
        self._speech_gen += 1
        self.stop_reply.set()
        return self._speech_gen

    def queue(self, text, hidden=False):
        """Start a reply on a thread, and wait until it is really waiting."""
        t = threading.Thread(target=self.reply_to, args=(text, hidden), daemon=True)
        t.start()
        time.sleep(.05)
        return t


class WhatWakesUpBehindTheLock(unittest.TestCase):
    def test_a_reply_queued_before_stop_does_not_speak_after_it(self):
        """The whole reason Stop waits: speaking reloads what it just freed."""
        s = Stub()
        s._replying.acquire()               # a reply in flight
        t = s.queue("something typed")
        s.running = False                   # Stop, while that one waits
        s._replying.release()
        t.join(2)
        self.assertEqual(s.spoken, [],
                         "a queued reply spoke after everything was unloaded")

    def test_and_it_leaves_the_stop_flag_where_it_found_it(self):
        """It used to clear the flag on its way past, which un-stopped the
        machine as well as talking to it."""
        s = Stub()
        s.stop_reply.set()
        s._replying.acquire()
        t = s.queue("something typed")
        s.running = False
        s._replying.release()
        t.join(2)
        self.assertTrue(s.stop_reply.is_set(), "the stop was quietly undone")

    def test_five_skips_in_one_breath_take_one_turn(self):
        s = Stub()
        s._replying.acquire()               # the pill is mid-sentence
        threads = []
        for i in range(5):
            s.silence()                     # what Skip does before asking
            threads.append(s.queue(f"skip {i}", hidden=True))
        s._replying.release()
        for t in threads:
            t.join(2)
        self.assertEqual(s.spoken, ["skip 4"],
                         "every press took its own turn, one after another")

    def test_stop_means_stop_even_for_something_typed(self):
        """With a long reply being spoken and two things typed behind it,
        pressing Stop and then hearing the machine work through the queue
        anyway is a key that does not do what it says."""
        s = Stub()
        s._replying.acquire()
        t = s.queue("what did you mean by that")
        s.silence()                         # Stop pressed on the voice
        s._replying.release()
        t.join(2)
        self.assertEqual(s.spoken, [], "it answered a line Stop had canceled")

    def test_but_the_words_are_kept(self):
        """The answer was canceled; the sentence was not. It is the part with
        nowhere else to live, and it was always going into the transcript —
        so it goes, and saying it again is what asks for an answer."""
        s = Stub()
        s._replying.acquire()
        t = s.queue("what did you mean by that")
        s.silence()
        s._replying.release()
        t.join(2)
        self.assertEqual([m["content"] for m in s.history],
                         ["what did you mean by that"],
                         "somebody's words went nowhere at all")

    def test_and_the_same_for_a_press_in_the_room(self):
        """A press makes a visible turn, so it is somebody's line as much as a
        typed one is."""
        s = Stub()
        s._replying.acquire()
        t = s.queue("he pushes the books")
        s.silence()
        s._replying.release()
        t.join(2)
        self.assertEqual(s.spoken, [])
        self.assertEqual([m["content"] for m in s.history], ["he pushes the books"])
