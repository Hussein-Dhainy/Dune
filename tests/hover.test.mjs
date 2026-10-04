import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, BufferAttribute, BufferGeometry, Ray, Vector3 } from 'three'
import {
  breakHoverTrail,
  cageStrength,
  calmHover,
  clearHoverTrail,
  columnHover,
  createArrival,
  createHoverSpawner,
  createHoverUniforms,
  emitHoverTrail,
  flushHoverTrail,
  hoverFromArrival,
  hoverShaderChunks,
  offerArrival,
  sampleSegment,
} from '../src/scene/transition/columnHover.ts'
import { createColumnPicker, pickColumn } from '../src/scene/transition/columnPicker.ts'
import { columnWave, tagColumns } from '../src/scene/transition/columnRipple.ts'

const freshUniforms = createHoverUniforms

/** What is drawn at a point from every live segment, as the shader works it
 *  out: the first front still showing there, or under reduced motion the
 *  brightest still patch. */
function drawnAt(uniforms, x, y, z, now, calm = false) {
  const sample = { reach: 0, age: 0 }
  const arrival = createArrival()
  let still = 0
  for (let index = 0; index < columnHover.maxSegments; index += 1) {
    sampleSegment(x, y, z, uniforms.uHoverStarts.value[index], uniforms.uHoverEnds.value[index], now, sample)
    if (calm) still = Math.max(still, calmHover(sample.reach, sample.age))
    else offerArrival(arrival, sample.reach, sample.age)
  }
  return calm ? still : hoverFromArrival(arrival)
}

/** Uniforms holding a single point of trail at each [x, time] given, on the x axis. */
function pointsAt(...points) {
  const uniforms = freshUniforms()
  points.forEach(([x, time], index) => {
    uniforms.uHoverStarts.value[index].set(x, 0, 0, time)
    uniforms.uHoverEnds.value[index].set(x, 0, 0, time)
  })
  return uniforms
}

test('a front spreads out from where the cursor passed, brightest on its edge', () => {
  const { speed, life, front, lingerShare } = columnHover
  const lone = pointsAt([0, 0])
  for (const age of [0.1, 0.3, 0.6]) {
    const radius = age * speed
    // Early on the front is at full strength; well ahead of it, nothing.
    assert.ok(Math.abs(drawnAt(lone, radius, 0, 0, age) - 1) < 1e-9, 'brightest on its front')
    assert.equal(drawnAt(lone, radius + front + 0.01, 0, 0, age), 0)
    // Just behind it, straight down to a quarter.
    const behind = drawnAt(lone, radius - front * 2, 0, 0, age)
    assert.ok(Math.abs(behind - lingerShare) < 0.03, `${behind}`)
  }
  // It stops where it has fully faded: never reaching further.
  for (let age = 0; age < life + 4; age += 0.1) {
    assert.equal(drawnAt(lone, life * speed + 0.05, 0, 0, age), 0)
  }
})

test('the triangles stay lit behind the front, fading evenly for the whole linger', () => {
  const { speed, linger, lingerShare, life } = columnHover
  assert.ok(linger >= 2.5 && linger <= 3.5, 'about three seconds')
  const lone = pointsAt([0, 0])
  const distance = 0.6
  const arrived = distance / speed
  // An even fade: halfway through the linger it is half its starting
  // brightness, and it only ever dims, right to the end.
  const halfway = drawnAt(lone, distance, 0, 0, arrived + linger / 2)
  assert.ok(Math.abs(halfway - lingerShare / 2) < 1e-9, `${halfway}`)
  let last = Infinity
  for (let since = 0.1; since < linger; since += 0.05) {
    const now = drawnAt(lone, distance, 0, 0, arrived + since)
    assert.ok(now <= last + 1e-9 && now > 0)
    last = now
  }
  assert.equal(drawnAt(lone, distance, 0, 0, arrived + linger + 0.01), 0)
  // A spot reached as the front weakens lingers too, but as dimly as the
  // front was then.
  const late = life * 0.75
  assert.ok(drawnAt(lone, late * speed, 0, 0, late + 0.4) > 0)
  assert.ok(drawnAt(lone, late * speed, 0, 0, late + 0.4) < drawnAt(lone, distance, 0, 0, arrived + 0.4))
})

test('fronts never cross: where two meet they stop, and only the outer edge moves on', () => {
  const { speed, lingerShare, linger } = columnHover
  // Two fronts setting out together, two units apart.
  const pair = pointsAt([0, 0], [2, 0])
  // The moment the right-hand front would sweep over x = 0.5, the left-hand
  // one has long since been there: only its fading trail shows, no edge.
  const crossing = 1.5 / speed
  assert.ok(drawnAt(pair, 0.5, 0, 0, crossing) <= lingerShare)
  // On its own, the right-hand front would have lit that spot brightly.
  assert.ok(drawnAt(pointsAt([2, 0]), 0.5, 0, 0, crossing) > 0.8)
  // The outer edges, on untouched stone, carry on regardless.
  assert.ok(drawnAt(pair, -1.5, 0, 0, crossing) > 0.8)
  assert.ok(drawnAt(pair, 3.5, 0, 0, crossing) > 0.8)

  // A front setting out later, inside ground still lit, shows nothing there.
  const inside = pointsAt([0, 0], [0.3, 1])
  const ahead = 0.3 + 0.33
  assert.ok(drawnAt(inside, ahead, 0, 0, 1 + 0.33 / speed) <= lingerShare)
  // Once that ground has faded right out, it is fresh stone again.
  const later = 0.3 / speed + linger + 0.5
  const fresh = pointsAt([0, 0], [0.3, later])
  assert.ok(drawnAt(fresh, ahead, 0, 0, later + 0.33 / speed) > 0.95)
})

test('under reduced motion a trail is a still patch that only fades', () => {
  const { calmRadius, life, linger } = columnHover
  const lone = pointsAt([0, 0])
  let last = Infinity
  for (let age = 0; age < life + linger; age += 0.05) {
    const centre = drawnAt(lone, 0, 0, 0, age, true)
    assert.ok(centre <= last, 'never brightens again: nothing travels')
    assert.equal(drawnAt(lone, calmRadius, 0, 0, age, true), 0)
    assert.ok(drawnAt(lone, calmRadius / 2, 0, 0, age, true) <= centre)
    last = centre
  }
})

test('the cage glows as the ring reaches it, further out and for longer', () => {
  const { speed, cageSpeed, cageLife, life } = columnHover
  // Out where the cage is, after the stone's own scan has faded: its glow
  // runs ahead of the stone's slow scan.
  assert.ok(cageSpeed > speed)
  const age = life + 0.1
  assert.equal(drawnAt(pointsAt([0, 0]), age * speed, 0, 0, age), 0)
  assert.ok(cageStrength(age * cageSpeed, age, false) > 0.2)
  assert.equal(cageStrength(age * cageSpeed + 2, age, false), 0)
  assert.equal(cageStrength(1, cageLife, false), 0)
  assert.ok(cageStrength(1, 0.1, true) > cageStrength(2.5, 0.1, true))
})

test('a moving cursor leaves one unbroken trail, built from joined segments', () => {
  const uniforms = freshUniforms()
  const spawner = createHoverSpawner()
  const { minInterval, maxSegments, speed } = columnHover
  // A steady sweep along x, one frame at a time, as the scene feeds it.
  const step = 1 / 60
  let added = 0
  for (let time = 0; time <= 1.5; time += step) {
    if (emitHoverTrail(spawner, time * 2, 0, 0, time, false, uniforms)) added += 1
  }
  // Far fewer segments than frames: the throttle groups the motion.
  assert.ok(added > 1.5 / (minInterval * 2) && added < 1.5 / minInterval + 2, `${added}`)
  // Every segment starts exactly where the one before it ended.
  const starts = uniforms.uHoverStarts.value
  const ends = uniforms.uHoverEnds.value
  for (let index = 1; index < added; index += 1) {
    assert.deepEqual(starts[index].toArray(), ends[index - 1].toArray())
  }
  // Each point on the path spreads from when the cursor passed it: right
  // after, a point a little ahead of the path is lit wherever along it.
  const now = 1.5 + 0.3
  for (let x = 0.2; x < 2.8; x += 0.05) {
    assert.ok(drawnAt(uniforms, x, 0.1, 0, now) > 0, `gap at ${x}`)
  }
  // Older stretches of the path have spread further than newer ones, and
  // nothing has spread further than the very first point could have.
  const reachAt = (x) => {
    let reach = 0
    for (let y = 0; y < 3; y += 0.01) if (drawnAt(uniforms, x, y, 0, now) > 0) reach = y
    return reach
  }
  assert.ok(reachAt(0.4) > reachAt(2.6) + 0.5, `${reachAt(0.4)} ${reachAt(2.6)}`)
  assert.ok(reachAt(0.4) <= now * speed + columnHover.front)
  assert.ok(added <= maxSegments)
})

test('the trail breaks off the stone, taps stand alone, and no segment is cut short', () => {
  const { minInterval, minTravel, maxJoin, maxSegments, life, linger } = columnHover
  const uniforms = freshUniforms()
  const spawner = createHoverSpawner()
  assert.equal(emitHoverTrail(spawner, 0, 0, 0, 10, false, uniforms), true)
  // Too soon, then too little travel, then both fine.
  assert.equal(emitHoverTrail(spawner, 1, 0, 0, 10 + minInterval / 2, false, uniforms), false)
  assert.equal(emitHoverTrail(spawner, minTravel / 2, 0, 0, 10 + minInterval * 1.5, false, uniforms), false)
  assert.equal(emitHoverTrail(spawner, 1, 0, 0, 10 + minInterval * 1.5, false, uniforms), true)
  assert.deepEqual(uniforms.uHoverStarts.value[1].toArray(), [0, 0, 0, 10])
  // Off the stone and back on elsewhere: a new trail, not a bridge.
  breakHoverTrail(spawner)
  assert.equal(emitHoverTrail(spawner, 1.5, 1, 0, 11, false, uniforms), true)
  assert.deepEqual(uniforms.uHoverStarts.value[2].toArray(), uniforms.uHoverEnds.value[2].toArray())
  // A jump too far in one go breaks it too.
  assert.equal(emitHoverTrail(spawner, 1.5 + maxJoin + 0.1, 1, 0, 11.5, false, uniforms), true)
  assert.deepEqual(uniforms.uHoverStarts.value[3].toArray(), uniforms.uHoverEnds.value[3].toArray())
  // A tap is a point of its own, whatever came before, and the next hover
  // does not join on to it.
  assert.equal(emitHoverTrail(spawner, 9, 9, 0, 11.5, true, uniforms), true)
  assert.deepEqual(uniforms.uHoverStarts.value[4].toArray(), uniforms.uHoverEnds.value[4].toArray())
  assert.equal(spawner.joined, false)

  // A steady sweep can never fill every slot: they free up as fast as it
  // uses them. Only a burst of taps can - and even then nothing is taken
  // over, so no segment is cut short.
  assert.ok(maxSegments * minInterval >= life + linger - 1e-9)
  const busy = freshUniforms()
  const tapper = createHoverSpawner()
  for (let index = 0; index < maxSegments; index += 1) emitHoverTrail(tapper, index, 0, 0, 0, true, busy)
  assert.equal(emitHoverTrail(tapper, 50, 0, 0, life * 0.7, false, busy), false)
  assert.equal(emitHoverTrail(tapper, 50, 0, 0, life + linger + 0.01, false, busy), true)

  clearHoverTrail(spawner, uniforms)
  for (const end of uniforms.uHoverEnds.value) assert.ok(20 - end.w > life + linger)
  assert.equal(spawner.joined, false)
})

test('a cursor that stops just after a segment still gets its ripple where it rests', () => {
  const { minInterval } = columnHover
  const uniforms = freshUniforms()
  const spawner = createHoverSpawner()
  assert.equal(emitHoverTrail(spawner, 0, 0, 0, 10, false, uniforms), true)
  // Moves on and stops too soon for the throttle: nothing yet, and no
  // further moves will come to carry it.
  assert.equal(emitHoverTrail(spawner, 1, 0, 0, 10 + minInterval / 2, false, uniforms), false)
  assert.equal(flushHoverTrail(spawner, 10 + minInterval * 0.9, uniforms), false)
  // Once the throttle allows, the resting point goes out, joined on.
  assert.equal(flushHoverTrail(spawner, 10 + minInterval * 1.1, uniforms), true)
  assert.deepEqual(uniforms.uHoverEnds.value[1].toArray(), [1, 0, 0, 10 + minInterval * 1.1])
  assert.deepEqual(uniforms.uHoverStarts.value[1].toArray(), [0, 0, 0, 10])
  const last = 10 + minInterval * 1.1
  // Only once.
  assert.equal(flushHoverTrail(spawner, last + 0.5 * minInterval, uniforms), false)

  // Coming back onto the stone too soon after leaving it starts a ripple too.
  breakHoverTrail(spawner)
  assert.equal(emitHoverTrail(spawner, 2, 1, 0, last + minInterval / 3, false, uniforms), false)
  assert.equal(flushHoverTrail(spawner, last + minInterval * 1.1, uniforms), true)
  assert.deepEqual(uniforms.uHoverStarts.value[2].toArray(), uniforms.uHoverEnds.value[2].toArray())
  // Leaving the stone drops whatever was held back.
  assert.equal(emitHoverTrail(spawner, 3, 1, 0, last + minInterval * 1.2, false, uniforms), false)
  breakHoverTrail(spawner)
  assert.equal(flushHoverTrail(spawner, last + 5, uniforms), false)
})

/** Two separate box "columns" 1 wide, 4 tall, 0.6 deep, side by side in x.
 *  Indexed, as the model is: tagColumns joins a triangle's corners through
 *  its index. */
function twoColumns() {
  const parts = [-1, 1].map((x) => new BoxGeometry(1, 4, 0.6).translate(x, 0, 0))
  const vertexCount = parts.reduce((sum, part) => sum + part.attributes.position.count, 0)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const indices = []
  let first = 0
  for (const part of parts) {
    positions.set(part.attributes.position.array, first * 3)
    normals.set(part.attributes.normal.array, first * 3)
    for (const index of part.index.array) indices.push(index + first)
    first += part.attributes.position.count
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  assert.equal(tagColumns(geometry), 2)
  return geometry
}

test('the cursor meets each column where the shader has slid it, not where it rests', () => {
  const geometry = twoColumns()
  const picker = createColumnPicker(geometry)
  assert.equal(picker.columnCount, 2)
  const amplitude = 0.3
  // A moment when the right-hand column is slid well up its length.
  const right = [...picker.bounds].findIndex((_, slot) => slot % 6 === 0 && picker.bounds[slot] > 0) / 6
  let time = 0
  while (columnWave(time, picker.phase[right]) < 0.7) time += 0.01
  const slide = amplitude * picker.length[right] * columnWave(time, picker.phase[right])
  assert.ok(slide > 0.5)

  // Aimed straight in, just above the column's resting top: only the slid
  // column is there.
  const y = 2 + slide / 2
  const ray = new Ray(new Vector3(1, y, 10), new Vector3(0, 0, -1))
  const hit = new Vector3()
  assert.equal(pickColumn(picker, ray, time, 0, hit), false)
  assert.equal(pickColumn(picker, ray, time, amplitude, hit), true)
  assert.ok(Math.abs(hit.x - 1) < 1e-5 && Math.abs(hit.y - y) < 1e-5)
  assert.ok(Math.abs(hit.z - 0.3) < 1e-5, 'on the near face')

  // Between the columns there is nothing to hit.
  assert.equal(pickColumn(picker, new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1)), time, amplitude, hit), false)
  // Along a row of both, the nearer one wins.
  const sideways = new Ray(new Vector3(10, 0, 0), new Vector3(-1, 0, 0))
  assert.equal(pickColumn(picker, sideways, 0, 0, hit), true)
  assert.ok(Math.abs(hit.x - 1.5) < 1e-5)
})

test('the column shader carries the hover mesh and nothing GLSL would reject', () => {
  const glsl = Object.values(hoverShaderChunks).join('\n')
  // Outside GLSL's character set, even in a comment.
  assert.doesNotMatch(glsl, /[`\\]/)
  for (const reserved of [/\bflat\b/, /\bfloat distance\b/, /\bsample\b/, /\bsmooth\b/]) {
    assert.doesNotMatch(glsl, reserved)
  }
  assert.match(glsl, new RegExp(`uHoverStarts\\[${columnHover.maxSegments}\\]`))
  assert.match(glsl, new RegExp(`uHoverEnds\\[${columnHover.maxSegments}\\]`))
  assert.match(glsl, /totalEmissiveRadiance \+=/)
  // One first arrival per point, not a sum: fronts never cross.
  assert.match(glsl, /arrivedFor > since/)
  assert.doesNotMatch(glsl, /fronts \+=/)
})
