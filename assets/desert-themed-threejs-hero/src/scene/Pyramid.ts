import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import gsap from "gsap";
import { STONE_HOVER_EVENT, type StoneHoverDetail } from "./interaction";
import {
  averageLinearLuma,
  configureStoneTexture,
  makeSandstoneFallback,
  SANDSTONE_TEXTURES,
  type SandstoneKind,
} from "./sandstone";
import { skyGLSL } from "./shaders";

export const PYRAMID = {
  courses: 12,
  base: 16,
  height: 16 * (146.6 / 230.4),
  // Keeps Giza proportions (146.6 : 230.4) while landing at ~8.8 x 5.6 world units,
  // so the resting camera at distance 20 sees a small monument in a wide desert field.
  worldScale: 0.55,
  baseY: -0.18,
  brickDepth: 1.1,
  brickLength: 1.75,
} as const;

// 0 = solid pyramid, 0.05 = igloo floating style
export const BLOCK_GAP = 0;

/**
 * ONE limestone colour for every block, like a real Giza course cut from the same quarry.
 * Per-block variation comes from roughness (0.88 - 0.95) and the shared texture maps only.
 */
const LIMESTONE = 0xc9ab7a;
const LAMP_COLOR = "#ffcc8a";
const SEAM_LEAK = 0.22;
const LAMP_BASE = 0.28;

type StoneMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;

interface Stone {
  mesh: StoneMesh;
  outer: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  /** Slow astronaut target. Zero-G rocks lerp around this point forever. */
  target: THREE.Vector3;
  maxDistance: number;
  /** Course index. Layer 0 is the foundation and never moves. */
  layer: number;
  isStatic: boolean;
  /** Intro build-in: 0 -> 1 scale and a rising offset from below the sand. */
  buildScale: number;
  buildY: number;
  origin: THREE.Vector3;
  current: THREE.Vector3;
  anchor: THREE.Vector3;
  offset: THREE.Vector3;
  path: THREE.CatmullRomCurve3 | null;
  pathLen: number;
  pathT: number;
  velocity: THREE.Vector3;
  spinVel: THREE.Vector3;
  fallY: number;
  vy: number;
  rot: { x: number; y: number; z: number };
  spinAcc: THREE.Vector3;
  mode: "rest" | "out" | "float" | "back";
  floating: boolean;
  floorY: number;
  color: THREE.Color;
  index: number;
  phase: number;
  scaleValue: number;
  pulse: number;
  glow: number;
}

interface StoneLink {
  from: Stone;
  to: Stone | null;
}

interface DisperseLines {
  object: THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.LineDashedMaterial;
  links: StoneLink[];
  fading: boolean;
}

function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function sharedField(px: number, py: number, pz: number, out: THREE.Vector3) {
  return out
    .set(
      Math.sin(px * 1.9 + py * 2.7 + 1.3) * 0.6 + Math.sin(pz * 3.3 - py * 1.1 + 2.1) * 0.4,
      Math.sin(pz * 2.3 + px * 1.7 + 4.1) * 0.6 + Math.sin(py * 3.1 + px * 0.9 + 0.7) * 0.4,
      Math.sin(px * 2.6 - pz * 1.4 + 5.2) * 0.6 + Math.sin(py * 2.2 + pz * 2.9 + 3.3) * 0.4
    )
    .multiplyScalar(0.035);
}

interface StoneShape {
  width: number;
  height: number;
  depth: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  taper: number;
}

const _field = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _inward = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _aim = new THREE.Vector3();
const MAX_OVERSHOOT = 0.35;

function evalPath(curve: THREE.CatmullRomCurve3, length: number, t: number, out: THREE.Vector3) {
  if (t < 0) {
    curve.getPoint(0, out);
    curve.getTangent(0, _tan);
    return out.addScaledVector(_tan, Math.max(t * length, -MAX_OVERSHOOT));
  }
  if (t > 1) {
    curve.getPoint(1, out);
    curve.getTangent(1, _tan);
    return out.addScaledVector(_tan, Math.min((t - 1) * length, MAX_OVERSHOOT));
  }
  return curve.getPoint(t, out);
}

function makeStoneGeometry(shape: StoneShape, random: () => number) {
  const { width, height, depth, centerX, centerY, centerZ, taper } = shape;
  const radius = 0.018 + Math.pow(random(), 2) * 0.04;
  const geometry = new RoundedBoxGeometry(width, height, depth, 2, radius);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const uvs = geometry.getAttribute("uv");
  const count = positions.count;
  const originalNormals = (normals.array as Float32Array).slice();

  const dust = new Float32Array(count);
  const inner = new Float32Array(count);
  const box = new Float32Array(count * 3);
  const seed = new Float32Array(count).fill(random() * 40);
  const smoothNormals = new Float32Array(count * 3);

  const uvX = 0.04 + random() * 0.75;
  const uvY = 0.04 + random() * 0.75;
  const textureScale = 0.18 + random() * 0.08;
  const slope = (taper - 1) / height;
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const halfD = depth * 0.5;

  _inward.set(-centerX, 0, -centerZ);
  if (_inward.lengthSq() < 1e-6) _inward.set(0, -1, 0);
  else _inward.normalize();

  for (let i = 0; i < count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const nx = originalNormals[i * 3];
    const ny = originalNormals[i * 3 + 1];
    const nz = originalNormals[i * 3 + 2];
    const fraction = THREE.MathUtils.clamp((y + halfH) / height, 0, 1);
    const scale = THREE.MathUtils.lerp(1, taper, fraction);

    _normal
      .set(nx / scale, ny - (slope * ((x + centerX) * nx + (z + centerZ) * nz)) / scale, nz / scale)
      .normalize();
    smoothNormals[i * 3] = _normal.x;
    smoothNormals[i * 3 + 1] = _normal.y;
    smoothNormals[i * 3 + 2] = _normal.z;

    box[i * 3] = x / halfW;
    box[i * 3 + 1] = y / halfH;
    box[i * 3 + 2] = z / halfD;

    const tx = (x + centerX) * scale - centerX;
    const tz = (z + centerZ) * scale - centerZ;
    const gx = tx + centerX;
    const gy = y + centerY;
    const gz = tz + centerZ;

    const d = _normal.dot(_inward);
    sharedField(gx, gy, gz, _field);
    // Extra chip only on exposed edges, not on touching faces, so the 0px shell stays sealed.
    const edge = Math.max(Math.abs(x) / halfW, Math.abs(z) / halfD, Math.abs(y) / halfH);
    const chip = THREE.MathUtils.smoothstep(edge, 0.82, 1) * 0.035;
    const qx = Math.round(gx * 400);
    const qy = Math.round(gy * 400);
    const qz = Math.round(gz * 400);
    const rx = (hash3(qx, qy, qz) - 0.5) * 2 * chip;
    const ry = (hash3(qy + 17, qz + 3, qx + 91) - 0.5) * 2 * chip;
    const rz = (hash3(qz + 41, qx + 7, qy + 59) - 0.5) * 2 * chip;

    positions.setXYZ(i, tx + _field.x + rx, y + _field.y + ry, tz + _field.z + rz);
    dust[i] = THREE.MathUtils.smoothstep(ny, 0.25, 0.95) * 0.85 + Math.max(0, _normal.y) * 0.15;
    uvs.setXY(i, uvX + uvs.getX(i) * textureScale, uvY + uvs.getY(i) * textureScale);
    void d;
  }

  geometry.computeVertexNormals();
  for (let i = 0; i < count; i++) {
    _normal
      .set(
        smoothNormals[i * 3] * 0.45 + normals.getX(i) * 0.55,
        smoothNormals[i * 3 + 1] * 0.45 + normals.getY(i) * 0.55,
        smoothNormals[i * 3 + 2] * 0.45 + normals.getZ(i) * 0.55
      )
      .normalize();
    normals.setXYZ(i, _normal.x, _normal.y, _normal.z);
  }

  const rockIndices: number[] = [];
  const lampIndices: number[] = [];
  for (let t = 0; t < count / 3; t++) {
    const a = t * 3;
    let sx = 0, sy = 0, sz = 0, ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 3; k++) {
      sx += smoothNormals[(a + k) * 3];
      sy += smoothNormals[(a + k) * 3 + 1];
      sz += smoothNormals[(a + k) * 3 + 2];
      ox += originalNormals[(a + k) * 3];
      oy += originalNormals[(a + k) * 3 + 1];
      oz += originalNormals[(a + k) * 3 + 2];
    }
    _normal.set(sx, sy, sz).normalize();
    const inwardDot = _normal.dot(_inward);
    const isBevel = Math.max(Math.abs(ox), Math.abs(oy), Math.abs(oz)) / 3 < 0.985;

    let lampWeight = 0;
    if (inwardDot > 0.3) lampWeight = -1;
    else if (isBevel) lampWeight = SEAM_LEAK;

    if (lampWeight === 0) {
      rockIndices.push(a, a + 1, a + 2);
    } else {
      lampIndices.push(a, a + 1, a + 2);
      for (let k = 0; k < 3; k++) {
        if (lampWeight < 0) {
          const vx = smoothNormals[(a + k) * 3] * _inward.x;
          const vy = smoothNormals[(a + k) * 3 + 1] * _inward.y;
          const vz = smoothNormals[(a + k) * 3 + 2] * _inward.z;
          inner[a + k] = THREE.MathUtils.smoothstep(vx + vy + vz, 0.12, 0.8);
        } else {
          inner[a + k] = lampWeight;
        }
      }
    }
  }
  geometry.setIndex([...rockIndices, ...lampIndices]);
  geometry.clearGroups();
  if (rockIndices.length) geometry.addGroup(0, rockIndices.length, 0);
  if (lampIndices.length) geometry.addGroup(rockIndices.length, lampIndices.length, 1);
  geometry.setAttribute("uv2", geometry.getAttribute("uv").clone());
  geometry.setAttribute("aStoneDust", new THREE.BufferAttribute(dust, 1));
  geometry.setAttribute("aInnerFace", new THREE.BufferAttribute(inner, 1));
  geometry.setAttribute("aBox", new THREE.BufferAttribute(box, 3));
  geometry.setAttribute("aBlockSeed", new THREE.BufferAttribute(seed, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export class Pyramid {
  readonly group = new THREE.Group();
  readonly meshes: StoneMesh[] = [];
  readonly ready: Promise<void>;

  private pickerGroup = new THREE.Group();
  private pickerMeshes: THREE.Mesh[] = [];
  private stones: Stone[] = [];
  private byMesh = new Map<THREE.Object3D, Stone>();
  private raycaster = new THREE.Raycaster();
  private intersections: THREE.Intersection<THREE.Mesh>[] = [];
  private bounds = new THREE.Sphere();
  private lastPointer = new THREE.Vector2(Infinity, Infinity);
  private smoothPointer = new THREE.Vector2();
  private hovered: Stone | null = null;
  private activeStones: Stone[] = [];
  private disperse = 0;
  private lines: DisperseLines | null = null;
  private lastPick = -Infinity;
  private disposed = false;
  /** Slow movement rates: 3.25 s out, 3.5 s back, 0.03 smoothing lerp. */
  private readonly outDuration = 3; // 2.5 + rand * 1.5
  private readonly backDuration = 3.5; // 3 + rand * 1.0
  private readonly lerpRate = 0.03;
  private readonly maxTravel = 1.5;
  private textures = new Set<THREE.Texture>();
  private maps: Record<SandstoneKind, THREE.Texture>;
  private heightUniform: THREE.IUniform<THREE.Texture>;
  private mapAverage: THREE.IUniform<number>;
  private highlight = new THREE.Color("#e8d5b5");
  private dustColor = { value: new THREE.Color("#e8d5b5") };
  private creviceColor = { value: new THREE.Color("#8a6a4f") };
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private finishReady: (() => void) | undefined;

  private innerLight = 1.2;
  private innerContrast: THREE.IUniform<number> = { value: 0.45 };
  private innerLightU: THREE.IUniform<number> = { value: 1 };
  private heartbeatOn = true;
  private heartbeatMix = 1;
  private gravity = 0;
  private rays: THREE.Mesh[] = [];
  private rayMaterial!: THREE.ShaderMaterial;

  constructor(
    private shared: Record<string, THREE.IUniform>,
    private anisotropy: number
  ) {
    this.group.name = "Great Pyramid / running-bond limestone";
    this.group.position.set(0, 0, 0);
    this.group.rotation.y = -0.28;
    this.group.userData.proportions = { baseMeters: 230.4, heightMeters: 146.6 };
    this.pickerGroup.name = "Static non-rendered hover targets";
    this.pickerGroup.visible = false;

    this.maps = makeSandstoneFallback(anisotropy);
    for (const texture of Object.values(this.maps)) this.textures.add(texture);
    this.heightUniform = { value: this.maps.displacement };
    this.mapAverage = { value: averageLinearLuma(this.maps.diffuse) };

    this.build();
    this.buildRays();
    this.group.add(this.pickerGroup);
    this.publishGravity();
    this.resize(1);

    this.ready = new Promise<void>((resolve) => {
      this.finishReady = () => {
        clearTimeout(this.readyTimer);
        resolve();
        this.finishReady = undefined;
      };
      this.readyTimer = setTimeout(() => this.finishReady?.(), 3500);
      void this.loadTextures().finally(() => this.finishReady?.());
    });
  }

  private addBrick(
    x: number,
    y: number,
    z: number,
    length: number,
    height: number,
    depth: number,
    alongX: boolean,
    taper: number,
    layer: number,
    random: () => number
  ) {
    const width = alongX ? length : depth;
    const brickDepth = alongX ? depth : length;
    const geometry = makeStoneGeometry(
      { width, height, depth: brickDepth, centerX: x, centerY: y, centerZ: z, taper },
      random
    );
    // Same quarry stone for every block: identical colour, only roughness differs.
    const color = new THREE.Color(LIMESTONE);
    const roughness = 0.88 + random() * 0.07;
    const { outer, lamp } = this.makeMaterials(color, roughness);
    const mesh = new THREE.Mesh(geometry, [outer, lamp]) as StoneMesh;
    const index = this.stones.length;
    const origin = new THREE.Vector3(x, y, z);
    mesh.name = `Giza stone ${index + 1}`;
    mesh.position.copy(origin);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const stone: Stone = {
      mesh,
      outer,
      lamp,
      origin,
      current: origin.clone(),
      anchor: origin.clone(),
      offset: new THREE.Vector3(),
      path: null,
      pathLen: 0,
      pathT: 0,
      velocity: new THREE.Vector3(),
      spinVel: new THREE.Vector3(),
      fallY: 0,
      vy: 0,
      target: origin.clone(),
      maxDistance: 1.5,
      layer,
      isStatic: layer === 0,
      buildScale: 1,
      buildY: 0,
      rot: { x: 0, y: 0, z: 0 },
      spinAcc: new THREE.Vector3(),
      mode: "rest",
      floating: false,
      floorY: PYRAMID.baseY + height * 0.5,
      color,
      index,
      phase: (x + z) * 0.6 + y * 1.2,
      scaleValue: 1,
      pulse: 0,
      glow: 0,
    };
    const picker = new THREE.Mesh(geometry, outer);
    picker.position.copy(origin);
    picker.visible = false;
    this.stones.push(stone);
    this.meshes.push(mesh);
    // Layer 0 is the foundation: it is never hoverable, so it is never picked.
    if (!stone.isStatic) this.pickerMeshes.push(picker);
    this.byMesh.set(mesh, stone);
    this.byMesh.set(picker, stone);
    this.group.add(mesh);
    this.pickerGroup.add(picker);
  }

  private build() {
    const random = seededRandom(23041466);
    const courseH = PYRAMID.height / PYRAMID.courses;
    const depth = PYRAMID.brickDepth;

    for (let layer = 0; layer < PYRAMID.courses; layer++) {
      const y0 = layer * courseH;
      const y1 = y0 + courseH;
      const y = PYRAMID.baseY + (y0 + y1) * 0.5;
      const outer = PYRAMID.base * (1 - y0 / PYRAMID.height);
      const topW = Math.max(0.05, PYRAMID.base * (1 - y1 / PYRAMID.height));
      const taper = topW / Math.max(outer, 0.05);
      const n = Math.max(1, Math.round(outer / PYRAMID.brickLength));
      const brickLen = outer / n;
      const height = y1 - y0;
      const radial = Math.min(depth, outer * 0.45);
      const even = layer % 2 === 0;
      const nsOwnsCorners = even; // running bond: odd courses rotate ownership 90°

      if (n === 1) {
        this.addBrick(0, y, 0, Math.max(outer, 0.4), height, Math.max(outer, 0.4), true, taper, layer, random);
        continue;
      }

      const placeFace = (alongX: boolean, sign: number, count: number, inset: number) => {
        const span = outer - 2 * inset;
        if (count <= 0 || span <= 0.05) return;
        const len = span / count;
        for (let i = 0; i < count; i++) {
          const along = -outer / 2 + inset + (i + 0.5) * len;
          const radialPos = sign * (outer / 2 - radial / 2);
          if (alongX) this.addBrick(along, y, radialPos, len, height, radial, true, taper, layer, random);
          else this.addBrick(radialPos, y, along, len, height, radial, false, taper, layer, random);
        }
      };

      if (nsOwnsCorners) {
        placeFace(true, 1, n, 0);
        placeFace(true, -1, n, 0);
        placeFace(false, 1, Math.max(0, n - 2), brickLen);
        placeFace(false, -1, Math.max(0, n - 2), brickLen);
      } else {
        placeFace(false, 1, n, 0);
        placeFace(false, -1, n, 0);
        placeFace(true, 1, Math.max(0, n - 2), brickLen);
        placeFace(true, -1, Math.max(0, n - 2), brickLen);
      }
    }

    this.group.userData.blockCount = this.stones.length;
  }

  private buildRays() {
    const geo = new THREE.PlaneGeometry(2.2, 9);
    this.rayMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uAmount: { value: 0 },
        uTime: this.shared.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAmount;
        uniform float uTime;
        varying vec2 vUv;
        void main(){
          float shaft = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.4) * (1.0 - vUv.y);
          float flicker = 0.85 + 0.15 * sin(uTime * 3.0 + vUv.y * 6.0);
          gl_FragColor = vec4(1.0, 0.72, 0.32, shaft * flicker * uAmount * 0.22);
        }
      `,
    });
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(geo, this.rayMaterial);
      ray.position.set((i - 2) * 0.55, 2.4, 0);
      ray.rotation.z = (i - 2) * 0.12;
      ray.frustumCulled = false;
      ray.renderOrder = 8;
      this.group.add(ray);
      this.rays.push(ray);
    }
  }

  private makeMaterials(color: THREE.Color, roughness = 0.9) {
    const shared = {
      map: this.maps.diffuse,
      normalMap: this.maps.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: this.maps.roughness,
      roughness,
      metalness: 0,
      aoMap: this.maps.ao,
      aoMapIntensity: 1.2,
      displacementMap: this.maps.displacement,
      displacementScale: 0.04,
      displacementBias: -0.02,
      dithering: true,
    };
    const outer = new THREE.MeshStandardMaterial({
      ...shared,
      color,
      emissive: new THREE.Color("#000000"),
      emissiveIntensity: 0,
    });
    const lamp = new THREE.MeshStandardMaterial({
      ...shared,
      color: color.clone().multiplyScalar(0.62),
      emissive: new THREE.Color(LAMP_COLOR),
      emissiveIntensity: 0,
    });
    this.patchMaterial(outer, "outer");
    this.patchMaterial(lamp, "lamp");
    return { outer, lamp };
  }

  private patchMaterial(material: THREE.MeshStandardMaterial, kind: "outer" | "lamp") {
    const isLamp = kind === "lamp";
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shared, {
        uStoneDustColor: this.dustColor,
        uCreviceColor: this.creviceColor,
        uInnerContrast: this.innerContrast,
        uHeightMap: this.heightUniform,
        uMapAvg: this.mapAverage,
        uInnerLight: this.innerLightU,
      });

      shader.vertexShader = /* glsl */ `
        attribute float aStoneDust;
        attribute float aInnerFace;
        attribute vec3 aBox;
        attribute float aBlockSeed;
        varying float vStoneDust;
        varying float vInnerFace;
        varying vec3 vBox;
        varying float vBlockSeed;
        varying vec3 vStoneLocal;
        varying vec3 vStoneWorld;
      ` + shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
          #include <begin_vertex>
          vStoneDust = aStoneDust;
          vInnerFace = aInnerFace;
          vBox = aBox;
          vBlockSeed = aBlockSeed;
          vStoneLocal = transformed;
          vStoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

      shader.fragmentShader = /* glsl */ `
        uniform vec3 uCam;
        uniform float uTime;
        uniform float uFogDist;
        uniform float uFogDensity;
        uniform vec3 uStoneDustColor;
        uniform vec3 uCreviceColor;
        uniform float uInnerContrast;
        uniform float uMapAvg;
        uniform float uInnerLight;
        uniform sampler2D uHeightMap;
        varying float vStoneDust;
        varying float vInnerFace;
        varying vec3 vBox;
        varying float vBlockSeed;
        varying vec3 vStoneLocal;
        varying vec3 vStoneWorld;
        ${skyGLSL}
      ` + shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `
          #include <color_fragment>
          float stoneMapLuma = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float stoneDetail = clamp(stoneMapLuma / uMapAvg, 0.5, 1.6);
          diffuseColor.rgb = diffuse * mix(1.0, stoneDetail, 0.65);
          float stoneHeight = texture2D(uHeightMap, vMapUv).r;
          diffuseColor.rgb *= mix(0.9, 1.06, stoneHeight);
          vec3 stoneQ = clamp(abs(vBox), 0.0, 1.0);
          float stoneQMax = max(stoneQ.x, max(stoneQ.y, stoneQ.z));
          float stoneQMin = min(stoneQ.x, min(stoneQ.y, stoneQ.z));
          float stoneQMid = stoneQ.x + stoneQ.y + stoneQ.z - stoneQMax - stoneQMin;
          // Sand packed in AO crevices: #8a6a4f
          float cavity = 1.0 - stoneHeight;
          diffuseColor.rgb = mix(diffuseColor.rgb, uCreviceColor, cavity * 0.45);
          vec3 stoneWearColor = pow(vec3(0.541, 0.416, 0.310), vec3(2.2));
          float stoneWear = smoothstep(0.82, 1.0, stoneQMid);
          diffuseColor.rgb = mix(diffuseColor.rgb, stoneWearColor, stoneWear * 0.5);
          float stoneFleck = fract(sin(dot(floor(vStoneWorld.xz * 110.0), vec2(12.9898, 78.233))) * 43758.5453);
          float stoneDust = vStoneDust * mix(0.3, 0.5, stoneFleck) * (1.0 - stoneWear * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, uStoneDustColor, stoneDust);
        `
      ).replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
          #include <roughnessmap_fragment>
          // Per-block roughness (0.88 - 0.95) modulated by the shared map: the only variation
          // between blocks, since every block shares one limestone colour.
          roughnessFactor = clamp(roughness * mix(0.94, 1.06, texelRoughness.g), 0.84, 0.97);
        `
      ).replace(
        "#include <emissivemap_fragment>",
        isLamp
          ? /* glsl */ `
          #include <emissivemap_fragment>
          {
            float stoneQMid = vBox.x + vBox.y + vBox.z;
            stoneQMid = abs(vBox.x) + abs(vBox.y) + abs(vBox.z) - max(abs(vBox.x), max(abs(vBox.y), abs(vBox.z))) - min(abs(vBox.x), min(abs(vBox.y), abs(vBox.z)));
            float lampEdge = clamp(stoneQMid, 0.0, 1.0);
            float lampSoft = 1.0 - 0.45 * lampEdge * lampEdge;
            float lampR = clamp(length(vec2(lampEdge, min(abs(vBox.x), min(abs(vBox.y), abs(vBox.z))))) * 0.7071, 0.0, 1.0);
            float lampSpot = pow(1.0 - lampR, 3.6) * 1.7;
            float lampShape = mix(lampSoft, lampSpot, uInnerContrast);
            float lampFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            lampShape *= mix(0.6, 1.0, lampFacing);
            float stoneFaceGate = smoothstep(0.7, 1.0, vInnerFace);
            lampShape = mix(1.0, lampShape, stoneFaceGate);
            float lampBreath = 0.9 + 0.1 * sin(uTime * 3.0 + vStoneWorld.x * 1.7);
            totalEmissiveRadiance *= vInnerFace * lampShape * lampBreath;
          }
        `
          : "#include <emissivemap_fragment>"
      ).replace(
        "#include <opaque_fragment>",
        /* glsl */ `
          // Border light: light leaking from inside the pyramid, strongest on silhouettes / seams.
          float borderFresnel = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
          float borderMix = mix(0.35, 1.7, uInnerContrast);
          vec3 borderCol = vec3(1.0, 0.667, 0.333);
          outgoingLight += borderCol * borderFresnel * uInnerLight * borderMix * (0.25 + 0.75 * max(vInnerFace, 0.35));
          vec3 fogRay = vStoneWorld - uCam;
          float stoneFogDistance = uFogDist / (1.0 + uStorm * 0.9);
          float stoneDistance = length(fogRay);
          float stoneFogFactor = max(stoneDistance / stoneFogDistance, stoneDistance * uFogDensity * 0.45);
          float stoneFog = 1.0 - exp(-pow(stoneFogFactor, 2.0));
          vec3 fogDirection = normalize(vec3(fogRay.x + 0.00001, 0.0, fogRay.z));
          outgoingLight = mix(outgoingLight, skyBase(fogDirection), stoneFog);
          #include <opaque_fragment>
        `
      );
    };
    material.customProgramCacheKey = () => `desert-giza-${kind}-v4`;
  }

  private async loadTextures() {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    await Promise.all(
      (Object.keys(SANDSTONE_TEXTURES) as SandstoneKind[]).map(async (kind) => {
        try {
          const texture = await loader.loadAsync(SANDSTONE_TEXTURES[kind]);
          if (this.disposed) {
            texture.dispose();
            return;
          }
          configureStoneTexture(texture, kind === "diffuse", this.anisotropy);
          this.textures.add(texture);
          const previous = this.maps[kind];
          this.maps[kind] = texture;
          for (const stone of this.stones) {
            for (const material of [stone.outer, stone.lamp]) {
              if (kind === "diffuse") material.map = texture;
              else if (kind === "normal") material.normalMap = texture;
              else if (kind === "roughness") material.roughnessMap = texture;
              else if (kind === "ao") material.aoMap = texture;
              else if (kind === "displacement") material.displacementMap = texture;
            }
          }
          if (kind === "displacement") this.heightUniform.value = texture;
          if (kind === "diffuse") this.mapAverage.value = averageLinearLuma(texture);
          this.textures.delete(previous);
          previous.dispose();
          this.group.userData.textureSource = "Poly Haven / Sandstone Blocks 05 / CC0 (ambientCG 4K zips unavailable)";
        } catch {
          /* procedural fallback stays */
        }
      })
    );
  }

  resize(viewScale: number) {
    const scale = PYRAMID.worldScale * viewScale;
    this.group.scale.setScalar(scale);
    this.bounds.center.set(0, (PYRAMID.height * 0.5 + PYRAMID.baseY) * scale, 0);
    this.bounds.radius = Math.sqrt(PYRAMID.base ** 2 * 0.5 + (PYRAMID.height * 0.5) ** 2) * scale + 2;
    this.lastPick = -Infinity;
  }

  setInnerLight(value: number) {
    this.innerLight = THREE.MathUtils.clamp(value, 0, 2);
  }

  setInnerContrast(value: number) {
    this.innerContrast.value = THREE.MathUtils.clamp(value / 100, 0, 1);
  }

  setHeartbeat(on: boolean) {
    this.heartbeatOn = on;
  }

  setGravity(value: number) {
    this.gravity = THREE.MathUtils.clamp(value, 0, 100) / 100;
    this.publishGravity();
  }

  private publishGravity() {
    const g = this.gravity;
    this.group.userData.gravity = {
      value: g,
      curveAmount: 1.5 - g * 1.2,
      fallSpeed: g * 2.5,
      floatSpeed: (1 - g) * 0.5,
    };
  }

  update(time: number, dt: number) {
    const isPulsing = this.hovered !== null && this.activeStones.length > 0;
    const focus = this.hovered?.origin ?? null;
    const radius = (this.disperse / 100) * 7;
    this.heartbeatMix += ((this.heartbeatOn ? 1 : 0) - this.heartbeatMix) * (1 - Math.exp(-dt * 2.5));
    const hb = this.heartbeatMix < 0.001 ? 0 : this.heartbeatMix;
    const glowEase = 1 - Math.exp(-dt * 3);
    const g = this.gravity;
    const flicker = 1 + Math.sin(time * 3) * 0.2 + Math.sin(time * 8.7) * 0.1;

    // Drag as specified: 1.0 at zero-G, ~0.998/frame at 50, ~0.95/frame at 100.
    const dragFrame = g <= 0.5 ? THREE.MathUtils.lerp(1, 0.998, g / 0.5) : THREE.MathUtils.lerp(0.998, 0.95, (g - 0.5) / 0.5);
    const drag = Math.pow(dragFrame, 60 * dt);

    this.innerLightU.value = this.innerLight * flicker;
    this.updateLines(time, isPulsing);

    if (this.rayMaterial) {
      this.rayMaterial.uniforms.uAmount.value = THREE.MathUtils.lerp(
        this.rayMaterial.uniforms.uAmount.value as number,
        isPulsing && this.disperse > 8 ? 1 : 0,
        1 - Math.exp(-dt * 3)
      );
    }

    // Pairwise collision push for floating stones so they can't cross each other in mid-air.
    // Small radius (~half the shortest brick edge in world units) and a gentle push, so the
    // motion still reads as calm astronaut drift rather than a hard bump.
    const floaters = this.activeStones.filter((s) => s.mode === "float" || s.mode === "out");
    if (floaters.length > 1) {
      const rr = 0.9; // collision radius in local pyramid units
      const rr2 = rr * rr;
      for (let i = 0; i < floaters.length; i++) {
        const a = floaters[i];
        for (let j = i + 1; j < floaters.length; j++) {
          const b = floaters[j];
          const dx = a.anchor.x - b.anchor.x;
          const dy = a.anchor.y - b.anchor.y;
          const dz = a.anchor.z - b.anchor.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr2 && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (rr - d) * 0.5;
            const nx = dx / d, ny = dy / d, nz = dz / d;
            a.anchor.x += nx * push; a.anchor.y += ny * push; a.anchor.z += nz * push;
            b.anchor.x -= nx * push; b.anchor.y -= ny * push; b.anchor.z -= nz * push;
            a.velocity.multiplyScalar(0.95);
            b.velocity.multiplyScalar(0.95);
          }
        }
      }
    }

    for (const stone of this.stones) {
      const mesh = stone.mesh;

      // Layer 0 is the ground foundation: no hover, no heartbeat, no float, no disperse.
      if (stone.isStatic) {
        mesh.position.copy(stone.origin);
        mesh.position.y += stone.buildY;
        mesh.rotation.set(0, 0, 0);
        mesh.scale.setScalar(stone.scaleValue * stone.buildScale);
        stone.lamp.emissiveIntensity = this.innerLight * LAMP_BASE * flicker;
        stone.outer.emissiveIntensity = 0;
        continue;
      }

      if (stone.mode === "float") {
        stone.velocity.multiplyScalar(drag);
        if (g > 0.45) stone.velocity.y -= (g * 2.5) * 1.8 * dt;
        stone.anchor.addScaledVector(stone.velocity, dt);
      } else if (stone.path && (stone.mode === "out" || stone.mode === "back")) {
        evalPath(stone.path, stone.pathLen, stone.pathT, stone.anchor);
      } else if (stone.mode === "rest") {
        stone.anchor.copy(stone.origin);
      }
      stone.anchor.add(stone.offset);

      // Astronaut float: displaced rocks continue drifting even after reaching their target.
      if (stone.mode === "float") {
        stone.target.x += Math.sin(time * 0.4 + stone.index) * 0.0005;
        stone.target.y += Math.cos(time * 0.5 + stone.index) * 0.0005;
        stone.target.z += Math.sin(time * 0.3 + stone.index * 1.7) * 0.0005;
        stone.spinAcc.x += (0.002 + Math.random() * 0.002) * dt;
        stone.spinAcc.y += (0.002 + Math.random() * 0.002) * dt;
        stone.spinAcc.z += 0.001 * dt;
      }

      // Invisible boundary: distance from original stone position is hard-clamped.
      if (stone.mode !== "rest") {
        const away = stone.anchor.clone().sub(stone.origin);
        const distance = away.length();
        if (distance > stone.maxDistance) {
          away.multiplyScalar(stone.maxDistance / distance);
          stone.anchor.copy(stone.origin).add(away);
          stone.target.sub(stone.anchor).clampLength(0, 0.05);
        }
      }

      let y = stone.anchor.y;
      if (stone.mode !== "rest" && y < stone.floorY) {
        y = stone.floorY;
        stone.anchor.y = y;
        if (stone.velocity.y < 0) stone.velocity.y *= -0.35 * g;
      }
      // Astronaut float: displaced rocks continue drifting even after reaching their target.
      if (stone.mode === "float") {
        stone.anchor.x += Math.sin(time * 0.4 + stone.index) * 0.0005;
        stone.anchor.y += Math.cos(time * 0.5 + stone.index) * 0.0005;
        stone.anchor.z += Math.sin(time * 0.3 + stone.index * 1.7) * 0.0005;
        stone.spinVel.x += 0.002 + Math.random() * 0.002;
        stone.spinVel.y += 0.002 + Math.random() * 0.002;
        stone.spinVel.z += 0.001;
        stone.spinAcc.addScaledVector(stone.spinVel, dt);
      }

      stone.current.set(stone.anchor.x, y, stone.anchor.z);

      // Build ONE target, then lerp once. Cosmetic offsets (build-in, heartbeat, pulse) are
      // folded into the target instead of being added to mesh.position afterwards - adding
      // them post-lerp would feed back into the next frame's lerp source and accumulate.
      _aim.copy(stone.current);
      _aim.y += stone.buildY;

      let scale = stone.scaleValue;
      let rx = stone.rot.x + stone.spinAcc.x;
      let ry = stone.rot.y + stone.spinAcc.y;
      let rz = stone.rot.z + stone.spinAcc.z;

      if (hb > 0 && !stone.isStatic) {
        // Whole mass breathes as one so touching blocks never split or intersect. The Y wave is
        // half-rectified so the pyramid can only ever rise (0 to +0.007), never dip into the
        // static layer 0 foundation below.
        const upWave = Math.max(0, Math.sin(time * 0.6));
        _aim.y += upWave * 0.007 * hb;
        _aim.x += Math.sin(time * 0.4) * 0.004 * hb;
        scale *= 1 + Math.sin(time * 0.7) * 0.004 * hb;
      }

      const pulse = stone.pulse;
      if (pulse > 0.001 && !stone.isStatic) {
        const i = stone.index;
        _aim.y += Math.sin(time * 0.8 + i) * 0.005 * pulse;
        _aim.x += Math.cos(time * 0.6) * 0.003 * pulse;
        scale *= 1 + Math.sin(time * 1.2) * 0.03 * pulse;
      }

      // Single smoothing step toward the finished target. While a block is still landing in
      // the intro it tracks its tween closely; afterwards the slow 0.03 astronaut lerp returns.
      const rate = stone.buildScale < 0.999 ? 0.25 : this.lerpRate;
      mesh.position.lerp(_aim, rate);

      if (stone.mode !== "rest" && mesh.position.y < stone.floorY - 0.02) {
        mesh.position.y = stone.floorY - 0.02;
      }

      mesh.rotation.set(rx, ry, rz);
      mesh.scale.setScalar(scale * stone.buildScale);

      let targetGlow = 0;
      if (focus) {
        const d = stone.origin.distanceTo(focus);
        if (d <= radius + 0.001) targetGlow = 1;
        else if (d <= radius + 2) targetGlow = 0.6 * (1 - (d - radius) / 2);
      }
      stone.glow += (targetGlow - stone.glow) * glowEase;
      const glow = stone.glow < 0.002 ? 0 : stone.glow;
      stone.lamp.emissiveIntensity = this.innerLight * (LAMP_BASE + (1 - LAMP_BASE) * glow) * flicker;
      stone.outer.emissiveIntensity = 0;
    }
  }

  setDisperse(value: number) {
    const next = THREE.MathUtils.clamp(value, 0, 100);
    if (Math.abs(next - this.disperse) < 0.001) return;
    this.disperse = next;
    this.group.userData.disperse = { value: next, radius: (next / 100) * 7 };
    if (this.hovered) {
      const hovered = this.hovered;
      this.returnDisplaced();
      this.explodeFrom(hovered, this.lastPointer);
    }
  }

  pick(pointer: THREE.Vector2, camera: THREE.PerspectiveCamera, time: number) {
    if (time - this.lastPick < 1 / 30) return;
    this.lastPick = time;
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(pointer, camera);
    if (!this.raycaster.ray.intersectsSphere(this.bounds)) {
      this.clearHover();
      return;
    }
    this.group.updateMatrixWorld(true);
    this.intersections.length = 0;
    this.raycaster.intersectObjects<THREE.Mesh>(this.pickerMeshes, false, this.intersections);
    const hit = this.intersections[0];
    const next = hit ? this.byMesh.get(hit.object) ?? null : null;
    const previous = this.hovered;
    if (next !== previous) this.setHovered(next, pointer);
    if (next) this.lastPointer.copy(pointer);
    if (next && this.disperse === 0 && previous === next) {
      this.smoothPointer.lerp(pointer, 0.04);
      gsap.to(next.offset, {
        x: this.smoothPointer.x * 0.15,
        y: this.smoothPointer.y * 0.15,
        z: 0,
        duration: 1.8,
        ease: "power4.out",
        overwrite: true,
      });
    }
  }

  private setHovered(next: Stone | null, pointer = this.lastPointer) {
    const previous = this.hovered;
    this.returnDisplaced();
    this.hovered = next;
    this.lastPointer.copy(pointer);
    if (next) this.explodeFrom(next, pointer);
    if (Boolean(previous) !== Boolean(next)) {
      window.dispatchEvent(new CustomEvent<StoneHoverDetail>(STONE_HOVER_EVENT, { detail: { hovered: Boolean(next) } }));
    }
  }

  private killStoneTweens(stone: Stone) {
    gsap.killTweensOf(stone);
    gsap.killTweensOf(stone.offset);
    gsap.killTweensOf(stone.rot);
    gsap.killTweensOf(stone.spinAcc);
    gsap.killTweensOf(stone.outer.color);
  }

  /** Intro build-in: layer 0 lands instantly, layers 1+ grow course by course from below. */
  buildIn() {
    for (const stone of this.stones) {
      gsap.killTweensOf(stone, "buildScale,buildY");
      if (stone.isStatic) {
        stone.buildScale = 1;
        stone.buildY = 0;
        continue;
      }
      stone.buildScale = 0;
      stone.buildY = -5;
      stone.mesh.position.set(stone.origin.x, stone.origin.y - 5, stone.origin.z);
      const delay = stone.layer * 0.3 + Math.random() * 0.2;
      gsap.to(stone, { buildScale: 1, duration: 0.8, delay, ease: "back.out(1.2)" });
      gsap.to(stone, { buildY: 0, duration: 0.8, delay, ease: "power2.out" });
    }
  }

  /** How much of the inner fire is showing through the gaps, for the crackle audio. */
  get dispersedAmount(): number {
    return this.activeStones.length > 0 ? this.disperse / 100 : 0;
  }

  private explodeFrom(center: Stone, pointer: THREE.Vector2) {
    const amount = this.disperse / 100;
    // Stone helper fields: target and max distance are added dynamically to keep
    // the motion model obvious and avoid constructor churn.
    const radius = amount * 7;
    const selected = this.stones.filter(
      (stone) =>
        !stone.isStatic &&
        (stone === center || (radius > 0 && stone.origin.distanceTo(center.origin) <= radius))
    );
    this.activeStones = selected;
    const g = this.gravity;
    const curveAmount = 1.5 - g * 1.2;
    this.smoothPointer.copy(pointer);

    selected.forEach((stone) => {
      const carry = stone.current.clone().sub(stone.origin);
      this.killStoneTweens(stone);
      stone.mode = "out";
      stone.velocity.set(0, 0, 0);
      stone.pathT = 0;
      stone.path = null;
      stone.offset.copy(carry);
      const delay = 0.05 + Math.random() * 0.4;
      // 1.5m at DISPERSE 0, 4.5m at 100.
      stone.maxDistance = this.maxTravel + amount * 3;

      if (amount === 0) {
        stone.floating = false;
        const dir = new THREE.Vector3(pointer.x * 0.15, pointer.y * 0.15, (Math.random() - 0.5) * 0.2);
        if (dir.length() > stone.maxDistance) dir.setLength(stone.maxDistance);
        stone.target.copy(stone.origin).add(dir);
        gsap.to(stone.target, {
          x: stone.target.x,
          y: stone.target.y,
          z: stone.target.z,
          duration: this.outDuration + Math.random() * 1.5,
          delay,
          ease: "power1.inOut",
        });
      } else {
        stone.floating = true;
        const angle = Math.random() * Math.PI * 2;
        const distance = (0.5 + Math.random() * 1.5) * (amount * 3);
        let end = new THREE.Vector3(Math.cos(angle) * distance, Math.sin(angle) * distance, (Math.random() - 0.5) * 2);
        end.clampLength(0, stone.maxDistance);
        const up = 0.5 + Math.random() * 0.5;
        const side = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), (Math.random() - 0.5) * 0.6).normalize();
        const mid1 = end.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, up * 1.0 * curveAmount, 0));
        const mid2 = end
          .clone()
          .multiplyScalar(0.7)
          .add(new THREE.Vector3(0, up * 0.5 * curveAmount, 0))
          .addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * 0.5 * curveAmount);
        const finish = end.clone().add(new THREE.Vector3(0, up * 0.8 * (1 - g * 0.5), 0));
        const o = stone.origin;
        stone.path = new THREE.CatmullRomCurve3(
          [o.clone(), o.clone().add(mid1), o.clone().add(mid2), o.clone().add(finish)],
          false,
          "catmullrom",
          0.5
        );
        stone.pathLen = stone.path.getLength();
        gsap.to(stone, {
          pathT: 1,
          duration: this.outDuration + Math.random() * 1.5,
          delay,
          ease: "power1.inOut",
          onComplete: () => {
            if (stone.mode !== "out") return;
            stone.mode = "float";
            // Very slow astronaut drift after the curved push-out.
            stone.velocity.set((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02);
            stone.spinVel.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8);
          },
        });
        gsap.to(stone.offset, { x: 0, y: 0, z: 0, duration: 1.4, delay, ease: "power3.out" });
        gsap.to(stone.rot, {
          x: (Math.random() - 0.5) * 1.0,
          y: (Math.random() - 0.5) * 1.0,
          z: (Math.random() - 0.5) * 0.5,
          duration: this.outDuration + Math.random() * 1.5,
          delay,
          ease: "power1.inOut",
        });
      }

      gsap.to(stone, { scaleValue: stone === center ? 1.08 : 1.025, duration: 2.5, delay, ease: "power2.out" });
      gsap.to(stone, { pulse: 1, duration: 2.5, delay, ease: "power2.inOut" });
      const tint = stone === center ? this.highlight : stone.color.clone().lerp(this.highlight, 0.32);
      gsap.to(stone.outer.color, { r: tint.r, g: tint.g, b: tint.b, duration: 1.2, ease: "power3.out" });
    });

    if (amount > 0) this.createLines(selected, radius);
    this.group.userData.activeDisperseCount = selected.length;
  }

  private returnDisplaced() {
    const returning = this.activeStones;
    this.activeStones = [];
    returning.forEach((stone, index) => {
      this.killStoneTweens(stone);
      const wasFloating = stone.mode === "float";
      const outboundT = stone.pathT;
      stone.mode = "back";
      stone.velocity.set(0, 0, 0);
      stone.spinVel.set(0, 0, 0);
      const delay = index * 0.03;
      const done = () => {
        if (stone.mode !== "back") return;
        stone.mode = "rest";
        stone.floating = false;
        stone.path = null;
        stone.pathT = 0;
        stone.offset.set(0, 0, 0);
        stone.spinAcc.set(0, 0, 0);
      };
      // Retrace: same curve, same speed, same power1.inOut, with no elastic return.
      if (stone.path && !wasFloating && outboundT > 0.02 && outboundT < 0.98) {
        gsap.to(stone, { pathT: 0, duration: this.backDuration + Math.random() * 1, delay, ease: "power1.inOut", onComplete: done });
      } else {
        const start = stone.current.clone();
        const o = stone.origin;
        const mid = start.clone().lerp(o, 0.45).add(new THREE.Vector3(0, 0.55, 0));
        stone.path = new THREE.CatmullRomCurve3([start, mid, o.clone()], false, "catmullrom", 0.5);
        stone.pathLen = stone.path.getLength();
        stone.pathT = 0;
        gsap.to(stone, { pathT: 1, duration: this.backDuration + Math.random() * 1, delay, ease: "power1.inOut", onComplete: done });
      }
      gsap.to(stone, { scaleValue: 1, duration: 1.2, delay, ease: "elastic.out(1, 0.6)" });
      gsap.to(stone, { pulse: 0, duration: 1.2, delay, ease: "power2.inOut" });
      gsap.to(stone.offset, { x: 0, y: 0, z: 0, duration: 1.2, delay, ease: "elastic.out(1, 0.6)" });
      gsap.to(stone.rot, { x: 0, y: 0, z: 0, duration: 1.2, delay, ease: "power2.inOut" });
      gsap.to(stone.spinAcc, { x: 0, y: 0, z: 0, duration: 1.2, delay, ease: "power2.inOut" });
      gsap.to(stone.outer.color, { r: stone.color.r, g: stone.color.g, b: stone.color.b, duration: 0.65, delay });
    });
    this.fadeLines();
    this.group.userData.activeDisperseCount = 0;
  }

  private createLines(stones: Stone[], radius: number) {
    this.removeLines();
    const links: StoneLink[] = stones.map((stone) => ({ from: stone, to: null }));
    const neighborDistance = Math.max(1.35, radius * 0.45);
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        if (stones[i].origin.distanceTo(stones[j].origin) <= neighborDistance) {
          links.push({ from: stones[i], to: stones[j] });
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(links.length * 6), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const distances = new THREE.BufferAttribute(new Float32Array(links.length * 2), 1);
    distances.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positions);
    geometry.setAttribute("lineDistance", distances);
    const material = new THREE.LineDashedMaterial({
      color: "#e8d5b5",
      transparent: true,
      opacity: 0.4,
      dashSize: 0.12,
      gapSize: 0.09,
      depthWrite: false,
    });
    const object = new THREE.LineSegments(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = 9;
    this.group.add(object);
    this.lines = { object, geometry, material, links, fading: false };
    this.updateLines(0, true);
  }

  private updateLines(time: number, pulsing: boolean) {
    if (!this.lines) return;
    if (pulsing && !this.lines.fading) this.lines.material.opacity = 0.3 + Math.sin(time * 2) * 0.15;
    const positions = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const distances = this.lines.geometry.getAttribute("lineDistance") as THREE.BufferAttribute;
    this.lines.links.forEach((link, index) => {
      const a = link.from.mesh.position;
      const b = link.to?.mesh.position ?? link.from.origin;
      positions.setXYZ(index * 2, a.x, a.y, a.z);
      positions.setXYZ(index * 2 + 1, b.x, b.y, b.z);
      distances.setX(index * 2, 0);
      distances.setX(index * 2 + 1, a.distanceTo(b));
    });
    positions.needsUpdate = true;
    distances.needsUpdate = true;
  }

  private fadeLines() {
    if (!this.lines) return;
    const lines = this.lines;
    lines.fading = true;
    gsap.to(lines.material, {
      opacity: 0,
      duration: 0.75,
      ease: "power2.out",
      overwrite: true,
      onComplete: () => {
        if (this.lines === lines) this.removeLines();
      },
    });
  }

  private removeLines() {
    if (!this.lines) return;
    gsap.killTweensOf(this.lines.material);
    this.lines.object.removeFromParent();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.lines = null;
  }

  clearHover() {
    if (this.hovered) this.setHovered(null, this.lastPointer);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHover();
    this.removeLines();
    this.finishReady?.();
    clearTimeout(this.readyTimer);
    for (const stone of this.stones) {
      this.killStoneTweens(stone);
      stone.mesh.geometry.dispose();
      stone.outer.dispose();
      stone.lamp.dispose();
    }
    this.rayMaterial?.dispose();
    this.rays[0]?.geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.byMesh.clear();
    this.intersections.length = 0;
    this.meshes.length = 0;
    this.pickerMeshes.length = 0;
    this.stones.length = 0;
    this.group.clear();
    this.group.removeFromParent();
  }
}
