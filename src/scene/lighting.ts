export type LightingSettings = {
  background: string
  fogColor: string
  fogDensity: number
  ambientColor: string
  ambientIntensity: number
  sunColor: string
  sunIntensity: number
  sunPositionX: number
  sunPositionY: number
  sunPositionZ: number
  skyColor: string
  groundColor: string
  hemisphereIntensity: number
  exposure: number
  /** Not a light: scales how far pyramid blocks drift on their pulse animation. */
  baseMovement: number
}

export const defaultLighting: LightingSettings = {
  background: '#c2a78e',
  fogColor: '#bda087',
  fogDensity: 0.0034,
  ambientColor: '#ded1c3',
  ambientIntensity: 0.06,
  sunColor: '#ffe1b8',
  sunIntensity: 3.2,
  sunPositionX: 20,
  sunPositionY: 18,
  sunPositionZ: 10,
  skyColor: '#dfcbb7',
  groundColor: '#765d4b',
  hemisphereIntensity: 0.38,
  exposure: 0.95,
  baseMovement: 0.12,
}
