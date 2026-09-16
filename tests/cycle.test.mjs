import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycleLength, nearestSectionPosition, sampleCycle, sectionStart, sections, smoothPosition, wrap } from '../src/experience/cycle.ts'
import { cameraPoses, mixPose, introPose, sampleCamera } from '../src/experience/cameraPath.ts'

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
  assert.equal(nearestSectionPosition(600.2, 1), 602)
  assert.equal(nearestSectionPosition(-600.2, 2), -602)
  assert.ok(Math.abs(nearestSectionPosition(2, 2, sections[2].hold) + 0.8) < 1e-12)
})
