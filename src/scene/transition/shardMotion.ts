import { sections, sectionStart, wrap } from '../../experience/cycle.ts'

/**
 * The sandstone shard's scroll choreography as pure functions of one number:
 * the cycle position the ExperienceDirector already smooths. Nothing here
 * keeps state, so scrolling backwards is the same function run in reverse.
 *
 * The shard belongs to one section and is on stage three times over:
 *  - entering, through the transition of the section before it;
 *  - holding, through its own section's hold;
 *  - exiting, through its own section's transition, until the storm swaps
 *    scenes at transitionTiming.switchAt.
 */
export const shardSection = 1

const previousSection = (shardSection + sections.length - 1) % sections.length
const previous = sections[previousSection]
const previousStart = sectionStart(previousSection)
const own = sections[shardSection]
const ownStart = sectionStart(shardSection)

export const shardTiming = {
  /** Share of the previous section's transition over which the shard rises.
   *  It starts once the wipe's edge is on screen and lands exactly as the
   *  hold begins, alongside the incoming camera's own ease-in. */
  enterFrom: 0.3,
  enterTo: 1,
  /** Share of its own transition over which it leaves. Done before the wipe
   *  has covered the view (0.72), well ahead of the scene swap (0.76). */
  exitFrom: 0.02,
  exitTo: 0.66,
}

export const shardTravel = {
  /** World units below the hero position it starts from, and above it that
   *  it leaves to. The pulled-back camera sees ~10 units either side of its
   *  target, so both ends are clear of the viewport. */
  rise: 15,
  lift: 16,
  /** Radians per scroll unit, all the way through: the tumble about all three
   *  axes that carries on across the hold. Rates differ so the poses never
   *  line up into a plain spin. */
  turnRate: 0.5,
  pitchRate: 0.38,
  rollRate: 0.27,
  /** Extra yaw unwound on the way in and wound up on the way out. */
  enterSpin: 2.6,
  exitSpin: 2.4,
  /** Lean it settles out of as it arrives, and into as it leaves. */
  enterTiltX: 0.4,
  enterTiltZ: -0.26,
  exitTiltX: -0.3,
  exitTiltZ: 0.2,
  enterScale: 0.86,
  exitScale: 0.9,
  /** The line network opens out slightly as it lets go. */
  linesEnterScale: 0.7,
  linesExitScale: 1.18,
}

export type ShardMotion = {
  /** Whether the shard can be on screen at all at this position. */
  onStage: boolean
  /** Eased 0..1 arrival and departure. Both rest during the hold: 1 and 0. */
  enter: number
  exit: number
  /** World units from the hero position: negative below, positive above. */
  offsetY: number
  yaw: number
  /** Scroll-driven tumble about X and Z, on top of the entry and exit leans. */
  pitch: number
  roll: number
  tiltX: number
  tiltZ: number
  scale: number
  /** 0..1 share of the idle hover and pointer offsets: 1 during the hold. */
  settle: number
  linesOpacity: number
  linesScale: number
}

export function createShardMotion(): ShardMotion {
  return {
    onStage: false,
    enter: 0,
    exit: 0,
    offsetY: -shardTravel.rise,
    yaw: 0,
    pitch: 0,
    roll: 0,
    tiltX: 0,
    tiltZ: 0,
    scale: 1,
    settle: 0,
    linesOpacity: 0,
    linesScale: 1,
  }
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t
}

/** Slow out of rest, slow into rest: no velocity at either end, so the rise
 *  meets the hold, and the hold meets the exit, without a visible join. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** Fills `out` for one cycle position. Allocation-free, so safe in useFrame. */
export function sampleShardMotion(position: number, out: ShardMotion) {
  const progress = wrap(position)
  // Linear 0..1 through the entry and exit windows, and scroll units measured
  // from the start of the hold (negative on the way in).
  let entering = 0
  let exiting = 0
  let travel = 0
  let onStage = false

  const previousLocal = progress - previousStart
  const ownLocal = progress - ownStart
  if (ownLocal >= 0 && ownLocal < own.hold + own.transition) {
    const transition = clamp01((ownLocal - own.hold) / own.transition)
    entering = 1
    exiting = clamp01((transition - shardTiming.exitFrom) / (shardTiming.exitTo - shardTiming.exitFrom))
    travel = ownLocal
    onStage = exiting < 1
  } else if (previousLocal >= 0 && previousLocal < previous.hold + previous.transition) {
    const transition = clamp01((previousLocal - previous.hold) / previous.transition)
    entering = clamp01((transition - shardTiming.enterFrom) / (shardTiming.enterTo - shardTiming.enterFrom))
    travel = (transition - 1) * previous.transition
    onStage = entering > 0
  }

  const enter = easeInOutCubic(entering)
  const exit = easeInOutCubic(exiting)
  const arriving = 1 - entering
  out.onStage = onStage
  out.enter = enter
  out.exit = exit
  out.offsetY = -shardTravel.rise * (1 - enter) + shardTravel.lift * exit
  // The extra spin has no velocity where it meets the hold, so the turn never
  // changes speed abruptly: it only ever eases into and out of turnRate.
  out.yaw = shardTravel.turnRate * travel
    - shardTravel.enterSpin * arriving ** 3
    + shardTravel.exitSpin * exiting ** 3
  out.pitch = shardTravel.pitchRate * travel
  out.roll = shardTravel.rollRate * travel
  out.tiltX = shardTravel.enterTiltX * arriving ** 2 + shardTravel.exitTiltX * exiting ** 2
  out.tiltZ = shardTravel.enterTiltZ * arriving ** 2 + shardTravel.exitTiltZ * exiting ** 2
  out.scale = lerp(shardTravel.enterScale, 1, enter) * lerp(1, shardTravel.exitScale, exit)
  out.settle = enter * (1 - exit)
  // The lines arrive after the stone and let go before it.
  out.linesOpacity = smoothstep(enter, 0.5, 1) * (1 - smoothstep(exit, 0, 0.4))
  out.linesScale = lerp(shardTravel.linesEnterScale, 1, enter) * lerp(1, shardTravel.linesExitScale, exit)
  return out
}
