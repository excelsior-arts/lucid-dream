/* The audio half of a page: what comes out of the speaker, what goes into the
   microphone, where a voice starts and stops, the words kept level with the
   voice, and the turn that was heard turned into a line of text.

   None of it is a component. The <audio> element outlives every render, the
   microphone outlives every re-mount that did not mean to close it, and the
   pacer is a clock. React reads them; it does not own them.

   And none of it knows what is being said. Nothing here has a conversation, a
   socket or a protocol in it: what a game wants done when a voice stops, or
   when the queue changes, or when the window takes the microphone away, it
   hands in as a callback. See packages/talk/src/routes/room/audio.ts for one
   game's answers. */
export {VOICE, soften, normalize} from './normalize';
export type {Lift} from './normalize';

export {createPlayback, wavBlob, wavBytes} from './playback';
export type {Playback, Options as PlaybackOptions} from './playback';

export {createCapture, canBeHeard, toPcm, toRate, RATE, saysSoAnyway} from './capture';
export type {Capture, MicFollow, Options as CaptureOptions} from './capture';

export {
  BLOCK, BLOCK_MS, FLOOR_MIN, ONSET_BLOCKS, PREROLL_BLOCKS, TUNING,
  bargeAllowed, createVad, speechlike, tuning, voicedness,
} from './vad';
export type {Meter, MicBarge, MicMode, Speaker, Tuning, Vad, VadConfig, VadEvent} from './vad';

export {isJunk} from './junk';

export {transcribe} from './stt';

export {createPacer, LEAD_S, STEP_MS} from './pacing';
export type {Pacer, Clock as PacerClock} from './pacing';
