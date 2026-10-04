import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, ShaderMaterial } from 'three'
import type { Points } from 'three'
import type { AtmosphereUniforms } from '../atmosphere/desertAtmosphereShaders'
import { useLoopScroll } from '../../experience/useLoopScroll'
import { stormParticleFragment, stormParticleVertex } from './transitionShaders'

const reducedMotionTimeScale = 0.2

// Deterministic seeds, like the ambient sand.
function createStormGeometry(count: number) {
  let state = 91373
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  const seeds = new Float32Array(count * 3)
  const tones = new Float32Array(count)
  for (let index = 0; index < seeds.length; index += 1) seeds[index] = random()
  for (let index = 0; index < count; index += 1) tones[index] = random()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(seeds, 3))
  geometry.setAttribute('aTone', new BufferAttribute(tones, 1))
  return geometry
}

/**
 * The transition's own sand, separate from the ambient layers: one Points draw
 * of grains rushing up and across the lens with the rising cloud. Invisible,
 * and so skipped by the renderer, whenever no storm is on screen.
 */
export function SandstormTransition({ atmosphere, count, detailed }: {
  atmosphere: AtmosphereUniforms
  count: number
  detailed: boolean
}) {
  const { state } = useLoopScroll()
  const points = useRef<Points>(null)
  const height = useThree((root) => root.size.height)
  const dpr = useThree((root) => root.viewport.dpr)
  const geometry = useMemo(() => createStormGeometry(count), [count])
  const material = useMemo(() => new ShaderMaterial({
    name: 'Sandstorm transition grains',
    uniforms: {
      ...atmosphere,
      uStormTime: { value: 0 },
      uCloudTop: { value: -1 },
      uCloudTilt: { value: 0 },
      uCloudBottom: { value: -1 },
      uDensity: { value: 0 },
      uViewportHeight: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: stormParticleVertex,
    fragmentShader: stormParticleFragment,
    defines: detailed ? { DETAILED_STORM: '' } : {},
    transparent: true,
    depthWrite: false,
    // In front of everything: these are grains between the lens and the scene.
    depthTest: false,
  }), [atmosphere, detailed])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    // oxlint-disable-next-line react/immutability
    material.uniforms.uViewportHeight.value = height * dpr
    material.uniforms.uPixelRatio.value = dpr
  }, [material, height, dpr])

  useFrame((_, delta) => {
    const object = points.current
    if (!object) return
    const transition = state.current.transition
    const density = transition.cloudDensity
    object.visible = density > 0.001
    if (!object.visible) return
    const uniforms = material.uniforms
    if (!document.hidden) {
      // Shader uniforms advance without React renders.
      // oxlint-disable-next-line react/immutability
      uniforms.uStormTime.value += Math.min(delta, 0.1) * (state.current.reducedMotion ? reducedMotionTimeScale : 1)
    }
    uniforms.uCloudTop.value = transition.cloudTop
    uniforms.uCloudTilt.value = transition.cloudTilt
    uniforms.uCloudBottom.value = transition.cloudBottom
    uniforms.uDensity.value = density
  })

  // Positions are built in view space in the shader, so the seed cube's
  // bounds say nothing about where the grains are.
  return (
    <points
      ref={points}
      name="Sandstorm transition grains"
      geometry={geometry}
      material={material}
      renderOrder={10}
      frustumCulled={false}
    />
  )
}
