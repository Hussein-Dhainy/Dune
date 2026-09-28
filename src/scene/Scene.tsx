import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import {
  Box3,
  InstancedMesh,
  MathUtils,
  Matrix4,
  NoColorSpace,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { BufferGeometry, Group, Material, Mesh, MeshStandardMaterial } from 'three'
import type { LightingSettings } from './lighting'
import { applyRevealShader, createRevealUniforms, revealDepthWeight } from './reveal'
import type { RevealUniforms } from './reveal'
import { useLoopScroll } from '../experience/useLoopScroll'
import { usePyramidMaterial } from './pyramidMaterial'
import { applyEdgeShader, buildEdgeGeometry, createEdgeUniforms } from './pyramidEdges'

const pyramidModelUrl = '/models/pyramid.glb?v=non-beveled-untextured-1'
const terrainModelUrl = '/models/desert-terrain.glb?v=webref-geometry-2'
const terrainTextureUrls = [
  '/textures/sand-basecolor.jpg',
  '/textures/sand-normal.jpg',
  '/textures/sand-roughness.jpg',
]
const revealDuration = 10
const terrainRevealStart = 0.04
const terrainRevealEnd = 0.6
// The desert measures ~522 world units from the reveal origin to its far
// corner; the pyramid measures ~4.7. One shared cell size cannot serve both -
// at the terrain's 1.35 the pyramid is spanned by only four cells and so
// arrives in four visible pops rather than a sweep.
const terrainRevealCellSize = 1.35
const pyramidRevealCellSize = 0.3
// The pyramid's own slice of the timeline. It still finishes about when the
// sand at its base does, so the two still read as one event, but it is spread
// over ~16 steps instead of four and starts from a much shorter dead spell.
const pyramidRevealStart = 0.04
const pyramidRevealEnd = 0.26
const pyramidRevealEase = 1.2
const terrainProgressAtPyramidReveal = Math.pow(
  (pyramidRevealEnd - terrainRevealStart) / (1 - terrainRevealStart),
  2.8,
)
const pyramidPulsePeriod = 11.4
// Heartbeat rhythm: a "lub-dub" pair, a short pause, then one slower, softer
// beat before the loop repeats. Times are seconds into the period.
const pyramidHeartbeat = [
  { start: 0, duration: 2.5, strength: 1 },
  { start: 2.5, duration: 2, strength: 0.75 },
  { start: 5.5, duration: 2.2, strength: 0.6 },
] as const
// Seconds for a beat to sweep from the pyramid's screen-left edge to its right.
const pyramidPulseTravel = 2.4

function heartbeatAt(phase: number) {
  let pulse = 0
  for (const beat of pyramidHeartbeat) {
    const t = phase - beat.start
    if (t > 0 && t < beat.duration) {
      pulse = Math.max(pulse, Math.sin(Math.PI * t / beat.duration) ** 2 * beat.strength)
    }
  }
  return pulse
}
const pyramidRotationY = MathUtils.degToRad(45)

// Scratch objects for the per-frame instance matrix rebuild, hoisted so the
// pulse loop allocates nothing.
const pulseOffset = new Vector3()
const pulseMatrix = new Matrix4()

type AnimatedPyramidBlock = {
  /** Which instanced batch this block lives in, and its slot inside it. */
  batch: InstancedMesh
  index: number
  /** Resting transform, recomposed with the pulse offset every frame. */
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
  direction: Vector3
  delay: number
  distance: number
  height: number
}

function prepareRevealMaterials(
  root: Group,
  reveal: RevealUniforms,
  configureMaterial?: (material: Material) => void,
) {
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
        configureMaterial?.(material)
        materials.set(source, material)
      }
      return material
    })
    mesh.material = Array.isArray(mesh.material) ? revealMaterials : revealMaterials[0]
  })
  return [...materials.values()]
}

function Pyramid({ reveal, rootRef, lighting }: {
  reveal: RevealUniforms
  rootRef: React.RefObject<Group | null>
  lighting: LightingSettings
}) {
  const { scene } = useGLTF(pyramidModelUrl)
  const { state } = useLoopScroll()
  const pyramidMaterial = usePyramidMaterial()
  const edges = useMemo(() => createEdgeUniforms(), [])
  const blocks = useRef<AnimatedPyramidBlock[]>([])
  const batches = useRef<InstancedMesh[]>([])
  const batchRoot = useRef<Group>(null)
  const pulseElapsed = useRef(0)

  // Layout effect, not a passive one: the parent measures this group's bounds
  // in its own layout effect to size the reveal, and child layout effects run
  // first. Building the batches later would hand the parent an empty box.
  useLayoutEffect(() => {
    const root = batchRoot.current
    if (!root) return

    // Occupy exactly the frame the glTF scene root did, so the per-block
    // matrices below (which are relative to that root) stay correct.
    root.position.copy(scene.position)
    root.quaternion.copy(scene.quaternion)
    root.scale.copy(scene.scale)
    scene.updateMatrixWorld(true)
    const inverseScene = new Matrix4().copy(scene.matrixWorld).invert()

    // The 146 blocks reuse only 8 geometries, so one instanced batch per
    // geometry collapses 146 draw calls into 8.
    const byGeometry = new Map<BufferGeometry, { mesh: Mesh; matrix: Matrix4 }[]>()
    scene.traverse((object) => {
      if (!('isMesh' in object)) return
      const mesh = object as Mesh
      const matrix = new Matrix4().multiplyMatrices(inverseScene, mesh.matrixWorld)
      const group = byGeometry.get(mesh.geometry)
      if (group) group.push({ mesh, matrix })
      else byGeometry.set(mesh.geometry, [{ mesh, matrix }])
    })

    // Bounds measured in the same space as the block matrices, so the height
    // ratio driving the pulse distance is consistent.
    const pyramidBounds = new Box3()
    for (const group of byGeometry.values()) {
      for (const { mesh, matrix } of group) {
        mesh.geometry.computeBoundingBox()
        pyramidBounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix))
      }
    }
    const pyramidSize = pyramidBounds.getSize(new Vector3())
    const pyramidCenter = pyramidBounds.getCenter(new Vector3())

    // One material for every batch keeps this to a single shader program, and
    // carries both the dissolve and the block outlines.
    const material = pyramidMaterial.clone()
    applyRevealShader(material, reveal)
    applyEdgeShader(material, edges)

    // The beat sweeps across the screen, so blocks are ordered by world X (the
    // camera looks down -Z) rather than by their rotated local position.
    root.updateWorldMatrix(true, false)
    const blockWorldX: number[] = []

    const animatedBlocks: AnimatedPyramidBlock[] = []
    const createdBatches: InstancedMesh[] = []
    const createdGeometries: BufferGeometry[] = []

    for (const [geometry, group] of byGeometry) {
      const edgeGeometry = buildEdgeGeometry(geometry, 25)
      createdGeometries.push(edgeGeometry)
      const batch = new InstancedMesh(edgeGeometry, material, group.length)
      batch.name = 'Pyramid block batch'
      batch.castShadow = true
      batch.receiveShadow = true
      batch.frustumCulled = false
      createdBatches.push(batch)
      root.add(batch)

      const center = new Vector3()
      for (const [index, { matrix }] of group.entries()) {
        batch.setMatrixAt(index, matrix)

        const position = new Vector3()
        const quaternion = new Quaternion()
        const scale = new Vector3()
        matrix.decompose(position, quaternion, scale)

        geometry.boundingBox!.getCenter(center)
        const blockCenter = center.clone().applyMatrix4(matrix)
        const height = MathUtils.clamp(
          (blockCenter.y - pyramidBounds.min.y) / Math.max(pyramidSize.y, 0.0001),
          0,
          1,
        )
        const direction = new Vector3(
          blockCenter.x - pyramidCenter.x,
          0.45 + height * 1.35,
          blockCenter.z - pyramidCenter.z,
        ).normalize()
        blockWorldX.push(blockCenter.clone().applyMatrix4(root.matrixWorld).x)

        animatedBlocks.push({
          batch,
          index,
          position,
          quaternion,
          scale,
          direction,
          delay: 0,
          distance: MathUtils.lerp(0.735, 1.365, height),
          height,
        })
      }
      batch.instanceMatrix.needsUpdate = true
      // Box3.setFromObject falls back to this for instanced meshes, and the
      // scene's reveal radius is derived from it.
      batch.computeBoundingBox()
      batch.computeBoundingSphere()
    }

    const minX = Math.min(...blockWorldX)
    const spanX = Math.max(Math.max(...blockWorldX) - minX, 0.0001)
    for (const [index, block] of animatedBlocks.entries()) {
      block.delay = (blockWorldX[index] - minX) / spanX * pyramidPulseTravel
    }

    blocks.current = animatedBlocks
    batches.current = createdBatches

    return () => {
      blocks.current = []
      batches.current = []
      for (const batch of createdBatches) {
        batch.removeFromParent()
        batch.dispose()
      }
      for (const geometry of createdGeometries) geometry.dispose()
      material.dispose()
    }
  }, [scene, reveal, pyramidMaterial, edges])

  useFrame((_, delta) => {
    const pyramidProgress = reveal.progress.value
    // The construction front leads the solid surface and disappears as the
    // pyramid finishes revealing. These uniforms update without React renders.
    // oxlint-disable-next-line react/immutability
    edges.build.value = Math.min(1, pyramidProgress * 1.5 + 0.05)
    // oxlint-disable-next-line react/immutability
    edges.opacity.value = 1 - MathUtils.smoothstep(pyramidProgress, 0.7, 0.99)
    if (!state.current.reducedMotion && edges.opacity.value > 0) {
      // oxlint-disable-next-line react/immutability
      edges.time.value += Math.min(delta, 0.1)
    }

    const motionVisibility = !state.current.reducedMotion && pyramidProgress >= 0.999 ? 1 : 0
    if (motionVisibility > 0) pulseElapsed.current += Math.min(delta, 0.1)

    for (const block of blocks.current) {
      const phase = MathUtils.euclideanModulo(
        pulseElapsed.current - block.delay,
        pyramidPulsePeriod,
      )
      const activePulse = heartbeatAt(phase) * motionVisibility
      const layerInfluence = MathUtils.smootherstep(block.height, 0.08, 0.55)
      const movementScale = MathUtils.lerp(lighting.baseMovement, 1, layerInfluence)

      // Instances are not scene-graph children, so the pulse offset has to be
      // written straight into the batch's matrix buffer.
      pulseOffset.copy(block.position).addScaledVector(
        block.direction,
        block.distance * activePulse * movementScale,
      )
      pulseMatrix.compose(pulseOffset, block.quaternion, block.scale)
      block.batch.setMatrixAt(block.index, pulseMatrix)
    }

    for (const batch of batches.current) {
      // Three instance buffers are mutable render-loop state by design.
      // oxlint-disable-next-line react/immutability
      batch.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group ref={rootRef} scale={0.9} rotation-y={pyramidRotationY}>
      <group ref={batchRoot} />
    </group>
  )
}

function Terrain({ reveal, rootRef }: { reveal: RevealUniforms; rootRef: React.RefObject<Group | null> }) {
  const { scene } = useGLTF(terrainModelUrl)
  const [baseColorMap, normalMap, roughnessMap] = useTexture(terrainTextureUrls)
  useEffect(() => {
    // Loaded textures are configured once for this material pipeline.
    // oxlint-disable-next-line react/immutability
    baseColorMap.colorSpace = SRGBColorSpace
    // oxlint-disable-next-line react/immutability
    normalMap.colorSpace = NoColorSpace
    // oxlint-disable-next-line react/immutability
    roughnessMap.colorSpace = NoColorSpace
    for (const texture of [baseColorMap, normalMap, roughnessMap]) {
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.needsUpdate = true
    }

    const materials = prepareRevealMaterials(scene, reveal, (material) => {
      const sand = material as MeshStandardMaterial
      sand.map = baseColorMap
      sand.normalMap = normalMap
      sand.roughnessMap = roughnessMap
      sand.roughness = 1
      sand.metalness = 0
      sand.normalScale.set(0.55, 0.55)
      sand.needsUpdate = true
    })
    scene.traverse((object) => {
      if ('isMesh' in object) (object as Mesh).receiveShadow = true
    })
    return () => {
      for (const material of materials) material.dispose()
    }
  }, [scene, reveal, baseColorMap, normalMap, roughnessMap])
  return (
    <group ref={rootRef}>
      <primitive object={scene} />
    </group>
  )
}

export function Scene({ lighting }: { lighting: LightingSettings }) {
  const gl = useThree((state) => state.gl)
  const viewportWidth = useThree((state) => state.size.width)
  const { state } = useLoopScroll()
  const reveal = useMemo(() => createRevealUniforms(terrainRevealCellSize), [])
  const pyramidReveal = useMemo(() => createRevealUniforms(pyramidRevealCellSize), [])
  const revealElapsed = useRef(0)
  const pyramidRoot = useRef<Group>(null)
  const terrainRoot = useRef<Group>(null)

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
    // An empty Box3 carries min=+Infinity/max=-Infinity, so a midpoint works out
    // to NaN. NaN then silently poisons the reveal shader: comparisons against it
    // are always false, so nothing discards and the edge glow saturates the whole
    // scene instead of erroring anywhere visible.
    if (pyramidBounds.isEmpty()) return
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

    // The pyramid is sized against its own bounds rather than the desert's, so
    // its front sweeps 7 units over its own window instead of crawling through
    // the first 1.3% of a 522-unit radius.
    // oxlint-disable-next-line react/immutability
    pyramidReveal.origin.value.copy(reveal.origin.value)
    const origin = reveal.origin.value
    const pyramidReach = Math.max(
      Math.abs(pyramidBounds.min.x - origin.x),
      Math.abs(pyramidBounds.max.x - origin.x),
      Math.abs(pyramidBounds.min.z - origin.z),
      Math.abs(pyramidBounds.max.z - origin.z),
    )
    // Mirrors the shader's own shaping: Chebyshev reach, plus the depth
    // weighting, plus headroom for the per-cell jitter riding on top.
    // oxlint-disable-next-line react/immutability
    pyramidReveal.distance.value = pyramidReach
      + (origin.y - pyramidBounds.min.y) * revealDepthWeight
      + pyramidRevealCellSize * 1.5
  }, [reveal, pyramidReveal])

  useFrame((_, delta) => {
    const current = state.current
    if (current.phase === 'loading') return
    if (!current.reducedMotion) revealElapsed.current += Math.min(delta, 0.1)
    const timeline = current.reducedMotion ? 1 : Math.min(revealElapsed.current / revealDuration, 1)
    const revealTime = MathUtils.clamp(
      (timeline - terrainRevealStart) / (1 - terrainRevealStart),
      0,
      1,
    )
    // Keep the original pacing through the pyramid reveal, then sweep across
    // the entire desert in the next 3.4 seconds instead of taking the full 10.
    const terrainProgress = timeline <= pyramidRevealEnd
      ? Math.pow(revealTime, 2.8)
      : MathUtils.lerp(
        terrainProgressAtPyramidReveal,
        1,
        MathUtils.clamp(
          (timeline - pyramidRevealEnd) / (terrainRevealEnd - pyramidRevealEnd),
          0,
          1,
        ),
      )
    // Shared shader uniforms are updated without triggering React renders.
    // oxlint-disable-next-line react/immutability
    reveal.timeline.value = timeline
    // oxlint-disable-next-line react/immutability
    reveal.progress.value = terrainProgress

    // Same timeline so the block outlines still fade in step with the sand,
    // but its own progress curve over its own radius.
    // oxlint-disable-next-line react/immutability
    pyramidReveal.timeline.value = timeline
    const pyramidTime = MathUtils.clamp(
      (timeline - pyramidRevealStart) / (pyramidRevealEnd - pyramidRevealStart),
      0,
      1,
    )
    // oxlint-disable-next-line react/immutability
    pyramidReveal.progress.value = Math.pow(pyramidTime, pyramidRevealEase)
  })

  return (
    <>
      <color attach="background" args={[lighting.background]} />
      <ambientLight color={lighting.ambientColor} intensity={lighting.ambientIntensity} />
      <hemisphereLight
        color={lighting.skyColor}
        groundColor={lighting.groundColor}
        intensity={lighting.hemisphereIntensity}
      />
      <directionalLight
        name="Desert sun"
        color={lighting.sunColor}
        intensity={lighting.sunIntensity}
        position={[
          lighting.sunPositionX,
          lighting.sunPositionY,
          lighting.sunPositionZ,
        ]}
        castShadow
        shadow-mapSize-width={viewportWidth < 600 ? 1024 : 2048}
        shadow-mapSize-height={viewportWidth < 600 ? 1024 : 2048}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.00015}
        shadow-normalBias={0.055}
        shadow-radius={2}
      />
      <Terrain reveal={reveal} rootRef={terrainRoot} />
      <group name="landmarks" position={[0, -0.05, 0.65]}>
        <Pyramid
          reveal={pyramidReveal}
          rootRef={pyramidRoot}
          lighting={lighting}
        />
      </group>
    </>
  )
}

useGLTF.preload(pyramidModelUrl)
useGLTF.preload(terrainModelUrl)
useTexture.preload(terrainTextureUrls)
