import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, Vector2, Vector3, Vector4 } from 'three'
import type { Group } from 'three'
import type { LightingSettings } from '../lighting'
import { useLoopScroll } from '../../experience/useLoopScroll'
import type { AtmosphereUniforms } from './desertAtmosphereShaders'
import { DesertSky } from './DesertSky'
import { WindblownSand } from './WindblownSand'
import type { GroundUniforms } from './WindblownSand'
import { bakeGroundHeight } from './groundHeight'
import { duneBackdropFor } from './sectionBackdrops'
import type { QualityProfile } from './quality'

// Wind travel wraps here to keep shader float precision; at breeze speed that
// is once every ~1.5 hours, and costs a single reshuffle of the grains.
const windWrap = 20_000
// Under prefers-reduced-motion the sand and sky bands drift at this share of
// their normal speed rather than stopping, so the scene does not look broken.
const reducedMotionScale = 0.2
const cameraForward = new Vector3()

/**
 * Sky, haze and airborne sand. Owns the per-frame atmosphere uniforms; the
 * haze itself is patched into the terrain and pyramid materials by Scene, via
 * applyAtmosphereFog, against the same uniforms.
 */
export function DesertAtmosphere({ atmosphere, lighting, profile, terrainRoot }: {
  atmosphere: AtmosphereUniforms
  lighting: LightingSettings
  profile: QualityProfile
  terrainRoot: React.RefObject<Group | null>
}) {
  const { state } = useLoopScroll()
  const bakedGroundRange = useRef<{ x: number; y: number } | null>(null)
  const groundSection = useRef(0)
  const ground = useMemo<GroundUniforms>(() => ({
    uGroundHeight: { value: null },
    uGroundBounds: { value: new Vector4() },
    uGroundRange: { value: new Vector2() },
  }), [])

  // Runs after Terrain's commit (it is rendered first), so the loaded glTF is
  // already in the terrain group.
  useLayoutEffect(() => {
    const root = terrainRoot.current
    if (!root) return
    const field = bakeGroundHeight(root)
    // Shared uniform values are written in place, without React renders.
    // oxlint-disable-next-line react/immutability
    ground.uGroundHeight.value = field.texture
    ground.uGroundBounds.value.copy(field.bounds)
    ground.uGroundRange.value.set(field.range.x, field.range.y)
    bakedGroundRange.current = field.range
    return () => {
      bakedGroundRange.current = null
      ground.uGroundHeight.value = null
      field.texture.dispose()
    }
  }, [terrainRoot, ground])

  useEffect(() => {
    // The sky's sun is the directional light's: it targets the origin, so its
    // position is also its direction.
    // oxlint-disable-next-line react/immutability
    atmosphere.uSunDirection.value
      .set(lighting.sunPositionX, lighting.sunPositionY, lighting.sunPositionZ)
      .normalize()
    atmosphere.uSunColor.value.set(lighting.sunColor)
    atmosphere.uHorizonColor.value.set(lighting.hazeHorizonColor)
    atmosphere.uMidColor.value.set(lighting.hazeMidColor)
    atmosphere.uZenithColor.value.set(lighting.hazeZenithColor)
    // oxlint-disable-next-line react/immutability
    atmosphere.uFogNear.value = lighting.fogNear
    atmosphere.uFogDensity.value = lighting.fogDensity
    atmosphere.uStormTint.value.set(lighting.stormTintColor)
    atmosphere.uStormTintAmount.value = lighting.stormTintAmount
  }, [
    atmosphere,
    lighting.sunPositionX,
    lighting.sunPositionY,
    lighting.sunPositionZ,
    lighting.sunColor,
    lighting.hazeHorizonColor,
    lighting.hazeMidColor,
    lighting.hazeZenithColor,
    lighting.fogNear,
    lighting.fogDensity,
    lighting.stormTintColor,
    lighting.stormTintAmount,
  ])

  useFrame(({ camera }, delta) => {
    // rAF is already throttled in background tabs; this also stops the clock
    // from jumping when the tab returns.
    if (document.hidden) return
    const transition = state.current.transition
    // The transition's wind rides on top of the resting breeze, never below it.
    // oxlint-disable-next-line react/immutability
    atmosphere.uStorm.value = lighting.storm + (1 - lighting.storm) * transition.storm * 0.85

    // The baked dunes only exist in the pyramid scene; elsewhere the sand
    // rides a flat plain at y = 0.
    const section = state.current.phase === 'interactive' ? transition.activeSection : 0
    if (section !== groundSection.current && bakedGroundRange.current) {
      groundSection.current = section
      if (section === 0) ground.uGroundRange.value.set(bakedGroundRange.current.x, bakedGroundRange.current.y)
      else ground.uGroundRange.value.set(0, 0)
    }
    // Flips at the scene switch, which only happens under full cloud cover.
    atmosphere.uDuneBackdrop.value = duneBackdropFor(section)

    const motion = state.current.reducedMotion ? reducedMotionScale : 1
    const step = Math.min(delta, 0.1) * motion
    // oxlint-disable-next-line react/immutability
    atmosphere.uTime.value += step
    const windSpeed = MathUtils.lerp(3.5, 12, atmosphere.uStorm.value)
    atmosphere.uWind.value = (atmosphere.uWind.value + step * windSpeed) % windWrap

    // Horizontal look direction. Straight down (the intro's first pose) has
    // none, so the previous one is kept.
    camera.getWorldDirection(cameraForward)
    const length = Math.hypot(cameraForward.x, cameraForward.z)
    if (length > 0.05) {
      atmosphere.uCameraForward.value.set(cameraForward.x / length, cameraForward.z / length)
    }
  })

  return (
    <>
      <DesertSky atmosphere={atmosphere} detailedNoise={profile.detailedNoise} />
      <WindblownSand
        atmosphere={atmosphere}
        ground={ground}
        airGrains={profile.airGrains}
        groundGrains={profile.groundGrains}
        detailedNoise={profile.detailedNoise}
      />
    </>
  )
}
