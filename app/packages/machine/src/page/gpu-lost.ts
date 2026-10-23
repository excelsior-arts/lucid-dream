/* A GPU device lost under a worker, said to the page.
 *
 * WebGPU loses a device when the driver resets, when some GPUs reclaim a
 * backgrounded tab's, or under memory pressure, and every library here hears
 * it differently. WebLLM disposes of its model where it stands and says so
 * only in the worker's console: the next request throws ModelNotLoadedError
 * ("Object has already been disposed" mid-reply), while the page goes on
 * reading the engine as ready, so every line after is refused the same way
 * (measured 10-10, the 0.8B, the device destroyed under it between replies
 * and in the middle of one). ONNX Runtime, under the voice, says nothing at
 * all: the sentence being made never comes back, the reply waits on it for
 * good, and the line after is never answered either.
 *
 * So the worker watches its own devices: every one a library asks an adapter
 * for, through the prototype, before any library has run. When the newest
 * one is lost, `tell` is called with why; a device given up on purpose --
 * a library's own unload destroys its device, and a reload makes a new one --
 * is not news, by its reason ('destroyed') or by not being the newest. A
 * browser test destroys the newest itself through `lose`, which counts as
 * lost: what a driver reset does to the page, without one.
 */

export interface LostInfo {
  reason: string;
  message: string;
}

export interface Watch {
  /** For a browser test: the newest device destroyed and told as lost.
      False where there is none. */
  lose(): boolean;
}

export function watchDevices(tell: (info: LostInfo) => void): Watch {
  let newest: GPUDevice | null = null;
  let losing: GPUDevice | null = null;
  const proto = (globalThis as {GPUAdapter?: {prototype: GPUAdapter}}).GPUAdapter?.prototype;
  if (proto && !(proto as {lucidWatched?: boolean}).lucidWatched) {
    (proto as {lucidWatched?: boolean}).lucidWatched = true;
    const ask = proto.requestDevice;
    proto.requestDevice = async function (this: GPUAdapter, d?: GPUDeviceDescriptor) {
      const device = await ask.call(this, d);
      newest = device;
      void device.lost.then((info) => {
        if (device !== newest) return;
        if (info.reason === 'destroyed' && losing !== device) return;
        tell({reason: losing === device ? 'lost' : String(info.reason), message: info.message});
      });
      return device;
    };
  }
  return {
    lose() {
      if (!newest) return false;
      losing = newest;
      newest.destroy();
      return true;
    },
  };
}
