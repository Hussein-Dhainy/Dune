import { Color, Vector3 } from 'three'
import type { Material } from 'three'

export type PyramidGlowUniforms = {
  /** World-space position of the hidden light source inside the pyramid. */
  core: { value: Vector3 }
  color: { value: Color }
  /** 0 until the pyramid has finished revealing, so the glow takes over from the construction outline. */
  visibility: { value: number }
  seamIntensity: { value: number }
  /** Seam line thickness in pixels, applied against the screen-space derivative. */
  seamWidth: { value: number }
  coreIntensity: { value: number }
  /** How much a block's pulse offset multiplies the light escaping around it. */
  pulseBoost: { value: number }
}

export function createPyramidGlowUniforms(): PyramidGlowUniforms {
  return {
    core: { value: new Vector3() },
    color: { value: new Color('#ffffff') },
    visibility: { value: 0 },
    seamIntensity: { value: 1.4 },
    seamWidth: { value: 1.1 },
    coreIntensity: { value: 5 },
    pulseBoost: { value: 4 },
  }
}

const patchedMaterials = new WeakSet<Material>()

/**
 * Fakes an intense light trapped inside the pyramid. Nothing is lit directly;
 * light only shows where it could escape: along every block seam, and on the
 * faces turned towards the core, which are hidden until the pulse pulls the
 * blocks apart. Values run well above 1 so the bloom pass picks them up.
 *
 * Must be applied after applyRevealShader and applyEdgeShader, whose world
 * position and barycentric varyings it reads. Expects a per-instance
 * `aGlowOpen` attribute holding each block's current pulse offset (0..1).
 */
export function applyPyramidGlowShader(material: Material, glow: PyramidGlowUniforms) {
  if (patchedMaterials.has(material)) return
  patchedMaterials.add(material)

  const compileBaseMaterial = material.onBeforeCompile
  const baseCacheKey = material.customProgramCacheKey.bind(material)

  material.onBeforeCompile = (shader, renderer) => {
    compileBaseMaterial.call(material, shader, renderer)
    shader.uniforms.uGlowCore = glow.core
    shader.uniforms.uGlowColor = glow.color
    shader.uniforms.uGlowVisibility = glow.visibility
    shader.uniforms.uGlowSeamIntensity = glow.seamIntensity
    shader.uniforms.uGlowSeamWidth = glow.seamWidth
    shader.uniforms.uGlowCoreIntensity = glow.coreIntensity
    shader.uniforms.uGlowPulseBoost = glow.pulseBoost

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aGlowOpen;
varying float vGlowOpen;
varying vec3 vGlowWorldNormal;
void main() {
  vGlowOpen = aGlowOpen;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  // Same caveat as the reveal's world position: three applies instanceMatrix
  // to the view-space normal only, so the world normal has to add it here.
  vec3 glowObjectNormal = objectNormal;
  #ifdef USE_INSTANCING
    glowObjectNormal = mat3(instanceMatrix) * glowObjectNormal;
  #endif
  vGlowWorldNormal = normalize(mat3(modelMatrix) * glowObjectNormal);`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uGlowCore;
uniform vec3 uGlowColor;
uniform float uGlowVisibility;
uniform float uGlowSeamIntensity;
uniform float uGlowSeamWidth;
uniform float uGlowCoreIntensity;
uniform float uGlowPulseBoost;
varying float vGlowOpen;
varying vec3 vGlowWorldNormal;
void main() {`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  // Dynamically uniform, so this costs nothing until the reveal has finished.
  if (uGlowVisibility > 0.001) {
    float glowOpen = vGlowOpen;
    float glowPulse = 1.0 + glowOpen * uGlowPulseBoost;

    // Seams: the hard block edges, widening as the blocks part.
    vec3 glowMaskedBary = vEdgeBary + (1.0 - vEdgeMask) * 10.0;
    float glowEdgeDistance = min(min(glowMaskedBary.x, glowMaskedBary.y), glowMaskedBary.z);
    float glowPixel = fwidth(glowEdgeDistance);
    float glowSeam = 1.0 - smoothstep(0.0, glowPixel * uGlowSeamWidth * (1.0 + glowOpen), glowEdgeDistance);
    // A wider band where escaping light washes over the face near its edge,
    // only while the block is pulled away. Blocks are ~25px on screen, so any
    // wider and the whole face washes out.
    float glowHalo = 1.0 - smoothstep(0.0, glowPixel * uGlowSeamWidth * 3.0, glowEdgeDistance);

    // Faces turned towards the core: the inner shell and the sides of each gap.
    vec3 glowToCore = uGlowCore - vRevealWorldPosition;
    float glowCoreDistance = length(glowToCore);
    float glowFacing = dot(normalize(vGlowWorldNormal), glowToCore / max(glowCoreDistance, 0.0001));
    float glowInward = smoothstep(-0.15, 0.75, glowFacing);
    float glowFalloff = mix(0.4, 1.0, 1.0 - smoothstep(0.5, 3.5, glowCoreDistance));

    totalEmissiveRadiance += uGlowColor * uGlowVisibility * (
      glowSeam * uGlowSeamIntensity * glowPulse
      + glowHalo * uGlowSeamIntensity * 0.3 * glowOpen * uGlowPulseBoost
      + glowInward * glowFalloff * uGlowCoreIntensity * (0.2 + glowOpen * uGlowPulseBoost)
    );
  }`,
      )
  }
  material.customProgramCacheKey = () => `${baseCacheKey()}-pyramid-core-glow-v4`
  material.needsUpdate = true
}
