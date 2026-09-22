import bpy
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
TEXTURE_DIR = PROJECT_DIR / "blend-files" / "PyramidSandstoneTextures"
OUTPUT_DIR = PROJECT_DIR / "public" / "textures"

DIFF_PATH = TEXTURE_DIR / "sandstone_cracks_diff_1k.jpg"
ARM_PATH = TEXTURE_DIR / "sandstone_cracks_arm_1k.jpg"
NORMAL_PATH = TEXTURE_DIR / "sandstone_cracks_nor_gl_1k.exr"


def load_image(path, color_space):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = color_space
    return image


# Reproduces the authored "Sandstone Cracks 1K - Test" material
# (Mix (Legacy), blend_type=MULTIPLY, Fac=0.35: Color1=diffuse, Color2=ARM.R)
# so the web material matches the Blender preview instead of approximating it.
diff = load_image(DIFF_PATH, "sRGB")
arm = load_image(ARM_PATH, "Non-Color")
if diff.size[:] != arm.size[:]:
    raise RuntimeError("Sandstone diffuse and ARM maps must have matching sizes")

width, height = diff.size[:]
diff_pixels = list(diff.pixels)
arm_pixels = list(arm.pixels)
base_pixels = [0.0] * len(diff_pixels)
roughness_pixels = [0.0] * len(arm_pixels)

for index in range(0, len(diff_pixels), 4):
    ao = arm_pixels[index]
    factor = 0.65 + 0.35 * ao
    base_pixels[index] = diff_pixels[index] * factor
    base_pixels[index + 1] = diff_pixels[index + 1] * factor
    base_pixels[index + 2] = diff_pixels[index + 2] * factor
    base_pixels[index + 3] = 1.0

    roughness = arm_pixels[index + 1]
    roughness_pixels[index:index + 4] = (roughness, roughness, roughness, 1.0)

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

basecolor = bpy.data.images.new("Pyramid Base Color + AO", width, height, alpha=False)
basecolor.colorspace_settings.name = "sRGB"
basecolor.pixels.foreach_set(base_pixels)
basecolor.filepath_raw = str(OUTPUT_DIR / "pyramid-basecolor.jpg")
basecolor.file_format = "JPEG"
basecolor.save()

roughness_image = bpy.data.images.new("Pyramid Roughness", width, height, alpha=False)
roughness_image.colorspace_settings.name = "Non-Color"
roughness_image.pixels.foreach_set(roughness_pixels)
roughness_image.filepath_raw = str(OUTPUT_DIR / "pyramid-roughness.jpg")
roughness_image.file_format = "JPEG"
roughness_image.save()

# The normal map only needs re-encoding (OpenGL tangent space already matches
# Three.js/WebGL, so no channel flip), but it has to go through Blender because
# nothing in the web toolchain here can decode EXR.
normal = load_image(NORMAL_PATH, "Non-Color")
normal_copy = bpy.data.images.new("Pyramid Normal", normal.size[0], normal.size[1], alpha=False)
normal_copy.colorspace_settings.name = "Non-Color"
normal_copy.pixels.foreach_set(list(normal.pixels))
normal_copy.filepath_raw = str(OUTPUT_DIR / "pyramid-normal.jpg")
normal_copy.file_format = "JPEG"
normal_copy.save()

print(f"WEB_TEXTURES={OUTPUT_DIR}")
for name in ("pyramid-basecolor.jpg", "pyramid-roughness.jpg", "pyramid-normal.jpg"):
    print(f"WEB_TEXTURE_BYTES={name}={(OUTPUT_DIR / name).stat().st_size}")
