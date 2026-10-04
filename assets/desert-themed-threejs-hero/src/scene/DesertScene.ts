import * as THREE from "three";
import gsap from "gsap";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Pyramid } from "./Pyramid";
import { RealisticStorm } from "./RealisticStorm";
import { Camel } from "./Camels";
import {
  noiseGLSL,
  duneGLSL,
  skyVS,
  skyFS,
  groundVS,
  groundFS,
  textVS,
  textFS,
} from "./shaders";

/* ------------------------------------------------------------------ */
/*  Palette + lighting (from the brief)                                */
/* ------------------------------------------------------------------ */
export const PALETTE = {
  fogDark: "#2b1d12",
  fogMid: "#d9c5a5",
  fogLight: "#e8d5b5",
  sand: "#e8d5b5",
  sun: "#ffcc8a",
  ambient: "#8a6a4f",
};

const TARGET = new THREE.Vector3(0, 2.4, 0);

/* igloo.inc-style intro: satellite view -> land builds -> pyramid grows -> wide field shot.
   Radius is the horizontal distance from the pyramid axis, height the camera altitude. */
const START_RADIUS = 0.1; // effectively straight overhead
const FINAL_DIST = 20; // wide shot: small pyramid in a big desert
const START_HEIGHT = 40;
const FINAL_HEIGHT = 6;
const MID_HEIGHT = 30;
const DESCEND_HEIGHT = 15;
const DESCEND_RADIUS = 8;
const START_AZ = -Math.PI * 0.75;
const FINAL_AZ = Math.PI / 6; // 30deg resting angle
const BASE_FOV = 58;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------------------------- text textures ------------------------ */
function makeTextTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  maxAniso: number
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const setSpacing = (ctx: CanvasRenderingContext2D, px: number) => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
};

interface TextPlane {
  mesh: THREE.Mesh;
  baseY: number;
  floatSeed: number;
  scaleWithAspect: boolean;
  baseScale: number;
}

export class DesertScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private shared: Record<string, THREE.IUniform>;
  private ground!: THREE.Mesh;
  private sky!: THREE.Mesh;
  private pyramid: Pyramid;
  private stormSystem: RealisticStorm;
  private camel: Camel;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private texts: TextPlane[] = [];
  private disposables: { dispose(): void }[] = [];

  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private pixelRatio: number;
  private frameAvg = 16;
  private frameCount = 0;

  private mouse = new THREE.Vector2();
  private mouseS = new THREE.Vector2();
  private pointerOnScene = false;
  private hoverClearTimer: number | undefined;
  private viewScale = 1;
  private lastShadowUpdate = -Infinity;

  // animated state
  private state = {
    radius: START_RADIUS,
    height: START_HEIGHT,
    azimuth: START_AZ,
    lookY: 0,
    fov: 50,
    fovWeight: 1, // 1 = scripted intro fov, 0 = gameplay fov
    dolly: 1,
    storm: 0,
    reveal: 0,
    mouse: 0,
  };
  private groundBuild = { value: 0 };
  /** Per-frame audio cue: distance to the pyramid, wind direction, exposed fire. */
  onAudioFrame: ((distance: number, pan: number, fire: number) => void) | null = null;
  private lastR = START_RADIUS;
  private smoothVel = 0;
  private walk = 0;
  private cellSize = 900 / 360;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = dpr;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: dpr < 1.5,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(PALETTE.fogMid);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.camera = new THREE.PerspectiveCamera(
      BASE_FOV,
      window.innerWidth / window.innerHeight,
      0.5,
      3500
    );

    const sunDir = new THREE.Vector3(0.42, 0.42, -0.82).normalize();
    this.shared = {
      uTime: { value: 0 },
      uCam: { value: this.camera.position },
      uStorm: { value: 0 },
      uSunDir: { value: sunDir },
      uSunCol: { value: new THREE.Color(PALETTE.sun) },
      uZenith: { value: new THREE.Color(PALETTE.fogDark) },
      uMid: { value: new THREE.Color(PALETTE.fogMid) },
      uHorizon: { value: new THREE.Color(PALETTE.fogLight) },
      uFogDist: { value: 150 },
      uFogDensity: { value: 0.01 },
      uPixelRatio: { value: dpr },
    };

    this.buildLights(sunDir);
    this.buildSky();
    this.buildGround();
    this.stormSystem = new RealisticStorm(this.shared, this.renderer);
    this.scene.add(this.stormSystem.group);
    this.pyramid = new Pyramid(this.shared, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.pyramid.group);
    this.camel = new Camel();
    this.scene.add(this.camel.group);
    this.buildPyramidShadow();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,
      0.42,
      0.72
    );
    this.composer.addPass(this.bloomPass);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("pointerdown", this.onPointer, { passive: true });
    window.addEventListener("pointerup", this.onPointerUp, { passive: true });
    window.addEventListener("pointercancel", this.onPointerLeave);
    window.addEventListener("blur", this.onPointerLeave);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.onResize();
    this.camera.position.set(0, 180, 250);
    this.camera.lookAt(TARGET);
  }

  /* ------------------------------ build ------------------------------ */
  private buildLights(sunDir: THREE.Vector3) {
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.5);
    sun.position.copy(sunDir).multiplyScalar(100);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(window.innerWidth > 900 ? 2048 : 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 180;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(PALETTE.ambient, 1));
    // Sky bounce for the PBR stones; the existing desert shaders remain unchanged.
    // Neutral sky/ground so the rocks keep their true limestone hues; the warmth of the desert
    // comes from the #ffcc8a sun above, not from a tinted fill light.
    const bounce = new THREE.HemisphereLight("#eee6d6", "#8f8474", 3.6);
    bounce.position.set(-0.3, 1, 0.5);
    this.scene.add(bounce);
    this.disposables.push(sun.shadow);
  }

  private buildSky() {
    const geo = new THREE.SphereGeometry(1500, 32, 24);
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVS,
      fragmentShader: skyFS,
      uniforms: { ...this.shared },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.disposables.push(geo, mat);
  }

  private buildGround() {
    const geo = new THREE.PlaneGeometry(900, 900, 360, 360);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: groundVS,
      fragmentShader: groundFS,
      uniforms: {
        ...this.shared,
        uColor: { value: new THREE.Color(PALETTE.sand) },
        uAmbient: { value: new THREE.Color(PALETTE.ambient) },
        uSunInt: { value: 1.5 },
        uBuild: this.groundBuild,
      },
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = 0;
    this.scene.add(this.ground);
    this.disposables.push(geo, mat);
  }

  private buildPyramidShadow() {
    const geometry = new THREE.PlaneGeometry(40, 40, 120, 120);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShadowMaterial({
      color: PALETTE.fogDark,
      opacity: 0.32,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uCam: this.shared.uCam,
        uFogDist: this.shared.uFogDist,
        uFogDensity: this.shared.uFogDensity,
        uStorm: this.shared.uStorm,
        uBuild: this.groundBuild,
      });
      shader.vertexShader = /* glsl */ `
        uniform float uBuild;
        varying vec3 vDesertShadowPosition;
        ${noiseGLSL}
        ${duneGLSL}
      ` + shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
          #include <begin_vertex>
          transformed.xz *= uBuild;
          transformed.y += duneHeight(transformed.xz) * uBuild - 5.0 * (1.0 - uBuild);
          vDesertShadowPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );
      shader.fragmentShader = /* glsl */ `
        varying vec3 vDesertShadowPosition;
        uniform vec3 uCam;
        uniform float uFogDist;
        uniform float uFogDensity;
        uniform float uStorm;
      ` + shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        /* glsl */ `
          float shadowFogDistance = uFogDist / (1.0 + uStorm * 0.9);
          float shadowDistance = distance(vDesertShadowPosition, uCam);
          float shadowFogFactor = max(shadowDistance / shadowFogDistance, shadowDistance * uFogDensity * 0.45);
          gl_FragColor.a *= exp(-pow(shadowFogFactor, 2.0));
          #include <tonemapping_fragment>
        `
      );
    };
    material.customProgramCacheKey = () => "desert-dune-shadow-v1";
    const shadow = new THREE.Mesh(geometry, material);
    shadow.name = "Pyramid shadow on the dune surface";
    shadow.position.y = 0.055;
    shadow.receiveShadow = true;
    shadow.frustumCulled = false;
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    this.disposables.push(geometry, material);
  }

  /* -------------------------- 3D typography -------------------------- */
  private addText(
    tex: THREE.Texture,
    width: number,
    height: number,
    pos: THREE.Vector3,
    color: string,
    opts: { scaleWithAspect?: boolean; opacity?: number } = {}
  ) {
    const geo = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.ShaderMaterial({
      vertexShader: textVS,
      fragmentShader: textFS,
      uniforms: {
        ...this.shared,
        uMap: { value: tex },
        uColor: { value: new THREE.Color(color) },
        uReveal: this.revealUniform,
        uOpacity: { value: opts.opacity ?? 1 },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.disposables.push(geo, mat, tex);
    this.texts.push({
      mesh,
      baseY: pos.y,
      floatSeed: Math.random() * 10,
      scaleWithAspect: !!opts.scaleWithAspect,
      baseScale: 1,
    });
  }

  private revealUniform: THREE.IUniform<number> = { value: 0 };

  async init() {
    // make sure webfonts are ready before painting them into textures
    try {
      await Promise.all([
        this.pyramid.ready,
        Promise.race([
          Promise.all([
            document.fonts.load('500 30px "IBM Plex Mono"'),
            document.fonts.load('600 100px "Space Grotesk"'),
          ]),
          new Promise((r) => setTimeout(r, 2500)),
        ]),
      ]);
    } catch {
      /* fall back to system fonts */
    }
    if (this.disposed) return;

    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const mono = '"IBM Plex Mono", ui-monospace, monospace';
    const grotesk = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';

    // Hero title
    const title = makeTextTexture(
      2048,
      1024,
      (ctx, w) => {
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = `500 34px ${mono}`;
        setSpacing(ctx, 12);
        ctx.fillText("( WELCOME TO )", w / 2, 330);

        let size = 320;
        setSpacing(ctx, -8);
        ctx.font = `600 ${size}px ${grotesk}`;
        while (ctx.measureText("DESERT INC").width > w * 0.9 && size > 80) {
          size -= 8;
          ctx.font = `600 ${size}px ${grotesk}`;
        }
        ctx.fillText("DESERT INC", w / 2, 620);

        ctx.font = `500 34px ${mono}`;
        setSpacing(ctx, 9);
        ctx.fillText("A LIVING WORLD OF WIND AND SAND", w / 2, 730);
      },
      aniso
    );
    // Keep the existing world-space typography clear of the new silhouette.
    this.addText(title, 11, 5.5, new THREE.Vector3(0, 7.6, -9), PALETTE.fogDark, {
      scaleWithAspect: true,
    });

    // Field notes floating in the dunes
    const left = makeTextTexture(
      1024,
      512,
      (ctx) => {
        ctx.textAlign = "left";
        ctx.font = `500 44px ${mono}`;
        setSpacing(ctx, 6);
        ctx.fillText("N 23°49′  E 25°08′", 40, 210);
        ctx.font = `400 34px ${mono}`;
        setSpacing(ctx, 5);
        ctx.fillText("SAHARA — SECTOR 01", 40, 275);
        ctx.fillText("ELEV. 412 M", 40, 330);
      },
      aniso
    );
    this.addText(left, 6, 3, new THREE.Vector3(-11, 2.6, -6), PALETTE.fogDark, { opacity: 0.85 });

    const right = makeTextTexture(
      1024,
      512,
      (ctx, w) => {
        ctx.textAlign = "right";
        ctx.font = `500 44px ${mono}`;
        setSpacing(ctx, 6);
        ctx.fillText("WIND 42 KM/H  →", w - 40, 210);
        ctx.font = `400 34px ${mono}`;
        setSpacing(ctx, 5);
        ctx.fillText("VISIBILITY 180 M", w - 40, 275);
        ctx.fillText("TEMP 38°C", w - 40, 330);
      },
      aniso
    );
    this.addText(right, 6, 3, new THREE.Vector3(11, 2.9, -6), PALETTE.fogDark, { opacity: 0.85 });

    this.onResize();
    // one warm-up render so shaders compile before the reveal
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------ control ---------------------------- */
  play() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);

    const s = this.state;

    // Nothing moves until the field exists. Layer 0 foundation rocks stay put throughout.
    this.pyramid.group.visible = false;
    this.pyramid.setHeartbeat(false);
    this.stormSystem.setIntensity(0.08);
    s.storm = 0.08;

    const tl = gsap.timeline();

    // 1s - 3s : satellite view. The desert field grows out of the dark.
    tl.to(this.groundBuild, { value: 1, duration: 3, ease: "power2.inOut" }, 1);
    tl.to(s, { height: MID_HEIGHT, duration: 2, ease: "power1.inOut" }, 1);

    // 3s - 7s : the camera tilts down toward 45deg while the pyramid grows brick by brick.
    tl.call(
      () => {
        this.pyramid.group.visible = true;
        this.pyramid.buildIn();
      },
      undefined,
      3
    );
    tl.to(s, { height: DESCEND_HEIGHT, radius: DESCEND_RADIUS, lookY: TARGET.y, duration: 4, ease: "power2.inOut" }, 3);

    // 7s - 10s : pull back to the wide field shot and take one slow 20deg turn.
    tl.to(s, { radius: FINAL_DIST, height: FINAL_HEIGHT, fov: 65, duration: 3, ease: "power2.inOut" }, 7);
    tl.to(s, { azimuth: FINAL_AZ + 0.35, duration: 3, ease: "power1.inOut" }, 7);

    // 10s : intro over. Hover, heartbeat and astronaut float come alive.
    tl.call(
      () => {
        this.pyramid.setHeartbeat(true);
        gsap.to(s, { mouse: 1, duration: 1.2, ease: "power1.inOut" });
        gsap.to(s, { fovWeight: 0, duration: 1.6, ease: "power2.inOut" });
      },
      undefined,
      10
    );

    gsap.to(s, { reveal: 1, duration: 3.6, delay: 6, ease: "power1.inOut" });
  }

  setStorm(on: boolean) {
    const s = this.state;
    gsap.to(s, {
      storm: on ? 0.9 : 0.2,
      duration: 2.6,
      ease: "power2.inOut",
      onUpdate: () => this.stormSystem.setIntensity(s.storm),
    });
    gsap.to(s, { dolly: on ? 0.66 : 1, duration: 3.2, ease: "power3.inOut" });
  }

  setStormIntensity(value: number) {
    gsap.killTweensOf(this.state, "storm");
    this.state.storm = clamp(value / 100, 0, 1);
    this.stormSystem.setIntensity(this.state.storm);
  }

  setDisperse(value: number) {
    this.pyramid.setDisperse(value);
  }

  /** INNER LIGHT: 0 - 2 -> emissiveIntensity of the stones' back faces. */
  setInnerLight(value: number) {
    this.pyramid.setInnerLight(value);
  }

  /** CONTRAST: 0 - 100 -> soft whole-face glow (low) to sharp edge line (high). */
  setInnerContrast(value: number) {
    this.pyramid.setInnerContrast(value);
  }

  /** HEARTBEAT toggle: constant slow breathing of the whole pyramid. */
  setHeartbeat(on: boolean) {
    this.pyramid.setHeartbeat(on);
  }

  /** GRAVITY: 0 = zero-G float, 50 = slow sink, 100 = heavy fall and bounce. */
  setGravity(value: number) {
    this.pyramid.setGravity(value);
  }

  /** BLOOM 0-100 → UnrealBloomPass strength 0-1.2 (50 = the requested 0.6). */
  setBloom(value: number) {
    this.bloomPass.strength = clamp(value / 100, 0, 1) * 1.2;
  }

  private onPointer = (e: PointerEvent) => {
    clearTimeout(this.hoverClearTimer);
    this.mouse.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1)
    );
    this.pointerOnScene = e.target === this.renderer.domElement;
    if (!this.pointerOnScene) this.pyramid.clearHover();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      this.hoverClearTimer = window.setTimeout(this.onPointerLeave, 650);
    }
  };

  private onPointerLeave = () => {
    clearTimeout(this.hoverClearTimer);
    this.pointerOnScene = false;
    this.pyramid.clearHover();
  };

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewScale = clamp(this.camera.aspect / 1.3, 0.3, 1);
    this.pyramid.resize(this.viewScale);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.renderer.shadowMap.needsUpdate = true;
    for (const t of this.texts) {
      if (t.scaleWithAspect) t.baseScale = this.viewScale;
      else t.mesh.visible = this.camera.aspect >= 1.15;
    }
  };

  /* ------------------------------- loop ------------------------------ */
  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const rawDt = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;
    const t = this.time;
    const s = this.state;

    this.adaptQuality(rawDt * 1000);

    // smooth cursor
    const k = 1 - Math.pow(0.001, dt / 1.4);
    this.mouseS.lerp(this.mouse, k);
    const mx = this.mouseS.x * s.mouse;
    const my = this.mouseS.y * s.mouse;

    // ----- camera: intro turn, then slow orbit that follows the cursor -----
    const scale = this.viewScale;
    const R = s.radius * s.dolly * scale;
    // During the intro the scripted azimuth rules; afterwards only the mouse steers it.
    const az = s.azimuth + (Math.sin(t * 0.09) * 0.16 + mx * 0.32) * s.mouse;
    const camY = s.height * scale + my * 2.2 * s.mouse;

    // ----- FPS head-bob tied to forward speed -----
    const vel = Math.abs(R - this.lastR) / Math.max(dt, 1e-4);
    this.lastR = R;
    this.smoothVel += (vel - this.smoothVel) * (1 - Math.pow(0.0005, dt));
    this.walk += this.smoothVel * dt * 0.2;
    const bob = Math.min(this.smoothVel * 0.006, 0.5) * s.mouse;

    const cam = this.camera;
    const targetY = s.lookY;
    cam.position.set(
      TARGET.x + R * Math.sin(az) + Math.cos(this.walk) * bob * 0.5,
      camY + Math.sin(this.walk * 2) * bob * 0.6,
      TARGET.z + R * Math.cos(az)
    );
    // storm shake
    const shake = s.storm * 0.06;
    if (shake > 0) {
      cam.position.x += Math.sin(t * 31.0) * shake + Math.sin(t * 17.3) * shake;
      cam.position.y += Math.sin(t * 27.0 + 1.3) * shake * 0.6;
    }
    if (s.storm > 0.7) {
      const heavyShake = ((s.storm - 0.7) / 0.3) * 0.02;
      cam.position.x += (Math.random() - 0.5) * heavyShake;
      cam.position.y += (Math.random() - 0.5) * heavyShake * 0.6;
    }
    cam.lookAt(TARGET.x + mx * 2.0, targetY + my * 1.2 * s.mouse, TARGET.z);
    cam.rotateZ(Math.cos(this.walk) * bob * 0.012 - mx * 0.012);

    // 3D ambience follows the camera: how loud, which way the wind blows, how much fire shows.
    if (this.onAudioFrame) {
      this.onAudioFrame(cam.position.distanceTo(TARGET), Math.sin(az), this.pyramid.dispersedAmount);
    }

    const normalFov = BASE_FOV + Math.min(this.smoothVel * 0.22, 24) + s.storm * 4;
    const introFov = s.fov + Math.sin(t * 2) * 3; // slow face in/out while the field builds
    const fov = THREE.MathUtils.lerp(normalFov, introFov, s.fovWeight);
    if (Math.abs(fov - cam.fov) > 0.005) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // ----- uniforms -----
    this.shared.uTime.value = t;
    this.shared.uStorm.value = s.storm;
    this.revealUniform.value = s.reveal;
    this.stormSystem.update(cam);

    this.pyramid.update(t, dt);
    this.camel.update(t, this.stormSystem.intensity);
    if (this.pointerOnScene && s.mouse > 0.1) this.pyramid.pick(this.mouse, cam, t);
    else this.pyramid.clearHover();

    // Sub-pixel breathing does not need a new shadow map on every display frame.
    if (t - this.lastShadowUpdate >= 1 / 24) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowUpdate = t;
    }

    // infinite ground + sky follow the camera (ground snaps to its grid: no swimming)
    this.ground.position.x = Math.round(cam.position.x / this.cellSize) * this.cellSize;
    this.ground.position.z = Math.round(cam.position.z / this.cellSize) * this.cellSize;
    this.sky.position.copy(cam.position);

    // 3D text: billboard around Y, gentle float
    for (const tp of this.texts) {
      const m = tp.mesh;
      m.rotation.y = Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z);
      const scale = tp.scaleWithAspect ? this.viewScale : 1;
      m.position.y = (tp.baseY + Math.sin(t * 0.5 + tp.floatSeed) * 0.35) * scale;
      m.scale.setScalar(tp.baseScale);
    }

    this.composer.render();
  };

  /** Drop resolution if the GPU can't hold ~60fps. */
  private adaptQuality(ms: number) {
    if (ms <= 0 || ms > 250) return;
    this.frameAvg += (ms - this.frameAvg) * 0.05;
    this.frameCount++;
    if (this.frameCount > 90 && this.frameAvg > 23 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.shared.uPixelRatio.value = this.pixelRatio;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.bloomPass.setSize(window.innerWidth, window.innerHeight);
      this.frameCount = 0;
      this.frameAvg = 16;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointer);
    window.removeEventListener("pointerdown", this.onPointer);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerLeave);
    window.removeEventListener("blur", this.onPointerLeave);
    this.renderer.domElement.removeEventListener("pointerleave", this.onPointerLeave);
    clearTimeout(this.hoverClearTimer);
    gsap.killTweensOf(this.state);
    this.pyramid.dispose();
    this.stormSystem.dispose();
    this.camel.dispose();
    this.composer.dispose();
    this.bloomPass.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.scene.clear();
    this.renderer.dispose();
  }
}
