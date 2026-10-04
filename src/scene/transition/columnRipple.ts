import { BufferAttribute } from 'three'
import type { BufferGeometry, Material } from 'three'
import { columnHoverUniforms, hoverShaderChunks } from './columnHover.ts'

/**
 * The hex block is one merged mesh of separate hexagonal columns, all standing
 * along the model's Y axis. Each column slides up and down its own length, in
 * the vertex shader, on a phase that travels across the block as a slow wave.
 * Displacement is in object space, so it follows the columns however the rig
 * turns them.
 */
export const columnRipple = {
  /** Share of each column's own length it travels either side of rest. The
   *  hover scan is measured on the stone at rest (see columnHover), so it
   *  rides with a sliding column rather than being outrun by it. */
  amplitude: 0.12,
  /** Radians of wave phase per second. */
  speed: 1.1,
  /** Radians of phase per model unit across the block, along `direction`. */
  wavenumber: 1.35,
  direction: [0.83, 0.56] as const,
  /** Per-column phase scatter, so the wave front is not a ruler-straight line. */
  jitter: 0.6,
}

export type ColumnRippleUniforms = {
  uColumnTime: { value: number }
  uColumnAmplitude: { value: number }
}

/**
 * One shared set: the model and its material are cached and patched once, so
 * the shader must read the very objects the frame loop writes - not a set made
 * by a later render (StrictMode builds every memo twice).
 */
export const columnRippleUniforms: ColumnRippleUniforms = {
  uColumnTime: { value: 0 },
  uColumnAmplitude: { value: columnRipple.amplitude },
}

const tagVersion = 2
const shaderVersion = 4

/**
 * -1..1: where a column of phase `phase` is in its slide at shader time
 * `time` (uColumnTime). The exact mirror of the GLSL below, so the cursor can
 * be tested against the columns where they are drawn, not where they rest.
 */
export function columnWave(time: number, phase: number) {
  return Math.sin(time + phase) * 0.78 + Math.sin(time * 0.53 + phase * 1.7 + 1.3) * 0.22
}

/** Deterministic 0..1 hash, so every load gets the same wave. */
function hash(index: number) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

/**
 * Tags every vertex with its column's wave phase (`aColumnPhase`). Columns are
 * found as connected pieces of the mesh: triangles share indices, and split
 * vertices (UV or normal seams) share positions. Returns the number of columns.
 */
export function tagColumns(geometry: BufferGeometry) {
  // useGLTF caches the parsed model across hot reloads, so a geometry tagged
  // by an older version of this function is re-tagged rather than trusted.
  if (geometry.userData.columnRippleVersion === tagVersion) return -1
  geometry.userData.columnRippleVersion = tagVersion

  const position = geometry.getAttribute('position')
  const count = position.count
  const parent = new Int32Array(count)
  for (let index = 0; index < count; index += 1) parent[index] = index
  const find = (index: number) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  const join = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootA] = rootB
  }

  const seen = new Map<string, number>()
  for (let index = 0; index < count; index += 1) {
    const key = `${position.getX(index).toFixed(4)},${position.getY(index).toFixed(4)},${position.getZ(index).toFixed(4)}`
    const first = seen.get(key)
    if (first === undefined) seen.set(key, index)
    else join(index, first)
  }
  const indices = geometry.getIndex()
  if (indices) {
    for (let corner = 0; corner < indices.count; corner += 3) {
      join(indices.getX(corner), indices.getX(corner + 1))
      join(indices.getX(corner), indices.getX(corner + 2))
    }
  }

  // Each column's footprint centre, from its vertices' X/Z extent.
  const columns = new Map<number, {
    minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number
  }>()
  for (let index = 0; index < count; index += 1) {
    const root = find(index)
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const column = columns.get(root)
    if (!column) {
      columns.set(root, { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z })
      continue
    }
    column.minX = Math.min(column.minX, x)
    column.maxX = Math.max(column.maxX, x)
    column.minY = Math.min(column.minY, y)
    column.maxY = Math.max(column.maxY, y)
    column.minZ = Math.min(column.minZ, z)
    column.maxZ = Math.max(column.maxZ, z)
  }

  const phaseOf = new Map<number, number>()
  const lengthOf = new Map<number, number>()
  let longest = 0
  let order = 0
  for (const [root, column] of columns) {
    const centerX = (column.minX + column.maxX) / 2
    const centerZ = (column.minZ + column.maxZ) / 2
    const along = centerX * columnRipple.direction[0] + centerZ * columnRipple.direction[1]
    const length = column.maxY - column.minY
    lengthOf.set(root, length)
    longest = Math.max(longest, length)
    phaseOf.set(root, -along * columnRipple.wavenumber + (hash(order) - 0.5) * columnRipple.jitter)
    order += 1
  }

  const phases = new Float32Array(count)
  const lengths = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const root = find(index)
    phases[index] = phaseOf.get(root)!
    lengths[index] = lengthOf.get(root)!
  }
  geometry.setAttribute('aColumnPhase', new BufferAttribute(phases, 1))
  geometry.setAttribute('aColumnLength', new BufferAttribute(lengths, 1))

  // Culling bounds have to allow for the travel.
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += columnRipple.amplitude * longest
  return columns.size
}

/**
 * Slides each column along its length by its own phase of the shared wave,
 * and - on the lit material only, not the shadow depth one - lays the hover
 * ripples' triangle lattice over the surface (see columnHover).
 */
export function applyColumnRippleShader(material: Material, uniforms = columnRippleUniforms) {
  // Same caching caveat as tagColumns: the material may carry a patch from an
  // older module instance, so always build on the unpatched originals instead
  // of chaining onto whatever is there.
  const data = material.userData as {
    columnRippleVersion?: number
    columnRippleBase?: { compile: Material['onBeforeCompile'], cacheKey: () => string }
  }
  if (data.columnRippleVersion === shaderVersion) return
  data.columnRippleBase ??= {
    compile: material.onBeforeCompile,
    cacheKey: material.customProgramCacheKey.bind(material),
  }
  data.columnRippleVersion = shaderVersion
  const compileBaseMaterial = data.columnRippleBase.compile
  const baseCacheKey = data.columnRippleBase.cacheKey

  material.onBeforeCompile = (shader, renderer) => {
    compileBaseMaterial.call(material, shader, renderer)
    shader.uniforms.uColumnTime = uniforms.uColumnTime
    shader.uniforms.uColumnAmplitude = uniforms.uColumnAmplitude
    // Only a lit material has emissive light to add to, and a normal in its
    // vertex stage to hand over.
    const lit = shader.fragmentShader.includes('#include <emissivemap_fragment>')

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aColumnPhase;
attribute float aColumnLength;
uniform float uColumnTime;
uniform float uColumnAmplitude;
void main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  // A main swell with a slower, out-of-step undertone, so no two passes of
  // the wave look quite alike. The two weights sum to 1, so a column peaks at
  // exactly uColumnAmplitude of its own length.
  float columnWave = sin(uColumnTime + aColumnPhase) * 0.78
    + sin(uColumnTime * 0.53 + aColumnPhase * 1.7 + 1.3) * 0.22;
  transformed.y += uColumnAmplitude * aColumnLength * columnWave;`,
      )
    if (!lit) return

    shader.uniforms.uHoverStarts = columnHoverUniforms.uHoverStarts
    shader.uniforms.uHoverEnds = columnHoverUniforms.uHoverEnds
    shader.uniforms.uHoverTime = columnHoverUniforms.uHoverTime
    shader.uniforms.uHoverCalm = columnHoverUniforms.uHoverCalm
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${hoverShaderChunks.vertexDeclarations}
void main() {`)
      .replace(
        'transformed.y += uColumnAmplitude * aColumnLength * columnWave;',
        `transformed.y += uColumnAmplitude * aColumnLength * columnWave;
  ${hoverShaderChunks.vertexBody}`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${hoverShaderChunks.fragmentDeclarations}
void main() {`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  ${hoverShaderChunks.fragmentBody}`,
      )
  }
  material.customProgramCacheKey = () => `${baseCacheKey()}-column-ripple-v${shaderVersion}`
  material.needsUpdate = true
}
