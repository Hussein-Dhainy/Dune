import { sampleCycle } from './cycle.ts'
import { createTransitionState, sampleTransition } from './transitionTimeline.ts'
import type { TransitionState } from './transitionTimeline.ts'
import { MathUtils, Vector3 } from 'three'

type Point = readonly [number, number, number]
export type CameraPose = { position: Point; target: Point }

/** One resting pose per section in cycle.ts, in the same order. */
export const cameraPoses: readonly CameraPose[] = [
  { position: [-3.393, 5.668, 21.525], target: [0, 1.9, 0] },
  // Second scene: lower and level. The sandstone shard hangs at the target.
  { position: [2.6, 2.4, 15.5], target: [0, 2.2, 0] },
]
/** Share of the pointer orbit (below) each section's camera takes. The second
 *  scene's camera holds still: there the cursor leans the shard instead. */
export const sectionPointerOrbit: readonly number[] = [1, 0]
export const baseFov = 45

/**
 * The sandstorm pull-back. The resting camera sits ~22 units from the
 * pyramid (itself ~4.7 across), so 6 units back plus a 4 degree wider lens
 * shrinks it to roughly 70% of its size: noticeable, not dramatic.
 */
export const cameraRetreat = {
  distance: 6,
  rise: 1.2,
  fovBoost: 4,
  /** Share of the move kept under prefers-reduced-motion. */
  reducedMotionScale: 0.3,
}
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

/** Dollies a pose straight back along its own view direction, keeping the
 *  target, and lifts it a little. Amount 0 returns the pose untouched, so the
 *  resting framing is restored exactly. */
export function retreatPose(pose: CameraPose, amount: number): CameraPose {
  if (amount === 0) return pose
  const [px, py, pz] = pose.position
  const [tx, ty, tz] = pose.target
  const length = Math.hypot(px - tx, py - ty, pz - tz) || 1
  const back = cameraRetreat.distance * amount / length
  return {
    position: [
      px + (px - tx) * back,
      py + (py - ty) * back + cameraRetreat.rise * amount,
      pz + (pz - tz) * back,
    ],
    target: pose.target,
  }
}

export type TransitionCamera = CameraPose & { fov: number }

/** Camera for a transition state: the showing scene's pose, pulled back. */
export function transitionCamera(transition: TransitionState, reducedMotion = false): TransitionCamera {
  const amount = transition.retreat * (reducedMotion ? cameraRetreat.reducedMotionScale : 1)
  const pose = retreatPose(cameraPoses[transition.activeSection], amount)
  return { position: pose.position, target: pose.target, fov: baseFov + cameraRetreat.fovBoost * amount }
}

/** Camera the incoming scene is seen through while it shows behind the wipe. */
export function incomingCamera(transition: TransitionState, reducedMotion = false): TransitionCamera {
  const amount = transition.incomingRetreat * (reducedMotion ? cameraRetreat.reducedMotionScale : 1)
  const pose = retreatPose(cameraPoses[transition.nextIndex], amount)
  return { position: pose.position, target: pose.target, fov: baseFov + cameraRetreat.fovBoost * amount }
}

const sampleScratch = createTransitionState()

export function sampleCamera(position: number, reducedMotion = false): TransitionCamera {
  return transitionCamera(sampleTransition(sampleCycle(position), reducedMotion, sampleScratch), reducedMotion)
}

/**
 * Mouse-driven look-around: the whole camera rig swings about a pivot set
 * behind the target, so the pyramid (nearer than the pivot) and the far dunes
 * (beyond it) drift in opposite directions.
 */
export const pointerOrbit = {
  /** Yaw at the window's left/right edge. */
  maxYaw: MathUtils.degToRad(5),
  /** Pitch at the window's top/bottom edge. Narrower than yaw: the camera
   *  sits low over the sand, and a steep swing reads as tilting the world. */
  maxPitch: MathUtils.degToRad(3),
  /** How far past the look-at target, along the horizontal view direction, the pivot sits. */
  pivotBehindTarget: 8,
  /** Easing rate towards the pointer, so the camera floats rather than snaps. */
  ease: 3,
}

const orbitPivot = new Vector3()
const orbitRight = new Vector3()
const orbitUp = new Vector3(0, 1, 0)
const orbitPoint = new Vector3()

/** Rotates a pose's position and target together about the pivot: `pitch`
 *  radians about the camera's horizontal right axis (positive raises the
 *  camera), then `yaw` about the vertical (positive swings it to its right). */
export function orbitPose(
  pose: CameraPose,
  yaw: number,
  pitch = 0,
  pivotBehindTarget = pointerOrbit.pivotBehindTarget,
): CameraPose {
  if (yaw === 0 && pitch === 0) return pose
  const viewX = pose.target[0] - pose.position[0]
  const viewZ = pose.target[2] - pose.position[2]
  const viewLength = Math.hypot(viewX, viewZ) || 1
  orbitPivot.set(
    pose.target[0] + (viewX / viewLength) * pivotBehindTarget,
    pose.target[1],
    pose.target[2] + (viewZ / viewLength) * pivotBehindTarget,
  )
  orbitRight.set(-viewZ / viewLength, 0, viewX / viewLength)
  const rotate = (point: Point): Point => {
    orbitPoint.set(...point).sub(orbitPivot)
    // Right-handed rotation about the right axis lowers a point in front of
    // the pivot, so pitch is negated to make positive raise the camera.
    orbitPoint.applyAxisAngle(orbitRight, -pitch).applyAxisAngle(orbitUp, yaw).add(orbitPivot)
    return [orbitPoint.x, orbitPoint.y, orbitPoint.z]
  }
  return { position: rotate(pose.position), target: rotate(pose.target) }
}
