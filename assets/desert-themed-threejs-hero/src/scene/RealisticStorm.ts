import * as THREE from "three";
import { duneGLSL, noiseGLSL } from "./shaders";

const MAX_AIR_GRAINS = 15000;
const GROUND_GRAINS = 3000;
const DUST_CLOUDS = 50;
const WIND_STREAKS = 180;

function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeCanvasTexture(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, size: number) => void
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function makeGrainTexture() {
  return makeCanvasTexture(64, (ctx, size) => {
    const gradient = ctx.createRadialGradient(25, 22, 1, 32, 32, 28);
    gradient.addColorStop(0, "rgba(255,238,202,1)");
    gradient.addColorStop(0.4, "rgba(210,170,112,0.98)");
    gradient.addColorStop(1, "rgba(112,72,34,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(size * 0.15, size * 0.42);
    ctx.lineTo(size * 0.36, size * 0.12);
    ctx.lineTo(size * 0.82, size * 0.24);
    ctx.lineTo(size * 0.94, size * 0.58);
    ctx.lineTo(size * 0.62, size * 0.9);
    ctx.lineTo(size * 0.22, size * 0.78);
    ctx.closePath();
    ctx.fill();
  });
}

function makeDustTexture() {
  return makeCanvasTexture(128, (ctx, size) => {
    const random = seededRandom(7017);
    for (let i = 0; i < 24; i++) {
      const x = random() * size;
      const y = random() * size;
      const radius = size * (0.09 + random() * 0.24);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(239,207,157,${0.08 + random() * 0.1})`);
      gradient.addColorStop(0.5, `rgba(193,154,107,${0.05 + random() * 0.08})`);
      gradient.addColorStop(1, "rgba(140,93,51,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

function makeRayTexture() {
  return makeCanvasTexture(64, (ctx, size) => {
    const x = ctx.createLinearGradient(0, 0, size, 0);
    x.addColorStop(0, "rgba(255,224,174,0)");
    x.addColorStop(0.5, "rgba(255,224,174,0.85)");
    x.addColorStop(1, "rgba(255,224,174,0)");
    ctx.fillStyle = x;
    ctx.fillRect(0, 0, size, size);
    const y = ctx.createLinearGradient(0, 0, 0, size);
    y.addColorStop(0, "rgba(255,255,255,0)");
    y.addColorStop(0.4, "rgba(255,255,255,1)");
    y.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = y;
    ctx.fillRect(0, 0, size, size);
  });
}

function makeInstancedPlane(count: number) {
  const source = new THREE.PlaneGeometry(1, 1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = source.index;
  geometry.setAttribute("position", source.getAttribute("position"));
  geometry.setAttribute("uv", source.getAttribute("uv"));
  geometry.instanceCount = count;
  source.dispose();
  return geometry;
}

function makeSeeds(count: number, seed: number) {
  const random = seededRandom(seed);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  return seeds;
}

const airVS = /* glsl */ `
attribute vec4 aSeed;
attribute float aSize;
uniform float uTime;
uniform float uWindSpeed;
uniform float uWindStrength;
uniform vec3 uCam;
varying vec2 vUv;
varying float vDistanceOpacity;
varying float vTone;
${noiseGLSL}
${duneGLSL}
void main(){
  vec2 box = vec2(270.0, 220.0);
  float randomGust = fract(sin(floor(uTime * 1.7) + aSeed.x * 91.7) * 43758.5453);
  float gust = max(0.1, uWindSpeed + sin(uTime * 0.3 + aSeed.w * 6.2831) * 2.0 + randomGust);
  vec2 raw = vec2(aSeed.x * box.x + uTime * gust * (2.4 + aSeed.w * 2.4), aSeed.z * box.y);
  raw.y += sin(uTime * 0.55 + aSeed.x * 28.0) * (1.0 + uWindStrength * 4.0);
  vec2 relative = mod(raw - uCam.xz + box * 0.5, box) - box * 0.5;
  vec2 worldXZ = uCam.xz + relative;
  float height = 0.6 + pow(aSeed.y, 1.65) * 38.0;
  worldXZ.x += sin(uTime + height) * uWindStrength * 0.1;
  height += sin(uTime + height + aSeed.z * 30.0) * uWindStrength * 0.1;
  height += snoise(vec2(worldXZ.x * 0.035 - uTime * 0.25, worldXZ.y * 0.03)) * (0.5 + uWindStrength * 2.4);
  vec3 center = vec3(worldXZ.x, duneHeight(worldXZ) + height, worldXZ.y);
  vec4 mv = viewMatrix * vec4(center, 1.0);

  // Camera-facing textured plane; shader rotation replaces a per-frame object rotation.
  float rotation = aSeed.z * 6.2831 + uTime * gust * 0.1;
  float cs = cos(rotation);
  float sn = sin(rotation);
  vec2 rotated = mat2(cs, -sn, sn, cs) * position.xy;
  mv.xy += rotated * aSize;

  float distanceToCamera = length(mv.xyz);
  vDistanceOpacity = mix(0.9, 0.1, smoothstep(4.0, 190.0, distanceToCamera));
  vDistanceOpacity *= 1.0 - smoothstep(105.0, 145.0, length(relative));
  vTone = aSeed.w;
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`;

const airFS = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
varying float vDistanceOpacity;
varying float vTone;
void main(){
  vec4 grain = texture2D(uMap, vUv);
  if(grain.a < 0.025) discard;
  vec3 darkSand = vec3(0.55, 0.34, 0.16);
  vec3 lightSand = vec3(0.91, 0.76, 0.52);
  vec3 color = mix(darkSand, lightSand, vTone * 0.72 + 0.14) * grain.rgb;
  gl_FragColor = vec4(color, grain.a * vDistanceOpacity * uOpacity);
  #include <colorspace_fragment>
}
`;

const groundVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uWindSpeed;
uniform float uWindStrength;
uniform float uPixelRatio;
uniform vec3 uCam;
varying float vAlpha;
${noiseGLSL}
${duneGLSL}
void main(){
  vec2 box = vec2(250.0, 180.0);
  float randomGust = fract(sin(floor(uTime * 1.7) + aSeed.x * 83.1) * 43758.5453);
  float gust = max(0.2, uWindSpeed + sin(uTime * 0.3 + aSeed.w * 4.0) * 2.0 + randomGust);
  vec2 raw = vec2(aSeed.x * box.x + uTime * gust * (7.0 + aSeed.w * 5.0), aSeed.z * box.y);
  raw.y += sin(uTime * 1.4 + aSeed.x * 35.0) * (0.8 + uWindStrength * 3.0);
  vec2 relative = mod(raw - uCam.xz + box * 0.5, box) - box * 0.5;
  vec2 worldXZ = uCam.xz + relative;
  float height = duneHeight(worldXZ) + 0.1 + aSeed.y * 0.4;
  vec4 mv = viewMatrix * vec4(worldXZ.x, height, worldXZ.y, 1.0);
  float distanceToCamera = length(mv.xyz);
  gl_PointSize = clamp((12.0 + aSeed.w * 42.0) * uPixelRatio * (55.0 / max(distanceToCamera, 1.0)), 1.0, 90.0 * uPixelRatio);
  vAlpha = smoothstep(2.0, 10.0, distanceToCamera) * (1.0 - smoothstep(80.0, 125.0, length(relative)));
  gl_Position = projectionMatrix * mv;
}
`;

const groundFS = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying float vAlpha;
void main(){
  vec4 cloud = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vec3(0.757, 0.604, 0.420), cloud.a * vAlpha * uOpacity * 0.6);
  #include <colorspace_fragment>
}
`;

const cloudVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uWindSpeed;
uniform float uWindStrength;
uniform vec3 uCam;
varying vec2 vUv;
varying float vFade;
${noiseGLSL}
${duneGLSL}
void main(){
  vec2 box = vec2(260.0, 210.0);
  float drift = uWindSpeed * 0.42 + sin(uTime * 0.3 + aSeed.w * 6.2831) * 0.4;
  vec2 raw = vec2(aSeed.x * box.x + uTime * drift, aSeed.z * box.y + sin(uTime * 0.12 + aSeed.x * 9.0) * 5.0);
  vec2 relative = mod(raw - uCam.xz + box * 0.5, box) - box * 0.5;
  vec2 worldXZ = uCam.xz + relative;
  vec3 center = vec3(worldXZ.x, duneHeight(worldXZ) + 2.0 + aSeed.y * 18.0, worldXZ.y);
  vec4 mv = viewMatrix * vec4(center, 1.0);
  float angle = aSeed.w * 6.2831 + sin(uTime * 0.08 + aSeed.x * 5.0) * 0.25;
  float cs = cos(angle);
  float sn = sin(angle);
  vec2 quad = mat2(cs, -sn, sn, cs) * position.xy;
  float scale = 5.0 * (0.8 + aSeed.w * 0.4) * (1.0 + uWindStrength * 0.45);
  mv.xy += quad * scale;
  vUv = uv;
  vFade = (1.0 - smoothstep(80.0, 130.0, length(relative))) * smoothstep(3.0, 14.0, length(mv.xyz));
  gl_Position = projectionMatrix * mv;
}
`;

const cloudFS = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
void main(){
  vec4 cloud = texture2D(uMap, vUv);
  gl_FragColor = vec4(vec3(0.76, 0.58, 0.36), cloud.a * vFade * uOpacity * 0.15);
  #include <colorspace_fragment>
}
`;

const streakVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uWindSpeed;
uniform float uHeavy;
uniform vec3 uCam;
varying vec2 vUv;
varying float vAlpha;
void main(){
  vec3 box = vec3(150.0, 45.0, 120.0);
  float randomGust = fract(sin(floor(uTime * 2.1) + aSeed.x * 77.3) * 43758.5453);
  float gust = uWindSpeed + sin(uTime * 0.3 + aSeed.w * 5.0) * 2.0 + randomGust;
  vec3 raw = vec3(aSeed.x * box.x + uTime * gust * 8.0, aSeed.y * box.y, aSeed.z * box.z);
  vec3 relative = mod(raw - uCam + box * 0.5, box) - box * 0.5;
  vec4 mv = viewMatrix * vec4(uCam + relative, 1.0);
  vec2 quad = position.xy * vec2(1.2 + aSeed.w * 2.8, 0.012 + aSeed.y * 0.025);
  quad.y += quad.x * (aSeed.z - 0.5) * 0.08;
  mv.xy += quad;
  vUv = uv;
  vAlpha = uHeavy * (0.2 + aSeed.w * 0.45) * (1.0 - smoothstep(50.0, 85.0, length(relative)));
  gl_Position = projectionMatrix * mv;
}
`;

const streakFS = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main(){
  float along = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.62, 1.0, vUv.x));
  float across = 1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5));
  gl_FragColor = vec4(vec3(0.98, 0.91, 0.8), along * across * vAlpha);
  #include <colorspace_fragment>
}
`;

export class RealisticStorm {
  readonly group = new THREE.Group();
  private air: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private ground: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private clouds: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private streaks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private rays = new THREE.Group();
  private rayMeshes: THREE.Mesh[] = [];
  private textures: THREE.Texture[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private windSpeed = { value: 0.5 };
  private windStrength = { value: 0 };
  private opacity = { value: 0.3 };
  private heavy = { value: 0 };
  private baseZenith = new THREE.Color("#2b1d12");
  private baseMid = new THREE.Color("#d9c5a5");
  private baseHorizon = new THREE.Color("#e8d5b5");
  private heavyZenith = new THREE.Color("#704a2d");
  private heavyMid = new THREE.Color("#b68c59");
  private heavyHorizon = new THREE.Color("#d5ae76");
  intensity = 0;
  particleCount = 2000;
  fogDensity = 0.01;

  constructor(
    private shared: Record<string, THREE.IUniform>,
    private renderer: THREE.WebGLRenderer
  ) {
    this.group.name = "Layered realistic sandstorm";
    const grainTexture = makeGrainTexture();
    const dustTexture = makeDustTexture();
    const rayTexture = makeRayTexture();
    this.textures.push(grainTexture, dustTexture, rayTexture);

    this.air = this.buildAir(grainTexture);
    this.ground = this.buildGround(dustTexture);
    this.clouds = this.buildClouds(dustTexture);
    this.streaks = this.buildStreaks();
    this.group.add(this.air, this.ground, this.clouds, this.streaks);
    this.buildRays(rayTexture);
    this.group.add(this.rays);
    this.setIntensity(0);
  }

  private uniforms(extra: Record<string, THREE.IUniform> = {}) {
    return {
      ...this.shared,
      uWindSpeed: this.windSpeed,
      uWindStrength: this.windStrength,
      uOpacity: this.opacity,
      uHeavy: this.heavy,
      ...extra,
    };
  }

  private buildAir(map: THREE.Texture) {
    const geometry = makeInstancedPlane(MAX_AIR_GRAINS);
    const seeds = makeSeeds(MAX_AIR_GRAINS, 82113);
    const sizes = new Float32Array(MAX_AIR_GRAINS);
    const random = seededRandom(31551);
    for (let i = 0; i < MAX_AIR_GRAINS; i++) {
      const group = random();
      sizes[i] = group < 0.7 ? 0.02 : group < 0.95 ? 0.06 : 0.12;
      sizes[i] *= 0.82 + random() * 0.36;
    }
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: airVS,
      fragmentShader: airFS,
      uniforms: this.uniforms({ uMap: { value: map } }),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "2,000-15,000 textured flying sand grains";
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildGround(map: THREE.Texture) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(GROUND_GRAINS * 3), 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(makeSeeds(GROUND_GRAINS, 55129), 4));
    const material = new THREE.ShaderMaterial({
      vertexShader: groundVS,
      fragmentShader: groundFS,
      uniforms: this.uniforms({ uMap: { value: map } }),
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = "3,000-grain rolling ground sheet";
    points.frustumCulled = false;
    points.renderOrder = 3;
    this.geometries.push(geometry);
    this.materials.push(material);
    return points;
  }

  private buildClouds(map: THREE.Texture) {
    const geometry = makeInstancedPlane(DUST_CLOUDS);
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(makeSeeds(DUST_CLOUDS, 99017), 4));
    const material = new THREE.ShaderMaterial({
      vertexShader: cloudVS,
      fragmentShader: cloudFS,
      uniforms: this.uniforms({ uMap: { value: map } }),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "50 volumetric dust cloud planes";
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildStreaks() {
    const geometry = makeInstancedPlane(WIND_STREAKS);
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(makeSeeds(WIND_STREAKS, 44617), 4));
    const material = new THREE.ShaderMaterial({
      vertexShader: streakVS,
      fragmentShader: streakFS,
      uniforms: this.uniforms(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "Heavy-storm wind streaks";
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }

  private buildRays(map: THREE.Texture) {
    const geometry = new THREE.PlaneGeometry(52, 7);
    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uStorm;
        varying vec2 vUv;
        void main(){
          float heavy = smoothstep(0.55, 0.95, uStorm);
          vec4 ray = texture2D(uMap, vUv);
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.54), ray.a * heavy * 0.05);
          #include <colorspace_fragment>
        }
      `,
      uniforms: { uMap: { value: map }, uStorm: this.shared.uStorm },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(geometry, material);
      ray.position.set(-28 + i * 4.5, 25 + i * 3.2, -38 - i * 4);
      ray.userData.roll = -0.7 + i * 0.07;
      ray.renderOrder = 2;
      this.rays.add(ray);
      this.rayMeshes.push(ray);
    }
    this.geometries.push(geometry);
    this.materials.push(material);
  }

  setIntensity(value: number) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    this.intensity = t;

    /* Real storm curve:
     *    0   NONE:       0 particles,  fog 0.005, visibility 120 (see hills + camels crisp)
     *    25  BREEZE:  ~1000 particles, fog 0.010, visibility  80 (pyramid clear)
     *    50  MEDIUM:  ~3500 particles, fog 0.020, visibility  50 (slight haze)
     *    75  HEAVY:   ~6000 particles, fog 0.035, visibility  30 (details fade)
     *   100  SANDSTORM: 9000 particles, fog 0.060, visibility  15 (silhouette only)
     * Everything below is linearly interpolated between those five stops.
     */
    interface StormStop { t: number; count: number; fog: number; vis: number; opacity: number }
    const stops: StormStop[] = [
      { t: 0.00, count:     0, fog: 0.008, vis: 120, opacity: 0.0 },
      { t: 0.25, count:  1000, fog: 0.008, vis: 100, opacity: 0.45 },
      { t: 0.50, count:  3500, fog: 0.015, vis:  70, opacity: 0.7 },
      { t: 0.75, count:  6000, fog: 0.030, vis:  45, opacity: 0.9 },
      { t: 1.00, count:  9000, fog: 0.055, vis:  22, opacity: 1.0 },
    ];
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].t && t <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const k = a.t === b.t ? 0 : (t - a.t) / (b.t - a.t);
    const mix = (u: number, v: number) => u + (v - u) * k;
    this.particleCount = Math.min(MAX_AIR_GRAINS, Math.round(mix(a.count, b.count)));
    this.fogDensity = mix(a.fog, b.fog);
    const visibility = mix(a.vis, b.vis);
    const opacity = mix(a.opacity, b.opacity);

    this.air.geometry.instanceCount = this.particleCount;
    this.windSpeed.value = THREE.MathUtils.lerp(0.3, 5, t);
    this.windStrength.value = t;
    this.opacity.value = opacity;
    this.heavy.value = THREE.MathUtils.smoothstep(t, 0.7, 1);
    this.shared.uFogDensity.value = this.fogDensity;
    this.shared.uFogDist.value = visibility;

    // Dust colour shifts from light beige to a heavier ochre as the storm thickens.
    (this.shared.uZenith.value as THREE.Color).copy(this.baseZenith).lerp(this.heavyZenith, t);
    (this.shared.uMid.value as THREE.Color).copy(this.baseMid).lerp(this.heavyMid, t);
    (this.shared.uHorizon.value as THREE.Color).copy(this.baseHorizon).lerp(this.heavyHorizon, t);
    this.renderer.setClearColor(this.shared.uMid.value as THREE.Color);
    const controls = this.group.userData.controls ?? {};
    controls.particleCount = this.particleCount;
    controls.windSpeed = this.windSpeed.value;
    controls.fogDensity = this.fogDensity;
    controls.opacity = this.opacity.value;
    controls.visibility = this.shared.uFogDist.value;
    this.group.userData.controls = controls;
  }

  update(camera: THREE.PerspectiveCamera) {
    for (const ray of this.rayMeshes) {
      ray.lookAt(camera.position);
      ray.rotateZ(ray.userData.roll as number);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }
}