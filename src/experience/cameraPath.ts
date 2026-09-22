import { sampleCycle } from './cycle.ts'
import { MathUtils } from 'three'

type Point = readonly [number, number, number]
export type CameraPose = { position: Point; target: Point }

export const cameraPoses: readonly CameraPose[] = [
  { position: [-3.393, 5.668, 21.525], target: [0, 1.9, 0] },
]
export const introPose: CameraPose = { position: [0, 22, 0.01], target: [0, 0, 0] }

// Weighted form rather than a + (b - a) * t: the latter is off by an ulp at
// t = 1 for most values, which breaks the handoff from the intro pose onto the
// first camera pose.
function mixPoint(a: Point, b: Point, t: number): Point {
  const inverse = 1 - t
  return [
    a[0] * inverse + b[0] * t,
    a[1] * inverse + b[1] * t,
    a[2] * inverse + b[2] * t,
  ]
}

export function mixPose(a: CameraPose, b: CameraPose, progress: number): CameraPose {
  const t = MathUtils.smoothstep(progress, 0, 1)
  return { position: mixPoint(a.position, b.position, t), target: mixPoint(a.target, b.target, t) }
}

export function sampleCamera(position: number): CameraPose {
  const { index, nextIndex, transition } = sampleCycle(position)
  return mixPose(cameraPoses[index], cameraPoses[nextIndex], transition)
}
