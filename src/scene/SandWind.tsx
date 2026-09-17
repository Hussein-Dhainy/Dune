import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Color, MathUtils, Mesh, ShaderMaterial } from 'three'
import { useLoopScroll } from '../experience/useLoopScroll'
import type { RevealUniforms } from './reveal'

const terrainModelUrl = '/models/desert-terrain.glb?v=groundsand-1'

const vertexShader = `
uniform float uHeight;
uniform float uHeightVariation;
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
uniform float uSeed;
varying vec3 vWindWorldPosition;
varying vec3 vWindWorldNormal;

float vertexRandom(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

float vertexNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float bottom = mix(vertexRandom(cell), vertexRandom(cell + vec2(1.0, 0.0)), local.x);
  float top = mix(vertexRandom(cell + vec2(0.0, 1.0)), vertexRandom(cell + vec2(1.0)), local.x);
  return mix(bottom, top, local.y);
}

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 heightFlow = vec2(
    (worldPosition.x - uTime * uSpeed) * uScale * 0.7,
    worldPosition.z * uScale * 1.1
  ) + vec2(uSeed, -uSeed);
  float heightShape = vertexNoise(heightFlow) * 0.72 + vertexNoise(heightFlow * 2.1 + 3.7) * 0.28;
  worldPosition.y += uHeight + heightShape * uHeightVariation;
  vWindWorldPosition = worldPosition.xyz;
  vWindWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`

const fragmentShader = `
uniform float uTime;
uniform float uVisibility;
uniform float uSpeed;
uniform float uScale;
uniform float uSeed;
uniform float uOpacity;
uniform float uThreshold;
uniform float uSoftness;
uniform float uBaseCoverage;
uniform float uNearCamera;
uniform vec3 uColor;
varying vec3 vWindWorldPosition;
varying vec3 vWindWorldNormal;

float random(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float bottom = mix(random(cell), random(cell + vec2(1.0, 0.0)), local.x);
  float top = mix(random(cell + vec2(0.0, 1.0)), random(cell + vec2(1.0)), local.x);
  return mix(bottom, top, local.y);
}

void main() {
  // Low X frequency and higher Z frequency stretch disconnected wisps in the
  // left-to-right travel direction instead of forming vertical stripes.
  vec2 flow = vec2(
    (vWindWorldPosition.x - uTime * uSpeed) * uScale,
    vWindWorldPosition.z * uScale * 2.6
  );
  float broad = valueNoise(flow + vec2(uSeed, -uSeed));
  float breakup = valueNoise(flow * 2.25 + vec2(5.7 + uSeed, 1.3));
  float fine = valueNoise(vec2(flow.x * 0.72, flow.y * 3.1) + vec2(2.4, uSeed * 2.0));

  float mass = broad * 0.62 + breakup * 0.26 + fine * 0.2;
  float density = smoothstep(uThreshold, uThreshold + uSoftness, mass);
  float islandBreakup = smoothstep(0.4, 0.66, breakup * 0.65 + fine * 0.45);
  density *= mix(uBaseCoverage, 1.0, islandBreakup);

  // Fade near grazing angles so elevated shells never draw bright lines along
  // the terrain silhouette.
  vec3 viewDirection = normalize(cameraPosition - vWindWorldPosition);
  float facingFade = smoothstep(0.02, 0.14, abs(dot(normalize(vWindWorldNormal), viewDirection)));

  // Keep the effect in the wide foreground basin and away from background dunes.
  vec2 foregroundPosition = vec2(vWindWorldPosition.x * 0.72, vWindWorldPosition.z);
  float foregroundFade = 1.0 - smoothstep(42.0, 66.0, length(foregroundPosition));
  float cameraGroundDistance = length(cameraPosition.xz - vWindWorldPosition.xz);
  float nearCameraFade = 1.0 - smoothstep(5.0, 16.0, cameraGroundDistance);
  foregroundFade *= mix(1.0, nearCameraFade, uNearCamera);
  float alpha = density * facingFade * foregroundFade * uVisibility * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

type WindLayer = {
  height: number
  heightVariation: number
  speed: number
  scale: number
  seed: number
  opacity: number
  threshold: number
  softness: number
  baseCoverage: number
  color: string
  nearCamera: number
}

const layers: readonly WindLayer[] = [
  { height: 0.045, heightVariation: 0.08, speed: 6.0, scale: 0.095, seed: 0.4, opacity: 0.2, threshold: 0.46, softness: 0.18, baseCoverage: 0.3, color: '#dec59a', nearCamera: 0 },
  { height: 0.32, heightVariation: 0.18, speed: 7.6, scale: 0.078, seed: 4.1, opacity: 0.16, threshold: 0.54, softness: 0.18, baseCoverage: 0.3, color: '#dec59a', nearCamera: 0 },
  { height: 1.7, heightVariation: 0.9, speed: 5.0, scale: 0.045, seed: 13.2, opacity: 0.1, threshold: 0.52, softness: 0.22, baseCoverage: 0.18, color: '#e8d9bd', nearCamera: 0 },
  { height: 0.72, heightVariation: 0.3, speed: 9.2, scale: 0.064, seed: 8.7, opacity: 0.11, threshold: 0.58, softness: 0.18, baseCoverage: 0.3, color: '#dec59a', nearCamera: 0 },
  { height: 1.1, heightVariation: 0.65, speed: 6.8, scale: 0.052, seed: 18.6, opacity: 0.15, threshold: 0.5, softness: 0.24, baseCoverage: 0.12, color: '#eadcc3', nearCamera: 1 },
]

function createWindMaterial(layer: WindLayer) {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uVisibility: { value: 0 },
      uHeight: { value: layer.height },
      uHeightVariation: { value: layer.heightVariation },
      uSpeed: { value: layer.speed },
      uScale: { value: layer.scale },
      uSeed: { value: layer.seed },
      uOpacity: { value: layer.opacity },
      uThreshold: { value: layer.threshold },
      uSoftness: { value: layer.softness },
      uBaseCoverage: { value: layer.baseCoverage },
      uNearCamera: { value: layer.nearCamera },
      uColor: { value: new Color(layer.color) },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: true,
  })
}

export function SandWind({ reveal }: { reveal: RevealUniforms }) {
  const { scene } = useGLTF(terrainModelUrl)
  const { state } = useLoopScroll()
  const width = useThree((root) => root.size.width)
  const materials = useMemo(() => layers.map(createWindMaterial), [])
  const elapsed = useRef(0)
  const pageVisible = useRef(!document.hidden)
  const activeLayerIndices = width < 600 ? [0, 2, 4] : [0, 1, 2, 3, 4]
  const foregroundLayers = useMemo(() => {
    const source = scene.children.find((child) => child.name.startsWith('Desert_Base_Terrain'))
    if (!(source instanceof Mesh)) return []
    return materials.map((material, index) => {
      const shell = new Mesh(source.geometry, material)
      shell.name = `Foreground sand wind ${index + 1}`
      shell.position.copy(source.position)
      shell.quaternion.copy(source.quaternion)
      shell.scale.copy(source.scale)
      shell.renderOrder = 3 + index
      shell.castShadow = false
      shell.receiveShadow = false
      shell.visible = false
      return shell
    })
  }, [scene, materials])

  useEffect(() => {
    const updateVisibility = () => { pageVisible.current = !document.hidden }
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  useEffect(() => () => {
    for (const material of materials) material.dispose()
  }, [materials])

  useFrame((_, delta) => {
    if (pageVisible.current && !state.current.reducedMotion) elapsed.current += Math.min(delta, 0.1)
    const visibility = MathUtils.smoothstep(reveal.timeline.value, 0.24, 0.42)
    for (const index of activeLayerIndices) {
      const material = materials[index]
      // Shader uniforms are mutable render-loop state and avoid React updates.
      // oxlint-disable-next-line react/immutability
      material.uniforms.uTime.value = elapsed.current
      material.uniforms.uVisibility.value = visibility
      // oxlint-disable-next-line react/immutability
      foregroundLayers[index].visible = visibility > 0.002
    }
  })

  return activeLayerIndices.map((index) => foregroundLayers[index]).map((layer) => (
    <primitive key={layer.uuid} object={layer} />
  ))
}
