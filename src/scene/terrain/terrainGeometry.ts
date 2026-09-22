import { PlaneGeometry } from 'three'
import type { BufferGeometry } from 'three'
import { createDuneHeightField, defaultDuneSettings } from './heightField'
import type { DuneSettings, HeightField } from './heightField'

/** World units covered by one repeat of the sand maps. */
export const sandTileSize = 5.5

/**
 * Exponent for the radial vertex remap. A uniform grid over a 620-unit desert
 * spends most of its vertices in the far field, where fog hides them; pushing
 * grid coordinates through a power curve concentrates them near the camera
 * instead, which buys finer foreground sand at a third of the vertex count.
 */
const densityFalloff = 1.9

export type TerrainBuild = {
  geometry: BufferGeometry
  /** Same field the geometry was displaced with, for seating props on the sand. */
  sampleHeight: HeightField
}

function remap(normalised: number, half: number) {
  return Math.sign(normalised) * Math.pow(Math.abs(normalised), densityFalloff) * half
}

/**
 * Displaces a grid on the CPU rather than in a vertex shader. The height
 * function is cheap enough to evaluate at load, and doing it here keeps exact
 * analytic normals and leaves the material's onBeforeCompile chain free for the
 * reveal effect alone.
 */
export function buildTerrainGeometry(
  segments = 288,
  settings: DuneSettings = defaultDuneSettings,
): TerrainBuild {
  const sampleHeight = createDuneHeightField(settings)
  const geometry = new PlaneGeometry(settings.extent, settings.extent, segments, segments)
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uv = geometry.attributes.uv
  const half = settings.extent / 2
  const step = 2 / segments

  for (let index = 0; index < position.count; index += 1) {
    const u = position.getX(index) / half
    const v = position.getZ(index) / half
    const x = remap(u, half)
    const z = remap(v, half)

    // Central differences taken against the vertex's actual neighbours, so the
    // shading normal matches the triangle the vertex belongs to at every density.
    const spanX = remap(u + step, half) - remap(u - step, half)
    const spanZ = remap(v + step, half) - remap(v - step, half)
    const slopeX = sampleHeight(x + spanX / 2, z) - sampleHeight(x - spanX / 2, z)
    const slopeZ = sampleHeight(x, z + spanZ / 2) - sampleHeight(x, z - spanZ / 2)
    const nx = -slopeX * spanZ
    const nz = -slopeZ * spanX
    const ny = spanX * spanZ
    const length = Math.hypot(nx, ny, nz)

    position.setXYZ(index, x, sampleHeight(x, z), z)
    normal.setXYZ(index, nx / length, ny / length, nz / length)
    // UVs follow world position so the remapped grid does not stretch the sand.
    uv.setXY(index, x / sandTileSize, z / sandTileSize)
  }

  position.needsUpdate = true
  normal.needsUpdate = true
  uv.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return { geometry, sampleHeight }
}
