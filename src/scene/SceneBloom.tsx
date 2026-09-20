import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector2 } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { useLoopScroll } from '../experience/useLoopScroll'
import type { LightingSettings } from './lighting'

export function SceneBloom({ lighting }: { lighting: LightingSettings }) {
  const gl = useThree((root) => root.gl)
  const scene = useThree((root) => root.scene)
  const camera = useThree((root) => root.camera)
  const width = useThree((root) => root.size.width)
  const height = useThree((root) => root.size.height)
  const { state } = useLoopScroll()
  const postprocessing = useMemo(() => {
    const composer = new EffectComposer(gl)
    const renderPass = new RenderPass(scene, camera)
    const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0, 0.38, 0.88)
    const outputPass = new OutputPass()
    composer.addPass(renderPass)
    composer.addPass(bloomPass)
    composer.addPass(outputPass)
    return { composer, bloomPass }
  }, [camera, gl, scene])

  useEffect(() => {
    const maximumPixelRatio = width < 600 ? 1.25 : 1.5
    postprocessing.composer.setPixelRatio(Math.min(gl.getPixelRatio(), maximumPixelRatio))
    postprocessing.composer.setSize(width, height)
  }, [gl, height, postprocessing, width])

  useEffect(() => () => {
    postprocessing.bloomPass.dispose()
    postprocessing.composer.dispose()
  }, [postprocessing])

  useFrame(() => {
    // Post-processing pass settings are mutable render-loop state by design.
    // oxlint-disable-next-line react/immutability
    postprocessing.bloomPass.enabled = !state.current.reducedMotion
    // oxlint-disable-next-line react/immutability
    postprocessing.bloomPass.strength = lighting.bloomStrength * (width < 600 ? 0.82 : 1)
    // oxlint-disable-next-line react/immutability
    postprocessing.bloomPass.radius = lighting.bloomRadius
    // oxlint-disable-next-line react/immutability
    postprocessing.bloomPass.threshold = lighting.bloomThreshold
    postprocessing.composer.render()
  }, 1)

  return null
}
