// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {Vector3} from 'three';
import {WaveReadback} from '../scene/wave-readback';

function harness() {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  let positions: Vector3[] = [];
  const sample = {height: 0, normal: new Vector3(0, 1, 0)};
  const source = {
    setPositions: vi.fn((points: Vector3[]) => {
      positions = points.map((p) => p.clone());
    }),
    update: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () => {
            sample.height = positions[0]!.x;
            resolve();
          };
          fail = reject;
        }),
    ),
    updateLowLatency: vi.fn(async () => {}),
    getSample: () => sample,
    getSamples: () => [sample],
    getSampleCount: () => 1,
    updateCascadeUniforms: vi.fn(),
    dispose: vi.fn(),
  };
  const adapter = new WaveReadback(source);
  adapter.setPositions([new Vector3(1, 0, 0)]);
  return {source, adapter, finish: () => finish(), fail: (e: Error) => fail(e)};
}

describe('water height readback', () => {
  it('keeps frames running on cached results, with at most one query in flight', async () => {
    const h = harness();
    await h.adapter.updateLowLatency();
    h.adapter.setPositions([new Vector3(2, 0, 0)]);
    for (let frame = 0; frame < 20; frame++) await h.adapter.updateLowLatency();
    expect(h.source.update).toHaveBeenCalledTimes(1);
    expect(h.source.setPositions).toHaveBeenCalledTimes(1);
    expect(h.adapter.getSample(0).height).toBe(0);
    h.finish();
    await h.adapter.drain();
    expect(h.adapter.getSample(0).height).toBe(1);
    await h.adapter.updateLowLatency();
    h.finish();
    await h.adapter.drain();
    expect(h.source.update).toHaveBeenCalledTimes(2);
    expect(h.adapter.getSample(0).height).toBe(2);
  });

  it('waits for fresh explicit queries without changing the pending request', async () => {
    const h = harness();
    await h.adapter.updateLowLatency();
    const position = new Vector3(7, 0, 0);
    h.adapter.setPositions([position]);
    const explicit = h.adapter.update();
    position.x = 9;
    h.finish();
    await h.adapter.drain();
    expect(h.source.update).toHaveBeenCalledTimes(2);
    h.finish();
    await explicit;
    expect(h.adapter.getSample(0).height).toBe(7);
  });

  it('drains resource changes and does not dispose a source owned by WaterSystem', async () => {
    const h = harness();
    await h.adapter.updateLowLatency();
    let drained = false;
    const done = h.adapter.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    h.finish();
    await done;
    h.adapter.dispose();
    await h.adapter.updateLowLatency();
    expect(h.source.update).toHaveBeenCalledTimes(1);
    expect(h.source.dispose).not.toHaveBeenCalled();
  });

  it('reports failed readbacks on the next frame instead of leaving an unhandled rejection', async () => {
    const h = harness();
    await h.adapter.updateLowLatency();
    const error = new Error('GPU readback failed');
    h.fail(error);
    await expect(h.adapter.drain()).rejects.toThrow(error);
    await expect(h.adapter.updateLowLatency()).rejects.toThrow(error);
  });
});
