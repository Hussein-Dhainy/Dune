import { useMemo } from 'react'
import { buildTerrainGeometry } from './terrainGeometry'
import { defaultDuneSettings } from './heightField'
import type { DuneSettings } from './heightField'

// Temporary: zeroes every height contribution so the mesh is a true flat
// plane for baseline comparison. Flip back to false to restore the dunes.
const flattenForComparison = true
const flatSettings: DuneSettings = {
  ...defaultDuneSettings,
  amplitude: 0,
  rippleAmplitude: 0,
  horizonRise: 0,
}

/** Builds the displaced dune grid once per segment count and keeps it alive
 *  for the lifetime of the scene. */
export function useTerrain(segments = 288) {
  return useMemo(
    () => buildTerrainGeometry(segments, flattenForComparison ? flatSettings : undefined),
    [segments],
  )
}
