import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { gsap } from 'gsap'
import { useProgress } from '@react-three/drei'
import { cameraPoses, introPose, mixPose, sampleCamera } from './cameraPath'
import { cycleLength, sampleCycle, scrollConfig, sectionStart, sections, smoothPosition } from './cycle'
import { useLoopScroll } from './useLoopScroll'

const introDuration = 3.2

export function ExperienceDirector({ cameraDebugEnabled = false }: { cameraDebugEnabled?: boolean }) {
  const { state, setPhase, finishIntro } = useLoopScroll()
  const scene = useThree((root) => root.scene)
  const gl = useThree((root) => root.gl)
  const camera = useThree((root) => root.camera)
  const assetsActive = useProgress((progress) => progress.active)
  const intro = useRef<gsap.core.Timeline | null>(null)
  const cycle = useRef<gsap.core.Timeline | null>(null)
  const fade = useRef({ value: 0 })

  useEffect(() => {
    const entrance = gsap.timeline({ paused: true })
      .to(state.current, { introProgress: 1, duration: introDuration, ease: 'none' })
    const loop = gsap.timeline({ paused: true })
    for (let index = 0; index < sections.length; index++) {
      const { hold, transition } = sections[index]
      const start = sectionStart(index) + hold
      loop.to(fade.current, { value: 1, duration: transition / 2, ease: 'sine.inOut' }, start)
      loop.to(fade.current, { value: 0, duration: transition / 2, ease: 'sine.inOut' }, start + transition / 2)
    }
    intro.current = entrance
    cycle.current = loop
    return () => {
      entrance.kill()
      loop.kill()
      intro.current = null
      cycle.current = null
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
      const sample = sampleCycle(current.position)
      const pose = current.reducedMotion ? cameraPoses[sample.transition < 0.5 ? sample.index : sample.nextIndex] : sampleCamera(current.position)
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      cycle.current?.time(sample.progress * cycleLength)
    } else {
      camera.position.set(...introPose.position)
      camera.lookAt(...introPose.target)
    }
    // Scrubbed fade is a placeholder for the eventual desert transition shader.
    const veil = document.getElementById('transition-veil')
    if (veil) veil.style.opacity = current.phase === 'interactive' && !current.reducedMotion ? String(fade.current.value) : '0'
  })
  return null
}
