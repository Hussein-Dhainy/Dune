import { useEffect, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three'
import type { Texture } from 'three'
import { applyRevealShader } from '../reveal'
import type { RevealUniforms } from '../reveal'
import type { buildTerrainGeometry } from './terrainGeometry'

const basecolorUrl = '/textures/sand-basecolor.jpg'
const roughnessUrl = '/textures/sand-roughness.jpg'
const normalUrl = '/textures/sand-normal.jpg'

export function TerrainSurface({
  reveal,
  geometry,
}: {
  reveal: RevealUniforms
  geometry: ReturnType<typeof buildTerrainGeometry>['geometry']
}) {
  const [basecolor, roughness, normal] = useTexture([basecolorUrl, roughnessUrl, normalUrl])

  const material = useMemo(() => {
    // Three texture parameters are mutable render state by design.
    // oxlint-disable-next-line react/immutability
    for (const texture of [basecolor, roughness, normal] as Texture[]) {
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.anisotropy = 8
    }
    // oxlint-disable-next-line react/immutability
    basecolor.colorSpace = SRGBColorSpace

    return new MeshStandardMaterial({
      map: basecolor,
      roughnessMap: roughness,
      normalMap: normal,
      normalScale: new Vector2(1.05, 1.05),
      roughness: 1,
      metalness: 0,
      dithering: true,
    })
  }, [basecolor, roughness, normal])

  useEffect(() => {
    applyRevealShader(material, reveal)
    return () => material.dispose()
  }, [material, reveal])

  return (
    <mesh
      geometry={geometry}
      material={material}
      receiveShadow
      name="Procedural dune terrain"
    />
  )
}
