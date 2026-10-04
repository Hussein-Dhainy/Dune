import { Color, Vector3 } from 'three'

/**
 * Art direction for the second scene: its lights and the desert backdrop the
 * sky shader draws behind it. Both read the key light's direction from here,
 * so the glow in the sky always sits where the light on the stone comes from.
 *
 * Light positions are offsets from the formation; the key follows it.
 */
export const secondSceneLights = {
  /** Low desert sun from the camera's right, ~31 degrees up: lit right-hand
   *  faces and tops, shaded left-hand faces, every column readable. */
  key: {
    color: '#ffdcb4',
    intensity: 3.1,
    offset: [9, 5.6, 1.4] as const,
  },
  /** Cool, neutral kicker from behind and to the left, so the shaded edges
   *  separate from the warm haze. */
  rim: {
    color: '#dfe2e6',
    intensity: 1.9,
    offset: [-7, 4.5, -11] as const,
  },
  /** Sky-and-ground fill: warm sand light from above, and the sun's bounce
   *  off the dunes below. Strong enough that the faces turned from the key
   *  stay readable stone rather than black. */
  fill: {
    skyColor: '#ecd9be',
    groundColor: '#b08a66',
    intensity: 2.1,
  },
  shadow: {
    /** Half-size of the shadow box around the formation, in world units: its
     *  ~4-unit radius plus the columns' 30% slide and the idle hover. */
    halfExtent: 5.6,
    /** Depth range either side of the formation along the light. */
    depthRange: 7,
    /** Fixed on both tiers: one small map, redrawn only for this scene's
     *  renders, and 512 leaves visibly stepped edges at this framing. */
    mapSize: 1024,
    bias: -0.0005,
    normalBias: 0.04,
    radius: 3,
  },
}

/** Colours are authored in sRGB, as everywhere else in the project. */
export const duneBackdrop = {
  /** Brightest at the horizon: sun-bleached haze. */
  horizonColor: '#ecdcc2',
  /** Lower sky, warming to amber higher up. */
  skyLowColor: '#ddbb92',
  skyHighColor: '#b98a5c',
  /** Broad glow towards the key light, added on top. */
  sunGlowColor: '#ffd9a8',
  sunGlowStrength: 0.32,
  /** Haze-washed sand floor below the dunes, darkest at the bottom of frame. */
  groundColor: '#b08560',
  /** Dune silhouettes before haze: each layer is pulled towards horizonColor
   *  by its haze share, so the farthest is barely there. */
  ridgeColor: '#a97a52',
  /** Far to near. Heights are in direction.y (the sine of elevation); the
   *  camera is level, so the frame spans about -0.38 to 0.38. */
  ridges: [
    { base: 0.006, amplitude: 0.016, frequency: 9.0, haze: 0.8 },
    { base: 0.001, amplitude: 0.028, frequency: 5.5, haze: 0.62 },
    { base: -0.012, amplitude: 0.042, frequency: 3.2, haze: 0.45 },
  ],
  /** Drifting dust veils over the horizon, as a share of the haze colour. */
  veilStrength: 0.22,
}

const linear = new Color()
function glslColor(hex: string) {
  // Color.set converts sRGB hex into the linear working space the shader uses.
  linear.set(hex)
  return `vec3(${linear.r.toFixed(4)}, ${linear.g.toFixed(4)}, ${linear.b.toFixed(4)})`
}

const sunDirection = new Vector3(...secondSceneLights.key.offset).normalize()

/**
 * The second scene's desert sky as GLSL. `duneSkyBase` is the plain gradient
 * and glow (safe in any shader stage); `duneBackdrop` adds the dune ridges,
 * the sand floor and dust veils, and needs derivatives, so it is for the sky's
 * fragment shader only. Expects atmosphereNoiseGLSL and the shared uniforms.
 */
export const duneSkyBaseGLSL = /* glsl */ `
const vec3 DUNE_HORIZON = ${glslColor(duneBackdrop.horizonColor)};
const vec3 DUNE_SKY_LOW = ${glslColor(duneBackdrop.skyLowColor)};
const vec3 DUNE_SKY_HIGH = ${glslColor(duneBackdrop.skyHighColor)};
const vec3 DUNE_SUN_GLOW = ${glslColor(duneBackdrop.sunGlowColor)};
const vec3 DUNE_GROUND = ${glslColor(duneBackdrop.groundColor)};
const vec3 DUNE_RIDGE = ${glslColor(duneBackdrop.ridgeColor)};
const vec3 DUNE_SUN_DIRECTION = vec3(${sunDirection.x.toFixed(4)}, ${sunDirection.y.toFixed(4)}, ${sunDirection.z.toFixed(4)});

vec3 duneSkyBase(vec3 direction) {
  float h = direction.y;
  float up = max(h, 0.0);
  vec3 sky = mix(DUNE_HORIZON, DUNE_SKY_LOW, smoothstep(0.0, 0.16, up));
  sky = mix(sky, DUNE_SKY_HIGH, smoothstep(0.1, 0.5, up));
  vec3 floorColor = mix(DUNE_HORIZON, DUNE_GROUND, smoothstep(0.0, 0.3, -h));
  vec3 color = mix(floorColor, sky, smoothstep(-0.01, 0.01, h));
  // The sun is off frame to the right; its glow only warms that side.
  float sun = max(dot(direction, DUNE_SUN_DIRECTION), 0.0);
  color += DUNE_SUN_GLOW * ${duneBackdrop.sunGlowStrength.toFixed(3)} * (pow(sun, 3.0) * 0.6 + pow(sun, 10.0) * 0.4);
  return color;
}
`

const ridgeLayers = duneBackdrop.ridges.map((ridge, index) => /* glsl */ `
  {
    vec2 q = around * ${ridge.frequency.toFixed(2)} + vec2(${(index * 17.3).toFixed(1)}, ${(index * 5.1).toFixed(1)});
    float n = atmosphereNoise(q) * 0.7 + atmosphereNoise(q * 2.3 + 3.7) * 0.3;
    float crest = ${ridge.base.toFixed(4)} + ${ridge.amplitude.toFixed(4)} * smoothstep(0.15, 0.9, n);
    float below = crest - h;
    float cover = smoothstep(-edge, edge, below);
    // Dune faces darken slightly away from their crest, and the sun side of
    // the frame lifts them, so they read as forms rather than cut-outs.
    vec3 tone = mix(DUNE_RIDGE, DUNE_HORIZON, ${ridge.haze.toFixed(2)});
    tone *= 1.0 - smoothstep(0.0, 0.06, below) * 0.07;
    tone += DUNE_SUN_GLOW * sunSide * 0.05;
    color = mix(color, tone, cover);
  }`).join('')

export const duneBackdropGLSL = /* glsl */ `
vec3 duneBackdrop(vec3 direction) {
  float h = direction.y;
  vec3 color = duneSkyBase(direction);
  // Points on the horizontal circle: noise sampled here has no seam however
  // far round the view turns.
  vec2 around = direction.xz / max(length(direction.xz), 1e-4);
  float sunSide = max(dot(around, normalize(DUNE_SUN_DIRECTION.xz)), 0.0);
  float edge = max(fwidth(h) * 1.25, 1e-5);

  // The sand floor: faint, broad undulations, lost in haze towards the
  // horizon so they never alias there.
  if (h < 0.0) {
    vec2 ground = around / max(-h, 0.02);
    float swell = atmosphereNoise(ground * 0.9) * 0.6 + atmosphereNoise(ground * 2.1 + 9.0) * 0.4;
    color *= 1.0 + (swell - 0.5) * 0.08 * smoothstep(0.03, 0.2, -h);
  }
${ridgeLayers}

  // Haze sitting on the horizon, over the ridges, and slow dust veils
  // drifting through it.
  color = mix(color, DUNE_HORIZON, exp(-abs(h - 0.004) * 30.0) * 0.4);
  float veilBand = exp(-abs(h - 0.02) * 9.0);
  vec2 veilQ = vec2(atan(around.y, around.x) * 4.0, h * 22.0);
  // atan's seam is behind the camera's back in this scene, and the veils are
  // faint and low-contrast either side of it.
  float veil = atmosphereNoise(veilQ + vec2(-uTime * 0.025, 0.0));
  #ifdef DESERT_DETAILED_NOISE
    veil = veil * 0.65 + atmosphereNoise(veilQ * 2.6 + vec2(-uTime * 0.045, 4.1)) * 0.35;
  #endif
  color = mix(color, DUNE_HORIZON * 1.02, smoothstep(0.4, 0.85, veil) * veilBand * ${duneBackdrop.veilStrength.toFixed(3)});
  return color;
}
`
