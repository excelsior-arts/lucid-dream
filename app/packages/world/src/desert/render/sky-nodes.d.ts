import type {Node} from 'three/webgpu';
export function createNodes(uniforms: Record<string, {value: unknown}>): {
  starHash: (arg0: Node<'vec2'>) => Node<'float'>;
  skyAtmosphere: (arg0: Node<'vec3'>) => Node<'vec3'>;
  skyFragment: (arg0: Node<'vec3'>) => Node<'vec4'>;
};
