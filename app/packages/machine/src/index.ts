/* The model side of a page: words asked for and streamed back, sentences
   spoken, the lamps, and the lifecycle of several gigabytes.

   Everything here talks to one address -- the machine, which is a Python on
   this Mac today and a hosted provider on the same shapes tomorrow. None of it
   knows what a game is. It is handed messages, a voice by name and a queue to
   play into, and hands back tokens, audio and one finished reply.

   The line it sits on: a language model, a voice, an ear and a microphone are
   the machine's; a persona, a pill, a dose, a memory of you and a room are the
   game's. See packages/talk/src/conversation for one game's half. */
export {MERGE_WORDS, MERGE_MAX_WORDS, MERGE_CHARS, hasWords, mergeFor, showable, splitForSpeech, spokenPrefix, tagsOnWords, wholeSentences, withoutTags} from './speech';
export type {SplitOptions} from './speech';
export {tagEntry, voiceTags} from './voice-tags';

export {answeredBy, beacon, call, machine, machineWs} from './address';
export type {Answer} from './address';

export {heedShelf, machineAnswers, settle} from './host';

export {streamChat} from './chat';
export {Told} from './told';
export {Dropped, FIRST_WORD_MS, LATE_MS, NEXT_WORD_MS, NotAnswering, Stalled} from './stall';
export {forgetModel} from './page/forget-model';
export type {PartKind} from './page/forget-model';
export type {ChatOptions, Message, Role} from './chat';

export {ask, colour, findJson, line, list, num, word} from './ask';
export type {AskOptions, Asked} from './ask';

export {openVoice, TTS_PATH, voiceAnsweredBy, VoiceFailed, VoiceRefused} from './tts';
export type {Frame, MakeSocket, Options as VoiceOptions, Socketish, Stats, Voice} from './tts';

export {asset, assets, awaitReady, bytes, models, ping, READY_EVERY_MS, READY_TIMEOUT_MS, shelf, status,
  voices}
  from './status';
export type {AssetKind, Facts, Fetching, Generation, MemoryUse, Model, ModelStatus, Offer, Part, PartsFetching, Wanted, WarmBody} from './status';

export {runReply} from './reply';
export type {Reply, ReplyOptions} from './reply';

export {createVoiceLoop} from './voice';
export type {InputMode, VoiceLoop, VoiceLoopOptions} from './voice';
