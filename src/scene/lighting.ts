export type LightingSettings = {
  background: string
  fogColor: string
  fogNear: number
  fogFar: number
  ambientColor: string
  ambientIntensity: number
  sunColor: string
  sunIntensity: number
  sunAzimuth: number
  sunElevation: number
  exposure: number
  shadows: boolean
}

export const defaultLighting: LightingSettings = {
  background: '#9e8065',
  fogColor: '#9e8065',
  fogNear: 45,
  fogFar: 190,
  ambientColor: '#ffffff',
  ambientIntensity: 0.8,
  sunColor: '#ffe0ad',
  sunIntensity: 3,
  sunAzimuth: 53,
  sunElevation: 48,
  exposure: 1,
  shadows: true,
}
