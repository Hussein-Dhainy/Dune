import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Color, InstancedMesh, MathUtils, Mesh, Object3D, PlaneGeometry, ShaderMaterial, UniformsLib } from 'three'
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

  // Let the existing fine noise visibly erode both edges of each wisp. This
  // creates grainy, uneven moving sand without paying for another noise sample.
  float edgeBreakup = (fine - 0.5) * 0.2 + (breakup - 0.5) * 0.06;
  float density = smoothstep(
    uThreshold - edgeBreakup,
    uThreshold + uSoftness - edgeBreakup,
    mass
  );
  density *= mix(0.55, 1.15, smoothstep(0.28, 0.72, fine));
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

const ribbonVertexShader = `
uniform float uTime;
varying vec2 vRibbonUv;
varying vec3 vRibbonWorldPosition;
#include <fog_pars_vertex>

void main() {
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
  worldPosition.y += sin(
    worldPosition.x * 1.35 + worldPosition.z * 0.48 + uTime * 1.1
  ) * 0.035;
  vRibbonUv = uv;
  vRibbonWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const ribbonFragmentShader = `
uniform float uTime;
uniform float uVisibility;
uniform vec3 uColor;
varying vec2 vRibbonUv;
varying vec3 vRibbonWorldPosition;
#include <fog_pars_fragment>

float ribbonRandom(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

float ribbonNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float bottom = mix(ribbonRandom(cell), ribbonRandom(cell + vec2(1.0, 0.0)), local.x);
  float top = mix(ribbonRandom(cell + vec2(0.0, 1.0)), ribbonRandom(cell + vec2(1.0)), local.x);
  return mix(bottom, top, local.y);
}

void main() {
  // Longitudinal flow makes the texture travel along the ribbons while the
  // higher crosswind frequency cuts it into separate strands.
  vec2 broadFlow = vec2(
    (vRibbonWorldPosition.x - uTime * 5.8) * 0.13,
    vRibbonWorldPosition.z * 0.72
  );
  vec2 fineFlow = vec2(
    (vRibbonWorldPosition.x - uTime * 7.4) * 0.31,
    vRibbonWorldPosition.z * 1.85
  );
  float broad = ribbonNoise(broadFlow);
  float fine = ribbonNoise(fineFlow + 4.7);
  float strand = smoothstep(0.55, 0.78, broad * 0.68 + fine * 0.42);

  float endFade = smoothstep(0.0, 0.16, vRibbonUv.x)
    * smoothstep(0.0, 0.16, 1.0 - vRibbonUv.x);
  float sideFade = smoothstep(0.0, 0.34, vRibbonUv.y)
    * smoothstep(0.0, 0.34, 1.0 - vRibbonUv.y);
  float granularBreakup = mix(0.35, 1.0, smoothstep(0.34, 0.74, fine));
  float alpha = strand * endFade * sideFade * granularBreakup * uVisibility * 0.24;
  if (alpha < 0.006) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
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
  { height: 0.035, heightVariation: 0.035, speed: 6.4, scale: 0.11, seed: 0.4, opacity: 0.08, threshold: 0.6, softness: 0.14, baseCoverage: 0.02, color: '#dec59a', nearCamera: 0 },
]

const ribbonPlacements = [
  { position: [-7.5, 0.2, 5.2], length: 10.5, width: 1.4, yaw: 0.08, tilt: 0.02 },
  { position: [5.8, 0.28, 4.1], length: 8.5, width: 1.25, yaw: -0.04, tilt: 0.08 },
  { position: [-5.2, 0.36, -3.4], length: 7.2, width: 1.1, yaw: 0.12, tilt: 0.12 },
  { position: [7.4, 0.45, -4.8], length: 9.2, width: 1.5, yaw: -0.1, tilt: 0.06 },
  { position: [-11.8, 0.32, -7.2], length: 11.5, width: 1.7, yaw: 0.16, tilt: 0.1 },
  { position: [1.2, 0.22, 8.1], length: 6.8, width: 0.95, yaw: 0.02, tilt: 0.04 },
  { position: [11.6, 0.38, 5.8], length: 8.4, width: 1.15, yaw: -0.14, tilt: 0.09 },
  { position: [2.8, 0.58, -9.5], length: 12.2, width: 1.8, yaw: 0.07, tilt: 0.14 },
  { position: [-14.2, 0.26, 1.2], length: 7.8, width: 1.05, yaw: -0.06, tilt: 0.05 },
  { position: [12.8, 0.5, -1.4], length: 10.8, width: 1.45, yaw: 0.11, tilt: 0.11 },
] as const

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

function createRibbonMaterial() {
  return new ShaderMaterial({
    vertexShader: ribbonVertexShader,
    fragmentShader: ribbonFragmentShader,
    uniforms: {
      ...UniformsLib.fog,
      uTime: { value: 0 },
      uVisibility: { value: 0 },
      uColor: { value: new Color('#ead8ba') },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: true,
    toneMapped: true,
  })
}

export function SandWind({ reveal }: { reveal: RevealUniforms }) {
  const { scene } = useGLTF(terrainModelUrl)
  const { state } = useLoopScroll()
  const viewportWidth = useThree((root) => root.size.width)
  const materials = useMemo(() => layers.map(createWindMaterial), [])
  const ribbonGeometry = useMemo(() => new PlaneGeometry(1, 1, 12, 1), [])
  const ribbonMaterial = useMemo(() => createRibbonMaterial(), [])
  const ribbonCount = viewportWidth < 600 ? 6 : ribbonPlacements.length
  const ribbons = useMemo(() => {
    const mesh = new InstancedMesh(ribbonGeometry, ribbonMaterial, ribbonCount)
    const transform = new Object3D()
    for (let index = 0; index < ribbonCount; index += 1) {
      const placement = ribbonPlacements[index]
      transform.position.set(
        placement.position[0],
        placement.position[1],
        placement.position[2],
      )
      transform.rotation.order = 'YXZ'
      transform.rotation.set(-Math.PI / 2 + placement.tilt, placement.yaw, 0)
      transform.scale.set(placement.length, placement.width, 1)
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    mesh.name = 'Localized wind ribbons'
    mesh.renderOrder = 4
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.visible = false
    return mesh
  }, [ribbonCount, ribbonGeometry, ribbonMaterial])
  const elapsed = useRef(0)
  const pageVisible = useRef(!document.hidden)
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
    ribbonGeometry.dispose()
    ribbonMaterial.dispose()
  }, [materials, ribbonGeometry, ribbonMaterial])

  useFrame((_, delta) => {
    if (pageVisible.current && !state.current.reducedMotion) elapsed.current += Math.min(delta, 0.1)
    const visibility = MathUtils.smoothstep(reveal.timeline.value, 0.24, 0.42)
    const groundMaterial = materials[0]
    // Shader uniforms are mutable render-loop state and avoid React updates.
    // oxlint-disable-next-line react/immutability
    groundMaterial.uniforms.uTime.value = elapsed.current
    groundMaterial.uniforms.uVisibility.value = visibility
    // oxlint-disable-next-line react/immutability
    ribbonMaterial.uniforms.uTime.value = elapsed.current
    ribbonMaterial.uniforms.uVisibility.value = visibility
    // oxlint-disable-next-line react/immutability
    foregroundLayers[0].visible = visibility > 0.002
    // oxlint-disable-next-line react/immutability
    ribbons.visible = visibility > 0.002
  })

  return (
    <>
      <primitive object={foregroundLayers[0]} />
      <primitive object={ribbons} />
    </>
  )
}
