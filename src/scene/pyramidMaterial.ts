import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Texture } from 'three'

// Recovered from blend-files/PyramidSandstoneTextures (ambientCG "Sandstone
// Cracks 1K"). Base color already has AO baked in and roughness pulled from
// the ARM map's channels, matching the authored Blender material
// ("Sandstone Cracks 1K - Test"); see scripts/build_pyramid_textures.py.
const basecolorUrl = '/textures/pyramid-basecolor.jpg'
const roughnessUrl = '/textures/pyramid-roughness.jpg'
const normalUrl = '/textures/pyramid-normal.jpg'

/** Loads the pyramid's sandstone maps and builds one shared material for every
 *  block. All 146 blocks reuse 8 mesh shapes with the same 0..1 UV layout, so
 *  a single non-tiling material is correct here — no per-block randomization. */
export function usePyramidMaterial() {
  const [basecolor, roughness, normal] = useTexture([basecolorUrl, roughnessUrl, normalUrl])

  return useMemo(() => {
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
      roughness: 1,
      metalness: 0,
    })
  }, [basecolor, roughness, normal])
}
