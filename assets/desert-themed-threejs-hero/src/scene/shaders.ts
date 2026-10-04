/* ------------------------------------------------------------------ */
/*  GLSL library for the desert world                                  */
/* ------------------------------------------------------------------ */

export const noiseGLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`

/**
 * Real Giza desert with CLOSE hills you can actually see from the pyramid.
 *   r < 8    : flat plaza (pyramid footing + camel standing area)
 *   8 - 20   : small dunes 0.8 - 1.5 high, 8 m out from the pyramid
 *   20 - 40  : bigger dunes 2 - 4.5 high at the edge of the 80x80 field
 * Beyond that the horizon crest takes over, which the fog keeps soft but visible.
 */
export const duneGLSL = /* glsl */ `
float duneHeight(vec2 p){
  float d = length(p);

  // ---- near dunes: 8 - 20 ----
  float nearMask = smoothstep(8.0, 20.0, d);
  float nearA = sin(p.x * 0.2) * 0.8;
  float nearB = cos(p.y * 0.2) * 0.8;
  float nearN = snoise(p * 0.35) * 1.2;
  float nearDune = (nearA + nearB + nearN) * 0.5;   // ~0.8 - 1.5 high

  // ---- mid dunes: 20 - 40 ----
  float midMask = smoothstep(20.0, 40.0, d);
  float midA = sin(p.x * 0.1) * 2.0;
  float midN = snoise(p * 0.12) * 2.5;
  float midDune = (midA + midN) * 0.55;             // ~2 - 4.5 high

  // ---- horizon crest ----
  float farMask = smoothstep(40.0, 90.0, d);
  float warp = snoise(p * 0.01) * 1.2;
  float big = snoise(vec2(p.x * 0.012 + warp, p.y * 0.02)) * 0.5 + 0.5;
  float ridge = 1.0 - abs(snoise(vec2(p.x * 0.014 + snoise(p * 0.008) * 1.5, p.y * 0.026)));
  ridge = pow(ridge, 2.4);
  float farDune = big * 7.0 + ridge * 6.0;

  // Fine grain so the flat plaza is not a mirror surface.
  float grain = snoise(p * 0.3) * 0.12 + snoise(p * 1.1) * 0.04;

  return grain + nearDune * nearMask + midDune * midMask + farDune * farMask;
}
`

/** Shared sky / fog colour function so the ground fades seamlessly into the sky dome. */
export const skyGLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform float uStorm;

vec3 skyBase(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
  col = mix(col, uZenith, pow(smoothstep(0.1, 0.9, h), 1.1) * 0.92);
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.45);
  vec3 stormCol = uMid * vec3(0.86, 0.74, 0.6);
  col = mix(col, stormCol, uStorm * 0.75 * (1.0 - smoothstep(0.2, 0.9, h) * 0.7));
  return col;
}
`

/* ------------------------------ SKY -------------------------------- */
export const skyVS = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
export const skyFS = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
${skyGLSL}
${noiseGLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  float h = clamp(d.y, 0.0, 1.0);
  // drifting dust bands (fades to nothing at the horizon so it matches the fogged ground)
  vec2 q = d.xz / (d.y + 0.35);
  float n = snoise(q * vec2(1.2, 3.0) + vec2(-uTime * (0.05 + uStorm * 0.12), 0.0)) * 0.5 + 0.5;
  float band = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.12, 0.6, h));
  col = mix(col, uMid, n * band * (0.28 + uStorm * 0.3));
  // sun disc
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * smoothstep(0.9993, 0.99985, s) * 1.4;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

/* ----------------------------- GROUND ------------------------------ */
export const groundVS = /* glsl */ `
uniform float uBuild;
varying vec3 vWorld;
varying vec3 vNormal;
${noiseGLSL}
${duneGLSL}
void main(){
  // Intro: the desert field grows out from the centre, its dunes rising out of the dark.
  vec4 wp = modelMatrix * vec4(position * uBuild, 1.0);
  float e = 1.5;
  float h  = duneHeight(wp.xz);
  float hL = duneHeight(wp.xz - vec2(e, 0.0));
  float hR = duneHeight(wp.xz + vec2(e, 0.0));
  float hD = duneHeight(wp.xz - vec2(0.0, e));
  float hU = duneHeight(wp.xz + vec2(0.0, e));
  vNormal = normalize(vec3(hL - hR, 2.0 * e, hD - hU));
  wp.y += h * uBuild - 5.0 * (1.0 - uBuild);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
export const groundFS = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uColor;
uniform vec3 uAmbient;
uniform float uSunInt;
uniform float uTime;
uniform float uFogDist;
uniform float uFogDensity;
varying vec3 vWorld;
varying vec3 vNormal;
${skyGLSL}
${noiseGLSL}
void main(){
  vec3 toCam = uCam - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vNormal);
  vec2 wp = vWorld.xz;

  float nearF = 1.0 - smoothstep(20.0, 150.0, dist);

  // wind ripples: crests run across the wind (+x) direction
  float rip = snoise(vec2(wp.x * 0.5 + snoise(wp * 0.06) * 5.0, wp.y * 1.8));
  N = normalize(N + vec3(rip * 0.13, 0.0, rip * 0.04) * nearF);

  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 sunLit = mix(vec3(1.0), uSunCol, 0.65);
  vec3 light = sunLit * uSunInt * ndl * 0.62 + uAmbient * 1.1 + uHorizon * 0.22;
  vec3 col = uColor * light;

  // Hills read darker and warmer than the flat plaza so the relief is obvious from the pyramid.
  float relief = smoothstep(0.15, 1.4, vWorld.y);
  col *= mix(1.0, 0.82, relief);
  col = mix(col, col * vec3(0.98, 0.93, 0.85), relief * 0.7);

  // fine sand grain
  float grain = snoise(wp * 7.0) * 0.5 + 0.5;
  col *= 0.95 + grain * 0.1 * nearF;

  // sand sliding across the surface in the wind
  float streak = snoise(vec2(wp.x * 0.12 - uTime * (6.0 + uStorm * 8.0), wp.y * 0.9)) * 0.5 + 0.5;
  col = mix(col, uHorizon, smoothstep(0.55, 1.0, streak) * 0.14 * (1.0 + uStorm) * nearF);

  // fog, same function as the sky at the horizon
  vec3 fd = normalize(vec3(-V.x, 0.0, -V.z));
  vec3 fogCol = skyBase(fd);
  float fd0 = uFogDist / (1.0 + uStorm * 0.9);
  float fogFactor = max(dist / fd0, dist * uFogDensity * 0.45);
  float f = 1.0 - exp(-pow(fogFactor, 2.0));
  col = mix(col, fogCol, clamp(f, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

/* ------------------------------ SAND ------------------------------- */
export const sandVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform vec3 uCam;
uniform float uFogDist;
varying float vAlpha;
varying float vTone;
${skyGLSL}
${noiseGLSL}
${duneGLSL}
void main(){
  vec3 box = vec3(230.0, 34.0, 230.0);
  float speed = (7.0 + aSeed.w * 10.0) * (1.0 + uStorm * 1.8);   // left -> right (+x)
  float t = uTime;

  vec3 p = aSeed.xyz * box;
  p.y = pow(aSeed.y, 1.8) * box.y;
  p.x += t * speed;

  // turbulence: per-particle wobble + shared eddies
  p.y += sin(t * 0.9 + aSeed.x * 40.0) * 1.6 + sin(t * 2.3 + aSeed.z * 30.0) * 0.5;
  p.z += sin(t * 0.7 + aSeed.y * 35.0) * 2.5 + cos(t * 1.9 + aSeed.x * 22.0) * 0.8;
  float eddy = snoise(vec2(p.x * 0.03 - t * 0.2, p.z * 0.03));
  p.y += eddy * 3.0;
  p.z += eddy * 2.0;

  // camera-relative wrap so the storm surrounds you forever
  vec2 rel = mod(p.xz - uCam.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
  vec2 wxz = uCam.xz + rel;
  float y = duneHeight(wxz) + 0.25 + mod(abs(p.y), box.y);
  vec4 mv = viewMatrix * vec4(wxz.x, y, wxz.y, 1.0);

  float dist = length(mv.xyz);
  float edge = 1.0 - smoothstep(70.0, 112.0, length(rel));
  float nearFade = smoothstep(1.5, 9.0, dist);
  float fd0 = uFogDist / (1.0 + uStorm * 0.9);
  float fog = 1.0 - exp(-pow(dist / fd0, 2.0));
  vAlpha = edge * nearFade * (1.0 - fog * 0.85) * (0.5 + uStorm * 0.25);
  vTone = aSeed.w;

  float size = uSize * uPixelRatio * (0.5 + aSeed.w) * (60.0 / max(dist, 1.0));
  gl_PointSize = clamp(size, 1.0, 14.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`
export const sandFS = /* glsl */ `
varying float vAlpha;
varying float vTone;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d);
  vec3 dark = vec3(0.60, 0.42, 0.24);
  vec3 light = vec3(0.98, 0.86, 0.66);
  vec3 col = mix(dark, light, step(0.5, fract(vTone * 7.31)));
  gl_FragColor = vec4(col, a * vAlpha);
  #include <colorspace_fragment>
}
`

/* ------------------------------ DUST ------------------------------- */
/* 200 swirls x N puffs, each puff spirals up a helix on the dune surface */
export const dustVS = /* glsl */ `
attribute vec4 aA; // swirl: centre x, centre z, height seed, speed seed
attribute vec4 aB; // puff: height frac, angle offset, radius rand, size rand
uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uCam;
uniform float uFogDist;
varying float vAlpha;
${skyGLSL}
${noiseGLSL}
${duneGLSL}
void main(){
  vec2 box = vec2(260.0);
  float t = uTime;
  vec2 c = aA.xy * box + vec2(t * (3.0 + aA.w * 4.0) * (1.0 + uStorm * 1.5), sin(t * 0.3 + aA.x * 20.0) * 4.0);
  float dir = aA.w > 0.5 ? 1.0 : -1.0;
  float ang = t * (1.1 + aA.w * 1.4) * dir + aB.y * 6.2831 + aB.x * 4.0;
  float r = (0.5 + aB.x * 2.4 + aB.z * 1.0) * (1.4 + aA.z) * (1.0 + uStorm * 0.5);
  vec2 xz = c + vec2(cos(ang), sin(ang)) * r;

  vec2 rel = mod(xz - uCam.xz + box * 0.5, box) - box * 0.5;
  vec2 wxz = uCam.xz + rel;
  float y = duneHeight(wxz) + 0.4 + aB.x * (4.0 + aA.z * 7.0) * (1.0 + uStorm * 0.6);
  vec4 mv = viewMatrix * vec4(wxz.x, y, wxz.y, 1.0);

  float dist = length(mv.xyz);
  float edge = 1.0 - smoothstep(80.0, 125.0, length(rel));
  float fd0 = uFogDist / (1.0 + uStorm * 0.9);
  float fog = 1.0 - exp(-pow(dist / fd0, 2.0));
  vAlpha = edge * smoothstep(3.0, 16.0, dist) * (1.0 - fog * 0.8) * (0.16 + uStorm * 0.08) * (1.0 - aB.x * 0.55);

  float size = (16.0 + aB.w * 26.0) * uPixelRatio * (60.0 / max(dist, 1.0));
  gl_PointSize = clamp(size, 2.0, 120.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`
export const dustFS = /* glsl */ `
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  vec3 col = vec3(0.86, 0.72, 0.52);
  gl_FragColor = vec4(col, a * vAlpha);
  #include <colorspace_fragment>
}
`

/* ------------------------------ TEXT ------------------------------- */
/* Typography that lives inside the 3D world: fogged by distance, dissolves in on the wind */
export const textVS = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
export const textFS = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uCam;
uniform float uReveal;
uniform float uOpacity;
uniform float uTime;
uniform float uFogDist;
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vWorld;
${skyGLSL}
${noiseGLSL}
void main(){
  float n = snoise(vUv * vec2(34.0, 17.0) + vec2(uTime * 0.05, 0.0)) * 0.5 + 0.5;
  float prog = uReveal * 1.45 - (vUv.x * 0.4 + (1.0 - n) * 0.55);
  float vis = smoothstep(0.0, 0.16, prog);

  // grains of sand get blown off to the right while it forms
  vec2 uv = vUv - vec2((1.0 - vis) * 0.03, 0.0);
  float a = texture2D(uMap, uv).a * vis * uOpacity;

  vec3 toCam = uCam - vWorld;
  float dist = length(toCam);
  vec3 fd = normalize(vec3(-toCam.x, 0.0, -toCam.z));
  float fd0 = uFogDist / (1.0 + uStorm * 0.9);
  float fogFactor = max(dist / fd0, dist * uFogDensity * 0.45);
  float f = 1.0 - exp(-pow(fogFactor, 2.0));
  vec3 col = mix(uColor, skyBase(fd), clamp(f, 0.0, 1.0));

  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`
