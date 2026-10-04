import * as THREE from "three";

/**
 * One realistic dromedary camel standing guard beside the pyramid.
 *
 * A single-file bundle cannot fetch a Sketchfab/TurboSquid GLB at runtime, so the animal is
 * built from smooth high-poly primitives with real anatomy rather than boxes:
 *   body   LatheGeometry  - barrel chest tapering to the rump
 *   hump   SphereGeometry 32 segments
 *   neck   TubeGeometry along a CatmullRomCurve3 - the true S-curve
 *   head   sphere cranium + tapered muzzle + 2 cones (ears) + 2 black spheres (eyes)
 *   legs   4 legs, thigh + shin with a knee joint, 16-segment cylinders
 *   tail   cylinder + tuft
 * All smooth-shaded with a procedural fur colour + bump map.
 *
 * It never walks. Head, neck, ears, legs, tail and chest all move continuously and slowly.
 * Above 75% storm it folds down into a sitting pose.
 */

interface Leg {
  root: THREE.Group;
  thigh: THREE.Group;
  shin: THREE.Group;
  baseY: number;
  phase: number;
}

function furMaps() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#b89a6a";
  ctx.fillRect(0, 0, size, size);
  // Hair strokes: darker guard hairs and lighter sun-bleached tips.
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = 0.04 + Math.random() * 0.13;
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(120,92,58,${a})` : `rgba(226,202,160,${a})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y + 1.5 + Math.random() * 4);
    ctx.stroke();
  }
  const color = new THREE.CanvasTexture(canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.RepeatWrapping;

  // Greyscale copy drives a bump map so the coat catches light.
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d")!;
  bctx.drawImage(canvas, 0, 0);
  const img = bctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  bctx.putImageData(img, 0, 0);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { color, bump };
}

export class Camel {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private torso!: THREE.Mesh;
  private hump!: THREE.Mesh;
  private neck = new THREE.Group();
  private headGroup = new THREE.Group();
  private earL = new THREE.Group();
  private earR = new THREE.Group();
  private tail = new THREE.Group();
  private legs: Leg[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];
  private sit = 0;
  private sitTarget = 0;
  private footOffset = 0;
  private baseRotationY = 0;

  constructor() {
    this.group.name = "Camel guarding the pyramid";
    this.build();
  }

  private track<T extends THREE.BufferGeometry>(geo: T) {
    this.geometries.push(geo);
    return geo;
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private build() {
    const { color, bump } = furMaps();
    this.textures.push(color, bump);

    const coat = new THREE.MeshStandardMaterial({
      color: 0xb89a6a,
      map: color,
      bumpMap: bump,
      bumpScale: 0.012,
      roughness: 0.85,
      metalness: 0,
      flatShading: false,
    });
    const coatDark = new THREE.MeshStandardMaterial({
      color: 0xa08055,
      map: color,
      bumpMap: bump,
      bumpScale: 0.012,
      roughness: 0.88,
      metalness: 0,
    });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x4a382a, roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120c07, roughness: 0.3 });
    this.materials.push(coat, coatDark, hoofMat, eyeMat);

    this.group.add(this.body);

    // ---- torso: lathe profile, barrel chest tapering back to the rump ----
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = -0.9 + t * 1.8; // nose-to-tail axis
      // Deeper at the chest (t~0.35), slimmer at the rump.
      const r = 0.30 + Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.20 - Math.max(0, t - 0.75) * 0.22;
      profile.push(new THREE.Vector2(Math.max(0.05, r), x));
    }
    const torsoGeo = this.track(new THREE.LatheGeometry(profile, 32));
    torsoGeo.rotateZ(-Math.PI / 2);
    torsoGeo.computeVertexNormals();
    this.torso = this.add(this.body, torsoGeo, coat);
    this.torso.position.y = 1.5;

    // ---- hump ----
    const humpGeo = this.track(new THREE.SphereGeometry(0.36, 32, 24));
    this.hump = this.add(this.body, humpGeo, coat);
    this.hump.position.set(-0.02, 1.95, 0);
    this.hump.scale.set(1.2, 0.85, 0.92);

    // ---- neck: real S-curve via TubeGeometry ----
    this.neck.position.set(0.55, 1.62, 0);
    this.body.add(this.neck);
    const neckCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.12, 0.28, 0),
      new THREE.Vector3(0.16, 0.56, 0),
      new THREE.Vector3(0.26, 0.82, 0),
    ]);
    const neckGeo = this.track(
      new THREE.TubeGeometry(neckCurve, 20, 0.15, 16, false)
    );
    // Taper: thinner toward the head.
    const np = neckGeo.attributes.position;
    for (let i = 0; i < np.count; i++) {
      const y = np.getY(i);
      const k = THREE.MathUtils.clamp(1 - (y / 0.9) * 0.35, 0.6, 1);
      np.setX(i, np.getX(i) * k);
      np.setZ(i, np.getZ(i) * k);
    }
    neckGeo.computeVertexNormals();
    this.add(this.neck, neckGeo, coat);

    // ---- head ----
    this.headGroup.position.set(0.26, 0.86, 0);
    this.neck.add(this.headGroup);
    const cranium = this.track(new THREE.SphereGeometry(0.15, 24, 18));
    const craniumMesh = this.add(this.headGroup, cranium, coat);
    craniumMesh.scale.set(1.15, 1, 0.95);
    const muzzleGeo = this.track(new THREE.CylinderGeometry(0.07, 0.11, 0.3, 16));
    const muzzle = this.add(this.headGroup, muzzleGeo, coatDark);
    muzzle.rotation.z = -Math.PI / 2;
    muzzle.position.set(0.22, -0.03, 0);
    const lipGeo = this.track(new THREE.SphereGeometry(0.075, 16, 12));
    const lip = this.add(this.headGroup, lipGeo, coatDark);
    lip.position.set(0.37, -0.04, 0);
    lip.scale.set(0.9, 0.8, 1);

    const eyeGeo = this.track(new THREE.SphereGeometry(0.033, 12, 10));
    const e1 = this.add(this.headGroup, eyeGeo, eyeMat);
    e1.position.set(0.07, 0.07, 0.115);
    const e2 = this.add(this.headGroup, eyeGeo, eyeMat);
    e2.position.set(0.07, 0.07, -0.115);

    // Ears: cones
    const earGeo = this.track(new THREE.ConeGeometry(0.05, 0.14, 12));
    this.earL.position.set(-0.06, 0.14, 0.09);
    this.headGroup.add(this.earL);
    const earLMesh = this.add(this.earL, earGeo, coatDark);
    earLMesh.rotation.x = 0.35;
    this.earR.position.set(-0.06, 0.14, -0.09);
    this.headGroup.add(this.earR);
    const earRMesh = this.add(this.earR, earGeo, coatDark);
    earRMesh.rotation.x = -0.35;

    // ---- tail ----
    this.tail.position.set(-0.86, 1.6, 0);
    this.body.add(this.tail);
    const tailGeo = this.track(new THREE.CylinderGeometry(0.03, 0.045, 0.5, 12));
    const tailMesh = this.add(this.tail, tailGeo, coatDark);
    tailMesh.position.y = -0.25;
    const tuftGeo = this.track(new THREE.SphereGeometry(0.06, 12, 10));
    const tuft = this.add(this.tail, tuftGeo, hoofMat);
    tuft.position.y = -0.52;
    tuft.scale.set(0.8, 1.3, 0.8);

    // ---- legs: thigh + shin with a knee ----
    const thighGeo = this.track(new THREE.CylinderGeometry(0.085, 0.065, 0.55, 16));
    const shinGeo = this.track(new THREE.CylinderGeometry(0.055, 0.042, 0.55, 16));
    const kneeGeo = this.track(new THREE.SphereGeometry(0.07, 12, 10));
    const hoofGeo = this.track(new THREE.CylinderGeometry(0.075, 0.085, 0.1, 12));
    const spec: [number, number, number][] = [
      [0.5, 0.22, 0],
      [0.5, -0.22, Math.PI],
      [-0.52, 0.22, 1],
      [-0.52, -0.22, 2],
    ];
    for (const [x, z, phase] of spec) {
      const root = new THREE.Group();
      const baseY = 1.3;
      root.position.set(x, baseY, z);
      this.body.add(root);

      const thigh = new THREE.Group();
      root.add(thigh);
      const thighMesh = this.add(thigh, thighGeo, coat);
      thighMesh.position.y = -0.275;

      const shin = new THREE.Group();
      shin.position.y = -0.55;
      thigh.add(shin);
      this.add(shin, kneeGeo, coatDark);
      const shinMesh = this.add(shin, shinGeo, coatDark);
      shinMesh.position.y = -0.275;
      const hoofMesh = this.add(shin, hoofGeo, hoofMat);
      hoofMesh.position.y = -0.57;

      this.legs.push({ root, thigh, shin, baseY, phase });
    }

    // Normalise to a real 2.2 m animal beside ~0.7 m pyramid blocks. The parts above are
    // authored at roughly 2.3 units tall, so measure the actual bounds and derive the scale
    // instead of multiplying an already-tall model.
    this.body.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.body);
    const rawHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
    const scale = 2.2 / rawHeight;
    this.group.scale.setScalar(scale);
    // Stand the hooves on the sand rather than letting the model sink or hover.
    this.footOffset = -bounds.min.y * scale;

    // Beside the pyramid, clear of the silhouette, angled so it reads as guarding it.
    this.group.position.set(-7.5, this.footOffset, 9.0);
    // The model faces +X locally; lookAt aims -Z, so turn a quarter turn after aiming.
    this.group.lookAt(0, this.footOffset, 0);
    this.group.rotateY(Math.PI / 2);
    this.baseRotationY = this.group.rotation.y;
  }

  update(time: number, stormAmount: number) {
    // Storm above 75%: fold down into a sit.
    this.sitTarget = stormAmount >= 0.75 ? 1 : 0;
    this.sit += (this.sitTarget - this.sit) * 0.015;
    const sit = this.sit;
    const awake = 1 - sit;

    // Breathing - whole body
    this.body.scale.y = 1 + Math.sin(time * 0.7) * 0.025;
    this.body.scale.x = 1 + Math.sin(time * 0.7) * 0.01;
    this.hump.position.y = 1.95 + Math.sin(time * 0.7) * 0.02;

    // Head moving slowly left-right + up-down, all the time
    this.headGroup.rotation.y = Math.sin(time * 0.45) * 0.25 * awake;
    this.headGroup.rotation.x = Math.sin(time * 0.33) * 0.12 * awake + sit * 0.3;
    this.headGroup.rotation.z = Math.sin(time * 0.5) * 0.05 * awake;

    // Ears twitch
    this.earL.rotation.z = Math.sin(time * 2.5) * 0.3 * awake;
    this.earR.rotation.z = Math.cos(time * 2.3) * 0.3 * awake;

    // Neck swaying
    this.neck.rotation.x = Math.sin(time * 0.4) * 0.08 * awake;
    this.neck.rotation.y = Math.sin(time * 0.35) * 0.12 * awake;
    this.neck.rotation.z = -sit * 0.5;

    // Legs: slow weight shift while standing, folded when sitting
    for (const leg of this.legs) {
      const shift = Math.sin(time * 0.6 + leg.phase);
      leg.root.position.y = leg.baseY + shift * 0.04 * awake;
      leg.thigh.rotation.x = shift * 0.08 * awake + sit * 1.2;
      leg.shin.rotation.x = -sit * 2.0;
    }

    // Tail flick, slow with occasional faster flicks
    this.tail.rotation.z = 0.2 + Math.sin(time * 1.2) * 0.25 * awake;
    this.tail.rotation.x = Math.sin(time * 3.5) * 0.15 * awake;

    // Whole camel subtle sway, and drops as it sits
    this.group.position.y = this.footOffset + Math.sin(time * 0.55) * 0.04 * awake - sit * 0.5;
    // Very slow idle turn of the whole animal so it never looks frozen.
    this.group.rotation.y = this.baseRotationY + Math.sin(time * 0.18) * 0.05 * awake;
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
    this.textures.length = 0;
    this.legs.length = 0;
    this.group.clear();
  }
}
