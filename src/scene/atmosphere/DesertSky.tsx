import { useEffect, useMemo } from 'react'
import { BackSide, ShaderMaterial, SphereGeometry } from 'three'
import type { AtmosphereUniforms } from './desertAtmosphereShaders'
import { atmosphereNoiseGLSL, atmosphereUniformsGLSL, desertSkyGLSL } from './desertAtmosphereShaders'
import { duneBackdropGLSL } from '../transition/secondSceneLook'

// Unit sphere, projected with the view rotation only: it is always centred on
// the camera without a per-frame position copy, and it sits well inside the
// far plane. Low tessellation is enough because the colour is per-pixel.
const skyRadius = 500

const skyVertexShader = /* glsl */ `
varying vec3 vSkyDirection;
void main() {
  vSkyDirection = position;
  vec3 viewDirection = mat3(viewMatrix) * position;
  gl_Position = projectionMatrix * vec4(viewDirection * ${skyRadius.toFixed(1)}, 1.0);
}
`

const skyFragmentShader = /* glsl */ `
${atmosphereUniformsGLSL}
${atmosphereNoiseGLSL}
${desertSkyGLSL}
${duneBackdropGLSL}
varying vec3 vSkyDirection;
void main() {
  vec3 direction = normalize(vSkyDirection);

  if (uDuneBackdrop >= 1.0) {
    // The second scene: a distant, sun-bleached dune horizon (secondSceneLook).
    vec3 color = duneBackdrop(direction);
    // As the storm thickens the backdrop closes in to the storm's own dust,
    // so the transition cloud meets a sky of its own colour, not a seam.
    vec2 q = direction.xy * vec2(1.6, 2.6) / (0.6 + abs(direction.z));
    vec2 flow = vec2(-uTime * 0.012, -uTime * 0.02);
    float billow = atmosphereNoise(q * 1.4 + flow) * 0.6 + atmosphereNoise(q * 2.9 + flow * 1.7 + 5.3) * 0.4;
    float storm = smoothstep(0.25, 0.85, uStorm);
    color = mix(color, stormDust(mix(0.5, billow, 0.7), direction.y * 0.5 + 0.5), storm);
    // Sub-LSB dither: the gradients are wide and shallow, and would band.
    color += (atmosphereHash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
    return;
  }

  vec3 color = desertSky(direction);

  // Slow dust bands drifting along the horizon. They start a little above
  // it, where the hazed ridges end, so the fogged terrain (which never shows
  // bands) meets plain sky rather than a band it cannot match.
  float h = direction.y;
  float band = smoothstep(0.012, 0.06, h) * (1.0 - smoothstep(0.12, 0.34, h));
  if (band > 0.0) {
    vec2 q = direction.xz / (h + 0.3);
    float dust = atmosphereNoise(q * vec2(1.3, 4.5) + vec2(-uTime * 0.03, 0.0));
    #ifdef DESERT_DETAILED_NOISE
      dust = dust * 0.65 + atmosphereNoise(q * vec2(3.2, 11.0) + vec2(-uTime * 0.055, 3.7)) * 0.35;
    #endif
    color = mix(color, uHorizonColor * 1.03, smoothstep(0.35, 0.85, dust) * band * (0.3 + uStorm * 0.4));
  }

  // Small sun disc, pushed above 1 so the existing bloom gives it a halo.
  float sun = dot(direction, uSunDirection);
  color += uSunColor * smoothstep(0.99955, 0.99985, sun) * 2.5 * (1.0 - uStorm * 0.7);

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

export function DesertSky({ atmosphere, detailedNoise }: {
  atmosphere: AtmosphereUniforms
  detailedNoise: boolean
}) {
  const geometry = useMemo(() => new SphereGeometry(1, 32, 16), [])
  const material = useMemo(() => new ShaderMaterial({
    name: 'Desert sky',
    uniforms: atmosphere,
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    defines: detailedNoise ? { DESERT_DETAILED_NOISE: '' } : {},
    side: BackSide,
    // Drawn first and behind everything, so it never needs the depth buffer.
    depthTest: false,
    depthWrite: false,
  }), [atmosphere, detailedNoise])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // Camera-centred in the shader, so its bounding sphere (at the origin) says
  // nothing about visibility - culling it could only ever be wrong.
  return (
    <mesh
      name="Desert sky"
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      frustumCulled={false}
    />
  )
}
