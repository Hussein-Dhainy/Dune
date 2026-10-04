import { Color, Vector2, Vector3 } from 'three'
import type { Material } from 'three'
import { duneSkyBaseGLSL } from '../transition/secondSceneLook'

/**
 * Uniforms shared by every atmosphere shader: the sky, the sand and the fog
 * patched into the scene's own materials. Each value object is shared by
 * reference, so one write reaches every program with no recompiles.
 */
export type AtmosphereUniforms = {
  /** Seconds of animation, slowed under reduced motion and frozen while hidden. */
  uTime: { value: number }
  /** Accumulated wind travel. Grains move by this, never by time, so a change
   *  in wind speed changes their velocity rather than teleporting them. */
  uWind: { value: number }
  /** 0 calm .. 1 sandstorm. Thickens the haze and the sand, never recompiles. */
  uStorm: { value: number }
  /** Distance with no haze at all, so the pyramid always stays crisp. */
  uFogNear: { value: number }
  /** Exponential-squared haze density beyond uFogNear, per world unit. */
  uFogDensity: { value: number }
  uHorizonColor: { value: Color }
  uMidColor: { value: Color }
  uZenithColor: { value: Color }
  /** Unit vector towards the sun, taken from the directional light. */
  uSunDirection: { value: Vector3 }
  uSunColor: { value: Color }
  /** Camera's horizontal look direction, so the sand box sits in front of it. */
  uCameraForward: { value: Vector2 }
  /** 0..1, follows the terrain reveal so sand never hangs over the empty void. */
  uSandVisibility: { value: number }
  /** 0 = the pyramid's desert sky, 1 = the second scene's dune backdrop. Set
   *  per scene, and only ever changed while the storm covers the view. */
  uDuneBackdrop: { value: number }
  /** Cool grade for the storm's dust, and how far the dust is pulled to it. */
  uStormTint: { value: Color }
  uStormTintAmount: { value: number }
}

export function createAtmosphereUniforms(): AtmosphereUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: 0 },
    uStorm: { value: 0 },
    uFogNear: { value: 30 },
    uFogDensity: { value: 1 / 110 },
    uHorizonColor: { value: new Color() },
    uMidColor: { value: new Color() },
    uZenithColor: { value: new Color() },
    uSunDirection: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color() },
    uCameraForward: { value: new Vector2(0, -1) },
    uSandVisibility: { value: 0 },
    uDuneBackdrop: { value: 0 },
    uStormTint: { value: new Color() },
    uStormTintAmount: { value: 0 },
  }
}

/** Declared once per program; the function chunks below only reference them. */
export const atmosphereUniformsGLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uStorm;
uniform float uFogNear;
uniform float uFogDensity;
uniform vec3 uHorizonColor;
uniform vec3 uMidColor;
uniform vec3 uZenithColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec2 uCameraForward;
uniform float uSandVisibility;
uniform float uDuneBackdrop;
uniform vec3 uStormTint;
uniform float uStormTintAmount;
`

/** Cheap 2D value noise, 0..1. Four hashes per call and no permutation tables. */
export const atmosphereNoiseGLSL = /* glsl */ `
float atmosphereHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float atmosphereNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(atmosphereHash(i), atmosphereHash(i + vec2(1.0, 0.0)), u.x),
    mix(atmosphereHash(i + vec2(0.0, 1.0)), atmosphereHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`

/**
 * The sky colour for a view direction, and the haze that fades geometry into
 * it. Fog mixes towards desertSky() along the fragment's own view ray, so a
 * fully hazed ridge is exactly the colour of the sky beside it: there is no
 * separate fog colour that could ever disagree with the background.
 */
export const desertSkyGLSL = /* glsl */ `
${duneSkyBaseGLSL}
// The sandstorm cloud's palette, in scene-linear colour. SandstormEffect
// builds the same three tones and tone maps them on the CPU, so a backdrop
// that eases into these is the cloud's colour once the scene is tone mapped.
vec3 stormDust(float billow, float lift) {
  // Each tone is graded towards the storm tint, keeping its own brightness
  // step, exactly as TransitionPostFX does before tone mapping them.
  vec3 dustDark = mix(mix(uMidColor, uZenithColor, 0.35) * 0.7, uStormTint * 0.62, uStormTintAmount);
  vec3 dustMid = mix(uMidColor, uStormTint * 0.85, uStormTintAmount);
  vec3 dustLight = mix(uHorizonColor, uStormTint * 1.1, uStormTintAmount);
  vec3 dust = mix(dustDark, dustMid, smoothstep(0.2, 0.7, billow));
  return mix(dust, dustLight, smoothstep(0.6, 0.95, billow) * (0.15 + lift * 0.25));
}

vec3 desertSky(vec3 direction) {
  // Dynamically uniform: the dune scene skips the pyramid's sky. Fog there
  // fades into the backdrop's gradient (its ridges need derivatives, which a
  // vertex shader including this cannot take).
  if (uDuneBackdrop >= 1.0) return duneSkyBase(direction);
  float h = clamp(direction.y, 0.0, 1.0);
  // The camera only ever sees ~12 degrees above the horizon, so the whole
  // bright-horizon-to-brown-sky ramp is packed into that band.
  vec3 color = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.16, h));
  color = mix(color, uZenithColor, smoothstep(0.05, 0.3, h));
  float sun = max(dot(direction, uSunDirection), 0.0);
  color += uSunColor * (pow(sun, 4.0) * 0.18 + pow(sun, 48.0) * 0.4);
  // A storm closes the dome in towards a dusty ochre, most of all low down.
  color = mix(color, uMidColor * vec3(0.92, 0.8, 0.64), uStorm * 0.6 * (1.0 - h * 0.6));
  return color;
}

float desertFogAmount(float viewDistance) {
  float depth = max(viewDistance - uFogNear, 0.0) * uFogDensity * (1.0 + uStorm * 1.5);
  return 1.0 - exp(-depth * depth);
}
`

// Same guard as the reveal patch: effects can run twice for one material, and
// splicing the chunks in twice would redeclare every uniform.
const patchedMaterials = new WeakSet<Material>()

/**
 * Distance haze for a built-in (lit) material. Chains onto whatever
 * onBeforeCompile the material already has - the reveal, edge and glow
 * patches - and extends its cache key rather than replacing it.
 *
 * The haze is mixed in before tone mapping, the same point the sky's own
 * colour enters the pipeline, so both go through identical grading.
 */
export function applyAtmosphereFog(material: Material, atmosphere: AtmosphereUniforms) {
  if (patchedMaterials.has(material)) return
  patchedMaterials.add(material)

  const compileBaseMaterial = material.onBeforeCompile
  const baseCacheKey = material.customProgramCacheKey.bind(material)

  material.onBeforeCompile = (shader, renderer) => {
    compileBaseMaterial.call(material, shader, renderer)
    Object.assign(shader.uniforms, atmosphere)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vAtmosphereWorldPosition;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  // As in the reveal patch, instanceMatrix never reaches \`transformed\`.
  vec4 atmosphereLocalPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    atmosphereLocalPosition = instanceMatrix * atmosphereLocalPosition;
  #endif
  vAtmosphereWorldPosition = ( modelMatrix * atmosphereLocalPosition ).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `${atmosphereUniformsGLSL}
${desertSkyGLSL}
varying vec3 vAtmosphereWorldPosition;
void main() {`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        `{
    vec3 atmosphereRay = vAtmosphereWorldPosition - cameraPosition;
    float atmosphereDistance = length(atmosphereRay);
    // The pyramid sits inside uFogNear, so its pixels skip all of this.
    if (atmosphereDistance > uFogNear) {
      gl_FragColor.rgb = mix(
        gl_FragColor.rgb,
        desertSky(atmosphereRay / atmosphereDistance),
        desertFogAmount(atmosphereDistance)
      );
    }
  }
  #include <tonemapping_fragment>`,
      )
  }
  material.customProgramCacheKey = () => `${baseCacheKey()}-desert-atmosphere-fog-v1`
  material.needsUpdate = true
}
