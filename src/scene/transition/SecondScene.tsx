import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  MathUtils,
  Matrix4,
  MeshDepthMaterial,
  Object3D,
  PointsMaterial,
  Ray,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import type { DirectionalLight, Group, HemisphereLight, Light, Mesh, PerspectiveCamera } from 'three'
import { baseFov, cameraPoses } from '../../experience/cameraPath'
import { useLoopScroll } from '../../experience/useLoopScroll'
import {
  breakHoverTrail,
  cageStrength,
  columnHover,
  columnHoverUniforms,
  createHoverSpawner,
  emitHoverTrail,
  flushHoverTrail,
  sampleSegment,
} from './columnHover'
import type { SegmentSample } from './columnHover'
import { projectColumnUVs, useColumnMaterial } from './columnMaterial'
import { createColumnPicker, pickColumn } from './columnPicker'
import type { ColumnPicker } from './columnPicker'
import { applyColumnRippleShader, columnRipple, columnRippleUniforms, tagColumns } from './columnRipple'
import { secondSceneLights } from './secondSceneLook'
import { createShardMotion, sampleShardMotion, shardSection } from './shardMotion'
import {
  createNetworkFrame,
  createNetworkView,
  createShardNetwork,
  networkBounds,
  networkSpread,
  networkStretch,
  updateNetwork,
} from './shardNetwork'

// Geometry only: UVs and the sandstone material are added in code (see
// columnMaterial).
const shardModelUrl = '/models/hex-cylinder-ripple-untextured.glb'

/** The shard hangs where its section's camera already looks, so it is framed
 *  without the camera having to know about it. */
const heroPosition = cameraPoses[shardSection].target
// The hex-cylinder export is ~5.74 units tall. This keeps approximately the
// same screen coverage as the former ~2-unit shard at scale 2.7.
const heroScale = 0.96
// Portrait viewports are narrower than the shard's lines reach, so the whole
// rig shrinks below these aspect ratios. The lines close in sideways too
// (see networkSpread), by as much as the view's width needs.
const narrowAspect = 0.5
const rigFitAspect = 1.1
const rigNarrowScale = 0.72
/** Half the view's height, in world units, at the formation's depth. */
const sectionPose = cameraPoses[shardSection]
const viewHalfHeight = Math.hypot(
  sectionPose.position[0] - sectionPose.target[0],
  sectionPose.position[1] - sectionPose.target[1],
  sectionPose.position[2] - sectionPose.target[2],
) * Math.tan(MathUtils.degToRad(baseFov / 2))

/** Idle motion layered on the scroll choreography. It is bounded - a sway,
 *  never a spin - so a scroll position always shows the same pose to within
 *  these amounts, and scrolling back retraces it. */
const idle = {
  hoverHeight: 0.11,
  hoverRate: 0.62,
  driftHeight: 0.05,
  driftRate: 0.27,
  /** Yaw swings this far either side over swayPeriod seconds: about a degree
   *  a second at its fastest. */
  swayYaw: MathUtils.degToRad(9),
  swayPeriod: 46,
  swayTilt: MathUtils.degToRad(1.4),
  /** Share of the amplitudes, and of the clock's speed, kept under
   *  prefers-reduced-motion. The network's rise runs on the same clock. */
  reducedMotionScale: 0.2,
  /** Share of the network's sideways wander kept under reduced motion. */
  reducedNetworkDrift: 0.4,
}

/** Cursor-driven lean of the shard itself. The camera takes no part in it. */
const pointerTilt = {
  maxYaw: MathUtils.degToRad(3),
  maxPitch: MathUtils.degToRad(2.5),
  /** Low easing rate: the stone follows the cursor late and settles slowly. */
  ease: 2.2,
  /** The lines sit behind the stone and lean less, which reads as depth. */
  linesShare: 0.45,
}

// Light offsets from the formation (see secondSceneLights); the key and rim
// ride along with it so the shadow box always fits it.
const keyOffset = new Vector3(...secondSceneLights.key.offset)
const rimOffset = new Vector3(...secondSceneLights.rim.offset)
const keyDistance = keyOffset.length()

/** The first scene's lights, by name (see Scene). They are switched off for
 *  every render of this scene, and back on straight after. */
const desertLightNames = ['Desert sun', 'Desert ambient', 'Desert hemisphere'] as const

const lineStyle = {
  color: '#f6eedd',
  opacity: 0.8,
  markerOpacity: 1,
  /** Width of a "+" marker in CSS pixels, and the highest device pixel ratio
   *  it is scaled for: past that it would only grow costlier, not sharper. */
  markerSize: 8,
  markerMaxDpr: 2,
  /** Rate at which a line fades in when it joins and out when it lets go, so
   *  neighbours changing places never pop. */
  linkEase: 2.6,
}

const meshBounds = new Box3()
const meshMatrix = new Matrix4()

/** Hover picking: the cursor's ray, carried into the formation's own space. */
const hoverRaycaster = new Raycaster()
const hoverPointer = new Vector2()
const hoverInverse = new Matrix4()
const hoverRay = new Ray()
const hoverHit = new Vector3()
const hoverRest = new Vector3()
/** A trail segment carried from the stone into the cage's own space. */
const trailPoint = new Vector3()
const trailStart = new Vector4()
const trailEnd = new Vector4()
const trailSample: SegmentSample = { reach: 0, age: 0 }
/** A touch counts as a tap, not a scroll, within these limits. */
const tapSlop = 12
const tapTime = 350
/** How much brighter a cage marker or line end gets at a ring's peak. */
const cageGlowBoost = 1.8

/** Signed distance from (x, y) to a centred box of half-size (w, h). */
function boxDistance(x: number, y: number, w: number, h: number) {
  const dx = Math.abs(x) - w
  const dy = Math.abs(y) - h
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

/** A thin "+" with anti-aliased edges and a brighter centre, so the point
 *  markers read as crosshair ticks rather than dots or squares. Mipmapped:
 *  it is drawn at a dozen pixels or less, and the mips keep the arms smooth. */
function createCrossTexture() {
  const size = 32
  const arm = 0.94
  const thickness = 0.19
  const edge = 2 / size
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1
      const v = ((y + 0.5) / size) * 2 - 1
      const distance = Math.min(boxDistance(u, v, arm, thickness), boxDistance(u, v, thickness, arm))
      const shape = 1 - MathUtils.smoothstep(distance, -edge, edge)
      const centre = 0.72 + 0.28 * (1 - MathUtils.smoothstep(Math.hypot(u, v), 0.1, 0.6))
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(255 * shape * centre)
    }
  }
  const texture = new DataTexture(data, size, size)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/**
 * Second location: a formation of sandstone columns floating above a distant,
 * hazy dune horizon, with a sparse network of thin lines drifting around it.
 * The horizon is painted by the sky shader alone (see secondSceneLook and
 * sectionBackdrops); there is no ground geometry.
 *
 * Everything the scroll controls - the rise, the turn, the lift away - comes
 * from sampleShardMotion, a pure function of the cycle position. The camera
 * is never touched. The scene root is hidden (and so neither rendered nor
 * drawn into the shadow map) by ScrollSceneController until the storm
 * switches to it.
 */
export function SecondScene({
  rootRef,
  anchorCount,
}: {
  rootRef: React.RefObject<Group | null>
  /** Markers in the line network, per quality tier. */
  anchorCount: number
}) {
  const { scene: shard } = useGLTF(shardModelUrl)
  const { state } = useLoopScroll()
  const scene = useThree((root) => root.scene)
  const dpr = useThree((root) => root.viewport.dpr)
  const canvas = useThree((root) => root.gl.domElement)
  const rig = useRef<Group>(null)
  const lean = useRef<Group>(null)
  const spin = useRef<Group>(null)
  const lines = useRef<Group>(null)
  const key = useRef<DirectionalLight>(null)
  const rim = useRef<DirectionalLight>(null)
  const fill = useRef<HemisphereLight>(null)
  /** Both directional lights aim at the formation through this. */
  const lightTarget = useMemo(() => new Object3D(), [])
  // Shadows have to see the columns where the vertex shader has slid them.
  const columnDepthMaterial = useMemo(() => new MeshDepthMaterial(), [])
  const motion = useMemo(() => createShardMotion(), [])
  const elapsed = useRef(0)
  /** The columns' own clock: wall time, untouched by scroll or reduced motion. */
  const rippleElapsed = useRef(0)
  // Mouse position, -1 to 1 from left to right and bottom to top; centred
  // when the mouse is away. Only real mice count, since touch drags scroll.
  const pointerX = useRef(0)
  const pointerY = useRef(0)
  /** Whether the mouse is over the page, and has moved since the last frame;
   *  and where it is, in client pixels, for picking against the canvas. */
  const pointerInside = useRef(false)
  const pointerMoved = useRef(false)
  const pointerClientX = useRef(0)
  const pointerClientY = useRef(0)
  /** A tap waiting to send a ripple, at this client position. */
  const tapPending = useRef(false)
  const tapX = useRef(0)
  const tapY = useRef(0)
  /** The formation mesh and its picker, ready once its columns are tagged. */
  const hoverTarget = useRef<{ mesh: Mesh, picker: ColumnPicker } | null>(null)
  const hoverSpawner = useMemo(() => createHoverSpawner(), [])
  const wasHoverable = useRef(false)
  const leanYaw = useRef(0)
  const leanPitch = useRef(0)
  /** Eased share of the network's wander, so toggling reduced motion glides. */
  const networkDrift = useRef(1)

  // The model's origin is not its middle; the rig turns it about its centre.
  // Before the first frame draws: both calls only mark what is already
  // marked, so running again (StrictMode, remounts) is harmless.
  const columnMaterial = useColumnMaterial()
  useEffect(() => () => columnDepthMaterial.dispose(), [columnDepthMaterial])
  useLayoutEffect(() => {
    applyColumnRippleShader(columnMaterial)
    applyColumnRippleShader(columnDepthMaterial)
    shard.traverse((object) => {
      if (!('isMesh' in object)) return
      const mesh = object as Mesh
      tagColumns(mesh.geometry)
      // Keyed off the column tags, so it has to follow them.
      projectColumnUVs(mesh.geometry)
      // The cached model is shared scene-graph state, re-dressed on mount.
      // oxlint-disable-next-line react/immutability
      mesh.material = columnMaterial
      mesh.customDepthMaterial = columnDepthMaterial
      // Only the key light casts shadows here, and the columns are its only
      // casters: neighbours shade each other as they slide.
      mesh.castShadow = true
      mesh.receiveShadow = true
      // Built once per geometry: the model is cached across remounts.
      mesh.geometry.userData.columnPicker ??= createColumnPicker(mesh.geometry)
      hoverTarget.current = { mesh, picker: mesh.geometry.userData.columnPicker as ColumnPicker }
    })
  }, [shard, columnMaterial, columnDepthMaterial])

  const shardOffset = useMemo(() => {
    const bounds = new Box3()
    shard.updateMatrixWorld(true)
    const inverse = new Matrix4().copy(shard.matrixWorld).invert()
    shard.traverse((object) => {
      if (!('isMesh' in object)) return
      const mesh = object as Mesh
      mesh.geometry.computeBoundingBox()
      meshMatrix.multiplyMatrices(inverse, mesh.matrixWorld)
      bounds.union(meshBounds.copy(mesh.geometry.boundingBox!).applyMatrix4(meshMatrix))
    })
    return bounds.getCenter(new Vector3()).negate()
  }, [shard])

  const network = useMemo(() => {
    const layout = createShardNetwork(anchorCount)
    const frame = createNetworkFrame(layout)
    const view = createNetworkView()
    /** Each candidate line's eased 0..1 presence, chasing frame.linked. */
    const levels = new Float32Array(layout.candidateCount)
    /** Each anchor's 0..1 glow from the hover ripples passing it. */
    const glow = new Float32Array(layout.anchorCount)

    // Room for every candidate; only the lines drawn are packed at the front,
    // and the draw range stops after them.
    const linePositions = new BufferAttribute(new Float32Array(layout.candidateCount * 6), 3)
    linePositions.setUsage(DynamicDrawUsage)
    // Four components: the alpha carries each end's own fade.
    const lineColors = new BufferAttribute(new Float32Array(layout.candidateCount * 8).fill(1), 4)
    lineColors.setUsage(DynamicDrawUsage)
    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute('position', linePositions)
    lineGeometry.setAttribute('color', lineColors)
    lineGeometry.setDrawRange(0, 0)

    // A marker on every anchor, reading the positions updateNetwork writes.
    const markerPositions = new BufferAttribute(frame.positions, 3)
    markerPositions.setUsage(DynamicDrawUsage)
    const markerColors = new BufferAttribute(new Float32Array(layout.anchorCount * 4).fill(1), 4)
    markerColors.setUsage(DynamicDrawUsage)
    const markerGeometry = new BufferGeometry()
    markerGeometry.setAttribute('position', markerPositions)
    markerGeometry.setAttribute('color', markerColors)

    // One fixed sphere holds the whole field in every view it can take, so
    // culling never needs the bounds recomputed.
    const { centreZ, radius } = networkBounds(layout)
    const bounds = new Sphere(new Vector3(0, 0, centreZ), radius)
    lineGeometry.boundingSphere = bounds
    markerGeometry.boundingSphere = bounds

    const lineMaterial = new LineBasicMaterial({
      name: 'Shard lines',
      color: lineStyle.color,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // The palette colour as authored: tone mapping would grey it out
      // against the pale haze it is drawn over.
      toneMapped: false,
    })
    const cross = createCrossTexture()
    const markerMaterial = new PointsMaterial({
      name: 'Shard line markers',
      color: lineStyle.color,
      map: cross,
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    })
    return {
      layout,
      frame,
      view,
      levels,
      glow,
      linePositions,
      lineColors,
      lineGeometry,
      markerPositions,
      markerColors,
      markerGeometry,
      lineMaterial,
      markerMaterial,
      cross,
    }
  }, [anchorCount])

  useEffect(() => () => {
    network.lineGeometry.dispose()
    network.markerGeometry.dispose()
    network.lineMaterial.dispose()
    network.markerMaterial.dispose()
    network.cross.dispose()
  }, [network])

  useEffect(() => {
    const toX = (clientX: number) => MathUtils.clamp((clientX / window.innerWidth) * 2 - 1, -1, 1)
    const toY = (clientY: number) => MathUtils.clamp(1 - (clientY / window.innerHeight) * 2, -1, 1)
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      pointerX.current = toX(event.clientX)
      pointerY.current = toY(event.clientY)
      pointerClientX.current = event.clientX
      pointerClientY.current = event.clientY
      pointerInside.current = true
      pointerMoved.current = true
    }
    const reset = () => {
      pointerX.current = 0
      pointerY.current = 0
      pointerInside.current = false
    }
    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) reset()
    }
    // Touch has no hover, so a tap stands in for it. A drag is a scroll, and
    // is left alone.
    let touchX = 0
    let touchY = 0
    let touchAt = 0
    const touchStart = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      touchX = event.clientX
      touchY = event.clientY
      touchAt = event.timeStamp
    }
    const touchEnd = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      const still = Math.hypot(event.clientX - touchX, event.clientY - touchY) < tapSlop
      if (!still || event.timeStamp - touchAt > tapTime) return
      tapX.current = event.clientX
      tapY.current = event.clientY
      tapPending.current = true
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', touchStart)
    window.addEventListener('pointerup', touchEnd)
    document.addEventListener('mouseout', leave)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', touchStart)
      window.removeEventListener('pointerup', touchEnd)
      document.removeEventListener('mouseout', leave)
      window.removeEventListener('blur', reset)
    }
  }, [])

  // This scene's lights stay in the scene for good, outside the scene root, so
  // the number of lights - which is baked into every lit shader - never
  // changes when the storm swaps scenes. Lighting is swapped per render, not
  // per frame, because during the wipe the two scenes are drawn in turn
  // within a single frame: while this scene is drawn its lights shine and the
  // desert's are off; otherwise the reverse, untouched.
  useEffect(() => {
    const desertLights = desertLightNames
      .map((name) => scene.getObjectByName(name) as Light | undefined)
      .filter((light): light is Light => light !== undefined)
    const sun = desertLights.find((light) => light.name === 'Desert sun') as DirectionalLight | undefined
    const saved = desertLights.map(() => 0)
    let swapped = false
    // The key's shadow map is redrawn only for renders of this scene.
    // oxlint-disable-next-line react/immutability
    if (key.current) key.current.shadow.autoUpdate = false

    const previousBefore = scene.onBeforeRender
    const previousAfter = scene.onAfterRender
    // oxlint-disable-next-line react/immutability
    scene.onBeforeRender = (...args) => {
      previousBefore.apply(scene, args)
      const lit = rootRef.current?.visible === true
      const { key: keyLight, rim: rimLight, fill: fillLight } = secondSceneLights
      if (key.current) {
        key.current.intensity = lit ? keyLight.intensity : 0
        // three only allocates a shadow map when it first draws one, and
        // every shadow-receiving material samples this light's map - the
        // desert's included. Left unallocated until this scene first shows,
        // those draws fail and the pyramid scene renders as bare sky. So the
        // first render draws it regardless, empty if need be.
        key.current.shadow.needsUpdate = lit || key.current.shadow.map === null
      }
      if (rim.current) rim.current.intensity = lit ? rimLight.intensity : 0
      if (fill.current) fill.current.intensity = lit ? fillLight.intensity : 0
      if (!lit) return
      for (let index = 0; index < desertLights.length; index += 1) {
        saved[index] = desertLights[index].intensity
        desertLights[index].intensity = 0
      }
      // Nothing of the desert is drawn now, so its shadow map can keep.
      if (sun) sun.shadow.autoUpdate = false
      swapped = true
    }
    // oxlint-disable-next-line react/immutability
    scene.onAfterRender = (...args) => {
      if (swapped) {
        for (let index = 0; index < desertLights.length; index += 1) desertLights[index].intensity = saved[index]
        if (sun) sun.shadow.autoUpdate = true
        swapped = false
      }
      previousAfter.apply(scene, args)
    }
    return () => {
      scene.onBeforeRender = previousBefore
      scene.onAfterRender = previousAfter
    }
  }, [scene, rootRef])

  useFrame(({ camera }, delta) => {
    const rigGroup = rig.current
    const leanGroup = lean.current
    const spinGroup = spin.current
    const linesGroup = lines.current
    if (!rigGroup || !leanGroup || !spinGroup || !linesGroup) return
    const current = state.current
    sampleShardMotion(current.position, motion)

    // Shader warm-up (compileAsync only walks visible objects) happens while
    // loading, at position 0, where the shard would otherwise be off stage.
    const warming = current.phase === 'loading'
    // Scene-graph state is mutable render state by design.
    // oxlint-disable-next-line react/immutability
    rigGroup.visible = warming || motion.onStage
    if (!rigGroup.visible) return

    if (!document.hidden) rippleElapsed.current += Math.min(delta, 0.1)
    // Shader uniforms are mutable render state by design.
    // oxlint-disable-next-line react/immutability
    columnRippleUniforms.uColumnTime.value = rippleElapsed.current * columnRipple.speed

    const calm = current.reducedMotion ? idle.reducedMotionScale : 1
    if (!document.hidden) elapsed.current += Math.min(delta, 0.1) * calm
    const time = elapsed.current
    const idleAmount = motion.settle * calm

    // Pointer lean: a damped secondary offset on its own group, faded out by
    // the storm exactly as the first scene's hover is.
    const transition = current.transition
    const leanWeight = current.reducedMotion || transition.activeSection !== shardSection
      ? 0
      : transition.interaction * motion.settle
    const frameDelta = Math.min(delta, 0.1)
    leanYaw.current = MathUtils.damp(
      leanYaw.current,
      pointerX.current * pointerTilt.maxYaw * leanWeight,
      pointerTilt.ease,
      frameDelta,
    )
    leanPitch.current = MathUtils.damp(
      leanPitch.current,
      -pointerY.current * pointerTilt.maxPitch * leanWeight,
      pointerTilt.ease,
      frameDelta,
    )

    const aspect = (camera as PerspectiveCamera).aspect ?? 1
    const rigFit = MathUtils.lerp(
      rigNarrowScale,
      1,
      MathUtils.clamp((aspect - narrowAspect) / (rigFitAspect - narrowAspect), 0, 1),
    )
    const hover = idleAmount * (
      Math.sin(time * idle.hoverRate) * idle.hoverHeight
      + Math.sin(time * idle.driftRate + 1.3) * idle.driftHeight
    )
    rigGroup.position.set(heroPosition[0], heroPosition[1] + motion.offsetY + hover, heroPosition[2])
    rigGroup.scale.setScalar(heroScale * rigFit * motion.scale)
    // The lights follow the formation, so its shadow box stays tight round it.
    lightTarget.position.copy(rigGroup.position)
    key.current?.position.copy(rigGroup.position).add(keyOffset)
    rim.current?.position.copy(rigGroup.position).add(rimOffset)
    leanGroup.rotation.set(leanPitch.current, leanYaw.current, 0)
    spinGroup.rotation.set(
      motion.tiltX + motion.pitch + idleAmount * Math.sin(time * 0.21 + 0.7) * idle.swayTilt,
      motion.yaw + idleAmount * Math.sin(time * Math.PI * 2 / idle.swayPeriod) * idle.swayYaw,
      motion.tiltZ + motion.roll + idleAmount * Math.sin(time * 0.17) * idle.swayTilt,
    )

    // Hover ripples run on the columns' wall clock, so reduced motion and
    // scrolling leave their pace alone; reduced motion only calms their shape.
    // oxlint-disable-next-line react/immutability
    columnHoverUniforms.uHoverTime.value = rippleElapsed.current
    columnHoverUniforms.uHoverCalm.value = current.reducedMotion ? 1 : 0
    const target = hoverTarget.current
    // Live as soon as the storm has handed over to this scene and the stone
    // is most of the way in - not only once the storm's interaction ramp
    // (which is for the camera's parallax) has caught up, which would leave
    // the stone unresponsive for the end of the transition.
    const hoverable = !warming && target !== null
      && transition.activeSection === shardSection
      && motion.settle > 0.5
    // A cursor already resting on the stone when it becomes hoverable counts
    // as a move, so it answers without a nudge.
    const justHoverable = hoverable && !wasHoverable.current
    wasHoverable.current = hoverable
    const tapped = tapPending.current
    const moved = (pointerMoved.current || justHoverable) && pointerInside.current
    pointerMoved.current = false
    tapPending.current = false
    if (hoverable && (moved || tapped)) {
      // The cursor's ray, in the mesh's own space, against the columns where
      // the shader has slid them.
      // Measured against the canvas itself, not the window: on phones the two
      // need not match (the lean above only wants a rough direction).
      rigGroup.updateMatrixWorld(true)
      // The director has posed the camera for this frame, but its world
      // matrix only refreshes at render: without this the ray would come from
      // last frame's camera, off by however far the parallax has moved it.
      camera.updateMatrixWorld()
      const bounds = canvas.getBoundingClientRect()
      const clientX = tapped ? tapX.current : pointerClientX.current
      const clientY = tapped ? tapY.current : pointerClientY.current
      hoverPointer.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((clientY - bounds.top) / bounds.height) * 2,
      )
      hoverRaycaster.setFromCamera(hoverPointer, camera)
      hoverInverse.copy(target.mesh.matrixWorld).invert()
      hoverRay.copy(hoverRaycaster.ray).applyMatrix4(hoverInverse)
      const hit = pickColumn(
        target.picker,
        hoverRay,
        columnRippleUniforms.uColumnTime.value,
        columnRippleUniforms.uColumnAmplitude.value,
        hoverHit,
        hoverRest,
      )
      // The trail is laid on the stone at rest, so it rides with the columns.
      if (hit) emitHoverTrail(hoverSpawner, hoverRest.x, hoverRest.y, hoverRest.z, rippleElapsed.current, tapped)
      // Off the stone: the trail picks up afresh wherever it comes back on.
      else breakHoverTrail(hoverSpawner)
    } else if (hoverable) {
      // A still cursor: the last point the throttle held back goes out now,
      // so the ripple starts where the cursor came to rest.
      flushHoverTrail(hoverSpawner, rippleElapsed.current)
    }
    if (!hoverable || !pointerInside.current) breakHoverTrail(hoverSpawner)

    const { layout, frame, view, levels, glow, lineMaterial, markerMaterial } = network
    // oxlint-disable-next-line react/immutability
    linesGroup.visible = motion.linesOpacity > 0.001 || warming
    if (!linesGroup.visible) return
    // Shared material state is written in place, without React renders.
    // oxlint-disable-next-line react/immutability
    lineMaterial.opacity = lineStyle.opacity * motion.linesOpacity
    // oxlint-disable-next-line react/immutability
    markerMaterial.opacity = lineStyle.markerOpacity * motion.linesOpacity
    // gl_PointSize is in device pixels.
    markerMaterial.size = lineStyle.markerSize * Math.min(dpr, lineStyle.markerMaxDpr)
    linesGroup.scale.setScalar(motion.linesScale)
    linesGroup.rotation.set(
      leanPitch.current * pointerTilt.linesShare,
      leanYaw.current * pointerTilt.linesShare,
      idleAmount * Math.sin(time * 0.09 + 2.1) * idle.swayTilt,
    )

    networkDrift.current = MathUtils.damp(
      networkDrift.current,
      current.reducedMotion ? idle.reducedNetworkDrift : 1,
      2,
      frameDelta,
    )
    // Fitted to the section's own framing, not the camera's momentary one, so
    // the field holds still while the storm pulls the view back. The fitting
    // is mutable render state, like the scene graph.
    // oxlint-disable-next-line react/immutability
    view.spread = networkSpread(viewHalfHeight * aspect / (heroScale * rigFit))
    view.stretch = networkStretch(view.spread)
    view.guard = 1 / motion.linesScale
    view.drift = networkDrift.current
    updateNetwork(layout, time, view, frame)

    // The trail's fronts, spreading off the stone, light up the cage as they
    // pass it. Each segment is carried from the stone into the cage's space.
    glow.fill(0)
    if (target) {
      const starts = columnHoverUniforms.uHoverStarts.value
      const ends = columnHoverUniforms.uHoverEnds.value
      const now = rippleElapsed.current
      let synced = false
      for (let index = 0; index < ends.length; index += 1) {
        if (now - ends[index].w >= columnHover.cageLife) continue
        if (!synced) {
          rigGroup.updateMatrixWorld(true)
          synced = true
        }
        trailPoint.set(starts[index].x, starts[index].y, starts[index].z)
        linesGroup.worldToLocal(target.mesh.localToWorld(trailPoint))
        trailStart.set(trailPoint.x, trailPoint.y, trailPoint.z, starts[index].w)
        trailPoint.set(ends[index].x, ends[index].y, ends[index].z)
        linesGroup.worldToLocal(target.mesh.localToWorld(trailPoint))
        trailEnd.set(trailPoint.x, trailPoint.y, trailPoint.z, ends[index].w)
        for (let anchor = 0; anchor < layout.anchorCount; anchor += 1) {
          sampleSegment(
            frame.positions[anchor * 3],
            frame.positions[anchor * 3 + 1],
            frame.positions[anchor * 3 + 2],
            trailStart,
            trailEnd,
            now,
            trailSample,
          )
          glow[anchor] = Math.max(
            glow[anchor],
            cageStrength(trailSample.reach, trailSample.age, current.reducedMotion),
          )
        }
      }
    }

    // Lines ease towards joined or let go; each is packed into the buffers
    // only while it shows. Both ends take the fainter anchor's fade, so a
    // line is gone before either end wraps, and each end its own on top.
    const ease = 1 - Math.exp(-lineStyle.linkEase * frameDelta)
    const positions = network.linePositions.array
    const colors = network.lineColors.array
    const anchors = frame.positions
    let drawn = 0
    for (let candidate = 0; candidate < layout.candidateCount; candidate += 1) {
      levels[candidate] += (frame.linked[candidate] - levels[candidate]) * ease
      const from = layout.candidates[candidate * 2]
      const to = layout.candidates[candidate * 2 + 1]
      const shared = levels[candidate] * frame.strength[candidate] * Math.min(frame.fades[from], frame.fades[to])
      if (shared < 0.002) continue
      const vertex = drawn * 6
      for (let axis = 0; axis < 3; axis += 1) {
        positions[vertex + axis] = anchors[from * 3 + axis]
        positions[vertex + 3 + axis] = anchors[to * 3 + axis]
      }
      // Above 1 on purpose: a glowing end is pushed into the bloom.
      const fromGlow = 1 + glow[from] * cageGlowBoost
      const toGlow = 1 + glow[to] * cageGlowBoost
      colors[drawn * 8] = fromGlow
      colors[drawn * 8 + 1] = fromGlow
      colors[drawn * 8 + 2] = fromGlow
      colors[drawn * 8 + 3] = Math.min(shared * (0.4 + 0.6 * frame.fades[from]) * (1 + glow[from]), 1)
      colors[drawn * 8 + 4] = toGlow
      colors[drawn * 8 + 5] = toGlow
      colors[drawn * 8 + 6] = toGlow
      colors[drawn * 8 + 7] = Math.min(shared * (0.4 + 0.6 * frame.fades[to]) * (1 + glow[to]), 1)
      drawn += 1
    }
    network.lineGeometry.setDrawRange(0, drawn * 2)
    // Three buffer attributes are mutable render-loop state by design.
    // oxlint-disable-next-line react/immutability
    network.linePositions.needsUpdate = true
    network.lineColors.needsUpdate = true

    const markerColors = network.markerColors.array
    for (let anchor = 0; anchor < layout.anchorCount; anchor += 1) {
      const bright = 1 + glow[anchor] * cageGlowBoost
      markerColors[anchor * 4] = bright
      markerColors[anchor * 4 + 1] = bright
      markerColors[anchor * 4 + 2] = bright
      markerColors[anchor * 4 + 3] = frame.fades[anchor]
    }
    network.markerPositions.needsUpdate = true
    network.markerColors.needsUpdate = true
  })

  return (
    <>
      <primitive object={lightTarget} />
      <directionalLight
        ref={key}
        name="Second scene key light"
        color={secondSceneLights.key.color}
        intensity={0}
        position={keyOffset}
        target={lightTarget}
        castShadow
        shadow-mapSize-width={secondSceneLights.shadow.mapSize}
        shadow-mapSize-height={secondSceneLights.shadow.mapSize}
        shadow-camera-left={-secondSceneLights.shadow.halfExtent}
        shadow-camera-right={secondSceneLights.shadow.halfExtent}
        shadow-camera-top={secondSceneLights.shadow.halfExtent}
        shadow-camera-bottom={-secondSceneLights.shadow.halfExtent}
        shadow-camera-near={keyDistance - secondSceneLights.shadow.depthRange}
        shadow-camera-far={keyDistance + secondSceneLights.shadow.depthRange}
        shadow-bias={secondSceneLights.shadow.bias}
        shadow-normalBias={secondSceneLights.shadow.normalBias}
        shadow-radius={secondSceneLights.shadow.radius}
      />
      <directionalLight
        ref={rim}
        name="Second scene rim light"
        color={secondSceneLights.rim.color}
        intensity={0}
        position={rimOffset}
        target={lightTarget}
      />
      <hemisphereLight
        ref={fill}
        name="Second scene fill"
        color={secondSceneLights.fill.skyColor}
        groundColor={secondSceneLights.fill.groundColor}
        intensity={0}
      />
      <group ref={rootRef} name="Second scene">
        <group ref={rig} name="Shard rig">
          <group ref={lean}>
            <group ref={spin}>
              {/* The GLB's mesh with the code-built sandstone material: one draw
                  call. The columns slide in its vertex shader (see columnRipple). */}
              <primitive object={shard} position={shardOffset} />
            </group>
          </group>
          <group ref={lines} name="Shard line network">
            <lineSegments geometry={network.lineGeometry} material={network.lineMaterial} />
            <points geometry={network.markerGeometry} material={network.markerMaterial} />
          </group>
        </group>
      </group>
    </>
  )
}

useGLTF.preload(shardModelUrl)
