// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {FrameLoop} from '../loop/frame-loop';

function harness(draw: (dt: number) => Promise<boolean>) {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const loop = new FrameLoop(draw, {
    request: (callback) => {
      callbacks.set(++next, callback);
      return next;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  });
  return {
    loop,
    queued: () => callbacks.size,
    async frame(time: number) {
      const entry = callbacks.entries().next().value;
      if (!entry) throw new Error('No frame requested');
      callbacks.delete(entry[0]);
      entry[1](time);
      await Promise.resolve();
    },
  };
}

describe('demand rendering', () => {
  it('coalesces changes and sleeps between static frames without accumulating idle time', async () => {
    const draw = vi.fn(async () => false);
    const h = harness(draw);
    h.loop.invalidate();
    expect(h.queued()).toBe(0);
    const ready = h.loop.start();
    h.loop.invalidate();
    h.loop.invalidate();
    expect(h.queued()).toBe(1);
    await h.frame(100);
    await ready;
    expect(h.loop.inspect().idle).toBe(true);
    h.loop.invalidate();
    await h.frame(60000);
    expect(draw.mock.calls).toEqual([[0], [0]]);
    expect(h.queued()).toBe(0);
  });

  it('advances moving scenes and resets the clock when playback resumes', async () => {
    const draw = vi.fn(async () => true);
    const h = harness(draw);
    void h.loop.start();
    await h.frame(100);
    await h.frame(120);
    h.loop.resetClock();
    await h.frame(5000);
    expect(draw.mock.calls).toEqual([[0], [0.02], [0]]);
    expect(h.queued()).toBe(1);
    h.loop.dispose();
    expect(h.queued()).toBe(0);
  });

  it('serializes async water passes and retains input received while a frame is in flight', async () => {
    let finish!: (moving: boolean) => void;
    const draw = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const h = harness(draw);
    void h.loop.start();
    await h.frame(100);
    h.loop.invalidate();
    h.loop.invalidate();
    expect(h.queued()).toBe(0);
    finish(false);
    await Promise.resolve();
    expect(h.queued()).toBe(1);
    await h.frame(120);
    expect(draw).toHaveBeenCalledTimes(2);
    h.loop.dispose();
    finish(true);
    await Promise.resolve();
    expect(h.queued()).toBe(0);
  });

  it('cancels hidden work and wakes without catching up hidden time', async () => {
    const draw = vi.fn(async () => true);
    const h = harness(draw);
    void h.loop.start();
    await h.frame(100);
    h.loop.setVisible(false);
    h.loop.invalidate();
    expect(h.queued()).toBe(0);
    h.loop.setVisible(true);
    await h.frame(60000);
    expect(draw.mock.calls).toEqual([[0], [0]]);
    h.loop.dispose();
  });

  it('does not restart an in-flight frame when hidden', async () => {
    let finish!: (moving: boolean) => void;
    const h = harness(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    void h.loop.start();
    await h.frame(100);
    h.loop.setVisible(false);
    finish(true);
    await Promise.resolve();
    expect(h.queued()).toBe(0);
    h.loop.setVisible(true);
    expect(h.queued()).toBe(1);
    h.loop.dispose();
  });

  it('reports a failed first draw to the loading screen and stops requesting frames', async () => {
    const h = harness(async () => {
      throw new Error('Water initialization failed');
    });
    const ready = expect(h.loop.start()).rejects.toThrow('Water initialization failed');
    await h.frame(100);
    await ready;
    h.loop.invalidate();
    expect(h.queued()).toBe(0);
  });
  it('paces a 120 Hz screen at 60 or 30 fps while retaining elapsed simulation time', async () => {
    for (const fps of [60, 30]) {
      const draw = vi.fn<(dt: number) => Promise<boolean>>(async () => true);
      const h = harness(draw);
      h.loop.setMaxFps(fps);
      void h.loop.start();
      for (let i = 0; i <= 120; i++) await h.frame((i * 1000) / 120);
      expect(draw).toHaveBeenCalledTimes(fps + 1);
      expect(draw.mock.calls.reduce((sum, [dt]) => sum + dt, 0)).toBeCloseTo(1, 6);
      h.loop.dispose();
    }
  });
  it('keeps input received on a skipped frame and still sleeps after it is drawn', async () => {
    let moving = true;
    const draw = vi.fn<(dt: number) => Promise<boolean>>(async () => moving);
    const h = harness(draw);
    h.loop.setMaxFps(30);
    void h.loop.start();
    await h.frame(0);
    h.loop.invalidate();
    moving = false;
    await h.frame(10);
    expect(draw).toHaveBeenCalledTimes(1);
    await h.frame(34);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(h.loop.inspect().idle).toBe(true);
  });
});
