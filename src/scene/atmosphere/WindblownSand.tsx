import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, ShaderMaterial, Vector3 } from 'three'
import type { Texture, Vector2, Vector4 } from 'three'
import type { AtmosphereUniforms } from './desertAtmosphereShaders'
import { atmosphereNoiseGLSL, atmosphereUniformsGLSL, desertSkyGLSL } from './desertAtmosphereShaders'

export type GroundUniforms = {
  uGroundHeight: { value: Texture | null }
  uGroundBounds: { value: Vector4 }
  uGroundRange: { value: Vector2 }
}

type SandLayerKind = 'air' | 'ground'

/**
 * Both layers wrap inside a box centred ahead of the camera rather than on it:
 * with a ~70 degree horizontal view, a camera-centred box would spend four
 * fifths of its grains behind or beside the lens.
 */
const layerSettings: Record<SandLayerKind, {
  box: [number, number, number]
  ahead: number
  /** Grain diameter in world units, before per-grain variation. */
  grainSize: number
  maxPixels: number
  opacity: number
  seed: number
  renderOrder: number
}> = {
  air: { box: [110, 11, 100], ahead: 40, grainSize: 0.05, maxPixels: 6, opacity: 0.7, seed: 82113, renderOrder: 2 },
  // Low, fast and faint: sand skimming the surface, drawn as short dashes.
  ground: { box: [64, 0.32, 54], ahead: 26, grainSize: 0.4, maxPixels: 22, opacity: 0.2, seed: 55129, renderOrder: 1 },
}

const sandVertexShader = /* glsl */ `
${atmosphereUniformsGLSL}
${atmosphereNoiseGLSL}
${desertSkyGLSL}
attribute float aTone;
uniform sampler2D uGroundHeight;
uniform vec4 uGroundBounds;
uniform vec2 uGroundRange;
uniform vec3 uBoxSize;
uniform float uAhead;
uniform float uGrainSize;
uniform float uMaxPixels;
uniform float uOpacity;
uniform float uViewportHeight;
uniform float uPixelRatio;
varying float vAlpha;
varying float vTone;

float groundHeightAt(vec2 xz) {
  vec2 uv = (xz - uGroundBounds.xy) / uGroundBounds.zw;
  return uGroundRange.x + texture2D(uGroundHeight, uv).r * uGroundRange.y;
}

void main() {
  // \`position\` carries three uniform random seeds, not a position: every
  // grain's place is derived here from them, the wind travel and time.
  vec3 seed = position;
  #ifdef DESERT_GROUND_LAYER
    float speed = 2.2 + aTone * 1.6;
    float lift = seed.y * seed.y * uBoxSize.y
      + (sin(uTime * 2.3 + seed.z * 41.0) * 0.5 + 0.5) * 0.05;
  #else
    float speed = 0.8 + aTone * 0.7;
    // Most grains hang low; a few ride high enough to cross the sky.
    float lift = pow(seed.y, 1.7) * uBoxSize.y + sin(uTime * 0.9 + seed.x * 40.0) * 0.4;
  #endif

  vec3 p = seed * uBoxSize;
  p.x += uWind * speed;
  p.z += sin(uTime * 0.7 + seed.y * 35.0) * 0.9 + sin(uTime * 1.9 + seed.x * 22.0) * 0.3;
  #ifdef DESERT_DETAILED_NOISE
    // A shared eddy field, so neighbouring grains swirl together.
    float eddy = atmosphereNoise(vec2(p.x * 0.06 - uTime * 0.35, p.z * 0.06)) - 0.5;
    p.z += eddy * 1.5;
    #ifndef DESERT_GROUND_LAYER
      lift += eddy * 1.4;
    #endif
  #endif

  vec2 center = cameraPosition.xz + uCameraForward * uAhead;
  vec2 relative = mod(p.xz - center + uBoxSize.xz * 0.5, uBoxSize.xz) - uBoxSize.xz * 0.5;
  vec2 xz = center + relative;
  vec3 world = vec3(xz.x, groundHeightAt(xz) + 0.04 + max(lift, 0.0), xz.y);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  float viewDistance = length(mvPosition.xyz);

  // Grains fade out towards the box walls, so a wrapped grain arrives unseen.
  vec2 edge = abs(relative) / (uBoxSize.xz * 0.5);
  float edgeFade = (1.0 - smoothstep(0.7, 1.0, edge.x)) * (1.0 - smoothstep(0.7, 1.0, edge.y));
  float nearFade = smoothstep(1.2, 4.5, viewDistance);
  float haze = 1.0 - desertFogAmount(viewDistance);

  // True perspective size in device pixels. Grains smaller than a pixel keep
  // a 1px footprint and lose opacity instead, which avoids shimmering.
  float pixels = uGrainSize * (0.55 + aTone * 0.9) * uViewportHeight * 0.5
    * projectionMatrix[1][1] / max(-mvPosition.z, 0.1);
  gl_PointSize = clamp(pixels, 1.0, uMaxPixels * uPixelRatio);
  vAlpha = uOpacity * uSandVisibility * (0.7 + uStorm * 0.6) * edgeFade * nearFade * haze * clamp(pixels, 0.2, 1.0);
  #ifdef DESERT_GROUND_LAYER
    // The dune scene's ground is only painted into its backdrop.
    vAlpha *= 1.0 - uDuneBackdrop;
  #endif
  vTone = aTone;
  gl_Position = projectionMatrix * mvPosition;
}
`

// Analytic round (or dash) sprite: no texture, nothing to upload or dispose.
const sandFragmentShader = /* glsl */ `
${atmosphereUniformsGLSL}
varying float vAlpha;
varying float vTone;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  #ifdef DESERT_GROUND_LAYER
    c.y *= 6.0;
  #endif
  float alpha = (1.0 - smoothstep(0.08, 0.25, dot(c, c))) * vAlpha;
  if (alpha < 0.003) discard;
  #ifdef DESERT_GROUND_LAYER
    // Skimming sand is the ground's own colour, just lifted: a streak, not a speck.
    vec3 sand = mix(uMidColor, uHorizonColor, vTone) * 0.95;
  #else
    vec3 sand = uHorizonColor * mix(0.5, 1.05, vTone) * mix(vec3(1.0), uSunColor, 0.25);
  #endif
  gl_FragColor = vec4(sand, alpha);
  #include <colorspace_fragment>
}
`

// Deterministic, so the sand looks the same on every visit.
function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function createSeedGeometry(count: number, seed: number) {
  const random = seededRandom(seed)
  const seeds = new Float32Array(count * 3)
  const tones = new Float32Array(count)
  for (let index = 0; index < seeds.length; index += 1) seeds[index] = random()
  for (let index = 0; index < count; index += 1) tones[index] = random()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(seeds, 3))
  geometry.setAttribute('aTone', new BufferAttribute(tones, 1))
  return geometry
}

type ScreenUniforms = {
  uViewportHeight: { value: number }
  uPixelRatio: { value: number }
}

// A calm day still draws most of the grains; a storm draws all of them.
const drawnShare: Record<SandLayerKind, (storm: number) => number> = {
  air: (storm) => 0.6 + 0.4 * storm,
  ground: (storm) => 0.5 + 0.5 * storm,
}

function SandLayer({ kind, count, atmosphere, ground, screen, detailedNoise }: {
  kind: SandLayerKind
  count: number
  atmosphere: AtmosphereUniforms
  ground: GroundUniforms
  screen: ScreenUniforms
  detailedNoise: boolean
}) {
  const settings = layerSettings[kind]
  const geometry = useMemo(() => createSeedGeometry(count, settings.seed), [count, settings.seed])
  const material = useMemo(() => {
    const defines: Record<string, string> = {}
    if (kind === 'ground') defines.DESERT_GROUND_LAYER = ''
    if (detailedNoise) defines.DESERT_DETAILED_NOISE = ''
    return new ShaderMaterial({
      name: `Windblown sand (${kind})`,
      uniforms: {
        ...atmosphere,
        ...ground,
        ...screen,
        uBoxSize: { value: new Vector3(...settings.box) },
        uAhead: { value: settings.ahead },
        uGrainSize: { value: settings.grainSize },
        uMaxPixels: { value: settings.maxPixels },
        uOpacity: { value: settings.opacity },
      },
      vertexShader: sandVertexShader,
      fragmentShader: sandFragmentShader,
      defines,
      transparent: true,
      depthWrite: false,
    })
  }, [kind, atmosphere, ground, screen, detailedNoise, settings])

  useFrame(() => {
    // Storm intensity only moves the draw range: no rebuild, no recompile.
    geometry.setDrawRange(0, Math.round(count * drawnShare[kind](atmosphere.uStorm.value)))
  })
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // Grain positions exist only in the vertex shader, so the geometry's bounds
  // (the unit seed cube) cannot be used for culling.
  return (
    <points
      name={`Windblown sand (${kind})`}
      geometry={geometry}
      material={material}
      renderOrder={settings.renderOrder}
      frustumCulled={false}
    />
  )
}

export function WindblownSand({ atmosphere, ground, airGrains, groundGrains, detailedNoise }: {
  atmosphere: AtmosphereUniforms
  ground: GroundUniforms
  airGrains: number
  groundGrains: number
  detailedNoise: boolean
}) {
  const height = useThree((root) => root.size.height)
  const dpr = useThree((root) => root.viewport.dpr)
  const screen = useMemo<ScreenUniforms>(() => ({
    uViewportHeight: { value: 1 },
    uPixelRatio: { value: 1 },
  }), [])
  useEffect(() => {
    // Shared uniform values change only on resize, without React renders.
    // oxlint-disable-next-line react/immutability
    screen.uViewportHeight.value = height * dpr
    // oxlint-disable-next-line react/immutability
    screen.uPixelRatio.value = dpr
  }, [screen, height, dpr])

  return (
    <>
      <SandLayer kind="ground" count={groundGrains} atmosphere={atmosphere}
        ground={ground} screen={screen} detailedNoise={detailedNoise} />
      <SandLayer kind="air" count={airGrains} atmosphere={atmosphere}
        ground={ground} screen={screen} detailedNoise={detailedNoise} />
    </>
  )
}
