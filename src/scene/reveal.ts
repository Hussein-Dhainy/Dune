import type { Material } from 'three'
import { Vector3 } from 'three'

/**
 * How much a fragment's depth below the reveal origin counts towards its
 * reveal distance, which is what tips the expanding square into sweeping
 * downwards rather than purely outwards. Exported because the CPU side has to
 * size a reveal radius against the same weighting the shader applies.
 */
export const revealDepthWeight = 0.34

export type RevealUniforms = {
  timeline: { value: number }
  progress: { value: number }
  origin: { value: Vector3 }
  distance: { value: number }
  /**
   * World size of one Chebyshev cell. The front snaps to cell centres, so this
   * is also the size of the step it advances by - it has to be proportional to
   * the object being revealed, or a small object is spanned by a handful of
   * cells and arrives in a handful of visible pops.
   */
  cellSize: { value: number }
}

export function createRevealUniforms(cellSize = 1.35): RevealUniforms {
  return {
    timeline: { value: 0 },
    progress: { value: 0 },
    origin: { value: new Vector3(0, 6, 0) },
    distance: { value: 60 },
    cellSize: { value: cellSize },
  }
}

// Chaining onBeforeCompile means applying the patch twice would splice the same
// uniforms and varyings into the shader source twice, which fails to compile.
// Effects can legitimately run more than once for a memoised material, so the
// patch records which materials it has already touched.
const patchedMaterials = new WeakSet<Material>()

export function applyRevealShader(material: Material, reveal: RevealUniforms) {
  if (patchedMaterials.has(material)) return
  patchedMaterials.add(material)

  const compileBaseMaterial = material.onBeforeCompile
  const baseCacheKey = material.customProgramCacheKey.bind(material)

  material.onBeforeCompile = (shader, renderer) => {
    compileBaseMaterial.call(material, shader, renderer)
    shader.uniforms.uRevealProgress = reveal.progress
    shader.uniforms.uRevealOrigin = reveal.origin
    shader.uniforms.uRevealDistance = reveal.distance
    shader.uniforms.uRevealCellSize = reveal.cellSize
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vRevealWorldPosition;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  // Three's own chunks only apply instanceMatrix to local temporaries like
  // mvPosition, never to \`transformed\`, so an instanced mesh would otherwise
  // report every instance at the same world position and dissolve as one.
  vec4 revealLocalPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    revealLocalPosition = instanceMatrix * revealLocalPosition;
  #endif
  vRevealWorldPosition = ( modelMatrix * revealLocalPosition ).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uRevealProgress;
uniform vec3 uRevealOrigin;
uniform float uRevealDistance;
uniform float uRevealCellSize;
varying vec3 vRevealWorldPosition;
void main() {`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  // uRevealProgress is a per-draw uniform, identical for every pixel in this
  // call, so this branch is "dynamically uniform": the GPU skips the whole
  // grid/hash computation below at zero cost once the reveal is done, instead
  // of paying for it on every pixel forever just to discard nothing.
  bool revealActive = uRevealProgress <= 0.999;
  float revealOffset = -1.0;
  if (revealActive) {
    vec3 revealDelta = vRevealWorldPosition - uRevealOrigin;
    float cellSize = uRevealCellSize;
    vec2 cell = floor((revealDelta.xz + cellSize * 0.5) / cellSize);
    vec2 cellCenter = cell * cellSize;

    // Chebyshev distance creates an expanding square. Sampling it at grid-cell
    // centers makes the advancing boundary arrive in distinct block-like patches.
    float squareDistance = max(abs(cellCenter.x), abs(cellCenter.y));
    squareDistance += max(-revealDelta.y, 0.0) * ${revealDepthWeight.toFixed(2)};

    // Stable per-cell variation breaks up an otherwise perfectly uniform border.
    float cellVariation = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453) - 0.5;
    float variationStrength = smoothstep(1.5, 7.0, length(revealDelta.xz));
    // Jitter scales with the cell so the border breaks up by the same
    // proportion at either object's cell size.
    float shapedDistance = squareDistance + cellVariation * cellSize * 0.85 * variationStrength;
    float revealRadius = uRevealProgress * uRevealDistance;
    revealOffset = shapedDistance - revealRadius;
    if (revealOffset > 0.0) discard;
  }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `if (revealActive) {
    // uRevealCellSize, not the local cellSize: that one is scoped to the
    // reveal block above, while this runs at function scope.
    float revealEdge = 1.0 - smoothstep(0.0, uRevealCellSize * 0.24, abs(revealOffset));
    gl_FragColor.rgb += vec3(0.95, 0.66, 0.28) * revealEdge * 0.8;
  }
  #include <dithering_fragment>`,
      )
  }
  material.customProgramCacheKey = () => `${baseCacheKey()}-dune-world-reveal-v6`
  material.needsUpdate = true
}
