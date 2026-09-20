import { Color, Vector3 } from 'three'
import type { Material } from 'three'

export type PyramidGlowUniforms = {
  origin: { value: Vector3 }
  color: { value: Color }
  intensity: { value: number }
  rimStrength: { value: number }
  exteriorPosition: { value: Vector3 }
  exteriorColor: { value: Color }
  exteriorRimStrength: { value: number }
}

export function createPyramidGlowUniforms(): PyramidGlowUniforms {
  return {
    origin: { value: new Vector3() },
    color: { value: new Color('#ffc46b') },
    intensity: { value: 0 },
    rimStrength: { value: 0.12 },
    exteriorPosition: { value: new Vector3(6, 11, 7) },
    exteriorColor: { value: new Color('#ffd8a3') },
    exteriorRimStrength: { value: 0.24 },
  }
}

export function applyPyramidGlowShader(material: Material, glow: PyramidGlowUniforms) {
  const compileBaseMaterial = material.onBeforeCompile
  const baseCacheKey = material.customProgramCacheKey.bind(material)

  material.onBeforeCompile = (shader, renderer) => {
    compileBaseMaterial.call(material, shader, renderer)
    shader.uniforms.uPyramidCoreOrigin = glow.origin
    shader.uniforms.uPyramidCoreColor = glow.color
    shader.uniforms.uPyramidGlowIntensity = glow.intensity
    shader.uniforms.uPyramidRimStrength = glow.rimStrength
    shader.uniforms.uPyramidExteriorPosition = glow.exteriorPosition
    shader.uniforms.uPyramidExteriorColor = glow.exteriorColor
    shader.uniforms.uPyramidExteriorRimStrength = glow.exteriorRimStrength
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'varying vec3 vPyramidGlowWorldNormal;\nvoid main() {',
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  vPyramidGlowWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uPyramidCoreOrigin;
uniform vec3 uPyramidCoreColor;
uniform float uPyramidGlowIntensity;
uniform float uPyramidRimStrength;
uniform vec3 uPyramidExteriorPosition;
uniform vec3 uPyramidExteriorColor;
uniform float uPyramidExteriorRimStrength;
varying vec3 vPyramidGlowWorldNormal;
void main() {`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  vec3 pyramidWorldNormal = normalize(vPyramidGlowWorldNormal);
  vec3 pyramidToCore = uPyramidCoreOrigin - vRevealWorldPosition;
  float pyramidCoreDistance = length(pyramidToCore);
  vec3 pyramidCoreDirection = pyramidToCore / max(pyramidCoreDistance, 0.0001);

  // Surfaces directed toward the core receive most of the energy. Outward
  // faces retain their normal sandstone shading and texture.
  float pyramidCoreFacing = smoothstep(0.02, 0.82, dot(pyramidWorldNormal, pyramidCoreDirection));
  vec3 pyramidViewDirection = normalize(cameraPosition - vRevealWorldPosition);
  float pyramidRim = pow(1.0 - abs(dot(pyramidWorldNormal, pyramidViewDirection)), 3.0);
  float pyramidDistanceFade = 1.0 - smoothstep(3.0, 6.8, pyramidCoreDistance);
  float pyramidLightShape = pyramidCoreFacing
    + pyramidRim * uPyramidRimStrength * mix(0.18, 1.0, pyramidCoreFacing);
  totalEmissiveRadiance += uPyramidCoreColor
    * pyramidLightShape
    * pyramidDistanceFade
    * uPyramidGlowIntensity;

  // Add a restrained rim only where the exterior key light can reach the
  // surface. The physical spotlight remains responsible for the main shading.
  vec3 pyramidToExterior = normalize(uPyramidExteriorPosition - vRevealWorldPosition);
  float pyramidExteriorFacing = smoothstep(0.0, 0.42, dot(pyramidWorldNormal, pyramidToExterior));
  float pyramidExteriorRim = pow(1.0 - abs(dot(pyramidWorldNormal, pyramidViewDirection)), 3.5);
  totalEmissiveRadiance += uPyramidExteriorColor
    * pyramidExteriorRim
    * pyramidExteriorFacing
    * uPyramidExteriorRimStrength;`,
      )
  }
  material.customProgramCacheKey = () => `${baseCacheKey()}-pyramid-exterior-glow-v2`
  material.needsUpdate = true
}
