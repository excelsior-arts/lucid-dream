import type {Node} from 'three/webgpu';
export function createNodes(uniforms: Record<string, {value: unknown}>): {
  particleVertex: () => Node<'vec4'>;
  noise: (arg0: Node<'vec2'>) => Node<'float'>;
  particleFragment: () => Node<'vec4'>;
  smokeFragment: () => Node<'vec4'>;
};
