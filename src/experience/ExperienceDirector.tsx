import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils } from 'three'
import type { PerspectiveCamera } from 'three'
import { gsap } from 'gsap'
import { useProgress } from '@react-three/drei'
import { baseFov, cameraPoses, introPose, mixPose, orbitPose, pointerOrbit, sectionPointerOrbit, transitionCamera } from './cameraPath'
import { sampleCycle, scrollConfig, smoothPosition } from './cycle'
import { sampleTransition } from './transitionTimeline'
import { useLoopScroll } from './useLoopScroll'

const introDuration = 3.2

export function ExperienceDirector({ cameraDebugEnabled = false }: { cameraDebugEnabled?: boolean }) {
  const { state, setPhase, finishIntro } = useLoopScroll()
  const scene = useThree((root) => root.scene)
  const gl = useThree((root) => root.gl)
  const camera = useThree((root) => root.camera)
  const assetsActive = useProgress((progress) => progress.active)
  const intro = useRef<gsap.core.Timeline | null>(null)
  // Mouse position, -1 to 1 from left to right and bottom to top; centred
  // when the mouse is away. Only real mice count, since touch drags scroll.
  const pointerX = useRef(0)
  const pointerY = useRef(0)
  const orbitYaw = useRef(0)
  const orbitPitch = useRef(0)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      pointerX.current = MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1)
      pointerY.current = MathUtils.clamp(1 - (event.clientY / window.innerHeight) * 2, -1, 1)
    }
    const reset = () => {
      pointerX.current = 0
      pointerY.current = 0
    }
    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) reset()
    }
    window.addEventListener('pointermove', move)
    document.addEventListener('mouseout', leave)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('mouseout', leave)
      window.removeEventListener('blur', reset)
    }
  }, [])

  useEffect(() => {
    const entrance = gsap.timeline({ paused: true })
      .to(state.current, { introProgress: 1, duration: introDuration, ease: 'none' })
    intro.current = entrance
    return () => {
      entrance.kill()
      intro.current = null
    }
  }, [state])

  useEffect(() => {
    if (assetsActive || state.current.phase !== 'loading') return
    let disposed = false
    // Warm up the actual scene shaders before leaving the loading phase.
    gl.compileAsync(scene, camera).then(() => {
      if (disposed) return
      setPhase('intro')
    }).catch((error: unknown) => {
      console.error('Shader warmup failed; continuing with on-demand compilation.', error)
      if (!disposed) setPhase('intro')
    })
    return () => {
      disposed = true
    }
  }, [assetsActive, scene, gl, camera, state, setPhase])

  const introElapsed = useRef(0)
  useFrame(({ camera }, delta) => {
    if (cameraDebugEnabled) return
    const current = state.current
    let fov = baseFov
    if (current.phase === 'intro') {
      introElapsed.current += Math.min(delta, 0.1)
      intro.current?.time(current.reducedMotion ? introDuration : introElapsed.current)
      const pose = mixPose(introPose, cameraPoses[0], current.introProgress)
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      if (current.introProgress >= 1) finishIntro()
    } else if (current.phase === 'interactive') {
      // R3F animation state intentionally lives in a mutable ref, outside React rendering.
      // oxlint-disable-next-line react/immutability
      current.position = smoothPosition(current.position, current.target, Math.min(delta, 0.1), current.reducedMotion ? 0 : scrollConfig.damping)
      // The single source of truth for the sandstorm: everything else reads
      // current.transition, which is rewritten here before any of them run.
      const transition = sampleTransition(sampleCycle(current.position), current.reducedMotion, current.transition)
      const basePose = transitionCamera(transition, current.reducedMotion)
      fov = basePose.fov
      const orbitDelta = Math.min(delta, 0.1)
      // Pointer parallax fades out with the storm, so it never fights the retreat.
      const orbitWeight = current.reducedMotion
        ? 0
        : transition.interaction * sectionPointerOrbit[transition.activeSection]
      const targetYaw = pointerX.current * pointerOrbit.maxYaw * orbitWeight
      // Moving the mouse up swings the camera up, looking down on the pyramid.
      const targetPitch = pointerY.current * pointerOrbit.maxPitch * orbitWeight
      orbitYaw.current = MathUtils.damp(orbitYaw.current, targetYaw, pointerOrbit.ease, orbitDelta)
      orbitPitch.current = MathUtils.damp(orbitPitch.current, targetPitch, pointerOrbit.ease, orbitDelta)
      const pose = orbitPose(basePose, orbitYaw.current, orbitPitch.current)
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
    } else {
      camera.position.set(...introPose.position)
      camera.lookAt(...introPose.target)
    }
    // Only touch the projection when the lens actually changes.
    const lens = camera as PerspectiveCamera
    if (lens.isPerspectiveCamera && Math.abs(lens.fov - fov) > 1e-4) {
      lens.fov = fov
      lens.updateProjectionMatrix()
    }
    // Negative priority runs before the scene's own callbacks (priority 0), so
    // hover hit-tests, marker projection and the storm all use this frame's
    // camera and transition. It does not take over rendering, which only
    // positive priorities do.
  }, -1)
  return null
}
