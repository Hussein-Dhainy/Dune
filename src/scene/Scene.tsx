import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, MathUtils, Object3D, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import type { Group, Material, Mesh, PointLight } from 'three'
import type { LightingSettings } from './lighting'
import { applyRevealShader, createRevealUniforms } from './reveal'
import type { RevealUniforms } from './reveal'
import { useLoopScroll } from '../experience/useLoopScroll'
import { SandWind } from './SandWind'
import { applyPyramidGlowShader, createPyramidGlowUniforms } from './pyramidGlow'

const pyramidModelUrl = '/models/pyramid.glb?v=separate-blocks-1'
const terrainModelUrl = '/models/desert-terrain.glb?v=groundsand-1'
const revealDuration = 10
const pyramidPulsePeriod = 5.6
const pyramidPulseDuration = 1.9
const pyramidPulseTravel = 2.35
const pyramidHoverInnerRadius = 0.45
const pyramidHoverOuterRadius = 1.6
const pyramidHoverStrength = 0.65
const pyramidHoverDamping = 11

type AnimatedPyramidBlock = {
  mesh: Mesh
  position: Vector3
  quaternion: Quaternion
  direction: Vector3
  rotationAxis: Vector3
  delay: number
  distance: number
  height: number
  hoverPosition: Vector3
  hover: number
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

function Pyramid({ reveal, rootRef, lighting, exteriorLightPosition }: {
  reveal: RevealUniforms
  rootRef: React.RefObject<Group | null>
  lighting: LightingSettings
  exteriorLightPosition: Vector3
}) {
  const { scene } = useGLTF(pyramidModelUrl)
  const { state } = useLoopScroll()
  const glow = useMemo(() => createPyramidGlowUniforms(), [])
  const wireframes = useRef<LineBasicMaterial[]>([])
  const blocks = useRef<AnimatedPyramidBlock[]>([])
  const raycastTargets = useRef<Mesh[]>([])
  const hoverPoint = useRef(new Vector3())
  const hoverActive = useRef(false)
  const pulseElapsed = useRef(0)
  const rotationDelta = useRef(new Quaternion())
  const coreLight = useRef<PointLight>(null)
  const raycaster = useMemo(() => new Raycaster(), [])
  const pointer = useMemo(() => new Vector2(), [])
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)

  useLayoutEffect(() => {
    coreLight.current?.getWorldPosition(glow.origin.value)
  }, [glow])

  useEffect(() => {
    glow.color.value.set(lighting.coreColor)
    glow.exteriorColor.value.set(lighting.exteriorColor)
    glow.exteriorPosition.value.copy(exteriorLightPosition)
    // Shared shader uniforms are mutable render state by design.
    // oxlint-disable-next-line react/immutability
    glow.exteriorRimStrength.value = lighting.exteriorRimStrength
  }, [glow, exteriorLightPosition, lighting.coreColor, lighting.exteriorColor, lighting.exteriorRimStrength])

  useEffect(() => {
    const materials = prepareRevealMaterials(
      scene,
      reveal,
      (material) => applyPyramidGlowShader(material, glow),
    )
    const edges: LineSegments[] = []
    const animatedBlocks: AnimatedPyramidBlock[] = []
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

        const position = mesh.position.clone()
        const hoverPosition = bounds.getCenter(new Vector3())
        mesh.updateWorldMatrix(true, false)
        hoverPosition.applyMatrix4(mesh.matrixWorld)
        scene.worldToLocal(hoverPosition)
        const height = MathUtils.clamp(position.y / 3.4, 0, 1)
        const direction = new Vector3(
          position.x,
          0.45 + height * 1.35,
          position.z,
        ).normalize()
        const nameSeed = [...mesh.name].reduce((sum, character) => sum + character.charCodeAt(0), 0)
        const rotationAxis = new Vector3(
          Math.sin(nameSeed * 1.7),
          0.35,
          Math.cos(nameSeed * 2.3),
        ).normalize()
        animatedBlocks.push({
          mesh,
          position,
          quaternion: mesh.quaternion.clone(),
          direction,
          rotationAxis,
          delay: MathUtils.mapLinear(position.x, -3.5, 3.5, 0, pyramidPulseTravel),
          distance: MathUtils.lerp(0.72, 1.05, height),
          height,
          hoverPosition,
          hover: 0,
        })
      }
    })
    blocks.current = animatedBlocks
    raycastTargets.current = animatedBlocks.map((block) => block.mesh)
    return () => {
      for (const block of animatedBlocks) {
        block.mesh.position.copy(block.position)
        block.mesh.quaternion.copy(block.quaternion)
      }
      blocks.current = []
      raycastTargets.current = []
      for (const lines of edges) {
        lines.removeFromParent()
        lines.geometry.dispose()
        ;(lines.material as Material).dispose()
      }
      wireframes.current = []
      for (const material of materials) material.dispose()
    }
  }, [scene, reveal, glow])

  useEffect(() => {
    const clearHover = () => { hoverActive.current = false }
    const updateHover = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || state.current.phase !== 'interactive') {
        clearHover()
        return
      }

      const bounds = gl.domElement.getBoundingClientRect()
      if (
        event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom
      ) {
        clearHover()
        return
      }

      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(raycastTargets.current, false)[0]
      if (!hit) {
        clearHover()
        return
      }

      hoverPoint.current.copy(hit.point)
      scene.worldToLocal(hoverPoint.current)
      hoverActive.current = true
    }

    window.addEventListener('pointermove', updateHover, { passive: true })
    window.addEventListener('pointerleave', clearHover)
    window.addEventListener('blur', clearHover)
    return () => {
      window.removeEventListener('pointermove', updateHover)
      window.removeEventListener('pointerleave', clearHover)
      window.removeEventListener('blur', clearHover)
    }
  }, [camera, gl, pointer, raycaster, scene, state])

  useFrame((_, delta) => {
    const progress = reveal.timeline.value
    const fadeIn = MathUtils.smoothstep(progress, 0, 0.12)
    const fadeOut = 1 - MathUtils.smoothstep(progress, 0.72, 1)
    const opacity = Math.min(fadeIn, fadeOut)
    // Three material uniforms are mutable render-loop state by design.
    // oxlint-disable-next-line react/immutability
    for (const material of wireframes.current) material.opacity = opacity

    const motionVisibility = state.current.reducedMotion
      ? 0
      : MathUtils.smootherstep(progress, 0.82, 1)
    if (motionVisibility > 0) pulseElapsed.current += Math.min(delta, 0.1)

    let strongestPulse = 0
    let combinedPulse = 0
    const rotation = rotationDelta.current
    for (const block of blocks.current) {
      const phase = MathUtils.euclideanModulo(
        pulseElapsed.current - block.delay,
        pyramidPulsePeriod,
      )
      const pulse = phase < pyramidPulseDuration
        ? Math.sin(Math.PI * phase / pyramidPulseDuration) ** 2 * motionVisibility
        : 0
      const hoverTarget = hoverActive.current && !state.current.reducedMotion
        ? (1 - MathUtils.smootherstep(
            block.hoverPosition.distanceTo(hoverPoint.current),
            pyramidHoverInnerRadius,
            pyramidHoverOuterRadius,
          )) * pyramidHoverStrength * motionVisibility
        : 0
      // Per-block interaction strength is mutable render-loop state by design.
      // oxlint-disable-next-line react/immutability
      block.hover = MathUtils.damp(block.hover, hoverTarget, pyramidHoverDamping, delta)
      const activePulse = 1 - (1 - pulse) * (1 - block.hover)
      strongestPulse = Math.max(strongestPulse, activePulse)
      combinedPulse += activePulse
      const layerInfluence = MathUtils.smootherstep(block.height, 0.08, 0.55)
      const movementScale = MathUtils.lerp(lighting.baseMovement, 1, layerInfluence)
      block.mesh.position.copy(block.position).addScaledVector(
        block.direction,
        block.distance * activePulse * movementScale,
      )
      rotation.setFromAxisAngle(block.rotationAxis, activePulse * 0.075)
      block.mesh.quaternion.copy(block.quaternion).multiply(rotation)
    }

    const glowVisibility = MathUtils.smootherstep(progress, 0.7, 1)
    const averagePulse = combinedPulse / Math.max(blocks.current.length, 1)
    const pulseEnergy = MathUtils.clamp(
      strongestPulse * 0.35 + averagePulse * 3.4 * 0.65,
      0,
      1,
    )
    if (coreLight.current) {
      // Three light intensity is mutable render-loop state by design.
      // oxlint-disable-next-line react/immutability
      coreLight.current.intensity = glowVisibility * (
        lighting.coreLightBase + pulseEnergy * lighting.coreLightPulse
      )
    }
    // Shared shader uniforms are mutable render-loop state by design.
    // oxlint-disable-next-line react/immutability
    glow.intensity.value = glowVisibility
      * lighting.innerGlowStrength
      * (0.06 + pulseEnergy * 0.94)
    // oxlint-disable-next-line react/immutability
    glow.rimStrength.value = lighting.rimStrength
  })

  return (
    <group ref={rootRef} scale={0.9}>
      <pointLight
        ref={coreLight}
        position={[0, 1.55, 0]}
        color={lighting.coreColor}
        intensity={0}
        distance={10}
        decay={2}
      />
      <primitive object={scene} />
    </group>
  )
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
  const viewportWidth = useThree((state) => state.size.width)
  const { state } = useLoopScroll()
  const reveal = useMemo(() => createRevealUniforms(), [])
  const revealElapsed = useRef(0)
  const pyramidRoot = useRef<Group>(null)
  const terrainRoot = useRef<Group>(null)
  const exteriorTarget = useMemo(() => {
    const target = new Object3D()
    target.name = 'Exterior pyramid light target'
    target.position.set(0, 0.65, 0.65)
    return target
  }, [])
  const azimuth = lighting.sunAzimuth * Math.PI / 180
  const elevation = lighting.sunElevation * Math.PI / 180
  const distance = 20
  const sunPosition: [number, number, number] = [
    Math.cos(elevation) * Math.cos(azimuth) * distance,
    Math.sin(elevation) * distance,
    Math.cos(elevation) * Math.sin(azimuth) * distance,
  ]
  const exteriorAzimuth = lighting.exteriorAzimuth * Math.PI / 180
  const exteriorElevation = lighting.exteriorElevation * Math.PI / 180
  const exteriorLightPosition = useMemo(() => new Vector3(
    Math.cos(exteriorElevation) * Math.cos(exteriorAzimuth) * lighting.exteriorRadius,
    Math.sin(exteriorElevation) * lighting.exteriorRadius,
    0.65 + Math.cos(exteriorElevation) * Math.sin(exteriorAzimuth) * lighting.exteriorRadius,
  ), [exteriorAzimuth, exteriorElevation, lighting.exteriorRadius])
  const exteriorShadowSize = viewportWidth < 600 ? 512 : 1024

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
        castShadow={false}
      />
      <primitive object={exteriorTarget} />
      <spotLight
        name="Exterior pyramid key light"
        position={exteriorLightPosition}
        target={exteriorTarget}
        color={lighting.exteriorColor}
        intensity={lighting.exteriorIntensity}
        angle={lighting.exteriorAngle}
        penumbra={lighting.exteriorPenumbra}
        distance={lighting.exteriorDistance}
        decay={2}
        castShadow={lighting.shadows}
        shadow-mapSize-width={exteriorShadowSize}
        shadow-mapSize-height={exteriorShadowSize}
        shadow-camera-near={2}
        shadow-camera-far={lighting.exteriorDistance}
        shadow-bias={-0.0002}
        shadow-normalBias={0.035}
      />
      <Terrain reveal={reveal} rootRef={terrainRoot} />
      <SandWind reveal={reveal} />
      <group name="landmarks" position={[0, 0.05, 0.65]}>
        <Pyramid
          reveal={reveal}
          rootRef={pyramidRoot}
          lighting={lighting}
          exteriorLightPosition={exteriorLightPosition}
        />
      </group>
    </>
  )
}

useGLTF.preload(pyramidModelUrl)
useGLTF.preload(terrainModelUrl)
