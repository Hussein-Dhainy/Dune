import { sampleCycle } from './cycle.ts'
import { MathUtils } from 'three'

type Point = readonly [number, number, number]
export type CameraPose = { position: Point; target: Point }

export const cameraPoses: readonly CameraPose[] = [
  { position: [-3, 3.5, 15.5], target: [0, 1.2, 0] },
]
export const introPose: CameraPose = { position: [0, 22, 0.01], target: [0, 0, 0] }

function mixPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function mixPose(a: CameraPose, b: CameraPose, progress: number): CameraPose {
  const t = MathUtils.smoothstep(progress, 0, 1)
  return { position: mixPoint(a.position, b.position, t), target: mixPoint(a.target, b.target, t) }
}

export function sampleCamera(position: number): CameraPose {
  const { index, nextIndex, transition } = sampleCycle(position)
  return mixPose(cameraPoses[index], cameraPoses[nextIndex], transition)
}
