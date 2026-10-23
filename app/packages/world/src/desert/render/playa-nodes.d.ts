import type {Node} from 'three/webgpu';
export const PLATE: number;
export const CRACK: number;
export function createPlayaNodes(): {
  /** One plate unit's width on screen; take it in uniform control flow. */
  plateFootprint: (arg0: Node<'vec2'>) => Node<'float'>;
  /** x: crack mask. y: plate tone. zw: the raised lip's horizontal slope. */
  playaCracks: (arg0: Node<'vec2'>, arg1: Node<'float'>) => Node<'vec4'>;
};
