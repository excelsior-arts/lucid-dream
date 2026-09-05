/* The model side of a page: words asked for and streamed back, sentences
   spoken, the lamps, and the lifecycle of several gigabytes.

   Everything here talks to one address -- the machine, which is a Python on
   this Mac today and a hosted provider on the same shapes tomorrow. None of it
   knows what a game is. It is handed messages, a voice by name and a queue to
   play into, and hands back tokens, audio and one finished reply.

   The line it sits on: a language model, a voice, an ear and a microphone are
   the machine's; a persona, a pill, a dose, a memory of you and a room are the
   game's. See packages/talk/src/conversation for one game's half. */
export {FIRST_CHUNK_WORDS, MERGE_WORDS, MERGE_MAX_WORDS, MERGE_CHARS, CLAUSE_END, mergeFor,
  shortenOpening, splitForSpeech, spokenPrefix} from './speech';
export type {SplitOptions} from './speech';

export {machine, machineWs} from './address';

export {streamChat} from './chat';
export type {ChatOptions, Message, Role} from './chat';

export {openVoice, TTS_PATH, VoiceRefused} from './tts';
export type {Frame, MakeSocket, Options as VoiceOptions, Socketish, Stats, Voice} from './tts';

export {awaitReady, models, ping, READY_EVERY_MS, READY_TIMEOUT_MS, status, voices}
  from './status';
export type {Facts, MemoryUse, Model, ModelStatus, Wanted, WarmBody} from './status';

export {runReply} from './reply';
export type {Reply, ReplyOptions} from './reply';

export {createVoiceLoop} from './voice';
export type {InputMode, VoiceLoop, VoiceLoopOptions} from './voice';
