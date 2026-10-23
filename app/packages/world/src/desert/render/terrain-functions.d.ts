import type {Node} from 'three/webgpu';
import type {Landscape} from '../landscape';
export function createNodes(uniforms: Record<string, {value: unknown}>, landscape: Landscape): {
  coastX: (arg0: Node<'float'>) => Node<'float'>;
  coastalDuneWeight: (arg0: Node<'vec2'>) => Node<'float'>;
  landHeight: (arg0: Node<'vec2'>) => Node<'float'>;
  terrainHeight: (arg0: Node<'vec2'>) => Node<'float'>;
  terrainVertexHeight: (arg0: Node<'vec2'>) => Node<'float'>;
  terrainNormal: (arg0: Node<'vec2'>) => Node<'vec3'>;
  hashSand: (arg0: Node<'vec2'>) => Node<'float'>;
  sandNoise: (arg0: Node<'vec2'>) => Node<'float'>;
  sandNoiseSlope: (arg0: Node<'vec2'>) => Node<'vec2'>;
  marks: (arg0: Node<'vec2'>) => Node<'vec4'>;
  ripple: (arg0: Node<'vec2'>) => Node<'float'>;
};

export const sandNoise: (p: Node<'vec2'>) => Node<'float'>;
export const sandNoiseSlope: (p: Node<'vec2'>) => Node<'vec2'>;
