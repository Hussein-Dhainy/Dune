import { Color, Float32BufferAttribute, MathUtils, Triangle, Vector3 } from 'three'
import type { BufferGeometry, Material } from 'three'

export type EdgeUniforms = {
  opacity: { value: number }
  color: { value: Color }
  /** Line thickness in pixels, applied against the screen-space derivative. */
  width: { value: number }
}

export function createEdgeUniforms(): EdgeUniforms {
  return {
    opacity: { value: 0 },
    color: { value: new Color('#e7b56f') },
    width: { value: 1.3 },
  }
}

/**
 * Non-indexed copy of the source geometry carrying the two attributes the edge
 * shader needs: barycentric coordinates, and a per-triangle mask marking which
 * of its three edges should be drawn.
 *
 * The mask is what keeps this from looking like a plain `wireframe: true` pass.
 * It reproduces EdgesGeometry's own test - positions hashed to 4 decimals so
 * split vertices merge, an edge kept when the angle between its two adjoining
 * face normals exceeds the threshold, and unmatched boundary edges always kept -
 * so only silhouette and corner edges light up, never the diagonal seams left
 * behind by triangulating quad faces.
 *
 * Mask components are stored in barycentric order rather than edge order:
 * along edge (b,c) the barycentric x goes to zero, so mask.x guards that edge,
 * mask.y guards (c,a) and mask.z guards (a,b). That lets the fragment shader
 * compare mask against bary component-wise with no index juggling.
 */
export function buildEdgeGeometry(source: BufferGeometry, thresholdAngle = 25): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  const position = geometry.getAttribute('position')
  const triangleCount = Math.floor(position.count / 3)

  const precision = 10 ** 4
  const thresholdDot = Math.cos(MathUtils.DEG2RAD * thresholdAngle)
  const triangle = new Triangle()
  const normal = new Vector3()

  // edgeHash -> the first face that claimed it, so the second face can measure
  // the dihedral angle against it.
  const pending = new Map<string, { normal: Vector3; triangle: number; edge: number }>()
  // hard[triangle * 3 + edge], where edge j spans triangle vertices j and j+1.
  const hard = new Uint8Array(triangleCount * 3)

  const hashOf = (vector: Vector3) =>
    `${Math.round(vector.x * precision)},${Math.round(vector.y * precision)},${Math.round(vector.z * precision)}`

  for (let index = 0; index < triangleCount; index += 1) {
    triangle.a.fromBufferAttribute(position, index * 3)
    triangle.b.fromBufferAttribute(position, index * 3 + 1)
    triangle.c.fromBufferAttribute(position, index * 3 + 2)
    triangle.getNormal(normal)

    const hashes = [hashOf(triangle.a), hashOf(triangle.b), hashOf(triangle.c)]
    // Degenerate triangles have no meaningful normal, so they cannot contribute
    // a dihedral angle; skipping them matches EdgesGeometry.
    if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) continue

    for (let edge = 0; edge < 3; edge += 1) {
      const next = (edge + 1) % 3
      const key = `${hashes[edge]}_${hashes[next]}`
      const reverseKey = `${hashes[next]}_${hashes[edge]}`
      const sibling = pending.get(reverseKey)

      if (sibling) {
        if (normal.dot(sibling.normal) <= thresholdDot) {
          hard[index * 3 + edge] = 1
          hard[sibling.triangle * 3 + sibling.edge] = 1
        }
        pending.delete(reverseKey)
      } else if (!pending.has(key)) {
        pending.set(key, { normal: normal.clone(), triangle: index, edge })
      }
    }
  }

  // Whatever is still pending never found a neighbouring face: an open boundary,
  // which always reads as a hard edge.
  for (const { triangle: index, edge } of pending.values()) {
    hard[index * 3 + edge] = 1
  }

  const bary = new Float32Array(position.count * 3)
  const mask = new Float32Array(position.count * 3)
  for (let index = 0; index < triangleCount; index += 1) {
    const edgeAB = hard[index * 3]
    const edgeBC = hard[index * 3 + 1]
    const edgeCA = hard[index * 3 + 2]
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = (index * 3 + corner) * 3
      bary[offset] = corner === 0 ? 1 : 0
      bary[offset + 1] = corner === 1 ? 1 : 0
      bary[offset + 2] = corner === 2 ? 1 : 0
      mask[offset] = edgeBC
      mask[offset + 1] = edgeCA
      mask[offset + 2] = edgeAB
    }
  }

  geometry.setAttribute('aEdgeBary', new Float32BufferAttribute(bary, 3))
  geometry.setAttribute('aEdgeMask', new Float32BufferAttribute(mask, 3))
  return geometry
}

// Patching twice would splice the same varyings in twice and fail to compile,
// mirroring the guard in reveal.ts.
const patchedMaterials = new WeakSet<Material>()

/**
 * Draws the block outlines inside the surface material's own fragment shader,
 * so the highlight rides along on a draw call that already happens rather than
 * needing a second LineSegments object per block.
 */
export function applyEdgeShader(material: Material, edges: EdgeUniforms) {
  if (patchedMaterials.has(material)) return
  patchedMaterials.add(material)

  const compileBaseMaterial = material.onBeforeCompile
  const baseCacheKey = material.customProgramCacheKey.bind(material)

  material.onBeforeCompile = (shader, renderer) => {
    compileBaseMaterial.call(material, shader, renderer)
    shader.uniforms.uEdgeOpacity = edges.opacity
    shader.uniforms.uEdgeColor = edges.color
    shader.uniforms.uEdgeWidth = edges.width

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute vec3 aEdgeBary;
attribute vec3 aEdgeMask;
varying vec3 vEdgeBary;
varying vec3 vEdgeMask;
void main() {
  vEdgeBary = aEdgeBary;
  vEdgeMask = aEdgeMask;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uEdgeOpacity;
uniform vec3 uEdgeColor;
uniform float uEdgeWidth;
varying vec3 vEdgeBary;
varying vec3 vEdgeMask;
void main() {`,
      )
      .replace(
        '#include <dithering_fragment>',
        `// uEdgeOpacity is a per-draw uniform, so this branch is dynamically uniform
  // and costs nothing once the outlines have faded out.
  if (uEdgeOpacity > 0.001) {
    // Pushing soft edges far out of range leaves only the masked-in hard edges
    // close enough to the fragment to light up.
    vec3 maskedBary = vEdgeBary + (1.0 - vEdgeMask) * 10.0;
    float edgeDistance = min(min(maskedBary.x, maskedBary.y), maskedBary.z);
    // Scaling by the screen-space derivative keeps the outline a constant
    // pixel width regardless of how close the camera is to the block.
    float edgeFalloff = fwidth(edgeDistance) * uEdgeWidth;
    float edgeStrength = 1.0 - smoothstep(0.0, edgeFalloff, edgeDistance);
    gl_FragColor.rgb += uEdgeColor * edgeStrength * uEdgeOpacity;
  }
  #include <dithering_fragment>`,
      )
  }
  material.customProgramCacheKey = () => `${baseCacheKey()}-pyramid-edges-v1`
  material.needsUpdate = true
}
