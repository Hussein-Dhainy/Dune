import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector3, Vector4 } from 'three'
import type { Mesh, Object3D } from 'three'

export type GroundHeightField = {
  texture: DataTexture
  /** World-space x, z of the texture's corner, then its x, z size. */
  bounds: Vector4
  /** Height of a 0 texel, then the span a 1 texel adds. */
  range: { x: number; y: number }
}

/**
 * Bakes a small heightmap of the terrain around the pyramid, once, so sand
 * shaders can sit grains on the dunes without sampling any geometry.
 *
 * Vertices are binned straight into the grid - no raycasts - keeping the
 * highest per cell so grains ride over crests instead of vanishing into them.
 * Cells no vertex landed in are filled from their neighbours. The whole field
 * is 128x128 bytes (16 KB) and bilinear filtering smooths the cell steps.
 */
export function bakeGroundHeight(root: Object3D, resolution = 128, extent = 192): GroundHeightField {
  const half = extent / 2
  const cellSize = extent / resolution
  const heights = new Float32Array(resolution * resolution).fill(-Infinity)
  const vertex = new Vector3()

  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    if (!('isMesh' in object)) return
    const mesh = object as Mesh
    const position = mesh.geometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
      const column = Math.floor((vertex.x + half) / cellSize)
      const row = Math.floor((vertex.z + half) / cellSize)
      if (column < 0 || row < 0 || column >= resolution || row >= resolution) continue
      const cell = row * resolution + column
      if (vertex.y > heights[cell]) heights[cell] = vertex.y
    }
  })

  // Grow known heights into empty cells, a ring at a time.
  for (let pass = 0; pass < 12; pass += 1) {
    let filled = 0
    const source = heights.slice()
    for (let row = 0; row < resolution; row += 1) {
      for (let column = 0; column < resolution; column += 1) {
        const cell = row * resolution + column
        if (source[cell] !== -Infinity) continue
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const y = row + dy
            const x = column + dx
            if (x < 0 || y < 0 || x >= resolution || y >= resolution) continue
            const value = source[y * resolution + x]
            if (value === -Infinity) continue
            sum += value
            count += 1
          }
        }
        if (count > 0) {
          heights[cell] = sum / count
          filled += 1
        }
      }
    }
    if (filled === 0) break
  }

  let minimum = Infinity
  let maximum = -Infinity
  for (const value of heights) {
    if (value === -Infinity) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (minimum === Infinity) {
    minimum = 0
    maximum = 0
  }
  const span = Math.max(maximum - minimum, 0.0001)

  const data = new Uint8Array(resolution * resolution)
  for (let cell = 0; cell < data.length; cell += 1) {
    const value = heights[cell] === -Infinity ? minimum : heights[cell]
    data[cell] = Math.round(((value - minimum) / span) * 255)
  }

  const texture = new DataTexture(data, resolution, resolution, RedFormat, UnsignedByteType)
  texture.name = 'Desert ground height'
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  // Rows are 4-byte aligned by default; 128 bytes is, but stay explicit.
  texture.unpackAlignment = 1
  texture.needsUpdate = true

  return {
    texture,
    bounds: new Vector4(-half, -half, extent, extent),
    range: { x: minimum, y: span },
  }
}
