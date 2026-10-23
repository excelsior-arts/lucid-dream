import * as THREE from 'three/webgpu';
export type BodyDetail = 'high' | 'balanced' | 'low';

export function bodyDetailIndices(data: ArrayBuffer, vertices: number) {
  if (data.byteLength < 16 || data.byteLength % 4 !== 0)
    throw new Error('Invalid body detail data');
  const values = new Uint32Array(data);
  const [magic, count, balanced, low] = values;
  if (
    magic !== 0x424c4f44 ||
    count !== vertices ||
    !balanced ||
    !low ||
    balanced % 3 ||
    low % 3 ||
    values.length !== 4 + balanced + low
  )
    throw new Error('Body detail does not match the character');
  const indices = values.subarray(4);
  if (indices.some((index) => index >= vertices))
    throw new Error('Body detail contains an invalid vertex');
  return {
    balanced: new THREE.BufferAttribute(indices.subarray(0, balanced), 1),
    low: new THREE.BufferAttribute(indices.subarray(balanced), 1),
  };
}
