import { Box3, Ray, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { columnWave } from './columnRipple.ts'

/**
 * Finds where a ray meets the hex formation as it is drawn. The columns slide
 * along their length in the vertex shader, up to about a unit, so a plain
 * raycast against the model would hit where a column rests rather than where
 * it is. Instead each column is tested on its own, with the ray shifted by
 * that column's current slide (columnWave, the shader's exact mirror).
 *
 * Built once per geometry from the tags tagColumns leaves (which must run
 * first); picking allocates nothing.
 */
export type ColumnPicker = {
  columnCount: number
  phase: Float32Array
  length: Float32Array
  /** Per column, its rest-pose box: min x, y, z, then max x, y, z. */
  bounds: Float32Array
  /** Per column, its first triangle and how many it has. */
  firstTriangle: Uint32Array
  triangleCount: Uint32Array
  /** Every triangle's corners, nine floats each, grouped by column. */
  corners: Float32Array
}

export function createColumnPicker(geometry: BufferGeometry): ColumnPicker {
  const position = geometry.getAttribute('position')
  const phaseAttribute = geometry.getAttribute('aColumnPhase')
  const lengthAttribute = geometry.getAttribute('aColumnLength')
  const index = geometry.getIndex()
  const triangles = index ? index.count / 3 : position.count / 3
  const corner = (triangle: number, which: number) => (index ? index.getX(triangle * 3 + which) : triangle * 3 + which)

  // A column's vertices all carry its phase, and no two columns share one.
  const columnOf = new Map<number, number>()
  const owner = new Int32Array(triangles)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const phase = phaseAttribute.getX(corner(triangle, 0))
    let column = columnOf.get(phase)
    if (column === undefined) {
      column = columnOf.size
      columnOf.set(phase, column)
    }
    owner[triangle] = column
  }

  const columnCount = columnOf.size
  const phase = new Float32Array(columnCount)
  const length = new Float32Array(columnCount)
  const bounds = new Float32Array(columnCount * 6)
  const triangleCount = new Uint32Array(columnCount)
  for (let column = 0; column < columnCount; column += 1) {
    bounds.fill(Infinity, column * 6, column * 6 + 3)
    bounds.fill(-Infinity, column * 6 + 3, column * 6 + 6)
  }
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const column = owner[triangle]
    triangleCount[column] += 1
    const first = corner(triangle, 0)
    phase[column] = phaseAttribute.getX(first)
    length[column] = lengthAttribute.getX(first)
    for (let which = 0; which < 3; which += 1) {
      const vertex = corner(triangle, which)
      for (let axis = 0; axis < 3; axis += 1) {
        const value = position.getComponent(vertex, axis)
        bounds[column * 6 + axis] = Math.min(bounds[column * 6 + axis], value)
        bounds[column * 6 + 3 + axis] = Math.max(bounds[column * 6 + 3 + axis], value)
      }
    }
  }

  const firstTriangle = new Uint32Array(columnCount)
  for (let column = 1; column < columnCount; column += 1) {
    firstTriangle[column] = firstTriangle[column - 1] + triangleCount[column - 1]
  }
  const filled = new Uint32Array(columnCount)
  const corners = new Float32Array(triangles * 9)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const column = owner[triangle]
    const slot = (firstTriangle[column] + filled[column]) * 9
    filled[column] += 1
    for (let which = 0; which < 3; which += 1) {
      const vertex = corner(triangle, which)
      corners[slot + which * 3] = position.getX(vertex)
      corners[slot + which * 3 + 1] = position.getY(vertex)
      corners[slot + which * 3 + 2] = position.getZ(vertex)
    }
  }
  return { columnCount, phase, length, bounds, firstTriangle, triangleCount, corners }
}

const shifted = new Ray()
const box = new Box3()
const boxHit = new Vector3()
const cornerA = new Vector3()
const cornerB = new Vector3()
const cornerC = new Vector3()
const triangleHit = new Vector3()

/**
 * Writes the nearest point where `ray` (in the formation's object space) meets
 * a column at shader time `time`, sliding by `amplitude` of its length, into
 * `out`, and - if given - the same point on the column at rest into `rest`.
 * Returns false, leaving both alone, when the ray misses.
 */
export function pickColumn(
  picker: ColumnPicker,
  ray: Ray,
  time: number,
  amplitude: number,
  out: Vector3,
  rest?: Vector3,
) {
  let nearest = Infinity
  let nearestSlide = 0
  for (let column = 0; column < picker.columnCount; column += 1) {
    const slide = amplitude * picker.length[column] * columnWave(time, picker.phase[column])
    // Sliding the column up is the same as sliding the ray down.
    shifted.copy(ray)
    shifted.origin.y -= slide
    const b = column * 6
    box.min.set(picker.bounds[b], picker.bounds[b + 1], picker.bounds[b + 2])
    box.max.set(picker.bounds[b + 3], picker.bounds[b + 4], picker.bounds[b + 5])
    if (!shifted.intersectBox(box, boxHit)) continue
    if (boxHit.distanceToSquared(shifted.origin) >= nearest * nearest) continue

    const start = picker.firstTriangle[column] * 9
    const end = start + picker.triangleCount[column] * 9
    for (let slot = start; slot < end; slot += 9) {
      const corners = picker.corners
      cornerA.set(corners[slot], corners[slot + 1], corners[slot + 2])
      cornerB.set(corners[slot + 3], corners[slot + 4], corners[slot + 5])
      cornerC.set(corners[slot + 6], corners[slot + 7], corners[slot + 8])
      // Double sided, as the material is.
      if (!shifted.intersectTriangle(cornerA, cornerB, cornerC, false, triangleHit)) continue
      const distance = triangleHit.distanceTo(shifted.origin)
      if (distance >= nearest) continue
      nearest = distance
      nearestSlide = slide
      out.copy(triangleHit)
    }
  }
  if (nearest === Infinity) return false
  rest?.copy(out)
  out.y += nearestSlide
  return true
}
