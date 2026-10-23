// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three/webgpu';
import {SeaSky} from '../scene/sea-sky';
import type {SeaLight} from '../scene/sea';

vi.mock('three/webgpu', async (load) => {
  const three = await load<typeof import('three/webgpu')>();
  return {
    ...three,
    PMREMGenerator: class {
      fromEquirectangular(_source: THREE.Texture, target?: THREE.RenderTarget) {
        return target ?? new three.RenderTarget(336, 64);
      }
      dispose() {}
    },
  };
});

function light(hour: number, horizon: string, zenith: string): SeaLight {
  return {
    hour,
    horizon: new THREE.Color(horizon),
    sunSkyline: new THREE.Color(horizon),
    sunHorizon: new THREE.Color(horizon),
    sunZenith: new THREE.Color(zenith),
    zenith: new THREE.Color(zenith),
    daylight: 1,
    sunDirection: [1, 1, 0],
    moonDirection: [-1, 1, 0],
    sunIntensity: 1,
    moonIntensity: 0,
  };
}

describe('sea reflection probe', () => {
  it('puts the warm reflection toward sunset and reverses it at sunrise', () => {
    const initTexture = vi.fn();
    const sky = new SeaSky({initTexture} as unknown as THREE.WebGPURenderer);
    const environment = sky.getEnvironmentTexture();
    const source = initTexture.mock.calls[0]![0] as THREE.DataTexture;
    const pixels = source.image.data as Uint8Array;
    const sunset = light(17.95, '#414d70', '#263652');
    sunset.sunHorizon.set('#e39470');
    sunset.sunDirection = [-1, 0, 0];
    sky.update(sunset);
    const rgb = (x: number) => pixels.slice((16 * 64 + x) * 4, (16 * 64 + x) * 4 + 3);
    const west = rgb(0),
      east = rgb(32);
    expect(west[0]).toBeGreaterThan(east[0]! * 2);
    expect(east[2]).toBeGreaterThan(east[0]!);
    // -X straddles the equirectangular seam and must remain continuous.
    expect(rgb(63)).toEqual(west);
    sky.update({...sunset, hour: 6.05, sunDirection: [1, 0, 0]});
    expect(rgb(32)).toEqual(west);
    expect(rgb(0)).toEqual(east);
    expect(sky.getEnvironmentTexture()).toBe(environment);
    sky.dispose();
  });

  it('changes sunset and moonlight pixels without replacing the environment bound by materials', () => {
    const initTexture = vi.fn();
    const sky = new SeaSky({initTexture} as unknown as THREE.WebGPURenderer);
    const environment = sky.getEnvironmentTexture();
    const disposed = vi.spyOn(THREE.RenderTarget.prototype, 'dispose');
    const source = initTexture.mock.calls[0]![0] as THREE.DataTexture;
    const pixels = source.image.data as Uint8Array;
    sky.update(light(17, '#e39470', '#6199c5'));
    const sunset = pixels.slice();
    for (let i = 1; i <= 100; i++) {
      sky.update(light(17 + i * 0.02, '#182c4c', '#091329'));
      expect(sky.getEnvironmentTexture()).toBe(environment);
    }
    expect(pixels).not.toEqual(sunset);
    expect(pixels[(16 * 64 + 32) * 4 + 2]).toBeGreaterThan(pixels[(16 * 64 + 32) * 4]!);
    expect(disposed).not.toHaveBeenCalled();
    const uploads = initTexture.mock.calls.length;
    for (let i = 0; i < 100; i++) sky.update(light(19, '#182c4c', '#091329'));
    expect(initTexture).toHaveBeenCalledTimes(uploads);
    // A Studio seek back into daylight updates the same resource too.
    sky.update(light(12, '#d4bf9d', '#6199c5'));
    expect(sky.getEnvironmentTexture()).toBe(environment);
    expect(initTexture).toHaveBeenCalledTimes(uploads + 1);
    sky.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    disposed.mockRestore();
  });
});
