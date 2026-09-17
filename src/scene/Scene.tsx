import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, MathUtils, Vector3 } from 'three'
import type { Group, Material, Mesh } from 'three'
import type { LightingSettings } from './lighting'
import { applyRevealShader, createRevealUniforms } from './reveal'
import type { RevealUniforms } from './reveal'
import { useLoopScroll } from '../experience/useLoopScroll'
import { SandWind } from './SandWind'

const pyramidModelUrl = '/models/pyramid.glb?v=separate-blocks-1'
const terrainModelUrl = '/models/desert-terrain.glb?v=groundsand-1'
const revealDuration = 10

function prepareRevealMaterials(root: Group, reveal: RevealUniforms) {
  const materials = new Map<Material, Material>()
  root.traverse((object) => {
    if (!('isMesh' in object)) return
    const mesh = object as Mesh
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const revealMaterials = sourceMaterials.map((source) => {
      let material = materials.get(source)
      if (!material) {
        material = source.clone()
        applyRevealShader(material, reveal)
        materials.set(source, material)
      }
      return material
    })
    mesh.material = Array.isArray(mesh.material) ? revealMaterials : revealMaterials[0]
  })
  return [...materials.values()]
}

function Pyramid({ reveal, rootRef }: { reveal: RevealUniforms; rootRef: React.RefObject<Group | null> }) {
  const { scene } = useGLTF(pyramidModelUrl)
  const wireframes = useRef<LineBasicMaterial[]>([])
  useEffect(() => {
    const materials = prepareRevealMaterials(scene, reveal)
    const edges: LineSegments[] = []
    scene.traverse((object) => {
      if ('isMesh' in object) {
        const mesh = object as Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.geometry.computeBoundingBox()
        const bounds = mesh.geometry.boundingBox!
        const size = bounds.getSize(new Vector3())
        const center = bounds.getCenter(new Vector3())
        const box = new BoxGeometry(size.x, size.y, size.z)
        const geometry = new EdgesGeometry(box)
        box.dispose()
        const material = new LineBasicMaterial({
          color: '#e7b56f',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
        const lines = new LineSegments(geometry, material)
        lines.name = 'Pyramid reveal edges'
        lines.position.copy(center)
        lines.renderOrder = 2
        mesh.add(lines)
        edges.push(lines)
        wireframes.current.push(material)
      }
    })
    return () => {
      for (const lines of edges) {
        lines.removeFromParent()
        lines.geometry.dispose()
        ;(lines.material as Material).dispose()
      }
      wireframes.current = []
      for (const material of materials) material.dispose()
    }
  }, [scene, reveal])

  useFrame(() => {
    const progress = reveal.timeline.value
    const fadeIn = MathUtils.smoothstep(progress, 0, 0.12)
    const fadeOut = 1 - MathUtils.smoothstep(progress, 0.72, 1)
    const opacity = Math.min(fadeIn, fadeOut)
    // Three material uniforms are mutable render-loop state by design.
    // oxlint-disable-next-line react/immutability
    for (const material of wireframes.current) material.opacity = opacity
  })

  return <group ref={rootRef} scale={0.75}><primitive object={scene} /></group>
}

function Terrain({ reveal, rootRef }: { reveal: RevealUniforms; rootRef: React.RefObject<Group | null> }) {
  const { scene } = useGLTF(terrainModelUrl)
  useEffect(() => {
    const materials = prepareRevealMaterials(scene, reveal)
    scene.traverse((object) => {
      if ('isMesh' in object) (object as Mesh).receiveShadow = true
    })
    return () => {
      for (const material of materials) material.dispose()
    }
  }, [scene, reveal])
  return <group ref={rootRef}><primitive object={scene} /></group>
}

export function Scene({ lighting }: { lighting: LightingSettings }) {
  const gl = useThree((state) => state.gl)
  const { state } = useLoopScroll()
  const reveal = useMemo(() => createRevealUniforms(), [])
  const revealElapsed = useRef(0)
  const pyramidRoot = useRef<Group>(null)
  const terrainRoot = useRef<Group>(null)
  const azimuth = lighting.sunAzimuth * Math.PI / 180
  const elevation = lighting.sunElevation * Math.PI / 180
  const distance = 20
  const sunPosition: [number, number, number] = [
    Math.cos(elevation) * Math.cos(azimuth) * distance,
    Math.sin(elevation) * distance,
    Math.cos(elevation) * Math.sin(azimuth) * distance,
  ]

  useEffect(() => {
    // Three renderer configuration is mutable by design and only changes on input.
    // oxlint-disable-next-line react/immutability
    gl.toneMappingExposure = lighting.exposure
  }, [gl, lighting.exposure])

  useLayoutEffect(() => {
    if (!pyramidRoot.current || !terrainRoot.current) return
    pyramidRoot.current.updateWorldMatrix(true, true)
    terrainRoot.current.updateWorldMatrix(true, true)
    const pyramidBounds = new Box3().setFromObject(pyramidRoot.current)
    const sceneBounds = new Box3().setFromObject(terrainRoot.current).union(pyramidBounds)
    reveal.origin.value.set(
      (pyramidBounds.min.x + pyramidBounds.max.x) / 2,
      pyramidBounds.max.y,
      (pyramidBounds.min.z + pyramidBounds.max.z) / 2,
    )
    const corner = new Vector3()
    let maximumDistance = 0
    for (const x of [sceneBounds.min.x, sceneBounds.max.x]) {
      for (const y of [sceneBounds.min.y, sceneBounds.max.y]) {
        for (const z of [sceneBounds.min.z, sceneBounds.max.z]) {
          corner.set(x, y, z)
          maximumDistance = Math.max(maximumDistance, corner.distanceTo(reveal.origin.value))
        }
      }
    }
    // Shared shader uniforms are updated without triggering React renders.
    // oxlint-disable-next-line react/immutability
    reveal.distance.value = maximumDistance * 1.02
  }, [reveal])

  useFrame((_, delta) => {
    const current = state.current
    if (current.phase === 'loading') return
    if (!current.reducedMotion) revealElapsed.current += Math.min(delta, 0.1)
    const timeline = current.reducedMotion ? 1 : Math.min(revealElapsed.current / revealDuration, 1)
    const revealTime = MathUtils.clamp((timeline - 0.04) / 0.96, 0, 1)
    // Shared shader uniforms are updated without triggering React renders.
    // oxlint-disable-next-line react/immutability
    reveal.timeline.value = timeline
    // oxlint-disable-next-line react/immutability
    reveal.progress.value = Math.pow(revealTime, 2.8)
  })

  return (
    <>
      <color attach="background" args={[lighting.background]} />
      <fog attach="fog" args={[lighting.fogColor, lighting.fogNear, lighting.fogFar]} />
      <ambientLight color={lighting.ambientColor} intensity={lighting.ambientIntensity} />
      <directionalLight
        position={sunPosition}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        castShadow={lighting.shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0002}
      />
      <Terrain reveal={reveal} rootRef={terrainRoot} />
      <SandWind reveal={reveal} />
      <group name="landmarks" position={[0, 0.05, 0]}>
        <Pyramid reveal={reveal} rootRef={pyramidRoot} />
      </group>
    </>
  )
}

useGLTF.preload(pyramidModelUrl)
useGLTF.preload(terrainModelUrl)
