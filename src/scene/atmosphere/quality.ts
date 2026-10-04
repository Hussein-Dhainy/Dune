import { useEffect, useState } from 'react'

export type DesertQuality = 'high' | 'low'

/** Everything that differs between the two rendering tiers, in one place. */
export type QualityProfile = {
  /** Canvas DPR range. The composer's passes all scale with it. */
  dpr: [number, number]
  shadowMapSize: number
  /** Airborne grains at full storm; the default breeze draws a share of them. */
  airGrains: number
  /** Streaks sliding along the sand. */
  groundGrains: number
  /** Two noise octaves in the sky bands and a noise eddy on the grains, or none. */
  detailedNoise: boolean
  /** Mip levels of the bloom blur chain (postprocessing defaults to 8). */
  bloomLevels: number
  bloomIntensityScale: number
  /** Sandstorm transition: grains streaming past the lens. */
  stormParticles: number
  /** Zoom-smear taps in the transition pass; 0 turns the smear off. */
  stormRadialSamples: number
  stormCloudOctaves: number
  /** Peak RGB split, in UV per unit of distance from the centre. */
  stormMaxAberration: number
  /** Resolution of the incoming scene's render during the wipe, as a share
   *  of the canvas. It is only on screen while the wipe is moving. */
  incomingScale: number
  /** Rising markers in the second scene's line network. */
  networkAnchors: number
}

export const qualityProfiles: Record<DesertQuality, QualityProfile> = {
  high: {
    dpr: [1, 1.5],
    shadowMapSize: 1024,
    airGrains: 3200,
    groundGrains: 1400,
    detailedNoise: true,
    bloomLevels: 8,
    bloomIntensityScale: 1,
    stormParticles: 1600,
    stormRadialSamples: 5,
    stormCloudOctaves: 4,
    stormMaxAberration: 0.014,
    incomingScale: 1,
    networkAnchors: 34,
  },
  low: {
    dpr: [1, 1.25],
    shadowMapSize: 512,
    airGrains: 1200,
    groundGrains: 500,
    detailedNoise: false,
    bloomLevels: 5,
    bloomIntensityScale: 0.8,
    stormParticles: 800,
    stormRadialSamples: 0,
    stormCloudOctaves: 2,
    stormMaxAberration: 0.007,
    incomingScale: 0.75,
    networkAnchors: 22,
  },
}

// Touch-first devices and small viewports get the cheaper tier. A phone held
// in landscape still reports a coarse pointer, so it stays on the low tier.
const lowQualityQuery = '(pointer: coarse), (max-width: 820px), (max-height: 500px)'

function detectQuality(): DesertQuality {
  if (typeof window === 'undefined') return 'high'
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (memory !== undefined && memory <= 4) return 'low'
  return window.matchMedia(lowQualityQuery).matches ? 'low' : 'high'
}

/** Picks the rendering tier once, and again only if the media query flips
 *  (rotating a tablet, resizing a window across the breakpoint). */
export function useDesertQuality(): DesertQuality {
  const [quality, setQuality] = useState(detectQuality)
  useEffect(() => {
    const query = window.matchMedia(lowQualityQuery)
    const update = () => setQuality(detectQuality())
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return quality
}
