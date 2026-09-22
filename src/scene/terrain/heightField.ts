// Procedural dune height field.
//
// The shape is authored here in TypeScript rather than in GLSL so that the
// renderer and the CPU-side scatter logic can never disagree about where the
// sand is: terrainGeometry.ts displaces the mesh with this function and the prop
// scatter samples the very same one.
//
// The model is a transverse dune field. Everything is expressed relative to a
// wind axis, because that directionality is what separates a dune from a hill:
// crests elongate across the wind, and each dune has a long windward ramp
// ending in a sharp brink with a short slip face on the lee side.

export type DuneSettings = {
  /** World size of the sampled region. */
  extent: number
  /** Prevailing wind direction in degrees. Crests run perpendicular to it. */
  windAngle: number
  /** Peak dune height in world units. */
  amplitude: number
  /** Crest-to-crest distance measured along the wind. */
  duneWavelength: number
  /** How much longer a crest runs across the wind than along it. */
  crestElongation: number
  /** Share of the wavelength spent on the gentle windward ramp, 0..1. */
  windwardFraction: number
  /** How far crest lines bend, in wavelengths. */
  sinuosity: number
  /** Slow variation in crest spacing, in wavelengths. Lets crests merge and split. */
  spacingVariation: number
  /** Feature size of the bending. */
  sinuosityScale: number
  /** Feature size of the slow variation in dune height across the field. */
  fieldScale: number
  /** How deeply that variation cuts, 0..1. Higher opens flat interdune corridors. */
  fieldContrast: number
  /** Height of the secondary dunes riding on the flanks of the primaries. */
  rippleAmplitude: number
  /** Crest spacing of those secondary dunes. */
  rippleWavelength: number
  /** Radius that is fully flattened for the pyramid footprint. */
  basinRadius: number
  /** Distance over which the basin blends back into open desert. */
  basinFalloff: number
  /**
   * How far the basin is stretched toward +Z, where the camera sits. Without
   * this a crest can land in the sightline and bury the pyramid base, which is
   * a matter of luck with the seed rather than something tuning can fix.
   */
  basinCameraStretch: number
  /** Extra height added toward the horizon so dunes stack into the distance. */
  horizonRise: number
  /** Distance at which the horizon rise reaches full strength. */
  horizonStart: number
  seed: number
}

export const defaultDuneSettings: DuneSettings = {
  // Sized to the camera, not the desert: 620 covered a full open landscape,
  // but with a fixed camera pose (plus the top-down intro), only ground within
  // ~32 units of the origin is ever visible even at ultrawide aspect ratios.
  // 70 covers that with margin. horizonRise/horizonStart below are tuned for
  // the old 620 scale and won't do anything meaningful at this size until
  // they're revisited alongside un-flattening the terrain.
  extent: 70,
  windAngle: 35,
  amplitude: 3.8,
  duneWavelength: 34,
  crestElongation: 3.5,
  windwardFraction: 0.76,
  sinuosity: 0.42,
  spacingVariation: 0.65,
  sinuosityScale: 150,
  fieldScale: 210,
  fieldContrast: 0.5,
  rippleAmplitude: 0.1,
  rippleWavelength: 23,
  basinRadius: 5.5,
  basinFalloff: 11,
  basinCameraStretch: 2.1,
  horizonRise: 2.6,
  horizonStart: 95,
  seed: 1337,
}

const GRADIENTS_2D = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

function buildPermutation(seed: number) {
  // Deterministic shuffle so a given seed always yields the same desert.
  const table = new Uint8Array(256)
  for (let index = 0; index < 256; index += 1) table[index] = index
  let state = (seed >>> 0) || 1
  for (let index = 255; index > 0; index -= 1) {
    // xorshift32 keeps this dependency-free and stable across platforms.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    const swap = state % (index + 1)
    const held = table[index]
    table[index] = table[swap]
    table[swap] = held
  }
  const doubled = new Uint8Array(512)
  for (let index = 0; index < 512; index += 1) doubled[index] = table[index & 255]
  return doubled
}

const SKEW_2D = 0.5 * (Math.sqrt(3) - 1)
const UNSKEW_2D = (3 - Math.sqrt(3)) / 6

/** Simplex noise in 2D, returning roughly -1..1. Chosen over value noise because
 *  its lack of grid alignment matters once the output is domain-warped. */
function makeNoise2D(seed: number) {
  const permutation = buildPermutation(seed)

  return function noise2D(x: number, y: number): number {
    const skew = (x + y) * SKEW_2D
    const cellX = Math.floor(x + skew)
    const cellY = Math.floor(y + skew)
    const unskew = (cellX + cellY) * UNSKEW_2D
    const originX = x - (cellX - unskew)
    const originY = y - (cellY - unskew)

    const secondX = originX > originY ? 1 : 0
    const secondY = originX > originY ? 0 : 1

    const cornerX = [originX, originX - secondX + UNSKEW_2D, originX - 1 + 2 * UNSKEW_2D]
    const cornerY = [originY, originY - secondY + UNSKEW_2D, originY - 1 + 2 * UNSKEW_2D]
    const offsetX = [0, secondX, 1]
    const offsetY = [0, secondY, 1]

    let total = 0
    for (let corner = 0; corner < 3; corner += 1) {
      const dx = cornerX[corner]
      const dy = cornerY[corner]
      let falloff = 0.5 - dx * dx - dy * dy
      if (falloff <= 0) continue
      const hash = permutation[
        (cellX + offsetX[corner] + permutation[(cellY + offsetY[corner]) & 255]) & 255
      ]
      const gradient = GRADIENTS_2D[hash & 7]
      falloff *= falloff
      total += falloff * falloff * (gradient[0] * dx + gradient[1] * dy)
    }
    return total * 70
  }
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Cross-section of a single dune, for phase 0..1 through one wavelength.
 *
 * The asymmetry is the whole point. The windward side is a long convex ramp
 * (~14 degrees) that steepens toward the top; the lee side drops away over a
 * much shorter span at close to the angle of repose for dry sand (~34 degrees).
 * The two meet at a slope discontinuity, which is what renders as a crisp brink
 * line rather than the rounded shoulder an isotropic height field produces.
 */
function duneProfile(phase: number, windwardFraction: number) {
  if (phase < windwardFraction) {
    return Math.pow(phase / windwardFraction, 1.4)
  }
  const lee = (phase - windwardFraction) / (1 - windwardFraction)
  return Math.pow(1 - lee, 1.3)
}

export type HeightField = (x: number, z: number) => number

export function createDuneHeightField(settings: DuneSettings = defaultDuneSettings): HeightField {
  const noise = makeNoise2D(settings.seed)
  const bendNoise = makeNoise2D(settings.seed ^ 0x9e3779b9)
  const fieldNoise = makeNoise2D(settings.seed ^ 0x85ebca6b)

  const windRadians = settings.windAngle * Math.PI / 180
  const windX = Math.cos(windRadians)
  const windZ = Math.sin(windRadians)

  function fbm(
    sampler: (x: number, y: number) => number,
    x: number,
    y: number,
    octaves: number,
  ) {
    let sum = 0
    let amplitude = 1
    let frequency = 1
    let normalisation = 0
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += sampler(x * frequency, y * frequency) * amplitude
      normalisation += amplitude
      amplitude *= 0.5
      frequency *= 2.03
    }
    return sum / normalisation
  }

  return function duneHeight(x: number, z: number): number {
    // Project into wind space. `along` advances downwind and drives the dune
    // cross-section; `across` runs parallel to the crests.
    const along = x * windX + z * windZ
    const across = -x * windZ + z * windX

    // Bend the crest lines. The warp is sampled mostly as a function of `across`
    // so a crest wanders sideways along its length instead of breaking up, and
    // the anisotropic scaling here is what elongates dunes into ridges at all.
    const bend = fbm(
      bendNoise,
      across / settings.sinuosityScale,
      along / (settings.sinuosityScale * settings.crestElongation),
      3,
    )

    // A second, much broader phase warp varies crest spacing across the field.
    // Where its gradient opposes the base advance, neighbouring crests merge or
    // split, which is what keeps the field from reading as regular corduroy.
    const spacing = fbm(bendNoise, (x + 820) / 430, (z - 610) / 430, 2)

    // Phase through one dune, warped so crests are sinuous rather than striped.
    const phase = along / settings.duneWavelength
      + bend * settings.sinuosity
      + spacing * settings.spacingVariation
    const profile = duneProfile(phase - Math.floor(phase), settings.windwardFraction)

    // Slow variation in dune height, opening flat interdune corridors in places
    // so the field is not a uniform corrugation.
    const field = fbm(fieldNoise, x / settings.fieldScale, z / settings.fieldScale, 3) * 0.5 + 0.5
    const fieldWeight = 1 - settings.fieldContrast + settings.fieldContrast * field

    let height = profile * fieldWeight * settings.amplitude

    // Secondary dunes riding the flanks of the primaries, weighted toward the
    // windward ramp where they survive in reality.
    const ripplePhase = along / settings.rippleWavelength
      + fbm(noise, across / 95, along / 210, 2) * 1.0
    const ripple = duneProfile(ripplePhase - Math.floor(ripplePhase), 0.7)
    const rippleMask = smoothstep(0.08, 0.5, profile) * (1 - smoothstep(0.62, 0.95, profile))
    height += ripple * rippleMask * fieldWeight * settings.rippleAmplitude

    // Dunes grow toward the horizon so the far field stacks instead of flattening.
    const distance = Math.hypot(x, z)
    height += smoothstep(settings.horizonStart, settings.extent * 0.5, distance)
      * settings.horizonRise

    // Flatten the pyramid footprint, easing back out so the basin edge is not a
    // crater rim, and reaching further toward the camera to keep the sightline
    // onto the pyramid base clear of crests.
    const basinZ = z > 0 ? z / settings.basinCameraStretch : z
    const basinDistance = Math.hypot(x, basinZ)
    const basin = smoothstep(
      settings.basinRadius,
      settings.basinRadius + settings.basinFalloff,
      basinDistance,
    )
    return height * basin
  }
}
