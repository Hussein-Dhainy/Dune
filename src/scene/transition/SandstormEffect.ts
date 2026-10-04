import { Effect, EffectAttribute } from 'postprocessing'
import { Color, Uniform, Vector2 } from 'three'
import { sandstormEffectFragment } from './transitionShaders'

export type SandstormEffectOptions = {
  /** Zoom-smear taps; 0 disables the smear (cheap tier). */
  radialSamples: number
  cloudOctaves: number
  detailed: boolean
  /** RGB split in UV per unit of distance from the centre, at full strength. */
  maxAberration: number
}

/**
 * The sandstorm transition as one postprocessing Effect. Declared as a
 * convolution (it samples its input around each pixel), which keeps it out
 * of the Bloom/ToneMapping/SMAA pass and in a pass of its own that can be
 * switched off whenever no storm is on screen.
 */
export class SandstormEffect extends Effect {
  constructor({ radialSamples, cloudOctaves, detailed, maxAberration }: SandstormEffectOptions) {
    const defines = new Map<string, string>([
      ['RADIAL_SAMPLES', String(radialSamples)],
      ['CLOUD_OCTAVES', String(cloudOctaves)],
    ])
    if (detailed) defines.set('DETAILED_STORM', '1')
    super('SandstormEffect', sandstormEffectFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      defines,
      uniforms: new Map<string, Uniform>([
        ['cloudTop', new Uniform(-1)],
        ['cloudTilt', new Uniform(0)],
        ['incomingBuffer', new Uniform(null)],
        ['incomingActive', new Uniform(0)],
        ['incomingExposure', new Uniform(1)],
        ['cloudBottom', new Uniform(-1)],
        ['cloudDensity', new Uniform(0)],
        ['distortion', new Uniform(0)],
        ['aberration', new Uniform(0)],
        ['glitch', new Uniform(0)],
        ['blockSeed', new Uniform(0)],
        // Direction the image is dragged in, in UV: up, the way the cloud
        // (and the next scene behind it) arrives.
        ['pull', new Uniform(new Vector2(0, 1))],
        ['stormTime', new Uniform(0)],
        ['maxAberration', new Uniform(maxAberration)],
        ['center', new Uniform(new Vector2(0.5, 0.5))],
        ['dustLight', new Uniform(new Color())],
        ['dustMid', new Uniform(new Color())],
        ['dustDark', new Uniform(new Color())],
      ]),
    })
  }

  uniform<T>(name: string) {
    return this.uniforms.get(name) as Uniform<T>
  }
}

// three.js's ACESFilmicToneMapping, on the CPU. The effect runs after tone
// mapping, so its dust colours must be tone mapped the same way to match the
// sky and haze they are meant to continue.
const acesInput = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
]
const acesOutput = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
]

function rrtAndOdtFit(v: number) {
  const a = v * (v + 0.0245786) - 0.000090537
  const b = v * (0.983729 * v + 0.432951) + 0.238081
  return a / b
}

/** Writes the tone-mapped form of a linear colour into `target`. */
export function toneMapAces(linear: Color, exposure: number, target: Color) {
  const scale = exposure / 0.6
  const input = [linear.r * scale, linear.g * scale, linear.b * scale]
  const fitted = acesInput.map((row) => rrtAndOdtFit(row[0] * input[0] + row[1] * input[1] + row[2] * input[2]))
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
  target.setRGB(
    clamp(acesOutput[0][0] * fitted[0] + acesOutput[0][1] * fitted[1] + acesOutput[0][2] * fitted[2]),
    clamp(acesOutput[1][0] * fitted[0] + acesOutput[1][1] * fitted[1] + acesOutput[1][2] * fitted[2]),
    clamp(acesOutput[2][0] * fitted[0] + acesOutput[2][1] * fitted[1] + acesOutput[2][2] * fitted[2]),
  )
  return target
}
