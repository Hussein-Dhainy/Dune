# Dune

Immersive website foundation with Vite, React, TypeScript, Three.js, React Three Fiber, Drei, and GSAP.

## Development

```sh
npm install
npm run dev
```

## Validation and production

```sh
npm run lint
npm test
npm run build
npm run preview
```

The prototype has three placeholder landmarks and an infinite scroll cycle in
both directions. The loading phase waits for Three.js asset loading and shader
warmup, then a top-down entrance settles into the first camera pose. The scale
animation and dark transition veil are temporary stand-ins for the final reveal
and scene effects. Desert terrain is not implemented yet.

Scroll with a wheel, trackpad, touch swipe, arrow keys, Page Up/Down, or Space
(Shift+Space reverses). Home/End travel one full cycle backward/forward. The
scroll region receives keyboard focus when the intro finishes; Tab accesses the
development controls. Reduced motion skips the animated entrance and camera
travel and disables smoothing and the transition veil.

## Controller

- `src/experience/cycle.ts`: section hold/transition durations, pixels per scroll
  unit, damping, and pure progress mapping.
- `LoopScrollProvider.tsx`: native input, scroll recentering, and mutable position
  refs. Native scroll is the only input owner; do not add a second scroll library.
- `ExperienceDirector.tsx`: loading/intro/interactive handoff, frame updates, and
  paused GSAP timelines scrubbed from scroll progress. This is the camera owner.
- `cameraPath.ts`: camera poses and interpolation, including the final return to
  the first pose with zero velocity at the boundary.
- `DebugOverlay.tsx`: live position/progress, nearest section and transition jumps,
  and an intro skip button. Included only in development.

Smoothing runs on the unwrapped position; only the resulting progress wraps.
Recentering the native container updates its input baseline without changing the
accumulated position. Resize also resets only this baseline. No React state
updates occur per animation frame.

When adding sections, update both the section configuration and camera poses.
Keep the last transition's ending camera, scene state, and effects identical to
the beginning. Add scene assets in `src/scene/Scene.tsx`, overlays in `src/App.tsx`,
and models/textures in `public/`. Suspended assets should live under the scene's
Suspense boundary, leaving the director mounted to manage loading.

## Browser checks

```sh
npx playwright install chromium
npm run test:browser
```

To use installed Chrome instead, set `PLAYWRIGHT_CHANNEL=chrome` (PowerShell:
`$env:PLAYWRIGHT_CHANNEL='chrome'`). The suite checks desktop and mobile-emulated
Chromium, including touch input, intro handoff, resizing, reverse scrolling,
repeated recentering, debug navigation, and reduced motion. Physical mobile
devices and Safari should also be checked when the final terrain and effects
are ready.
