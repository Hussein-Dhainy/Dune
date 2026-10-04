/**
 * The thin line network that rises around the sandstone formation: small "+"
 * markers drifting upward beside it, joined to their nearest neighbours by
 * lines that come and go as the markers pass one another, and across the
 * formation by long struts that pass behind it or over and under it, so the
 * whole reads as a loose cage round the stone.
 *
 * The layout is built once from a seed and only ever read after that. Where
 * an anchor is at any moment is a pure function of the elapsed time (see
 * sampleAnchor), so there is no state to step and nothing to allocate per
 * frame. Units are the formation rig's own (the formation is about 4.2 wide
 * and 5.7 tall there, centred on the origin): +x right, +y up, +z towards the
 * camera.
 */
export type ShardNetwork = {
  anchorCount: number
  /** -1 left of the formation, 1 right of it, 0 behind its centre line. */
  side: Int8Array
  /** For side anchors, the distance out past the guard's edge and its gap
   *  (before the view's spread); for those behind the centre, x itself. */
  baseX: Float32Array
  baseZ: Float32Array
  /** 0..1 share of the rise each anchor is at when the clock starts. */
  phase: Float32Array
  /** Seconds each anchor takes to cross the field from bottom to top. */
  cycle: Float32Array
  /** Sway as it rises, sideways and in depth: amplitudes, a rate in radians per
   *  second, and a starting phase. */
  driftX: Float32Array
  driftZ: Float32Array
  driftRate: Float32Array
  driftPhase: Float32Array
  /** Per-anchor seed for where it is re-scattered each time it comes round. */
  scatter: Uint32Array
  /** Most lines to its own side one anchor may hold at once: 2 or 3. */
  maxLinks: Uint8Array
  /** Most struts across the formation it may hold: 1 or 2 on the flanks. */
  maxSpans: Uint8Array
  /** Anchor pairs that can ever come close enough to join: from, to. Every
   *  other pair is too far apart sideways to bother testing. */
  candidateCount: number
  candidates: Uint16Array
  /** Per candidate: 1 for a strut from one flank across to the other. */
  span: Uint8Array
}

/** How the field is fitted to the current frame. Written in place per frame. */
export type NetworkView = {
  /** 0..1 share of the side lanes' width kept: narrow screens pull them in. */
  spread: number
  /** Multiple of the field's height: narrow screens stretch it vertically. */
  stretch: number
  /** Multiple of the guard's size. The line group is scaled apart from the
   *  formation, so the guard grows when the group shrinks. */
  guard: number
  /** 0..1 share of the sideways and depth wander. */
  drift: number
}

/** Everything one frame of the network needs, preallocated once. */
export type NetworkFrame = {
  /** Every anchor's position (x, y, z) and 0..1 visibility. */
  positions: Float32Array
  fades: Float32Array
  /** Per candidate: length, and 0..1 strength - the distance falloff times
   *  the clearance from the formation; 0 when it cannot be drawn. */
  distance: Float32Array
  strength: Float32Array
  /** Per candidate: 1 when it is one of the lines drawn. */
  linked: Uint8Array
  /** Candidates, shortest first. Kept between frames, so the anchors' slow
   *  movement leaves it nearly sorted and re-sorting it costs next to nothing. */
  order: Uint16Array
  /** Lines to its own side, and struts across, held by each anchor. */
  links: Uint8Array
  spans: Uint8Array
}

export const shardNetworkSeed = 0x5a9d51

export const networkField = {
  /** The field runs from this far below the centre to as far above it. */
  halfHeight: 5.6,
  /** Height over which an anchor fades in after it appears at the bottom,
   *  and out before it reaches the top. */
  fadeBand: 1.1,
  /** Rounded rectangle (a superellipse) kept clear around the formation's
   *  outline from the camera, wide enough for its tumble and lean. */
  guardX: 2.55,
  guardY: 3.45,
  /** Side lanes: a fixed gap out from the guard's edge, more than the
   *  wander can close, then this much width to spread across. */
  innerGap: 0.25,
  /** Widest sideways sway an anchor takes as it rises, edge to edge. */
  maxSway: 1.1,
  maxOffset: 2.8,
  /** Over this much of the guard's radius beyond its edge, an anchor fades
   *  out as it nears the formation: slowly for those that pass behind it,
   *  barely at all for the flanks, which never come that close. */
  centreFade: 0.25,
  sideFade: 0.06,
  /** Behind the centre: how far either side, and the depths. */
  centreHalfWidth: 1.9,
  centreNear: -2.6,
  centreFar: -3.3,
  sideNear: -0.9,
  sideFar: -3.4,
  /** Each lap starts from a fresh spot this far either side of the anchor's
   *  lane, sideways and in depth. */
  recycleX: 0.45,
  recycleZ: 0.25,
  /** Seconds to cross the whole field, fastest and slowest. */
  fastestCycle: 9.5,
  slowestCycle: 13.5,
  /** Lines are full strength up to `near` and gone by `reach`. */
  near: 2,
  reach: 3.6,
  /** The same for the struts across the formation. */
  spanNear: 7,
  spanReach: 9.6,
  /** A line may cross the formation's outline only with both ends at least
   *  this far behind its centre, where the stone's own depth hides the part
   *  it passes behind; it fades in over the half unit before. */
  behindDepth: -1.1,
  /** Anchors fainter than this neither hold nor take a line. */
  linkFade: 0.05,
  /** Narrowest spread, and how much the field stretches at it. */
  minSpread: 0.15,
  narrowStretch: 0.45,
  /** Range of the guard multiplier: 1 / the line group's scale. */
  maxGuard: 1 / 0.7,
  minGuard: 1 / 1.18,
}

const guardPower = 4
const clearanceSteps = 10

/** Small seeded generator (mulberry32): the same sequence for the same seed. */
function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One-shot 0..1 hash of a seed and a lap number: where a lap starts. */
function hash01(seed: number, lap: number) {
  let t = (seed ^ Math.imul(lap, 0x9e3779b1)) >>> 0
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296
}

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Under 1 inside the guard round the formation, 1 on its edge. */
export function guardRadius(x: number, y: number, guard = 1) {
  const u = Math.abs(x) / (networkField.guardX * guard)
  const v = Math.abs(y) / (networkField.guardY * guard)
  return (u ** guardPower + v ** guardPower) ** (1 / guardPower)
}

export function insideSilhouette(x: number, y: number, guard = 1) {
  return guardRadius(x, y, guard) < 1
}

/** Side-lane spread that keeps the field on screen, from the half-width of
 *  the view in rig units at the formation's depth. */
export function networkSpread(viewHalfWidth: number) {
  const room = viewHalfWidth * 0.9 - networkField.guardX - networkField.innerGap - networkField.maxSway
  const spread = room / networkField.maxOffset
  return Math.min(Math.max(spread, networkField.minSpread), 1)
}

/** What a narrow screen loses sideways, the field gains in height. */
export function networkStretch(spread: number) {
  return 1 + (1 - spread) * networkField.narrowStretch
}

export function createNetworkView(): NetworkView {
  return { spread: 1, stretch: 1, guard: 1, drift: 1 }
}

export function createShardNetwork(anchorCount = 34, seed = shardNetworkSeed): ShardNetwork {
  const random = createRandom(seed)
  const field = networkField
  const side = new Int8Array(anchorCount)
  const baseX = new Float32Array(anchorCount)
  const baseZ = new Float32Array(anchorCount)
  const phase = new Float32Array(anchorCount)
  const cycle = new Float32Array(anchorCount)
  const driftX = new Float32Array(anchorCount)
  const driftZ = new Float32Array(anchorCount)
  const driftRate = new Float32Array(anchorCount)
  const driftPhase = new Float32Array(anchorCount)
  const scatter = new Uint32Array(anchorCount)
  const maxLinks = new Uint8Array(anchorCount)
  const maxSpans = new Uint8Array(anchorCount)

  // Most anchors flank the formation; a few pass behind its centre, and only
  // show above and below it.
  const centreCount = Math.max(2, Math.round(anchorCount * 0.24))
  const leftCount = Math.ceil((anchorCount - centreCount) / 2)
  const lanes: Array<[number, number]> = [[-1, leftCount], [1, anchorCount - centreCount - leftCount], [0, centreCount]]
  let anchor = 0
  for (const [lane, count] of lanes) {
    // Stratified in both height and width, with the strata shuffled against
    // each other, so no two anchors start stacked or side by side.
    const columns = Array.from({ length: count }, (_, index) => index)
    for (let index = count - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1))
      ;[columns[index], columns[swap]] = [columns[swap], columns[index]]
    }
    for (let index = 0; index < count; index += 1, anchor += 1) {
      const across = (columns[index] + 0.15 + random() * 0.7) / count
      side[anchor] = lane
      phase[anchor] = (index + 0.15 + random() * 0.7) / count
      if (lane === 0) {
        baseX[anchor] = (across * 2 - 1) * field.centreHalfWidth
        baseZ[anchor] = field.centreNear + random() * (field.centreFar - field.centreNear)
      } else {
        baseX[anchor] = across * field.maxOffset
        baseZ[anchor] = field.sideNear + random() * (field.sideFar - field.sideNear)
      }
    }
  }
  for (anchor = 0; anchor < anchorCount; anchor += 1) {
    cycle[anchor] = field.fastestCycle + random() * (field.slowestCycle - field.fastestCycle)
    driftX[anchor] = (field.maxSway / 2) * (0.5 + random() * 0.5)
    driftZ[anchor] = 0.2 + random() * 0.25
    // Periods of 7 to 14 seconds - about one full sway per rise - none of
    // them shared, so neighbours drift apart and back rather than in step.
    driftRate[anchor] = 0.45 + random() * 0.45
    driftPhase[anchor] = random() * Math.PI * 2
    scatter[anchor] = Math.floor(random() * 4294967296) >>> 0
    maxLinks[anchor] = random() < 0.7 ? 3 : 2
    maxSpans[anchor] = side[anchor] === 0 ? 0 : random() < 0.35 ? 2 : 1
  }

  // Anchors only ever rise; sideways they stay near their lanes. So a pair
  // whose lanes are further apart than a line can reach, even with every
  // wander and re-scatter pulling them together, can never join. Opposite
  // flanks are struts, with their own, longer reach.
  const laneX = (index: number, guard: number) => side[index] === 0
    ? baseX[index]
    : side[index] * (field.guardX * guard + field.innerGap + baseX[index])
  const pairs: number[] = []
  const spans: number[] = []
  for (let from = 0; from < anchorCount; from += 1) {
    for (let to = from + 1; to < anchorCount; to += 1) {
      const across = side[from] * side[to] === -1
      if (across && !(maxSpans[from] && maxSpans[to])) continue
      // Spread under 1 only draws a flank's lanes closer together, and a
      // smaller guard only draws the flanks closer to the centre.
      const apart = Math.abs(laneX(from, field.minGuard) - laneX(to, field.minGuard))
      const slack = 2 * (field.recycleX + driftX[from] + driftX[to])
      if (apart - slack <= (across ? field.spanReach : field.reach)) {
        pairs.push(from, to)
        spans.push(across ? 1 : 0)
      }
    }
  }

  return {
    anchorCount,
    side,
    baseX,
    baseZ,
    phase,
    cycle,
    driftX,
    driftZ,
    driftRate,
    driftPhase,
    scatter,
    maxLinks,
    maxSpans,
    candidateCount: pairs.length / 2,
    candidates: Uint16Array.from(pairs),
    span: Uint8Array.from(spans),
  }
}

/** Radius of a sphere, about (0, 0, centreZ), holding every anchor in every
 *  view - so culling can use one fixed bound and never recompute it. */
export function networkBounds(network: ShardNetwork) {
  const field = networkField
  let drift = 0
  for (let anchor = 0; anchor < network.anchorCount; anchor += 1) {
    drift = Math.max(drift, 2 * network.driftX[anchor], network.driftZ[anchor])
  }
  const near = field.sideNear + field.recycleZ + drift
  const far = field.centreFar - field.recycleZ - drift
  const centreZ = (near + far) / 2
  // x and y both move linearly with the spread, so the farthest point is at
  // one end of its range or the other.
  let radius = 0
  for (const spread of [field.minSpread, 1]) {
    const x = field.guardX * field.maxGuard + field.innerGap + (field.maxOffset + field.recycleX) * spread + drift
    const y = field.halfHeight * networkStretch(spread)
    radius = Math.max(radius, Math.hypot(x, y, (near - far) / 2))
  }
  return { centreZ, radius }
}

/**
 * Writes anchor `anchor`'s position at `time` seconds into `out` at `offset`,
 * and returns how visible it is, 0..1: faded in over the bottom of the field,
 * out over the top, and out wherever it passes behind the formation.
 *
 * Each anchor wraps on its own. Its lap number seeds where the next lap
 * starts, so it comes round somewhere new - but only ever while it is fully
 * faded out, at the field's edge.
 */
export function sampleAnchor(
  network: ShardNetwork,
  anchor: number,
  time: number,
  view: NetworkView,
  out: Float32Array,
  offset: number,
) {
  const field = networkField
  const travelled = network.phase[anchor] + time / network.cycle[anchor]
  const lap = Math.floor(travelled)
  const half = field.halfHeight * view.stretch
  const band = field.fadeBand * view.stretch
  const y = ((travelled - lap) * 2 - 1) * half

  const seed = network.scatter[anchor]
  const scatterX = (hash01(seed, lap) * 2 - 1) * field.recycleX
  const scatterZ = (hash01(seed ^ 0x5bd1e995, lap) * 2 - 1) * field.recycleZ
  // Each anchor sways as it climbs: sideways with a quicker ripple on top, so
  // it never reads as a plain pendulum, and in depth a quarter turn behind,
  // so in perspective it traces a loose spiral. The flanks sway outward only
  // (0..twice the amplitude), so the gap round the formation always holds.
  const wave = time * network.driftRate[anchor] + network.driftPhase[anchor]
  const swing = (Math.sin(wave) + 0.35 * Math.sin(wave * 2.3 + 1.1)) / 1.35
  const lane = network.side[anchor]
  const sway = lane === 0 ? swing : lane * (1 + swing)
  // Narrow screens have less room beside the formation, so less sway.
  const wanderX = network.driftX[anchor] * view.drift * (0.5 + 0.5 * view.spread) * sway
  const wanderZ = network.driftZ[anchor] * view.drift * Math.cos(wave + 0.4)

  const x = lane === 0
    ? network.baseX[anchor] + scatterX + wanderX
    : lane * (
      field.guardX * view.guard
      + field.innerGap
      // Reflected off the inner edge rather than clamped to it, so laps that
      // start near the formation do not all start at the same spot.
      + Math.abs(network.baseX[anchor] + scatterX) * view.spread
    ) + wanderX
  out[offset] = x
  out[offset + 1] = y
  out[offset + 2] = network.baseZ[anchor] + scatterZ + wanderZ

  const edges = smoothstep(y, -half, -half + band) * (1 - smoothstep(y, half - band, half))
  const fadeBand = lane === 0 ? field.centreFade : field.sideFade
  return edges * smoothstep(guardRadius(x, y, view.guard), 1, 1 + fadeBand)
}

/** 0..1: how far the line between two points keeps clear of the guard - or,
 *  failing that, how far behind the formation it passes. */
function clearance(positions: Float32Array, from: number, to: number, guard: number) {
  const front = Math.max(positions[from + 2], positions[to + 2])
  const behind = 1 - smoothstep(front, networkField.behindDepth - 0.5, networkField.behindDepth)
  if (behind >= 1) return 1
  let closest = Infinity
  for (let step = 0; step <= clearanceSteps; step += 1) {
    const t = step / clearanceSteps
    const radius = guardRadius(
      positions[from] + (positions[to] - positions[from]) * t,
      positions[from + 1] + (positions[to + 1] - positions[from + 1]) * t,
      guard,
    )
    if (radius < closest) closest = radius
  }
  // Starts a touch outside the guard, so a dip between the samples above
  // still never reaches it.
  return Math.max(smoothstep(closest, 1.02, 1.12), behind)
}

export function createNetworkFrame(network: ShardNetwork): NetworkFrame {
  return {
    positions: new Float32Array(network.anchorCount * 3),
    fades: new Float32Array(network.anchorCount),
    distance: new Float32Array(network.candidateCount),
    strength: new Float32Array(network.candidateCount),
    linked: new Uint8Array(network.candidateCount),
    order: Uint16Array.from({ length: network.candidateCount }, (_, index) => index),
    links: new Uint8Array(network.anchorCount),
    spans: new Uint8Array(network.anchorCount),
  }
}

/**
 * Fills `frame` for `time` seconds: every anchor's position and fade, and the
 * lines drawn - each anchor joined to its nearest neighbours in turn, nearest
 * pairs first, until it holds its share, and then to its nearest partner on
 * the far side if it takes a strut. Allocation-free, so safe in useFrame.
 */
export function updateNetwork(network: ShardNetwork, time: number, view: NetworkView, frame: NetworkFrame) {
  const { positions, fades, distance, strength, linked, order, links, spans } = frame
  for (let anchor = 0; anchor < network.anchorCount; anchor += 1) {
    fades[anchor] = sampleAnchor(network, anchor, time, view, positions, anchor * 3)
  }

  const { candidates, candidateCount, span } = network
  for (let candidate = 0; candidate < candidateCount; candidate += 1) {
    const from = candidates[candidate * 2] * 3
    const to = candidates[candidate * 2 + 1] * 3
    const length = Math.hypot(
      positions[to] - positions[from],
      positions[to + 1] - positions[from + 1],
      positions[to + 2] - positions[from + 2],
    )
    distance[candidate] = length
    const near = span[candidate] ? networkField.spanNear : networkField.near
    const reach = span[candidate] ? networkField.spanReach : networkField.reach
    strength[candidate] = length >= reach
      ? 0
      : (1 - smoothstep(length, near, reach)) * clearance(positions, from, to, view.guard)
  }

  for (let index = 1; index < candidateCount; index += 1) {
    const held = order[index]
    let slot = index
    while (slot > 0 && distance[order[slot - 1]] > distance[held]) {
      order[slot] = order[slot - 1]
      slot -= 1
    }
    order[slot] = held
  }

  links.fill(0)
  spans.fill(0)
  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = order[index]
    const from = candidates[candidate * 2]
    const to = candidates[candidate * 2 + 1]
    // Struts draw on their own budget, so the cage never starves the chains.
    const held = span[candidate] ? spans : links
    const most = span[candidate] ? network.maxSpans : network.maxLinks
    const join = strength[candidate] > 0
      && fades[from] > networkField.linkFade
      && fades[to] > networkField.linkFade
      && held[from] < most[from]
      && held[to] < most[to]
    linked[candidate] = join ? 1 : 0
    if (join) {
      held[from] += 1
      held[to] += 1
    }
  }
  return frame
}
