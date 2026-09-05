/* Where the machine answers. The socket's address with the scheme it was made
   from, so nothing in here has to be configured and a page under a dev proxy
   reaches the same Python its websocket does. See stt.ts in @lucid/audio,
   which asks the same question of the same shell. */
import {backend} from '@lucid/shell';

export const machine = (): string => backend().replace(/^ws/, 'http');

/** And as a websocket, which is what the voice is reached on. */
export const machineWs = (): string => backend();
