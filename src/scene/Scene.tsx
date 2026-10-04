import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import { Bloom, EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import {
  Box3,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  NoColorSpace,
  Quaternion,
  Ray,
  Raycaster,
  RepeatWrapping,
  Vector2,
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
import { applyPyramidGlowShader, createPyramidGlowUniforms } from './pyramidGlow'
import { createHoverMarkerOverlay } from './hoverMarkers'
import type { HoverMarker, HoverMarkerEdge } from './hoverMarkers'
import { applyAtmosphereFog, createAtmosphereUniforms } from './atmosphere/desertAtmosphereShaders'
import type { AtmosphereUniforms } from './atmosphere/desertAtmosphereShaders'
import { DesertAtmosphere } from './atmosphere/DesertAtmosphere'
import type { QualityProfile } from './atmosphere/quality'
import { ScrollSceneController } from './transition/ScrollSceneController'
import { SandstormTransition } from './transition/SandstormTransition'
import { SecondScene } from './transition/SecondScene'
import { TransitionPostFX } from './transition/TransitionPostFX'

const pyramidModelUrl = '/models/pyramid.glb?v=no-base-course-merged-apex-1'
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
const hoverRaycaster = new Raycaster()
const hoverRay = new Ray()
const hoverHit = new Vector3()
const hoverCandidate = new Vector3()
const hoverInverse = new Matrix4()
// Hovered blocks breathe in and out instead of freezing in place.
const hoverBreathPeriod = 3.2
// Hovered blocks swing between 1 - 2 * depth and 1 of their full lift.
const hoverBreathDepth = 0.25
// How far every block above the base layer travels at full pulse or hover.
const pyramidBlockTravel = 1.365
// Tracking markers on hovered blocks. A block gains one once clearly lifted
// and keeps it until nearly settled, so small cursor moves never flicker them.
const markerLimit = 5
const markerEnterHover = 0.5
const markerExitHover = 0.25
// Minimum gap between marked blocks (blocks are ~1 unit), so the web spreads
// across the lifted area instead of bunching up under the cursor.
const markerSpacing = 1.9
const markerPoint = new Vector3()
const markerSize = new Vector3()
const markerCamera = new Vector3()

type AnimatedPyramidBlock = {
  /** Which instanced batch this block lives in, and its slot inside it. */
  batch: InstancedMesh
  index: number
  /** Per-instance pulse offset read by the glow shader, so light escapes where blocks part. */
  glowOpen: InstancedBufferAttribute
  /** Resting transform, recomposed with the pulse offset every frame. */
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
  direction: Vector3
  /** Resting bounds and centre in the batch root's space, for the hover hit test. */
  restingBox: Box3
  restingCenter: Vector3
  /** Eased 0..1 hover amount, so blocks glide out and back rather than snap. */
  hover: number
  delay: number
  /** The bottom course stays planted, scaled down by lighting.baseMovement. */
  isBase: boolean
  /** Current pulse/hover offset, 0..1 of pyramidBlockTravel. */
  offset: number
  /** Hover as actually seen on screen, so near-still base blocks never get a marker. */
  visibleHover: number
}

/** Live two-digit readout of how far a block is extended: 00 at rest, 99 at
 *  full travel, so it rises and falls with the breathing and the heartbeat. */
function extensionLabel(offset: number) {
  return String(Math.round(MathUtils.clamp(offset, 0, 1) * 99)).padStart(2, '0')
}

/** Joins each marked block to its two nearest marked neighbours in 3D, which
 *  gives small chains and triangles rather than every-to-every clutter. */
function connectMarkers(marked: readonly AnimatedPyramidBlock[]) {
  const edges: HoverMarkerEdge[] = []
  const seen = new Set<string>()
  for (const [from, block] of marked.entries()) {
    const nearest = marked
      .map((other, to) => ({ to, distance: block.restingCenter.distanceTo(other.restingCenter) }))
      .filter(({ to }) => to !== from)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
    for (const { to } of nearest) {
      const key = from < to ? `${from}-${to}` : `${to}-${from}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([from, to])
    }
  }
  return edges
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

function Pyramid({ reveal, atmosphere, rootRef, lighting }: {
  reveal: RevealUniforms
  atmosphere: AtmosphereUniforms
  rootRef: React.RefObject<Group | null>
  lighting: LightingSettings
}) {
  const { scene } = useGLTF(pyramidModelUrl)
  const { state } = useLoopScroll()
  const pyramidMaterial = usePyramidMaterial()
  const edges = useMemo(() => createEdgeUniforms(), [])
  const glow = useMemo(() => createPyramidGlowUniforms(), [])
  const blocks = useRef<AnimatedPyramidBlock[]>([])
  const batches = useRef<InstancedMesh[]>([])
  const batchRoot = useRef<Group>(null)
  const pulseElapsed = useRef(0)
  const camera = useThree((root) => root.camera)
  const gl = useThree((root) => root.gl)
  // Screen position of a hovering mouse in normalized device coordinates, or
  // null. Tracked on the window because the scroll layer sits over the canvas
  // and swallows R3F's own pointer events.
  const hoverPointer = useRef<Vector2 | null>(null)
  const markerOverlay = useRef<ReturnType<typeof createHoverMarkerOverlay> | null>(null)
  const markedBlocks = useRef<AnimatedPyramidBlock[]>([])
  const markerEdges = useRef<HoverMarkerEdge[]>([])
  const markers = useRef<HoverMarker[]>([])

  useEffect(() => {
    const container = gl.domElement.parentElement
    if (!container) return
    const overlay = createHoverMarkerOverlay(container, markerLimit)
    markerOverlay.current = overlay
    return () => {
      overlay.dispose()
      markerOverlay.current = null
    }
  }, [gl])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      // Touch drags are scrolling, not hovering.
      if (event.pointerType !== 'mouse') return
      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      if (Math.abs(x) > 1 || Math.abs(y) > 1) {
        hoverPointer.current = null
        return
      }
      hoverPointer.current ??= new Vector2()
      hoverPointer.current.set(x, y)
    }
    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) hoverPointer.current = null
    }
    const clear = () => {
      hoverPointer.current = null
    }
    window.addEventListener('pointermove', move)
    document.addEventListener('mouseout', leave)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('mouseout', leave)
      window.removeEventListener('blur', clear)
    }
  }, [gl])

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

    // The 113 blocks reuse only 7 geometries, so one instanced batch per
    // geometry collapses 113 draw calls into 7.
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
    // ratio tilting each block's pulse direction is consistent.
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
    applyPyramidGlowShader(material, glow)
    applyAtmosphereFog(material, atmosphere)

    // The beat sweeps across the screen, so blocks are ordered by world X (the
    // camera looks down -Z) rather than by their rotated local position.
    root.updateWorldMatrix(true, false)
    const blockWorldX: number[] = []
    // oxlint-disable-next-line react/immutability
    glow.core.value.copy(pyramidCenter).applyMatrix4(root.matrixWorld)

    const animatedBlocks: AnimatedPyramidBlock[] = []
    const createdBatches: InstancedMesh[] = []
    const createdGeometries: BufferGeometry[] = []

    for (const [geometry, group] of byGeometry) {
      const edgeGeometry = buildEdgeGeometry(geometry, 25)
      createdGeometries.push(edgeGeometry)
      const glowOpen = new InstancedBufferAttribute(new Float32Array(group.length), 1)
      glowOpen.setUsage(DynamicDrawUsage)
      edgeGeometry.setAttribute('aGlowOpen', glowOpen)
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
        const restingBox = geometry.boundingBox!.clone().applyMatrix4(matrix)
        // Sitting on the pyramid's floor, within half its own height.
        const isBase = restingBox.min.y - pyramidBounds.min.y
          < (restingBox.max.y - restingBox.min.y) * 0.5

        animatedBlocks.push({
          batch,
          index,
          glowOpen,
          position,
          quaternion,
          scale,
          direction,
          restingBox,
          restingCenter: blockCenter,
          hover: 0,
          delay: 0,
          isBase,
          offset: 0,
          visibleHover: 0,
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
    markedBlocks.current = []
    markerEdges.current = []

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
  }, [scene, reveal, atmosphere, pyramidMaterial, edges, glow])

  function updateMarkers(root: Group | null) {
    const overlay = markerOverlay.current
    if (!overlay || !root) return
    const marked = markedBlocks.current
    let changed = false
    for (let index = marked.length - 1; index >= 0; index -= 1) {
      if (marked[index].visibleHover < markerExitHover) {
        marked.splice(index, 1)
        changed = true
      }
    }
    if (marked.length < markerLimit) {
      const candidates = blocks.current
        .filter((block) => block.visibleHover >= markerEnterHover && !marked.includes(block))
        .sort((a, b) => b.visibleHover - a.visibleHover)
      for (const block of candidates) {
        if (marked.length >= markerLimit) break
        const crowded = marked.some((other) =>
          other.restingCenter.distanceTo(block.restingCenter) < markerSpacing)
        if (crowded) continue
        marked.push(block)
        changed = true
      }
    }
    if (changed) markerEdges.current = connectMarkers(marked)

    // Anchor on the centre of whichever face of the block looks most towards
    // the camera. Block boxes are axis-aligned in the batch root's space.
    hoverInverse.copy(root.matrixWorld).invert()
    markerCamera.copy(camera.position).applyMatrix4(hoverInverse)
    const width = gl.domElement.clientWidth
    const height = gl.domElement.clientHeight
    const current = markers.current
    current.length = marked.length
    for (const [index, block] of marked.entries()) {
      markerPoint.copy(block.restingCenter).addScaledVector(block.direction, pyramidBlockTravel * block.offset)
      block.restingBox.getSize(markerSize).multiplyScalar(0.5)
      const toCameraX = markerCamera.x - markerPoint.x
      const toCameraY = markerCamera.y - markerPoint.y
      const toCameraZ = markerCamera.z - markerPoint.z
      const reachX = Math.abs(toCameraX)
      const reachY = Math.abs(toCameraY)
      const reachZ = Math.abs(toCameraZ)
      if (reachX >= reachY && reachX >= reachZ) markerPoint.x += Math.sign(toCameraX) * markerSize.x
      else if (reachY >= reachZ) markerPoint.y += Math.sign(toCameraY) * markerSize.y
      else markerPoint.z += Math.sign(toCameraZ) * markerSize.z

      markerPoint.applyMatrix4(root.matrixWorld).project(camera)
      const marker = current[index] ?? (current[index] = { x: 0, y: 0, opacity: 0, label: '' })
      marker.x = (markerPoint.x + 1) * 0.5 * width
      marker.y = (1 - markerPoint.y) * 0.5 * height
      marker.opacity = markerPoint.z > 1 ? 0 : MathUtils.smoothstep(block.visibleHover, markerExitHover, 0.7)
      marker.label = extensionLabel(block.offset)
    }
    overlay.update(current, markerEdges.current)
  }

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

    // The trapped light takes over as the construction outline fades out.
    // oxlint-disable-next-line react/immutability
    glow.visibility.value = MathUtils.smoothstep(pyramidProgress, 0.85, 1)
    glow.color.value.set(lighting.glowColor)
    glow.seamIntensity.value = lighting.glowSeamIntensity
    glow.seamWidth.value = lighting.glowSeamWidth
    glow.coreIntensity.value = lighting.glowCoreIntensity
    glow.pulseBoost.value = lighting.glowPulseBoost

    const motionVisibility = !state.current.reducedMotion && pyramidProgress >= 0.999 ? 1 : 0
    const frameDelta = Math.min(delta, 0.1)
    if (motionVisibility > 0) pulseElapsed.current += frameDelta

    // Hit-test the blocks' resting boxes, not the moving instances: a block
    // that lifts away from the cursor would otherwise drop the hover and fall
    // back, flickering in and out.
    let hovering = false
    const root = batchRoot.current
    // Hover belongs to the settled scene: it lets go as the storm arrives.
    const transition = state.current.transition
    const hoverable = transition.activeSection === 0 && transition.interaction > 0.5
    if (motionVisibility > 0 && hoverable && hoverPointer.current && root) {
      hoverRaycaster.setFromCamera(hoverPointer.current, camera)
      hoverInverse.copy(root.matrixWorld).invert()
      hoverRay.copy(hoverRaycaster.ray).applyMatrix4(hoverInverse)
      let nearest = Infinity
      for (const block of blocks.current) {
        if (!hoverRay.intersectBox(block.restingBox, hoverCandidate)) continue
        const distance = hoverCandidate.distanceToSquared(hoverRay.origin)
        if (distance < nearest) {
          nearest = distance
          hoverHit.copy(hoverCandidate)
        }
      }
      hovering = nearest < Infinity
    }
    const breath = 1 - hoverBreathDepth
      + hoverBreathDepth * Math.sin(pulseElapsed.current * Math.PI * 2 / hoverBreathPeriod)

    for (const block of blocks.current) {
      const phase = MathUtils.euclideanModulo(
        pulseElapsed.current - block.delay,
        pyramidPulsePeriod,
      )
      const activePulse = heartbeatAt(phase) * motionVisibility
      const hoverTarget = hovering
        ? 1 - MathUtils.smoothstep(
          block.restingCenter.distanceTo(hoverHit),
          lighting.hoverRadius * 0.35,
          lighting.hoverRadius,
        )
        : 0
      // Out quickly, back a little slower so blocks settle rather than drop.
      const hoverEase = hoverTarget > block.hover ? lighting.hoverEase : lighting.hoverEase * 0.5
      // Per-block animation state lives in a ref and is advanced every frame.
      // oxlint-disable-next-line react/immutability
      block.hover = MathUtils.damp(block.hover, hoverTarget, hoverEase, frameDelta)
      const movementScale = block.isBase ? lighting.baseMovement : 1
      // Whichever is further wins, so a beat still passes through hovered blocks
      // without stacking into an extreme jump.
      const offsetAmount = movementScale * Math.max(
        activePulse,
        block.hover * lighting.hoverStrength * breath,
      )
      block.glowOpen.setX(block.index, offsetAmount)
      block.offset = offsetAmount
      block.visibleHover = block.hover * movementScale

      // Instances are not scene-graph children, so the pulse offset has to be
      // written straight into the batch's matrix buffer.
      pulseOffset.copy(block.position).addScaledVector(
        block.direction,
        pyramidBlockTravel * offsetAmount,
      )
      pulseMatrix.compose(pulseOffset, block.quaternion, block.scale)
      block.batch.setMatrixAt(block.index, pulseMatrix)
    }

    for (const batch of batches.current) {
      // Three instance buffers are mutable render-loop state by design.
      // oxlint-disable-next-line react/immutability
      batch.instanceMatrix.needsUpdate = true
      batch.geometry.getAttribute('aGlowOpen').needsUpdate = true
    }

    updateMarkers(root)
  })


  return (
    <group ref={rootRef} scale={0.9} rotation-y={pyramidRotationY}>
      <group ref={batchRoot} />
    </group>
  )
}

function Terrain({ reveal, atmosphere, rootRef }: {
  reveal: RevealUniforms
  atmosphere: AtmosphereUniforms
  rootRef: React.RefObject<Group | null>
}) {
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
      applyAtmosphereFog(sand, atmosphere)
    })
    scene.traverse((object) => {
      if ('isMesh' in object) (object as Mesh).receiveShadow = true
    })
    return () => {
      for (const material of materials) material.dispose()
    }
  }, [scene, reveal, atmosphere, baseColorMap, normalMap, roughnessMap])
  return (
    <group ref={rootRef}>
      <primitive object={scene} />
    </group>
  )
}

export function Scene({ lighting, quality }: { lighting: LightingSettings; quality: QualityProfile }) {
  const gl = useThree((state) => state.gl)
  const { state } = useLoopScroll()
  const reveal = useMemo(() => createRevealUniforms(terrainRevealCellSize), [])
  const pyramidReveal = useMemo(() => createRevealUniforms(pyramidRevealCellSize), [])
  const atmosphere = useMemo(() => createAtmosphereUniforms(), [])
  const revealElapsed = useRef(0)
  const pyramidRoot = useRef<Group>(null)
  const terrainRoot = useRef<Group>(null)
  // One root per section in cycle.ts; only the active one is ever drawn.
  const pyramidSceneRoot = useRef<Group>(null)
  const secondSceneRoot = useRef<Group>(null)
  const sceneRoots = useMemo(() => [pyramidSceneRoot, secondSceneRoot], [])

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
    // Airborne sand arrives with the desert it blows over.
    // oxlint-disable-next-line react/immutability
    atmosphere.uSandVisibility.value = MathUtils.smoothstep(terrainProgress, 0.15, 0.8)

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
      {/* Only seen before the sky's first frame; the sky covers every pixel. */}
      <color attach="background" args={[lighting.hazeHorizonColor]} />
      {/* Named so the second scene can switch them off for its own renders. */}
      <ambientLight name="Desert ambient" color={lighting.ambientColor} intensity={lighting.ambientIntensity} />
      <hemisphereLight
        name="Desert hemisphere"
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
        shadow-mapSize-width={quality.shadowMapSize}
        shadow-mapSize-height={quality.shadowMapSize}
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
      <group ref={pyramidSceneRoot} name="Pyramid scene">
        <Terrain reveal={reveal} atmosphere={atmosphere} rootRef={terrainRoot} />
        <group name="landmarks" position={[0, -0.05, 0.65]}>
          <Pyramid
            reveal={pyramidReveal}
            atmosphere={atmosphere}
            rootRef={pyramidRoot}
            lighting={lighting}
          />
        </group>
      </group>
      <SecondScene rootRef={secondSceneRoot} anchorCount={quality.networkAnchors} />
      {/* Sky and ambient sand are shared by both scenes. */}
      <DesertAtmosphere
        atmosphere={atmosphere}
        lighting={lighting}
        profile={quality}
        terrainRoot={terrainRoot}
      />
      <SandstormTransition
        atmosphere={atmosphere}
        count={quality.stormParticles}
        detailed={quality.detailedNoise}
      />
      <ScrollSceneController sceneRoots={sceneRoots} />
      {/* The composer disables the renderer's own tone mapping, so ACES is
          reapplied after bloom, which has to see the untonemapped HDR glow.
          MSAA on the composer's HDR buffer cost about as much as the bloom
          itself, so edges are smoothed by a single SMAA pass instead. */}
      <EffectComposer multisampling={0}>
        <Bloom
          mipmapBlur
          levels={quality.bloomLevels}
          intensity={lighting.bloomIntensity * quality.bloomIntensityScale}
          luminanceThreshold={lighting.bloomThreshold}
          luminanceSmoothing={lighting.bloomSmoothing}
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
        {/* Its own pass after SMAA, enabled only while a storm is on screen. */}
        <TransitionPostFX quality={quality} lighting={lighting} atmosphere={atmosphere} sceneRoots={sceneRoots} />
      </EffectComposer>
    </>
  )
}

useGLTF.preload(pyramidModelUrl)
useGLTF.preload(terrainModelUrl)
useTexture.preload(terrainTextureUrls)
