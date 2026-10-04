import * as THREE from "three";

// ambientCG Rock035 / Limestone001 / Sandstone002 4K zips 404 from this environment
// (ambientcg.com/get returns 404). Poly Haven Sandstone Blocks 05 is the closest
// CC0 Giza-like limestone with all 5 PBR maps. 1K is used so 181 displaced
// meshes can hold 60fps; 4K would be ~7–12 MB per map.
const BASE = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sandstone_blocks_05/sandstone_blocks_05";
export const SANDSTONE_TEXTURES = {
  diffuse: `${BASE}_diff_1k.jpg`,
  normal: `${BASE}_nor_gl_1k.jpg`,
  roughness: `${BASE}_rough_1k.jpg`,
  displacement: `${BASE}_disp_1k.jpg`,
  ao: `${BASE}_ao_1k.jpg`,
};

export type SandstoneKind = keyof typeof SANDSTONE_TEXTURES;

export function configureStoneTexture(
  texture: THREE.Texture,
  color: boolean,
  anisotropy: number
) {
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(anisotropy, 8);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

export function averageLinearLuma(texture: THREE.Texture): number {
  try {
    const image = texture.image as {
      data?: ArrayLike<number>;
      width: number;
      height: number;
    } & CanvasImageSource;
    let pixels: ArrayLike<number>;
    if (image.data) {
      pixels = image.data;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, 32, 32);
      pixels = ctx.getImageData(0, 0, 32, 32).data;
    }
    let sum = 0;
    let count = 0;
    for (let i = 0; i + 2 < pixels.length; i += 4) {
      sum +=
        0.2126 * srgbToLinear(pixels[i] / 255) +
        0.7152 * srgbToLinear(pixels[i + 1] / 255) +
        0.0722 * srgbToLinear(pixels[i + 2] / 255);
      count++;
    }
    return count ? Math.max(0.02, sum / count) : 0.5;
  } catch {
    return 0.5;
  }
}

/** Matching 5-map set so the hero never waits on a CDN. */
export function makeSandstoneFallback(anisotropy: number): Record<SandstoneKind, THREE.Texture> {
  const size = 256;
  const heights = new Float32Array(size * size);
  const diffuse = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Uint8Array(size * size * 4);
  const ao = new Uint8Array(size * size * 4);
  let seed = 23149;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const tau = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * tau;
      const v = (y / size) * tau;
      const strata = Math.sin(v * 12 + Math.sin(u * 3) * 0.8);
      const weather = Math.sin(u * 7 + v * 3) * Math.sin(v * 5 - u * 2);
      const pores = random() > 0.97 ? -0.2 : 0;
      const h = 0.5 + strata * 0.065 + weather * 0.1 + (random() - 0.5) * 0.17 + pores;
      const index = y * size + x;
      heights[index] = h;
      const c = Math.round(176 + h * 69);
      diffuse.set([c, c - 5, c - 12, 255], index * 4);
      const r = Math.round(255 * THREE.MathUtils.clamp(0.9 - (h - 0.5) * 0.5, 0.7, 1));
      roughness.set([r, r, r, 255], index * 4);
      const hv = Math.round(255 * THREE.MathUtils.clamp(h, 0, 1));
      height.set([hv, hv, hv, 255], index * 4);
      const a = Math.round(255 * THREE.MathUtils.clamp(0.55 + h * 0.45, 0, 1));
      ao.set([a, a, a, 255], index * 4);
    }
  }

  const at = (x: number, y: number) =>
    heights[((y + size) % size) * size + ((x + size) % size)];
  const n = new THREE.Vector3();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      n.set((at(x - 1, y) - at(x + 1, y)) * 2, (at(x, y - 1) - at(x, y + 1)) * 2, 1).normalize();
      normal.set(
        [Math.round((n.x * 0.5 + 0.5) * 255), Math.round((n.y * 0.5 + 0.5) * 255), Math.round((n.z * 0.5 + 0.5) * 255), 255],
        (y * size + x) * 4
      );
    }
  }

  return {
    diffuse: configureStoneTexture(new THREE.DataTexture(diffuse, size, size), true, anisotropy),
    normal: configureStoneTexture(new THREE.DataTexture(normal, size, size), false, anisotropy),
    roughness: configureStoneTexture(new THREE.DataTexture(roughness, size, size), false, anisotropy),
    displacement: configureStoneTexture(new THREE.DataTexture(height, size, size), false, anisotropy),
    ao: configureStoneTexture(new THREE.DataTexture(ao, size, size), false, anisotropy),
  };
}
