import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycleLength, nearestSectionPosition, sampleCycle, sectionStart, sections, smoothPosition, wrap } from '../src/experience/cycle.ts'
import { cameraPoses, mixPose, introPose, orbitPose, pointerOrbit, sampleCamera } from '../src/experience/cameraPath.ts'

test('progress repeats in both directions, including exact boundaries', () => {
  for (const position of [-600.1, -6, -0.1, 0, 1, 2, 5.99, 6, 600.1]) {
    const sample = sampleCycle(position)
    assert.ok(sample.progress >= 0 && sample.progress < 1)
    assert.ok(sample.transition >= 0 && sample.transition <= 1)
    assert.ok(Math.abs(sample.progress - sampleCycle(position + cycleLength).progress) < 1e-12)
  }
  assert.equal(wrap(-cycleLength), 0)
  assert.equal(sampleCycle(-0.001).index, sections.length - 1)
  assert.equal(sampleCycle(cycleLength).index, 0)
})

test('section timing includes holds and transitions', () => {
  sections.forEach((section, index) => {
    const start = sectionStart(index)
    assert.equal(sampleCycle(start).index, index)
    assert.equal(sampleCycle(start + section.hold / 2).transition, 0)
    assert.ok(Math.abs(sampleCycle(start + section.hold + section.transition / 2).transition - 0.5) < 1e-12)
  })
})

test('smoothing is frame-rate independent and follows the continuous position over the seam', () => {
  let manyFrames = 5.9
  for (let frame = 0; frame < 60; frame++) manyFrames = smoothPosition(manyFrames, 6.1, 1 / 60, 0.22)
  assert.ok(Math.abs(manyFrames - smoothPosition(5.9, 6.1, 1, 0.22)) < 1e-12)
  assert.ok(manyFrames > 6 && manyFrames < 6.1)
  assert.equal(smoothPosition(0, -6, 1 / 60, 0), -6)
})

test('camera pose and velocity meet at the loop boundary', () => {
  const epsilon = 1e-5
  for (const key of ['position', 'target']) {
    assert.deepEqual(sampleCamera(0)[key], cameraPoses[0][key])
    assert.deepEqual(sampleCamera(cycleLength)[key], cameraPoses[0][key])
    sampleCamera(-epsilon)[key].forEach((value, index) => {
      assert.ok(Math.abs(value - sampleCamera(epsilon)[key][index]) < 1e-6)
      assert.ok(Math.abs((sampleCamera(0)[key][index] - value) / epsilon) < 0.01)
    })
  }
  assert.deepEqual(mixPose(introPose, cameraPoses[0], 1), cameraPoses[0])
})

test('debug navigation selects the nearest occurrence without losing the loop count', () => {
  assert.equal(nearestSectionPosition(600.2, 0), 600)
  assert.equal(nearestSectionPosition(-600.2, 0), -600)
  assert.ok(Math.abs(nearestSectionPosition(2, 0, sections[0].hold) - 1.2) < 1e-12)
})

test('pointer orbit swings the rig about a pivot behind the target', () => {
  const pose = cameraPoses[0]
  assert.deepEqual(orbitPose(pose, 0), pose)

  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const swung = orbitPose(pose, pointerOrbit.maxYaw)
  // A rigid rotation: camera-to-target distance and heights are unchanged.
  assert.ok(Math.abs(distance(swung.position, swung.target) - distance(pose.position, pose.target)) < 1e-9)
  assert.equal(swung.position[1], pose.position[1])
  assert.equal(swung.target[1], pose.target[1])

  // Positive yaw moves the camera to its right.
  const right = [-(pose.target[2] - pose.position[2]), 0, pose.target[0] - pose.position[0]]
  const moved = swung.position.map((value, axis) => value - pose.position[axis])
  assert.ok(moved[0] * right[0] + moved[2] * right[2] > 0)

  // The pivot sits behind the target, so the target itself moves too, less than the camera.
  const targetShift = distance(swung.target, pose.target)
  assert.ok(targetShift > 0 && targetShift < distance(swung.position, pose.position))
})

test('pointer orbit pitch raises the camera rigidly about the same pivot', () => {
  const pose = cameraPoses[0]
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const raised = orbitPose(pose, 0, pointerOrbit.maxPitch)
  const lowered = orbitPose(pose, 0, -pointerOrbit.maxPitch)
  assert.ok(raised.position[1] > pose.position[1])
  assert.ok(lowered.position[1] < pose.position[1])
  assert.ok(Math.abs(distance(raised.position, raised.target) - distance(pose.position, pose.target)) < 1e-9)
  // Pitch alone stays in the camera's vertical plane: no sideways drift.
  const right = [-(pose.target[2] - pose.position[2]), 0, pose.target[0] - pose.position[0]]
  const moved = raised.position.map((value, axis) => value - pose.position[axis])
  assert.ok(Math.abs(moved[0] * right[0] + moved[2] * right[2]) < 1e-9)
})
