import type { Material } from 'three'
import { Vector3 } from 'three'

export type RevealUniforms = {
  timeline: { value: number }
  progress: { value: number }
  origin: { value: Vector3 }
  distance: { value: number }
}

export function createRevealUniforms(): RevealUniforms {
  return {
    timeline: { value: 0 },
    progress: { value: 0 },
    origin: { value: new Vector3(0, 6, 0) },
    distance: { value: 60 },
  }
}

export function applyRevealShader(material: Material, reveal: RevealUniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRevealProgress = reveal.progress
    shader.uniforms.uRevealOrigin = reveal.origin
    shader.uniforms.uRevealDistance = reveal.distance
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vRevealWorldPosition;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vRevealWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uRevealProgress;
uniform vec3 uRevealOrigin;
uniform float uRevealDistance;
varying vec3 vRevealWorldPosition;
void main() {`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  vec3 revealDelta = vRevealWorldPosition - uRevealOrigin;
  const float cellSize = 1.35;
  vec2 cell = floor((revealDelta.xz + cellSize * 0.5) / cellSize);
  vec2 cellCenter = cell * cellSize;

  // Chebyshev distance creates an expanding square. Sampling it at grid-cell
  // centers makes the advancing boundary arrive in distinct block-like patches.
  float squareDistance = max(abs(cellCenter.x), abs(cellCenter.y));
  squareDistance += max(-revealDelta.y, 0.0) * 0.34;

  // Stable per-cell variation breaks up an otherwise perfectly uniform border.
  float cellVariation = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  float variationStrength = smoothstep(1.5, 7.0, length(revealDelta.xz));
  float shapedDistance = squareDistance + cellVariation * 1.15 * variationStrength;
  float revealRadius = uRevealProgress * uRevealDistance;
  float revealOffset = shapedDistance - revealRadius;
  if (uRevealProgress > 0.999) revealOffset = -1.0;
  if (revealOffset > 0.0) discard;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `float revealEdge = 1.0 - smoothstep(0.0, 0.32, abs(revealOffset));
  gl_FragColor.rgb += vec3(0.95, 0.66, 0.28) * revealEdge * 0.8;
  #include <dithering_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'dune-world-reveal-v3'
  material.needsUpdate = true
}
