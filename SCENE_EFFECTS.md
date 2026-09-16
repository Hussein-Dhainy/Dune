# Landing scene and transition effects

This document describes the intended visual behavior for the desert experience.
The reference is Igloo.inc, adapted to a pyramid surrounded by desert terrain.
These are visual requirements, not a claim about the reference site's exact implementation.

## Loading and entrance

1. Display a loading screen while the initial assets load and shaders prepare.
2. Begin with a camera looking down toward the pyramid from above.
3. Lower the camera and tilt toward the pyramid, settling into an elevated,
   angled view with the pyramid as the foreground focal point.
4. Coordinate the camera movement with a spatial reveal of the landscape.

### Expanding spatial reveal

- The pyramid and terrain begin invisible.
- The reveal originates at a single point: the pyramid's peak.
- A reveal boundary expands outward in world space, exposing the pyramid first
  and then the surrounding ground and distant terrain.
- Visibility depends on distance from that origin. This is not a uniform fade
  of the entire scene, and objects should not grow or move into place.
- An expanding sphere is the initial implementation model. Its radius controls
  which surfaces have been revealed.
- The boundary's softness, noise, and any bright edge treatment remain to be
  tuned. Use the reference animation to decide how pronounced these should be.
- The entrance plays once per visit. Returning through the scroll loop uses a
  scene transition rather than replaying loading and the entrance.

## Settled landing scene

- Keep the pyramid centered as the main landmark, surrounded by actual 3D dunes.
- Use an elevated, angled camera composition with foreground ground, middle
  distance dunes, and a distant landscape that blends into the sky.
- Terrain geometry supplies dune slopes and crests. Material detail supplies
  fine wind ripples and sand grain.
- Directional sunlight should make dune shapes and pyramid faces readable.
- Desert haze should soften distant terrain and conceal the landscape limits.
- Consider subtle heat shimmer and sparse drifting sand as ambient effects;
  these are proposed additions, with intensity to be decided during terrain work.
- Keep the resting scene clear. Strong glitch, streaking, and dissolve effects
  belong to transitions.

## Scroll transitions

The experience loops in both directions. Scroll controls transition progress;
effects must reverse naturally when the user reverses scrolling. Do not move the
camera sideways between landmarks as the current placeholder does. Use framing
and depth movement that preserve the focal point, with scene changes concealed
by the transition effects. The exact camera path remains to be designed.

### Effects to combine

| Effect | Visible behavior | Desert treatment |
| --- | --- | --- |
| Radial streaking | Image details stretch outward from near the landmark, suggesting a zoom or shockwave. | Center the distortion around the pyramid's projected position; keep its silhouette more readable than the surroundings. |
| Chromatic aberration | Color channels separate into fringes around high-contrast edges. | Use controlled color separation during transitions, strongest around distorted edges, fading back to a clean image. |
| Blocky displacement | Rectangular regions shift and fragment portions of the image. | Preserve the reference's digital character with localized patches affecting the pyramid and terrain. |
| Sand dissolve | Cloudy regions progressively obscure or expose scene detail. | Adapt the reference's pale frost-like dissolve into warm dust and sand that conceal the scene exchange. |
| Fine colored noise | Grain appears around distorted boundaries and displaced regions. | Use restrained grain concentrated near the active transition, avoiding persistent noise over the whole resting scene. |
| Heat distortion | Uneven refraction bends the image. | Proposed desert-specific layer to accompany the dissolve; tune it so it does not overpower the radial and blocky effects. |

Radial streaking is inferred from the supplied transition screenshot. Its motion,
timing, and whether it follows camera movement need confirmation from a recording.
Heat distortion and the sand treatment are proposed adaptations, not confirmed
features of the reference.

### Transition sequence

1. Start from a clear, settled scene.
2. Increase radial distortion, displacement, color separation, and edge noise
   as the outgoing scene begins to dissolve into dust.
3. Conceal the scene exchange near the strongest part of the transition.
4. Resolve the incoming scene as dust and distortion recede.
5. Finish with a clear image and stable camera framing.

The landmark should remain a visual anchor for as much of the transition as
possible. Avoid a simple sideways camera journey or a flat fade to black as the
final transition treatment. The current dark veil is a temporary placeholder.

## Loop continuity and implementation constraints

- Use the existing continuous scroll position and section transition progress.
- Keep one director responsible for the camera and effect updates.
- At the loop boundary, camera pose, target, scene visibility, and effect values
  must match the beginning of the cycle, in both scroll directions.
- Seek effects directly from progress rather than triggering one-way animations
  when thresholds are crossed. Fast scrolling and direction changes must work.
- Provide a reduced-motion treatment that avoids radial streaking, strong
  displacement, and animated camera travel.
- Fine-tune effect strengths, reveal timing, and transition durations in the
  browser once the terrain and pyramid are available.
- The screenshots show color separation and noise affecting some reference UI
  text. Whether our overlays should receive similar effects remains undecided.

## Reference

Abeto's [Igloo Inc. case study](https://www.awwwards.com/igloo-inc-case-study.html)
describes scene transitions combining chromatic aberration, tech displacement,
and frost. It also confirms that the intro runs in real time using code and
custom shaders. The supplied screenshots establish the settled composition and
the visual appearance of a transition, but cannot establish its exact motion.
