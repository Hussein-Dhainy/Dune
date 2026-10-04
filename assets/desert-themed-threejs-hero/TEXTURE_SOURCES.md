# Pyramid textures

- Requested: ambientCG Rock035 / Limestone001 / Sandstone002 at 4K (Diffuse + Normal + Roughness + Displacement + AO).
- `https://ambientcg.com/get?file=Limestone001_1K-JPG.zip` and `Sandstone002_1K-JPG.zip` return HTTP 404 from this environment. Three.js's own `examples/textures/ambientcg/` folder only contains ice.
- Used instead: [Sandstone Blocks 05](https://polyhaven.com/a/sandstone_blocks_05) by Rob Tuytel / Poly Haven, CC0. All five maps (diff, nor_gl, rough, disp, ao) at 1K JPG so 193 displaced meshes can hold 60fps. 4K (~7–12 MB per map) would stall the hero.
- Runtime URL prefix: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_blocks_05/`
- Procedural 5-map fallback is generated locally if the CDN is blocked.

The pyramid is a 12-course running-bond limestone shell (193 long rectangular bricks, 0px gap). Odd courses rotate corner ownership 90° so each brick sits on the joint of the two below.
