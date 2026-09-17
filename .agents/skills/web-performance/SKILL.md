---
name: web-performance
description: Build and modify this web experience with performance as a first-class constraint. Apply when changing frontend code, Three.js scenes, 3D assets, textures, animation, effects, loading, or build configuration in this project.
---

# Web Performance

Treat runtime performance, download cost, and responsiveness as part of the feature—not as later cleanup. Preserve the requested visual result, but choose the least expensive implementation that delivers it reliably on both desktop and mobile.

## Make decisions with budgets in mind

- Measure relevant asset sizes, geometry counts, draw calls, texture dimensions, bundle output, and runtime behavior before declaring work complete.
- Keep critical initial downloads small. Load non-critical assets and effects only when they are needed.
- Reuse geometry, materials, textures, and decoded assets instead of creating duplicates.
- Prefer simple, maintainable optimizations with observable benefit over speculative complexity.
- Call out a tradeoff when a requested visual effect materially increases loading time, GPU cost, memory use, or mobile risk.

## Optimize 3D assets for the browser

- Use GLB/glTF for delivered models. Exclude cameras, lights, source meshes, hidden helpers, and authoring-only data unless the experience needs them.
- Apply transforms and required modifiers, export valid normals and tangents, and verify the exported file by importing or rendering it.
- Preserve separate objects only when individual animation, interaction, culling, or material behavior requires them. Otherwise merge compatible meshes to reduce draw calls.
- Share materials and texture atlases across separately animated pieces whenever practical.
- Use the lowest geometry density that preserves the intended silhouette at the actual on-screen size. Consider LODs for assets that cover substantially different viewing distances.
- Use portable PBR materials. Bake unsupported procedural materials and keep editable, lossless source textures outside the public delivery directory.
- Choose texture resolution from expected screen coverage. Compress delivered textures appropriately, while avoiding compression that visibly damages normal maps or masks.
- Use geometry or texture compression only when the runtime decoder is configured, supported, and worth its own download and decode cost.

## Keep rendering and animation efficient

- Cap device pixel ratio instead of rendering unbounded native resolution on high-density displays.
- Avoid per-frame React state updates, object creation, scene traversal, DOM queries, and shader recompilation. Cache references and update mutable render state directly where appropriate.
- Animate only objects and properties that visibly change. Pause work when the scene is hidden, inactive, or offscreen when practical.
- Budget transparent layers, shadows, post-processing passes, particles, and dynamic lights carefully; these costs compound quickly.
- Prefer one intentional lighting setup over many overlapping real-time lights. Limit shadow-casting lights and tune shadow-map resolution to the visible need.
- Preserve frustum culling and sensible near/far camera planes. Avoid giant bounds that keep irrelevant objects rendered.

## Protect loading and interaction

- Preload only critical above-the-fold assets. Use Suspense or an equivalent loading boundary so incomplete assets do not produce broken frames.
- Version changed public assets or use content-hashed filenames so browsers do not retain stale models or textures.
- Keep scrolling and input responsive while assets load and animations run. Respect reduced-motion preferences.
- Avoid adding dependencies for behavior that existing platform or project APIs can provide cleanly.

## Verify every material change

- Run the production build, lint, and relevant tests.
- Inspect build output for unexpected asset or JavaScript growth.
- Perform a real browser render check for 3D, lighting, camera, shader, or animation changes; compilation alone does not verify visual correctness.
- Check at least one mobile-sized viewport when a change affects rendering load, framing, or interaction.
- Report important delivered asset sizes and known performance tradeoffs in the handoff.
