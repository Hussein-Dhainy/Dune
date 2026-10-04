/**
 * The sandstorm transition as pure functions of one number: the section's
 * transition progress, 0..1, straight from sampleCycle(). Every visual channel
 * of the storm is derived here and nowhere else, so scrolling backwards is the
 * same function run in reverse - there is no event-driven state to go stale.
 */

export const transitionTiming = {
  /** Where the main render is handed from the outgoing scene to the incoming
   *  one: just after the wipe's edge has left the top of the view, when the
   *  incoming scene already fills it. */
  switchAt: 0.76,
}

export type TransitionState = {
  /** Section being left and section being entered. */
  index: number
  nextIndex: number
  /** 0..1 through the current section's transition; 0 during its hold. */
  progress: number
  /** Which scene's content should be drawn: index before the switch, nextIndex after. */
  activeSection: number
  /** 0..1 camera pull-back of the active scene. */
  retreat: number
  /** 0..1 pull-back of the incoming scene's own camera during the wipe. */
  incomingRetreat: number
  /** Whether the incoming scene is on screen behind the wipe's edge, and so
   *  needs rendering alongside the outgoing one. */
  incomingVisible: boolean
  /** 0..1 extra wind and airborne sand on top of the resting atmosphere. */
  storm: number
  /** Screen-space leading (upper) edge of the fog and its lower bound,
   *  0 = bottom of the viewport, 1 = top. The lower bound stays below the
   *  screen: the fog only ever advances. */
  cloudTop: number
  /** Slope of that edge across the screen: how much higher it sits at the
   *  left edge than the right, in viewport heights. Only the start of the
   *  wipe is diagonal; it levels out as the fog rises. */
  cloudTilt: number
  cloudBottom: number
  /** 0..1 opacity of the fog band along the edge. */
  cloudDensity: number
  /** 0..1 radial smear, and separately the RGB separation. */
  distortion: number
  aberration: number
  /** 0..1 digital texture of the crossing: block slips and scanlines. */
  glitch: number
  /** 1 while the scene is settled and interactive, fading to 0 in the storm.
   *  Scales pointer parallax and gates pyramid hover. */
  interaction: number
  /** Share of the viewport the incoming scene has taken, for debugging and tests. */
  coverage: number
}

export function createTransitionState(): TransitionState {
  return {
    index: 0,
    nextIndex: 0,
    progress: 0,
    activeSection: 0,
    retreat: 0,
    incomingRetreat: 0,
    incomingVisible: false,
    storm: 0,
    cloudTop: -0.3,
    cloudTilt: 0,
    cloudBottom: -0.5,
    cloudDensity: 0,
    distortion: 0,
    aberration: 0,
    glitch: 0,
    interaction: 1,
    coverage: 0,
  }
}

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t
}

type CycleSample = { index: number; nextIndex: number; transition: number }

/**
 * Fills `out` for one frame. Allocation-free, so it is safe in useFrame.
 * Reduced motion keeps the cover-and-switch (the only way to reach the next
 * scene) but drops distortion and aberration and shortens the camera move.
 */
export function sampleTransition(sample: CycleSample, reducedMotion: boolean, out: TransitionState) {
  const p = sample.transition
  const { switchAt } = transitionTiming
  out.index = sample.index
  out.nextIndex = sample.nextIndex
  out.progress = p
  out.activeSection = p < switchAt ? sample.index : sample.nextIndex

  // The incoming scene is drawn behind the advancing edge for the whole wipe,
  // already easing in from its own pulled-back camera, so it is a moving,
  // live scene from the first moment it shows - not a still that starts up
  // once the wipe is over. After the swap it simply carries on.
  out.incomingRetreat = 1 - smoothstep(p, 0.3, 0.97)
  out.incomingVisible = p > 0.03 && p < switchAt
  out.retreat = p < switchAt ? smoothstep(p, 0.08, switchAt) : out.incomingRetreat

  out.storm = smoothstep(p, 0.08, 0.35) * (1 - smoothstep(p, 0.7, 0.92))

  // A true wipe: one edge climbs from below the viewport to above it. Above
  // it is the outgoing scene, below it the incoming one - there is never a
  // moment with neither on screen. The fog is only a band hugging that edge.
  out.cloudTop = lerp(-0.35, 1.5, smoothstep(p, 0.05, 0.72))
  // The edge comes in on the diagonal, from the upwind (left) side first,
  // and has levelled off well before it reaches the top.
  out.cloudTilt = 0.85 * (1 - smoothstep(p, 0.16, 0.5))
  out.cloudBottom = -0.6
  out.cloudDensity = smoothstep(p, 0.04, 0.14) * (1 - smoothstep(p, 0.66, switchAt))

  if (reducedMotion) {
    out.distortion = 0
    out.aberration = 0
    out.glitch = 0
  } else {
    // The digital distortion belongs to the outgoing scene as it is
    // overtaken: it starts with the first edge and is gone as the edge leaves
    // the top. The shader concentrates it along the edge, and never applies
    // it to the incoming scene.
    out.distortion = smoothstep(p, 0.06, 0.28) * (1 - smoothstep(p, 0.6, 0.74))
    out.aberration = out.distortion * 0.9
    out.glitch = smoothstep(p, 0.1, 0.3) * (1 - smoothstep(p, 0.6, 0.74))
  }

  out.interaction = p < switchAt
    ? 1 - smoothstep(p, 0.02, 0.16)
    : smoothstep(p, 0.8, 1)

  // How much of the view the incoming scene has taken. Zero again once the
  // swap has happened and nothing is being wiped any more.
  out.coverage = p < switchAt ? Math.min(Math.max(out.cloudTop, 0), 1) : 0
  return out
}
