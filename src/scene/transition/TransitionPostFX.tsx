import { useContext, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposerContext } from '@react-three/postprocessing'
import type { Effect, Pass } from 'postprocessing'
import { Color, HalfFloatType, PerspectiveCamera, WebGLRenderTarget } from 'three'
import type { Group, Object3D, Texture, Vector2 } from 'three'
import type { AtmosphereUniforms } from '../atmosphere/desertAtmosphereShaders'
import { duneBackdropFor } from '../atmosphere/sectionBackdrops'
import { incomingCamera } from '../../experience/cameraPath'
import type { LightingSettings } from '../lighting'
import type { QualityProfile } from '../atmosphere/quality'
import { useLoopScroll } from '../../experience/useLoopScroll'
import { SandstormEffect, toneMapAces } from './SandstormEffect'

// Frames the storm pass is forced on at start-up, while the loading screen is
// still up, so both render-to-screen variants of the passes are compiled then
// rather than as a hitch on the first scroll into the storm.
const warmupFrames = 3
const reducedMotionTimeScale = 0.2
const dustColor = new Color()
const zenithColor = new Color()
const tintColor = new Color()

type PassWithEffects = Pass & { effects?: Effect[] }

/**
 * Mount inside <EffectComposer>, after SMAA. Being a convolution effect it
 * lands in its own EffectPass, which this component switches on only while
 * the storm is visible - at rest the composer skips it entirely.
 */
export function TransitionPostFX({ quality, lighting, atmosphere, sceneRoots, center = [0.5, 0.5] }: {
  quality: QualityProfile
  lighting: LightingSettings
  atmosphere: AtmosphereUniforms
  /** One root per section; the incoming one is rendered on its own during the wipe. */
  sceneRoots: readonly React.RefObject<Group | null>[]
  /** Where the zoom smear and RGB split radiate from, in UV. The camera
   *  always looks at the landmark, so the screen centre is the default. */
  center?: readonly [number, number]
}) {
  const { composer } = useContext(EffectComposerContext)
  const { state } = useLoopScroll()
  const warmup = useRef(warmupFrames)
  const effect = useMemo(() => new SandstormEffect({
    radialSamples: quality.stormRadialSamples,
    cloudOctaves: quality.stormCloudOctaves,
    detailed: quality.detailedNoise,
    maxAberration: quality.stormMaxAberration,
  }), [quality])
  useEffect(() => () => effect.dispose(), [effect])

  // The incoming scene, rendered through its own camera into its own buffer
  // while the wipe is on screen - the only time two scenes are ever drawn.
  const width = useThree((root) => root.size.width)
  const height = useThree((root) => root.size.height)
  const dpr = useThree((root) => root.viewport.dpr)
  const incomingTarget = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true })
    target.texture.name = 'Incoming scene'
    return target
  }, [])
  const incomingLens = useMemo(() => new PerspectiveCamera(), [])
  const stormGrains = useRef<Object3D | null>(null)
  useEffect(() => () => incomingTarget.dispose(), [incomingTarget])
  useEffect(() => {
    const scale = dpr * quality.incomingScale
    incomingTarget.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
  }, [incomingTarget, width, height, dpr, quality.incomingScale])
  useEffect(() => {
    effect.uniform<Texture | null>('incomingBuffer').value = incomingTarget.texture
    effect.uniform<number>('incomingExposure').value = lighting.exposure
  }, [effect, incomingTarget, lighting.exposure])

  useEffect(() => {
    // The haze palette, tone mapped the way the scene behind it was.
    // Graded towards the storm tint first - the same maths as stormDust() in
    // the sky shader, so the fog backdrop and this cloud stay one colour.
    const exposure = lighting.exposure
    const amount = lighting.stormTintAmount
    const tint = (scale: number) => tintColor.set(lighting.stormTintColor).multiplyScalar(scale)
    toneMapAces(
      dustColor.set(lighting.hazeHorizonColor).lerp(tint(1.1), amount),
      exposure,
      effect.uniform<Color>('dustLight').value,
    )
    toneMapAces(
      dustColor.set(lighting.hazeMidColor).lerp(tint(0.85), amount),
      exposure,
      effect.uniform<Color>('dustMid').value,
    )
    toneMapAces(
      dustColor.set(lighting.hazeMidColor).lerp(zenithColor.set(lighting.hazeZenithColor), 0.35).multiplyScalar(0.7)
        .lerp(tint(0.62), amount),
      exposure,
      effect.uniform<Color>('dustDark').value,
    )
  }, [
    effect,
    lighting.exposure,
    lighting.hazeHorizonColor,
    lighting.hazeMidColor,
    lighting.hazeZenithColor,
    lighting.stormTintColor,
    lighting.stormTintAmount,
  ])

  const [centerX, centerY] = center
  useEffect(() => {
    effect.uniform<Vector2>('center').value.set(centerX, centerY)
  }, [effect, centerX, centerY])

  useFrame(({ gl, scene, camera }, delta) => {
    const transition = state.current.transition
    const showIncoming = transition.incomingVisible && state.current.phase === 'interactive'
    if (showIncoming) {
      // Same projection as the main camera, but the incoming scene's own pose.
      const main = camera as PerspectiveCamera
      const pose = incomingCamera(transition, state.current.reducedMotion)
      incomingLens.position.set(...pose.position)
      incomingLens.lookAt(...pose.target)
      // Camera parameters are mutable render state by design.
      // oxlint-disable-next-line react/immutability
      incomingLens.fov = pose.fov
      incomingLens.aspect = main.aspect
      incomingLens.near = main.near
      incomingLens.far = main.far
      incomingLens.updateProjectionMatrix()
      incomingLens.updateMatrixWorld()

      // Swap which scene root is drawn, and the backdrop it sits against,
      // for this one render only. The storm's lens grains belong to the
      // outgoing side of the edge, so they sit this one out.
      stormGrains.current ??= scene.getObjectByName('Sandstorm transition grains') ?? null
      const grainsVisible = stormGrains.current?.visible ?? false
      if (stormGrains.current) stormGrains.current.visible = false
      for (let index = 0; index < sceneRoots.length; index += 1) {
        const root = sceneRoots[index].current
        // Scene-graph visibility is mutable render state by design.
        // oxlint-disable-next-line react/immutability
        if (root) root.visible = index === transition.nextIndex
      }
      const backdrop = atmosphere.uDuneBackdrop.value
      // oxlint-disable-next-line react/immutability
      atmosphere.uDuneBackdrop.value = duneBackdropFor(transition.nextIndex)

      gl.setRenderTarget(incomingTarget)
      gl.clear()
      gl.render(scene, incomingLens)
      gl.setRenderTarget(null)

      atmosphere.uDuneBackdrop.value = backdrop
      for (let index = 0; index < sceneRoots.length; index += 1) {
        const root = sceneRoots[index].current
        if (root) root.visible = index === transition.activeSection
      }
      if (stormGrains.current) stormGrains.current.visible = grainsVisible
    }
    effect.uniform<number>('incomingActive').value = showIncoming ? 1 : 0

    const time = effect.uniform<number>('stormTime')
    if (!document.hidden) {
      // oxlint-disable-next-line react/immutability
      time.value += Math.min(delta, 0.1) * (state.current.reducedMotion ? reducedMotionTimeScale : 1)
    }
    effect.uniform<number>('cloudTop').value = transition.cloudTop
    effect.uniform<number>('cloudTilt').value = transition.cloudTilt
    effect.uniform<number>('cloudBottom').value = transition.cloudBottom
    effect.uniform<number>('cloudDensity').value = transition.cloudDensity
    effect.uniform<number>('distortion').value = transition.distortion
    effect.uniform<number>('aberration').value = transition.aberration
    effect.uniform<number>('glitch').value = transition.glitch
    // Blocks reshuffle with the scroll and ~2.5 times a second: slow enough
    // to read as slips, never as flicker.
    effect.uniform<number>('blockSeed').value = Math.floor(transition.progress * 40) + Math.floor(time.value * 2.5)

    const active = transition.cloudDensity > 0 || transition.distortion > 0 || transition.aberration > 0
      || transition.glitch > 0
      || showIncoming
      || warmup.current > 0
    if (warmup.current > 0) warmup.current -= 1

    // Find this effect's pass and the pass before it. Three or four passes,
    // no allocation; the composer may have rebuilt them since last frame.
    const passes = composer.passes as PassWithEffects[]
    let stormPass: PassWithEffects | null = null
    let previous: PassWithEffects | null = null
    for (let index = 0; index < passes.length; index += 1) {
      if (passes[index].effects?.includes(effect)) {
        stormPass = passes[index]
        previous = index > 0 ? passes[index - 1] : null
        break
      }
    }
    if (!stormPass || !previous || stormPass.enabled === active) return
    // A disabled last pass would leave nothing drawing to the screen, so the
    // screen output moves to the pass before it and back again. Composer
    // passes are mutable render state by design.
    // oxlint-disable-next-line react/immutability
    stormPass.enabled = active
    stormPass.renderToScreen = active
    previous.renderToScreen = !active
  })

  return <primitive object={effect} dispose={null} />
}
