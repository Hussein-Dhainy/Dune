import { useEffect, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { BufferAttribute, DoubleSide, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three'
import type { BufferGeometry, Texture } from 'three'

// Poly Haven "Sandstone Blocks 04", 1K. The untextured hex model carries no
// UVs or material; both come from here.
const textureFolder = '/textures/sandstone_blocks_04'
const columnTextureUrls = [
  `${textureFolder}/sandstone_blocks_04_diff_1k.jpg`,
  `${textureFolder}/sandstone_blocks_04_nor_1k.png`,
  `${textureFolder}/sandstone_blocks_04_rough_1k.jpg`,
  `${textureFolder}/sandstone_blocks_04_ao_1k.jpg`,
]

export const columnSurface = {
  /** Texture repeats per model unit. A column is ~4 units long and its faces
   *  ~0.48 wide, so a face shows a narrow strip of a couple of tiles. */
  repeatsPerUnit: 0.5,
  normalScale: 0.8,
}

const uvVersion = 1

/** Deterministic 0..1 hash of a column's phase, for its texture offset. */
function scatter(value: number, salt: number) {
  const hashed = Math.sin(value * 91.7 + salt * 47.3) * 43758.5453
  return hashed - Math.floor(hashed)
}

/**
 * Projects UVs onto every flat face of the columns: caps take X/Z, sides run
 * across the face horizontally and along the column vertically, so the stone
 * courses lie across each column. Each column gets its own offset (keyed off
 * the per-column `aColumnPhase` from tagColumns, which must run first) so
 * neighbours do not line up into one continuous wall. UVs come from the rest
 * pose, so the texture travels with a column as it slides.
 */
export function projectColumnUVs(geometry: BufferGeometry) {
  if (geometry.userData.columnUvVersion === uvVersion) return
  geometry.userData.columnUvVersion = uvVersion

  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const phase = geometry.getAttribute('aColumnPhase')
  const uvs = new Float32Array(position.count * 2)
  const scale = columnSurface.repeatsPerUnit
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const nx = normal.getX(index)
    const ny = normal.getY(index)
    const nz = normal.getZ(index)
    let u: number
    let v: number
    if (Math.abs(ny) > 0.7) {
      u = x
      v = z
    } else {
      // Horizontal direction across the face: the normal turned a quarter
      // about Y.
      const length = Math.hypot(nx, nz) || 1
      u = (x * -nz + z * nx) / length
      v = y
    }
    const offset = phase ? phase.getX(index) : 0
    uvs[index * 2] = u * scale + scatter(offset, 1)
    uvs[index * 2 + 1] = v * scale + scatter(offset, 2)
  }
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
}

/** The columns' sandstone material, built from the loose texture files. */
export function useColumnMaterial() {
  const [color, normal, roughness, occlusion] = useTexture(columnTextureUrls)

  const material = useMemo(() => {
    // Three texture parameters are mutable render state by design.
    for (const texture of [color, normal, roughness, occlusion] as Texture[]) {
      // oxlint-disable-next-line react/immutability
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.anisotropy = 8
      texture.colorSpace = NoColorSpace
    }
    // oxlint-disable-next-line react/immutability
    color.colorSpace = SRGBColorSpace

    return new MeshStandardMaterial({
      name: 'Hex columns sandstone',
      map: color,
      normalMap: normal,
      normalScale: new Vector2(columnSurface.normalScale, columnSurface.normalScale),
      roughnessMap: roughness,
      roughness: 1,
      metalness: 0,
      aoMap: occlusion,
      // The authored GLB material was double sided; kept for parity.
      side: DoubleSide,
    })
  }, [color, normal, roughness, occlusion])

  useEffect(() => () => material.dispose(), [material])
  return material
}

useTexture.preload(columnTextureUrls)
