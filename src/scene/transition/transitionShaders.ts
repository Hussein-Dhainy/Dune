import { atmosphereNoiseGLSL, atmosphereUniformsGLSL } from '../atmosphere/desertAtmosphereShaders'

/**
 * Fullscreen scene wipe, run as a postprocessing Effect in its own pass after
 * tone mapping and SMAA. In one shader it draws the rising cloud, the radial
 * zoom smear, the RGB split and a little grain - so the whole storm costs one
 * fullscreen pass, and only while it is on screen. The same pass carries the
 * crossing's digital texture: a directional pull blur, brief blocky slips and
 * faint scanlines, all kept small and slow - dreamlike, never a strobe.
 *
 * Works in display-referred colour (the input is already tone mapped), so the
 * dust colours arrive pre-tone-mapped from the CPU: see toneMapAces().
 *
 * Defines: RADIAL_SAMPLES (0 disables the smear), CLOUD_OCTAVES, and
 * DETAILED_STORM for the domain warp and turbulent wobble.
 */
export const sandstormEffectFragment = /* glsl */ `
uniform float cloudTop;
uniform float cloudTilt;
// The incoming scene, rendered on its own (scene-linear, not yet tone mapped).
uniform mediump sampler2D incomingBuffer;
uniform float incomingActive;
uniform float incomingExposure;
uniform float cloudBottom;
uniform float cloudDensity;
uniform float distortion;
uniform float aberration;
uniform float glitch;
uniform float blockSeed;
uniform vec2 pull;
uniform float stormTime;
uniform float maxAberration;
uniform vec2 center;
uniform vec3 dustLight;
uniform vec3 dustMid;
uniform vec3 dustDark;

float stormHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float stormNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(stormHash(i), stormHash(i + vec2(1.0, 0.0)), u.x),
    mix(stormHash(i + vec2(0.0, 1.0)), stormHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float stormFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int i = 0; i < CLOUD_OCTAVES; i++) {
    value += amplitude * stormNoise(p);
    total += amplitude;
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value / total;
}

// three.js's ACES filmic curve. The incoming scene arrives untouched by the
// composer, so it is tone mapped here to sit beside the already-graded input.
vec3 stormRrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / b;
}
vec3 stormToneMap(vec3 color) {
  color *= incomingExposure / 0.6;
  color = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * color;
  color = stormRrtOdt(color);
  color = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * color;
  return clamp(color, 0.0, 1.0);
}

// The cloud's three tones for a billow value; called once per colour channel
// when the fringe is on, which is what splits the cloud itself into RGB.
vec3 dustTone(float billow, float lift) {
  vec3 dust = mix(dustDark, dustMid, smoothstep(0.2, 0.7, billow));
  return mix(dust, dustLight, smoothstep(0.6, 0.95, billow) * (0.15 + lift * 0.25));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  vec2 sampleUv = uv;

  // How hard the crossing acts on this pixel of scene one: full strength
  // along the wipe's advancing edge, easing to a third in the still-untouched
  // image well above it. Below the edge the incoming scene replaces it.
  // The edge is a tilted line early on: higher at the left than the right.
  float edgeY = cloudTop + (0.5 - uv.x) * cloudTilt;
  float local = mix(0.3, 1.0, 1.0 - smoothstep(0.0, 0.5, uv.y - edgeY));

  if (glitch > 0.0) {
    // Datamosh: a minority of coarse blocks slip a short way, mostly along
    // the pull. blockSeed steps slowly (a few times a second, and with the
    // scroll), so blocks hold still between steps instead of flickering.
    vec2 blocks = vec2(floor(13.0 * aspect), 9.0);
    vec2 block = floor(uv * blocks);
    float pick = stormHash(block + blockSeed * 1.37);
    float slip = step(1.0 - 0.28 * glitch * local, pick);
    vec2 offset = vec2(stormHash(block * 1.7 + blockSeed), stormHash(block * 2.3 - blockSeed)) - 0.5;
    sampleUv += (offset * vec2(0.048, 0.014) + pull * (offset.x * 0.035)) * slip * glitch * local;
    color = texture2D(inputBuffer, sampleUv).rgb;
  }

  vec2 radial = sampleUv - center;

  if (distortion > 0.0 || aberration > 0.0) {
    #ifdef DETAILED_STORM
      // A slow turbulent wobble, so the smear reads as moving air, not a lens.
      vec2 wobble = vec2(
        stormNoise(uv * 5.0 + vec2(stormTime * 0.6, 0.0)),
        stormNoise(uv * 5.0 - vec2(0.0, stormTime * 0.5))
      ) - 0.5;
      radial += wobble * 0.03 * distortion * local;
    #endif
    // One set of taps does both blurs: a soft zoom smear towards the centre,
    // and a directional pull that drags the image the way the next scene
    // is arriving from.
    vec2 streak = (radial * (distortion * 0.05) + pull * (distortion * 0.032)) * local;
    #if RADIAL_SAMPLES > 0
      // Each pixel offsets its taps by a different fraction of a step, which
      // turns five distinct ghost images into one smooth, faintly grainy blur.
      float jitter = stormHash(uv * resolution + 3.7);
      vec3 smeared = color;
      for (int i = 1; i <= RADIAL_SAMPLES; i++) {
        float t = (float(i) - jitter) / float(RADIAL_SAMPLES);
        smeared += texture2D(inputBuffer, sampleUv - streak * t).rgb;
      }
      color = smeared / float(RADIAL_SAMPLES + 1);
    #endif
    // Red and blue pulled apart along the same line, from the middle of the
    // streak so the fringes stay aligned with it. Grows towards the edges,
    // so high-contrast edges pick up red and cyan-blue rims.
    vec2 split = (radial + pull * 0.35) * aberration * maxAberration * local;
    vec2 base = sampleUv - streak * 0.5;
    // Without the blur taps there is nothing to soften the split, so the
    // cheap tier blends it in at about half strength.
    #if RADIAL_SAMPLES > 0
      float fringeMix = 0.65;
    #else
      float fringeMix = 0.45;
    #endif
    color.r = mix(color.r, texture2D(inputBuffer, base + split).r, fringeMix);
    color.b = mix(color.b, texture2D(inputBuffer, base - split).b, fringeMix);
  }

  if (cloudDensity > 0.0 || incomingActive > 0.0) {
    // Built from the slipped UV, so the block displacement shows in the edge.
    vec2 p = vec2(sampleUv.x * aspect, sampleUv.y);
    // Billows climb the screen and drift with the wind (+x), stretched along
    // it so they read as blown sand rather than smoke.
    vec2 flow = vec2(-stormTime * 0.2, -stormTime * 0.34);
    vec2 cell = p * vec2(1.6, 2.6);
    float billow = stormFbm(cell + flow);
    #ifdef DETAILED_STORM
      // Domain warp: the billows curl and roll instead of sliding as a sheet.
      billow = stormFbm(cell + flow + (billow - 0.5) * 1.3);
    #endif
    float fine = stormNoise(p * 16.0 + flow * 3.0);

    // Signed height above the wipe's ragged, billowing (and early on, tilted)
    // edge: positive in the outgoing scene, negative in the incoming one.
    float topEdge = cloudTop + (0.5 - sampleUv.x) * cloudTilt;
    float above = sampleUv.y - (billow - 0.5) * 0.5 - topEdge;

    if (incomingActive > 0.0) {
      // The wipe itself: below the edge is the incoming scene, read at the
      // true UV so it is never slipped, smeared or split - always sharp.
      float wipe = 1.0 - smoothstep(-0.05, 0.05, above);
      if (wipe > 0.0) {
        color = mix(color, stormToneMap(texture2D(incomingBuffer, uv).rgb), wipe);
      }
    }

    // Fog only as a band hugging the edge, thinning a little further into the
    // incoming scene than into the outgoing one. It softens the join; it never
    // fills the view.
    float reach = above > 0.0 ? above : -above * 0.7;
    float density = (1.0 - smoothstep(0.0, 0.26, reach)) * cloudDensity
      * (0.72 + billow * 0.6 + (fine - 0.5) * 0.14);
    float alpha = smoothstep(0.0, 0.88, density);

    // Dense cores are darker; thin, high wisps catch the light.
    vec3 dust = dustTone(billow, uv.y);
    #ifdef DETAILED_STORM
      if (aberration > 0.0) {
        // Chromatic fringe inside the fog: red and blue read the billows a
        // little to either side. Two cheap noise taps, not two more clouds.
        vec2 shift = normalize(radial + pull * 0.35 + 1e-4) * 0.09;
        float fringe = (stormNoise(cell * 2.0 + flow + shift) - stormNoise(cell * 2.0 + flow - shift))
          * aberration * 0.22;
        dust.r = dustTone(billow + fringe, uv.y).r;
        dust.b = dustTone(billow - fringe, uv.y).b;
      }
    #endif
    color = mix(color, dust, alpha);
  }

  if (glitch > 0.0) {
    // Faint scanlines, a few pixels apart, only as deep as the glitch.
    float line = sin(uv.y * resolution.y * 1.3) * 0.5 + 0.5;
    color *= 1.0 - line * 0.035 * glitch * local;
  }

  // Fine grain rides with the storm and is gone when it is.
  float grain = max(max(distortion, glitch), cloudDensity * 0.6) * 0.045;
  if (grain > 0.0) {
    color += (stormHash(uv * resolution + fract(stormTime * 7.0) * 113.0) - 0.5) * grain;
  }

  outputColor = vec4(color, inputColor.a);
}
`

/**
 * Transition-only sand: grains streaming up and across right in front of the
 * lens, in view space so they stay with the camera as it retreats. They lead
 * the cloud's front a little, which is what gives the fullscreen cloud depth.
 */
export const stormParticleVertex = /* glsl */ `
${atmosphereUniformsGLSL}
${atmosphereNoiseGLSL}
attribute float aTone;
uniform float uStormTime;
uniform float uCloudTop;
uniform float uCloudTilt;
uniform float uCloudBottom;
uniform float uDensity;
uniform float uViewportHeight;
uniform float uPixelRatio;
varying float vAlpha;
varying float vTone;

void main() {
  vec3 seed = position;
  // A box in view space: 16 wide, 11 tall, from 1.5 to 19 units ahead.
  vec3 box = vec3(16.0, 11.0, 17.5);
  float speed = 0.7 + aTone * 0.8;
  vec3 p = seed * box;
  p.x += uStormTime * 2.6 * speed;
  p.y += uStormTime * 1.7 * speed;
  #ifdef DETAILED_STORM
    p.x += (atmosphereNoise(vec2(p.y * 0.4, uStormTime * 0.5 + seed.z * 7.0)) - 0.5) * 1.6;
  #endif
  p.xy = mod(p.xy, box.xy) - box.xy * 0.5;
  // Further grains spread wider so the box roughly fills the view at depth.
  float depth = 1.5 + p.z;
  vec4 mvPosition = vec4(p.xy * (0.25 + depth * 0.07), -depth, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Screen height of the grain, 0 bottom .. 1 top, to follow the cloud.
  float screenY = gl_Position.y / gl_Position.w * 0.5 + 0.5;
  float screenX = gl_Position.x / gl_Position.w * 0.5 + 0.5;
  float grainEdge = uCloudTop + (0.5 - screenX) * uCloudTilt;
  float withCloud = smoothstep(grainEdge + 0.12, grainEdge - 0.05, screenY)
    * smoothstep(uCloudBottom - 0.2, uCloudBottom + 0.05, screenY);
  vec2 edge = abs(p.xy) / (box.xy * 0.5);
  float edgeFade = (1.0 - smoothstep(0.75, 1.0, edge.x)) * (1.0 - smoothstep(0.75, 1.0, edge.y));
  float nearFade = smoothstep(1.5, 3.0, depth);

  float pixels = 0.035 * (0.6 + aTone) * uViewportHeight * 0.5 * projectionMatrix[1][1] / depth;
  gl_PointSize = clamp(pixels, 1.0, 9.0 * uPixelRatio);
  vAlpha = uDensity * withCloud * edgeFade * nearFade * clamp(pixels, 0.25, 1.0) * 0.75;
  vTone = aTone;
}
`

export const stormParticleFragment = /* glsl */ `
${atmosphereUniformsGLSL}
varying float vAlpha;
varying float vTone;
void main() {
  // A short dash along the wind (up and to the right).
  vec2 c = gl_PointCoord - 0.5;
  vec2 along = vec2(0.83, -0.55);
  vec2 local = vec2(dot(c, along), dot(c, vec2(-along.y, along.x)) * 3.5);
  float alpha = (1.0 - smoothstep(0.06, 0.25, dot(local, local))) * vAlpha;
  if (alpha < 0.003) discard;
  vec3 sand = mix(uMidColor * 0.7, uHorizonColor, vTone);
  gl_FragColor = vec4(sand, alpha);
  #include <colorspace_fragment>
}
`
