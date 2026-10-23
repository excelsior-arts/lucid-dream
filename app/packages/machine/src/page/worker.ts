/* The language model's own thread, when it runs in this page.
 *
 * WebLLM's handler and nothing else: the page talks to it through
 * CreateWebWorkerMLCEngine (see engine.ts), and everything heavy -- the
 * weights, the GPU, a reply being written -- stays off the thread that draws
 * the room. Beside it, a watch on the GPU device (gpu-lost.ts): WebLLM gives
 * up its model when the device is lost and tells nobody but this console, so
 * the page is told, as `{lucid: 'gpu-lost'}`, which engine.ts takes off the
 * stream before WebLLM's client reads it. */
import {WebWorkerMLCEngineHandler} from '@mlc-ai/web-llm';
import {watchDevices} from './gpu-lost';

const watch = watchDevices((info) => self.postMessage({lucid: 'gpu-lost', ...info}));
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  // A browser test's lost device: see Engine.loseGpu.
  if ((msg.data as {lucid?: string} | null)?.lucid === 'lose-gpu') { watch.lose(); return; }
  handler.onmessage(msg);
};
