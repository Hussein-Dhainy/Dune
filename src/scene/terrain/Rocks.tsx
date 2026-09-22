import { useEffect, useMemo } from 'react'
import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { applyRevealShader } from '../reveal'
import type { RevealUniforms } from '../reveal'
import { defaultDuneSettings } from './heightField'
import type { HeightField } from './heightField'

const rockCount = 140
/** Rocks only read as scale cues near the camera; past this they are fog. */
const scatterRadius = 95

function makeRockGeometry(seed: number) {
  // A low subdivision icosahedron pushed around by a cheap hash reads as a
  // weathered boulder at this distance without needing an authored asset.
  const geometry = new IcosahedronGeometry(1, 1)
  const position = geometry.attributes.position
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const wobble = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453)
    const scale = 1 + wobble * 0.26
    position.setXYZ(index, x * scale, y * scale * 0.72, z * scale)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function Rocks({
  reveal,
  sampleHeight,
}: {
  reveal: RevealUniforms
  sampleHeight: HeightField
}) {
  const mesh = useMemo(() => {
    const geometry = makeRockGeometry(7.3)
    const material = new MeshStandardMaterial({
      color: new Color('#a58d6d'),
      roughness: 0.92,
      metalness: 0,
    })
    const instanced = new InstancedMesh(geometry, material, rockCount)
    instanced.name = 'Desert rocks'
    instanced.castShadow = true
    instanced.receiveShadow = true

    const dummy = new Object3D()
    let state = 20260921
    const random = () => {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      return state / 0xffffffff
    }

    for (let index = 0; index < rockCount; index += 1) {
      // Square-root radius keeps the scatter areally uniform instead of
      // clumping everything around the pyramid.
      const angle = random() * Math.PI * 2
      const radius = defaultDuneSettings.basinRadius
        + Math.sqrt(random()) * (scatterRadius - defaultDuneSettings.basinRadius)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const scale = 0.1 + random() * 0.28

      dummy.position.set(x, sampleHeight(x, z) + scale * 0.32, z)
      dummy.rotation.set(random() * 0.6, random() * Math.PI * 2, random() * 0.6)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      instanced.setMatrixAt(index, dummy.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
    return instanced
  }, [sampleHeight])

  useEffect(() => {
    applyRevealShader(mesh.material as MeshStandardMaterial, reveal)
    return () => {
      mesh.geometry.dispose()
      ;(mesh.material as MeshStandardMaterial).dispose()
    }
  }, [mesh, reveal])

  return <primitive object={mesh} />
}
