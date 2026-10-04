import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycleLength, sectionStart, sections } from '../src/experience/cycle.ts'
import { transitionTiming } from '../src/experience/transitionTimeline.ts'
import {
  createShardMotion,
  sampleShardMotion,
  shardSection,
  shardTiming,
  shardTravel,
} from '../src/scene/transition/shardMotion.ts'
import {
  createNetworkFrame,
  createNetworkView,
  createShardNetwork,
  insideSilhouette,
  networkBounds,
  networkField,
  networkSpread,
  networkStretch,
  sampleAnchor,
  updateNetwork,
} from '../src/scene/transition/shardNetwork.ts'

const previousSection = (shardSection + sections.length - 1) % sections.length
const entryStart = sectionStart(previousSection) + sections[previousSection].hold
const entryLength = sections[previousSection].transition
const holdStart = sectionStart(shardSection)
const holdLength = sections[shardSection].hold
const exitStart = holdStart + holdLength
const exitLength = sections[shardSection].transition

const at = (position) => ({ ...sampleShardMotion(position, createShardMotion()) })

test('the shard rises from below the view and lands on its hero pose as the hold begins', () => {
  // Off stage for the whole of the section before, and until the wipe is in.
  assert.equal(at(sectionStart(previousSection) + 0.1).onStage, false)
  assert.equal(at(entryStart + entryLength * (shardTiming.enterFrom - 0.01)).onStage, false)

  const first = at(entryStart + entryLength * (shardTiming.enterFrom + 1e-6))
  assert.equal(first.onStage, true)
  assert.ok(Math.abs(first.offsetY + shardTravel.rise) < 1e-3)
  assert.ok(first.linesOpacity === 0)

  // It only ever climbs, and keeps turning the same way, all the way in.
  let last = first
  for (let step = 1; step <= 200; step++) {
    const progress = shardTiming.enterFrom + (1 - shardTiming.enterFrom) * step / 200
    const now = at(entryStart + entryLength * Math.min(progress, 1 - 1e-9))
    assert.ok(now.offsetY >= last.offsetY)
    assert.ok(now.yaw > last.yaw)
    assert.ok(now.linesOpacity >= last.linesOpacity)
    last = now
  }
  assert.ok(Math.abs(last.offsetY) < 1e-6)
})

test('the shard is settled through the hold, tumbling about all three axes with the scroll', () => {
  for (let step = 0; step <= 20; step++) {
    const motion = at(holdStart + holdLength * step / 20)
    assert.equal(motion.onStage, true)
    assert.equal(motion.offsetY, 0)
    assert.equal(motion.scale, 1)
    assert.equal(motion.tiltX, 0)
    assert.equal(motion.tiltZ, 0)
    assert.equal(motion.settle, 1)
    assert.equal(motion.linesOpacity, 1)
    assert.equal(motion.linesScale, 1)
  }
  const start = at(holdStart)
  const end = at(holdStart + holdLength)
  for (const [key, rate] of [['yaw', shardTravel.turnRate], ['pitch', shardTravel.pitchRate], ['roll', shardTravel.rollRate]]) {
    const turned = end[key] - start[key]
    assert.ok(Math.abs(turned - rate * holdLength) < 1e-9, key)
    assert.ok(turned > 0 && turned < Math.PI / 4, key)
  }
})

test('the shard lifts away and is gone before the storm swaps scenes', () => {
  let last = at(exitStart)
  assert.equal(last.offsetY, 0)
  for (let step = 1; step <= 200; step++) {
    const progress = shardTiming.exitTo * step / 200
    const now = at(exitStart + exitLength * progress)
    assert.ok(now.offsetY >= last.offsetY)
    assert.ok(now.yaw > last.yaw)
    assert.ok(now.linesOpacity <= last.linesOpacity)
    last = now
  }
  assert.ok(Math.abs(last.offsetY - shardTravel.lift) < 1e-6)
  assert.equal(last.linesOpacity, 0)
  assert.ok(shardTiming.exitTo < transitionTiming.switchAt)
  assert.equal(at(exitStart + exitLength * (shardTiming.exitTo + 1e-6)).onStage, false)
  assert.equal(at(exitStart + exitLength * 0.9).onStage, false)
})

test('entry, hold and exit join without a step in position, turn or turn speed', () => {
  const epsilon = 1e-6
  for (const boundary of [holdStart, exitStart]) {
    const before = at(boundary - epsilon)
    const on = at(boundary)
    const after = at(boundary + epsilon)
    for (const key of ['offsetY', 'yaw', 'pitch', 'roll', 'tiltX', 'tiltZ', 'scale', 'settle', 'linesOpacity', 'linesScale']) {
      assert.ok(Math.abs(before[key] - on[key]) < 1e-4, `${key} steps into ${boundary}`)
      assert.ok(Math.abs(after[key] - on[key]) < 1e-4, `${key} steps out of ${boundary}`)
    }
    const speedIn = (on.yaw - before.yaw) / epsilon
    const speedOut = (after.yaw - on.yaw) / epsilon
    assert.ok(Math.abs(speedIn - speedOut) < 1e-3)
  }
})

test('shard motion is a pure function of position: reversing and looping retrace it exactly', () => {
  const forward = []
  for (let step = 0; step <= 600; step++) forward.push(at(step / 100))
  const reuse = createShardMotion()
  for (let step = 600; step >= 0; step--) {
    sampleShardMotion(step / 100, reuse)
    assert.deepEqual({ ...reuse }, forward[step])
  }
  // Every lap of the loop, in either direction, is the same lap.
  for (const position of [entryStart + 1.3, holdStart + 0.5, exitStart + 0.4]) {
    for (const laps of [-7, -1, 1, 12]) {
      const lapped = at(position + laps * cycleLength)
      const base = at(position)
      for (const key of Object.keys(base)) {
        if (typeof base[key] === 'number') assert.ok(Math.abs(lapped[key] - base[key]) < 1e-9, key)
        else assert.equal(lapped[key], base[key])
      }
    }
  }
})

const desktopView = () => createNetworkView()
const narrowView = () => {
  const view = createNetworkView()
  view.spread = networkSpread(4.2)
  view.stretch = networkStretch(view.spread)
  return view
}
const anchorAt = (network, anchor, time, view = desktopView()) => {
  const out = new Float32Array(3)
  const fade = sampleAnchor(network, anchor, time, view, out, 0)
  return { x: out[0], y: out[1], z: out[2], fade }
}

test('the line network is seeded and spread round the formation, not across its face', () => {
  const network = createShardNetwork()
  assert.deepEqual(createShardNetwork(), network)
  assert.notDeepEqual(createShardNetwork(34, 7).baseX, network.baseX)
  assert.ok(network.anchorCount >= 28 && network.anchorCount <= 40)
  assert.ok(createShardNetwork(22).anchorCount < network.anchorCount)

  // Mostly flanking it, evenly either side, with a few behind its centre.
  const sides = [...network.side]
  const centre = sides.filter((side) => side === 0).length
  assert.ok(centre >= 2 && centre <= network.anchorCount * 0.25)
  assert.ok(Math.abs(sides.filter((side) => side < 0).length - sides.filter((side) => side > 0).length) <= 1)
  for (let anchor = 0; anchor < network.anchorCount; anchor++) {
    assert.ok(network.baseZ[anchor] < 0, 'behind the formation\'s front face')
    // Behind its centre means behind its back face too.
    if (network.side[anchor] === 0) assert.ok(network.baseZ[anchor] < -2.1)
    assert.ok(network.maxLinks[anchor] >= 2 && network.maxLinks[anchor] <= 3)
    // Struts across the formation start only from the flanks.
    if (network.side[anchor] === 0) assert.equal(network.maxSpans[anchor], 0)
    else assert.ok(network.maxSpans[anchor] >= 1 && network.maxSpans[anchor] <= 2)
    const crossing = network.cycle[anchor]
    assert.ok(crossing >= 9 && crossing <= 14, 'crosses the field in 9 to 14 seconds')
  }
  // Prebuilt once; flank-to-flank pairs, and only those, are struts.
  const pairs = network.anchorCount * (network.anchorCount - 1) / 2
  assert.ok(network.candidateCount <= pairs)
  let struts = 0
  for (let candidate = 0; candidate < network.candidateCount; candidate++) {
    const from = network.candidates[candidate * 2]
    const to = network.candidates[candidate * 2 + 1]
    assert.equal(network.span[candidate], network.side[from] * network.side[to] === -1 ? 1 : 0)
    struts += network.span[candidate]
  }
  assert.ok(struts > 0)
})

test('anchors rise steadily and wrap one at a time, unseen, somewhere new', () => {
  const network = createShardNetwork()
  const step = 1 / 60
  const wraps = Array.from({ length: network.anchorCount }, () => [])
  const sway = new Float32Array(network.anchorCount)
  let last = Array.from({ length: network.anchorCount }, (_, anchor) => anchorAt(network, anchor, 0))
  for (let time = step; time < 90; time += step) {
    let wrapping = 0
    for (let anchor = 0; anchor < network.anchorCount; anchor++) {
      const now = anchorAt(network, anchor, time)
      const before = last[anchor]
      if (now.y < before.y) {
        // Out of sight on both sides of the jump, so it never pops.
        assert.ok(before.fade < 0.01 && now.fade < 0.01)
        assert.ok(before.y > networkField.halfHeight - 0.05 && now.y < -networkField.halfHeight + 0.05)
        wraps[anchor].push({ time, x: now.x })
        wrapping += 1
      } else {
        // Upward at the anchor's own pace: no stalls, no surges.
        const speed = (now.y - before.y) / step
        assert.ok(Math.abs(speed - 2 * networkField.halfHeight / network.cycle[anchor]) < 1e-3)
        // It sways as it climbs, calmly: under a unit a second sideways.
        const sideways = Math.abs(now.x - before.x) / step
        assert.ok(sideways < 1)
        sway[anchor] = Math.max(sway[anchor], sideways)
        assert.ok(Math.abs(now.fade - before.fade) < 0.04, 'fades, never pops')
      }
      last[anchor] = now
    }
    // Only ever a handful at once: there is no global reset.
    assert.ok(wrapping <= Math.max(2, network.anchorCount * 0.1))
  }
  const times = new Set()
  for (const laps of wraps) {
    assert.ok(laps.length >= 6)
    for (const { time } of laps) times.add(time.toFixed(2))
    // Laps start from spots spread across the lane, not the same one.
    assert.ok(new Set(laps.map(({ x }) => x.toFixed(3))).size >= laps.length * 0.75)
    const starts = laps.map(({ x }) => x)
    assert.ok(Math.max(...starts) - Math.min(...starts) > 0.25)
  }
  assert.ok(times.size > wraps.flat().length * 0.9)
  // Every anchor visibly moves sideways too, not just straight up: at least
  // twice the old drift's top speed.
  for (const fastest of sway) assert.ok(fastest > 0.14, `${fastest}`)
})

test('anchors fade in over the bottom of the field and out over the top', () => {
  const network = createShardNetwork()
  const view = desktopView()
  const flank = [...network.side].findIndex((side) => side !== 0)
  const crossing = network.cycle[flank]
  // Time at which the anchor is `share` of the way up the field.
  const at = (share) => anchorAt(network, flank, ((share - network.phase[flank] + 2) % 1) * crossing + crossing, view)
  assert.ok(at(0.0005).fade < 0.01)
  assert.ok(at(0.9995).fade < 0.01)
  assert.ok(at(0.04).fade > 0 && at(0.04).fade < 0.5)
  assert.ok(at(0.96).fade > 0 && at(0.96).fade < 0.5)
  for (const share of [0.3, 0.5, 0.7]) assert.ok(Math.abs(at(share).fade - 1) < 1e-6)

  // Behind the formation it is gone, and back once clear above it.
  const behind = [...network.side].indexOf(0)
  const centreAt = (share) => anchorAt(network, behind, ((share - network.phase[behind] + 2) % 1) * network.cycle[behind], view)
  assert.equal(centreAt(0.5).fade, 0)
  assert.ok(centreAt(0.88).fade > 0.5)
})

for (const [name, makeView, count] of [['desktop', desktopView, 34], ['narrow', narrowView, 22]]) {
  test(`lines cage the formation, capped per anchor, never across its face (${name})`, () => {
    const network = createShardNetwork(count)
    const view = makeView()
    const frame = createNetworkFrame(network)
    let lines = 0
    let struts = 0
    let shown = 0
    let frames = 0
    for (let time = 0; time < 120; time += 1 / 15) {
      updateNetwork(network, time, view, frame)
      const links = new Uint8Array(network.anchorCount)
      const spans = new Uint8Array(network.anchorCount)
      for (let candidate = 0; candidate < network.candidateCount; candidate++) {
        if (!frame.linked[candidate]) continue
        const from = network.candidates[candidate * 2]
        const to = network.candidates[candidate * 2 + 1]
        const held = network.span[candidate] ? spans : links
        held[from] += 1
        held[to] += 1
        lines += 1
        struts += network.span[candidate]
        const reach = network.span[candidate] ? networkField.spanReach : networkField.reach
        assert.ok(frame.distance[candidate] < reach)
        if (frame.strength[candidate] === 0) continue
        // Along its whole length, finely sampled, it keeps outside the guard -
        // or passes behind the formation, where the stone hides it.
        const behind = Math.max(frame.positions[from * 3 + 2], frame.positions[to * 3 + 2]) < networkField.behindDepth
        for (let step = 0; step <= 60; step++) {
          const t = step / 60
          const x = frame.positions[from * 3] + (frame.positions[to * 3] - frame.positions[from * 3]) * t
          const y = frame.positions[from * 3 + 1] + (frame.positions[to * 3 + 1] - frame.positions[from * 3 + 1]) * t
          assert.ok(behind || !insideSilhouette(x, y, view.guard))
        }
      }
      for (let anchor = 0; anchor < network.anchorCount; anchor++) {
        assert.ok(links[anchor] <= network.maxLinks[anchor])
        assert.ok(spans[anchor] <= network.maxSpans[anchor])
        assert.equal(links[anchor], frame.links[anchor])
        assert.equal(spans[anchor], frame.spans[anchor])
        const x = frame.positions[anchor * 3]
        const y = frame.positions[anchor * 3 + 1]
        if (frame.fades[anchor] > 0) assert.equal(insideSilhouette(x, y, view.guard), false)
        if (frame.fades[anchor] > 0.5) shown += 1
      }
      frames += 1
    }
    // A loose cage: chains up each side, struts across, never a solid web.
    const perFrame = lines / frames
    assert.ok(perFrame >= network.anchorCount * 0.8, `${perFrame} lines`)
    assert.ok(perFrame <= network.anchorCount * 1.6, `${perFrame} lines`)
    assert.ok(struts / frames >= network.anchorCount * 0.15, `${struts / frames} struts`)
    assert.ok(shown / frames >= network.anchorCount * 0.5)
  })
}

test('a narrow view pulls the flanks in and stretches the field to fit', () => {
  assert.equal(networkSpread(10.8), 1)
  const narrow = networkSpread(4.2)
  assert.ok(narrow >= networkField.minSpread && narrow < 0.5)
  assert.ok(networkStretch(narrow) > 1 && networkStretch(1) === 1)

  const network = createShardNetwork(22)
  const view = narrowView()
  // The outermost anchor still fits a 4.2-unit half-width.
  let widest = 0
  for (let time = 0; time < 60; time += 0.25) {
    for (let anchor = 0; anchor < network.anchorCount; anchor++) {
      widest = Math.max(widest, Math.abs(anchorAt(network, anchor, time, view).x))
    }
  }
  assert.ok(widest < 4.2, `${widest}`)

  // And the fixed culling sphere holds every anchor in every view.
  const { centreZ, radius } = networkBounds(network)
  for (const fit of [desktopView(), view]) {
    for (const guard of [networkField.minGuard, networkField.maxGuard]) {
      fit.guard = guard
      for (let time = 0; time < 40; time += 0.2) {
        for (let anchor = 0; anchor < network.anchorCount; anchor++) {
          const { x, y, z } = anchorAt(network, anchor, time, fit)
          assert.ok(Math.hypot(x, y, z - centreZ) <= radius)
        }
      }
    }
  }
})

test('updating the network is allocation-free in shape: it only refills the frame', () => {
  const network = createShardNetwork()
  const frame = createNetworkFrame(network)
  const arrays = Object.values(frame)
  assert.equal(updateNetwork(network, 12.5, desktopView(), frame), frame)
  assert.deepEqual(Object.values(frame).map((value) => value.buffer), arrays.map((value) => value.buffer))
  // A pure function of time: the same moment gives the same frame.
  const again = createNetworkFrame(network)
  updateNetwork(network, 12.5, desktopView(), again)
  assert.deepEqual([...again.positions], [...frame.positions])
  assert.deepEqual([...again.linked], [...frame.linked])
})

test('the camera takes no pointer orbit in the shard scene', async () => {
  const { cameraPoses, sectionPointerOrbit } = await import('../src/experience/cameraPath.ts')
  assert.equal(sectionPointerOrbit.length, sections.length)
  assert.equal(sectionPointerOrbit.length, cameraPoses.length)
  assert.equal(sectionPointerOrbit[shardSection], 0)
  assert.equal(sectionPointerOrbit[previousSection], 1)
})
