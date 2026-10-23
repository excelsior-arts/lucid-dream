import * as THREE from 'three/webgpu';
import {
  BRDF_Lambert,
  F_Schlick,
  diffuseContribution,
  normalView,
  positionViewDirection,
  specularColor,
  specularF90,
  vec3,
} from 'three/tsl';

/**
 * The three r186 compensation, in one place.
 *
 * r186 made the physically based materials conserve energy at the diffuse
 * layer: light a surface reflects at its specular interface no longer reaches
 * its diffuse colour. Direct light is weighted by (1 - Fresnel) at the
 * half-vector, and hemisphere and ambient light by (1 - the specular lobe's
 * albedo) at the view angle. Specular itself did not change. On rough sand
 * that is a few per cent of the diffuse at the front-lit opening and over ten
 * per cent with the moon low ahead of the camera, which is most of the walk:
 * measured headless against r185 at the same frames, the ground came out 3 to
 * 7 % darker in code values, the figure up to 1.8 %, the sea and the sky not
 * at all (the sea shades itself and the sky is unlit).
 *
 * A factor on the albedo or on a light cannot give that back, because the
 * share taken depends on where the camera stands against the light: fitted
 * over the walk, the best albedo factor (1.065) left the opening 2.4 % too
 * bright and the walk to the sea 3.4 % too dark. So the share is handed back
 * where it was taken, per pixel and per light, by a lighting model that is
 * r186's own plus the term it subtracted. Nothing of three's is changed: the
 * materials are told which lighting model to build (setupLightingModel, the
 * hook three's own node materials override). Specular stays r186's.
 *
 * Remove this when the desert's look is re-authored for the new shading.
 */
class Diffuse185LightingModel extends THREE.PhysicalLightingModel {
  override direct(
    light: Parameters<THREE.PhysicalLightingModel['direct']>[0],
    builder: THREE.NodeBuilder,
  ) {
    super.direct(light, builder);
    const {lightDirection, lightColor, reflectedLight} = light as unknown as {
      lightDirection: THREE.Node<'vec3'>;
      lightColor: THREE.Node<'vec3'>;
      reflectedLight: {directDiffuse: THREE.Node<'vec3'>};
    };
    const irradiance = normalView.dot(lightDirection).clamp().mul(lightColor);
    const halfway = lightDirection.add(positionViewDirection).normalize();
    const taken = F_Schlick({
      f0: specularColor,
      f90: specularF90,
      dotVH: positionViewDirection.dot(halfway).clamp(),
    });
    const lambert = BRDF_Lambert({diffuseColor: diffuseContribution}) as unknown as THREE.Node<'vec3'>;
    reflectedLight.directDiffuse.addAssign(
      irradiance.mul(lambert).mul(taken as unknown as THREE.Node<'vec3'>),
    );
  }

  override indirectDiffuse(builder: THREE.NodeBuilder) {
    super.indirectDiffuse(builder);
    const {irradiance, reflectedLight} = builder.context as unknown as {
      irradiance: THREE.Node<'vec3'>;
      reflectedLight: {indirectDiffuse: THREE.Node<'vec3'>};
    };
    const single = vec3().toVar(),
      multiple = vec3().toVar();
    // The same call r186's indirectDiffuse makes (the types leave out its f0).
    (this as unknown as {computeMultiscattering(...args: unknown[]): void}).computeMultiscattering(
      single,
      multiple,
      specularF90,
      specularColor,
    );
    const lambert = BRDF_Lambert({diffuseColor: diffuseContribution}) as unknown as THREE.Node<'vec3'>;
    reflectedLight.indirectDiffuse.addAssign(
      irradiance.mul(lambert).mul(single.add(multiple)),
    );
  }
}

/** Give r185's diffuse back to everything lit under `root`. A trip calls it on
    its scene when the world is assembled and again on anything that arrives
    later; a material already given it is left alone. */
export function keepDiffuse185(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of ([] as THREE.Material[]).concat(mesh.material)) {
      const lit = material as THREE.MeshStandardNodeMaterial;
      if (!lit.isMeshStandardNodeMaterial || lit.userData.diffuse185) continue;
      lit.userData.diffuse185 = true;
      // A physical material's own model carries its clearcoat, sheen and the
      // rest; there is none in the desert, and it is left as it is.
      if ((lit as THREE.MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial) continue;
      lit.setupLightingModel = () => new Diffuse185LightingModel();
      lit.needsUpdate = true;
    }
  });
}
