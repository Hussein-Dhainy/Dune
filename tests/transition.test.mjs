import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTransitionState, sampleTransition, transitionTiming } from '../src/experience/transitionTimeline.ts'
import { baseFov, cameraPoses, sampleCamera } from '../src/experience/cameraPath.ts'
import { sampleCycle, sectionStart, sections } from '../src/experience/cycle.ts'

const at = (progress, reducedMotion = false) =>
  sampleTransition({ index: 0, nextIndex: 1, transition: progress }, reducedMotion, createTransitionState())

test('the storm is fully resolved at both ends of a transition', () => {
  for (const progress of [0, 1]) {
    const state = at(progress)
    assert.equal(state.retreat, 0)
    assert.equal(state.storm, 0)
    assert.equal(state.cloudDensity, 0)
    assert.equal(state.distortion, 0)
    assert.equal(state.aberration, 0)
    assert.equal(state.glitch, 0)
    assert.equal(state.coverage, 0)
    assert.equal(state.interaction, 1)
  }
  assert.equal(at(0).activeSection, 0)
  assert.equal(at(1).activeSection, 1)
})

test('the incoming scene is on screen for the whole wipe, and the hand-over is seamless', () => {
  const { switchAt } = transitionTiming
  // Visible behind the edge almost from the first scroll, until the swap.
  assert.equal(at(0).incomingVisible, false)
  for (const progress of [0.05, 0.2, 0.5, switchAt - 0.01]) assert.equal(at(progress).incomingVisible, true)
  assert.equal(at(switchAt).incomingVisible, false)

  // By the swap the incoming scene already fills the view and the fog band
  // has gone, so handing the main render over changes nothing on screen.
  const before = at(switchAt - 1e-6)
  assert.equal(before.coverage, 1)
  assert.ok(before.cloudDensity < 1e-3)
  assert.equal(before.activeSection, 0)
  assert.equal(at(switchAt).activeSection, 1)
  // Its camera carries straight on across the swap.
  assert.ok(Math.abs(before.incomingRetreat - at(switchAt).retreat) < 1e-4)

  // The wipe only advances: coverage never falls while it is running.
  let last = 0
  for (let progress = 0; progress < switchAt; progress += 0.01) {
    const coverage = at(progress).coverage
    assert.ok(coverage >= last - 1e-9)
    last = coverage
  }
})

test('distortion acts on scene one as it is overtaken, and never on scene two', () => {
  const { switchAt } = transitionTiming
  // Mid-wipe, scene one is still partly in view and visibly distorted.
  const midWipe = at(0.35)
  assert.equal(midWipe.activeSection, 0)
  assert.ok(midWipe.coverage > 0.1 && midWipe.coverage < 0.9)
  assert.ok(midWipe.distortion > 0.8 && midWipe.glitch > 0.8 && midWipe.aberration > 0.5)

  for (let progress = 0; progress <= 1; progress += 0.01) {
    const state = at(progress)
    assert.ok(state.aberration <= 1)
    // The fog only ever advances: there is no trailing edge to lift away.
    assert.ok(state.cloudBottom < 0)
    if (progress >= switchAt) {
      assert.equal(state.distortion, 0)
      assert.equal(state.aberration, 0)
      assert.equal(state.glitch, 0)
    }
    const reduced = at(progress, true)
    assert.equal(reduced.distortion, 0)
    assert.equal(reduced.aberration, 0)
    assert.equal(reduced.glitch, 0)
  }
})

test('every channel is a pure function of progress, so reversing retraces it exactly', () => {
  const forward = []
  for (let step = 0; step <= 100; step++) forward.push({ ...at(step / 100) })
  const reuse = createTransitionState()
  for (let step = 100; step >= 0; step--) {
    sampleTransition({ index: 0, nextIndex: 1, transition: step / 100 }, false, reuse)
    assert.deepEqual({ ...reuse }, forward[step])
  }
})

test('the camera starts and ends each transition exactly on the resting poses', () => {
  sections.forEach((section, index) => {
    const start = sectionStart(index)
    const next = (index + 1) % sections.length
    const holdCamera = sampleCamera(start + section.hold / 2)
    assert.deepEqual(holdCamera.position, cameraPoses[index].position)
    assert.equal(holdCamera.fov, baseFov)
    const end = sampleCamera(start + section.hold + section.transition - 1e-9)
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(end.position[axis] - cameraPoses[next].position[axis]) < 1e-6)
    }
    assert.ok(Math.abs(end.fov - baseFov) < 1e-6)
    assert.equal(sampleCycle(start + section.hold + section.transition * 0.3).index, index)
  })
})

test('the camera pulls back and widens mid-storm, less under reduced motion', () => {
  const start = sectionStart(0) + sections[0].hold
  const position = start + sections[0].transition * 0.6
  const pose = cameraPoses[0]
  const distance = (camera) => Math.hypot(...camera.position.map((value, axis) => value - pose.target[axis]))
  const full = sampleCamera(position)
  const reduced = sampleCamera(position, true)
  assert.ok(distance(full) > distance({ position: pose.position }) + 4)
  assert.ok(full.fov > baseFov + 3)
  assert.ok(distance(reduced) < distance(full))
  assert.ok(reduced.fov < full.fov)
})
