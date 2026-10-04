export type LightingSettings = {
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
  /** Not a light: scales how far the pyramid's bottom course drifts on pulse and hover. */
  baseMovement: number
  /** Not a light: reach of the hover lift around the cursor, in pyramid units. */
  hoverRadius: number
  /** How far hovered blocks lift, as a share of a full pulse. */
  hoverStrength: number
  /** Easing rate for blocks moving towards their hover target. */
  hoverEase: number
  /** Light trapped inside the pyramid, escaping through the block seams. */
  glowColor: string
  glowSeamIntensity: number
  glowSeamWidth: number
  glowCoreIntensity: number
  glowPulseBoost: number
  bloomIntensity: number
  /** Scene luminance (before tone mapping) above which pixels bloom. */
  bloomThreshold: number
  bloomSmoothing: number
  /** Sky and haze: bright sand at the horizon, darkening to brown overhead.
   *  Distant terrain fades into exactly this sky, so there is no seam. */
  hazeHorizonColor: string
  hazeMidColor: string
  hazeZenithColor: string
  /** Distance with no haze at all; keep it beyond the pyramid. */
  fogNear: number
  /** Exponential-squared haze density per world unit beyond fogNear. */
  fogDensity: number
  /** 0 calm .. 1 sandstorm: thickens haze and sand without recompiling. */
  storm: number
  /** Grade of the transition cloud and of fog-backdrop scenes: the dust tones
   *  are pulled this far (0..1) towards stormTintColor. 0 is pure desert
   *  sand; 1 is the tint itself, e.g. a muted icy blue-grey. */
  stormTintColor: string
  stormTintAmount: number
}

export const defaultLighting: LightingSettings = {
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
  hoverRadius: 3,
  hoverStrength: 1,
  hoverEase: 6.5,
  glowColor: '#ffcf6b',
  glowSeamIntensity: 0.4,
  glowSeamWidth: 0.7,
  glowCoreIntensity: 2.1,
  glowPulseBoost: 1.8,
  bloomIntensity: 0.9,
  bloomThreshold: 1,
  bloomSmoothing: 0.3,
  hazeHorizonColor: '#e3cdad',
  hazeMidColor: '#c6a684',
  hazeZenithColor: '#6e4e37',
  fogNear: 30,
  fogDensity: 0.009,
  storm: 0.15,
  stormTintColor: '#a9b3c1',
  stormTintAmount: 0.35,
}
